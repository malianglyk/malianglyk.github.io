"""POST /api/timetable/generate — ML-optimized daily schedule
POST /api/timetable/order   — record manual reorder + pairwise comparisons
"""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from typing import List

from database import get_db
from models import Task, User, UserConstraints, SlotOut, ReorderIn
from auth import get_current_user
from ml_engine import (
    encode_task, score_tasks, get_default_weights,
    record_pairwise_comparisons, fmt_time,
)

router = APIRouter(prefix="/api/timetable", tags=["timetable"])


# ---------------------------------------------------------------------------
#  Slot assignment with constraints
# ---------------------------------------------------------------------------

def build_slots(
    scored_tasks: list[tuple[Task, float]],
    constraints: UserConstraints | None,
) -> list[dict]:
    """Given scored & sorted tasks, build a timetable respecting constraints.

    Logic:
      - Available windows are [wake_up, school_start] + [school_end, sleep_time]
      - Tasks are placed in order of score (highest first).
      - Breaks are inserted between tasks.
      - Lunch break around midday.
    """
    # Default constraints if none set
    wake_up = constraints.wake_up_time if constraints else 420   # 7:00 AM
    sleep_at = constraints.sleep_time if constraints else 1320   # 10:00 PM
    school_s = constraints.school_start if constraints else 480  # 8:00 AM
    school_e = constraints.school_end if constraints else 900    # 3:00 PM

    # Build available windows (list of (start, end) in minutes)
    windows: list[tuple[int, int]] = []

    # Morning window: wake_up → school_start (if there's time)
    if school_s - wake_up >= 30:
        windows.append((wake_up, school_s))

    # Afternoon/evening window: school_end → sleep_time
    if sleep_at - school_e >= 30:
        windows.append((school_e, sleep_at))

    # If no school constraint set (both 0), use full day
    if not windows:
        windows.append((wake_up, sleep_at))

    slots: list[dict] = []
    win_idx = 0
    cursor = windows[0][0] if windows else wake_up

    for i, (task, score) in enumerate(scored_tasks):
        task_dur = task.duration

        # Find a window that can fit this task
        placed = False
        attempts = 0
        while not placed and attempts < len(windows):
            win_start, win_end = windows[win_idx % len(windows)]

            if cursor < win_start:
                cursor = win_start

            if cursor + task_dur <= win_end:
                # Task fits in current window
                start_min = cursor
                end_min = cursor + task_dur
                placed = True
            else:
                # Move to next window
                win_idx += 1
                cursor = windows[win_idx % len(windows)][0]
                attempts += 1

        if not placed:
            # No window can fit this task → skip it
            continue

        slots.append({
            "task_id": task.id,
            "name": task.name,
            "category": task.category,
            "priority": task.priority,
            "duration": task.duration,
            "deadline": task.deadline,
            "difficulty": task.difficulty,
            "is_paper_based": task.is_paper_based,
            "start_time": fmt_time(start_min),
            "end_time": fmt_time(end_min),
            "is_break": False,
        })
        cursor = end_min

        # Insert a break after this task (unless it's the last one)
        if i < len(scored_tasks) - 1:
            # Determine break length
            hour_of_day = start_min / 60.0
            if 11.5 <= hour_of_day < 13.0:
                break_len = 45
                label = "🍱 Lunch Break"
            elif i % 3 == 2:
                break_len = 20
                label = "☕ Short Break"
            else:
                break_len = 10
                label = "☕ Quick Break"

            # Make sure break fits in the current window
            next_win_end = windows[win_idx % len(windows)][1]
            break_end = min(cursor + break_len, next_win_end)

            slots.append({
                "task_id": None,
                "name": label,
                "category": "",
                "priority": "low",
                "duration": break_end - cursor,
                "deadline": None,
                "difficulty": None,
                "is_paper_based": None,
                "start_time": fmt_time(cursor),
                "end_time": fmt_time(break_end),
                "is_break": True,
            })
            cursor = break_end

    return slots


# ---------------------------------------------------------------------------
#  POST /api/timetable/generate
# ---------------------------------------------------------------------------

@router.post("/generate", response_model=List[SlotOut])
def generate_timetable(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Generate an ML-optimised daily timetable.

    - Encodes each task as a feature vector.
    - Scores using learned or default preference weights.
    - Assigns tasks to time slots honouring user constraints.
    """
    tasks = db.query(Task).filter(Task.user_id == user.id).all()

    if not tasks:
        return []

    # Load user constraints
    constraints = db.query(UserConstraints).filter(
        UserConstraints.user_id == user.id
    ).first()

    # Load or default weights
    from models import UserPreferences, PairwiseComparison
    import json

    pref = db.query(UserPreferences).filter(
        UserPreferences.user_id == user.id
    ).first()

    num_pairs = db.query(PairwiseComparison).filter(
        PairwiseComparison.user_id == user.id
    ).count()

    weights = get_default_weights()
    if pref and pref.weights_json and num_pairs >= 5:
        try:
            stored = json.loads(pref.weights_json)
            if len(stored) == 13:
                weights = [stored.get(str(i), weights[i]) for i in range(13)]
        except (json.JSONDecodeError, KeyError):
            pass

    # Score & sort
    scored = score_tasks(tasks, weights, constraints)

    # Build timetable slots
    slots = build_slots(scored, constraints)

    return slots


# ---------------------------------------------------------------------------
#  POST /api/timetable/order
# ---------------------------------------------------------------------------

@router.post("/order", response_model=List[SlotOut])
def reorder_timetable(
    body: ReorderIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Accept a manually reordered task list.

    - Records all pairwise comparisons (A before B → A > B).
    - Updates task_order_index on each task.
    - Returns the full timetable.
    """
    ordered_ids = body.ordered_task_ids

    # Validate that all tasks belong to the user
    user_task_ids = {
        t.id for t in db.query(Task).filter(Task.user_id == user.id).all()
    }
    for tid in ordered_ids:
        if tid not in user_task_ids:
            from fastapi import HTTPException
            raise HTTPException(status_code=400, detail=f"Task {tid} not found")

    # Record pairwise comparisons
    record_pairwise_comparisons(user.id, ordered_ids, db)

    # Update task_order_index
    for idx, tid in enumerate(ordered_ids):
        task = db.query(Task).filter(Task.id == tid, Task.user_id == user.id).first()
        if task:
            task.task_order_index = idx
    db.commit()

    # Return the regenerated timetable
    return generate_timetable(db=db, user=user)
