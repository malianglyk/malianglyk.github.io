"""POST   /api/timetable/generate   — ML-optimised multi-day schedule
POST   /api/timetable/order     — record manual reorder + pairwise comparisons
PUT    /api/timetable/slots     — update individual slot times
DELETE /api/timetable/slots/{id} — delete a break slot
"""
from datetime import date, datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List

from database import get_db
from models import Task, User, UserConstraints, SlotOut, ReorderIn, SlotMoveIn, TimeAdjustment
from auth import get_current_user
from pydantic import BaseModel
from ml_engine import (
    encode_task, score_tasks, get_default_weights,
    record_pairwise_comparisons, fmt_time, parse_time_str,
)

router = APIRouter(prefix="/api/timetable", tags=["timetable"])

# In-memory slot store for editing (keyed by user_id)
# Format: {user_id: [slot_dict, ...]}
_slot_store: dict[int, list[dict]] = {}


def _get_or_create_constraints(db, user_id: int) -> UserConstraints:
    c = db.query(UserConstraints).filter(UserConstraints.user_id == user_id).first()
    if not c:
        c = UserConstraints(user_id=user_id)
        db.add(c)
        db.commit()
        db.refresh(c)
    return c


def is_weekend(d: date) -> bool:
    return d.weekday() >= 5


def get_day_label(d: date) -> str:
    return f"{d.strftime('%A')}, {d.strftime('%b')} {d.day}"


def _make_slot(task_id, name, category, priority, duration, deadline,
               difficulty, is_paper_based, start_time, end_time, day_str,
               day_label, is_break, is_meal, is_header, is_school, slot_id) -> dict:
    return {
        "task_id": task_id, "name": name, "category": category,
        "priority": priority, "duration": duration, "deadline": deadline,
        "difficulty": difficulty, "is_paper_based": is_paper_based,
        "start_time": start_time, "end_time": end_time,
        "date": day_str, "day_label": day_label,
        "is_break": is_break, "is_meal": is_meal,
        "is_header": is_header, "is_school": is_school,
        "slot_id": slot_id,
    }


def build_multi_day_slots(
    scored_tasks: list[tuple[Task, float]],
    constraints,
    num_days: int = 7,
) -> list[dict]:
    """Distribute scored tasks across the next `num_days` days.

    HARD CONSTRAINTS:
      - Weekdays: NO tasks during school hours (visible school blocks).
      - Weekends: full day available.
      - Meals use user-configured times and durations.
    """

    if constraints:
        wake_up = constraints.wake_up_time
        sleep_at = constraints.sleep_time
        school_s = constraints.school_start
        school_e = constraints.school_end
    else:
        wake_up, sleep_at = 420, 1320
        school_s, school_e = 480, 900

    # Break/meal times are hardcoded — user edits them inline in the timetable
    break_dur = 10
    lunch_start, lunch_dur = 720, 60
    dinner_start, dinner_dur = 1080, 60

    lunch_end = lunch_start + lunch_dur
    dinner_end = dinner_start + dinner_dur

    MEAL_BREAKS = [
        {"start": lunch_start, "end": lunch_end, "label": "🍱 Lunch"},
        {"start": dinner_start, "end": dinner_end, "label": "🍽️ Dinner"},
    ]

    today = date.today()
    slots: list[dict] = []
    task_idx = 0
    n_tasks = len(scored_tasks)
    slot_counter = [0]  # mutable counter for unique IDs

    def _sid(kind: str) -> str:
        slot_counter[0] += 1
        return f"{kind}-{slot_counter[0]}"

    for day_offset in range(num_days):
        current_date = today + timedelta(days=day_offset)
        weekend = is_weekend(current_date)
        day_str = current_date.isoformat()
        day_label = get_day_label(current_date)
        day_slots = []

        # ── Day header ──────────────────────────────────────────
        day_slots.append(_make_slot(
            None, day_label, "", "", 0, None, None, None,
            "", "", day_str, day_label,
            True, False, True, False, _sid("header"),
        ))

        if weekend:
            # Full day window
            windows = [(wake_up, sleep_at)] if sleep_at - wake_up >= 30 else []
        else:
            # Weekday: morning + evening ONLY (school blocked)
            windows = []
            if school_s - wake_up >= 30:
                windows.append((wake_up, school_s))
            if sleep_at - school_e >= 30:
                windows.append((school_e, sleep_at))
            if not windows:
                windows = [(wake_up, sleep_at)]

            # ── Add visible SCHOOL BLOCK ─────────────────────────
            if school_e - school_s >= 15:
                day_slots.append(_make_slot(
                    None, "🏫 School Hours", "", "", school_e - school_s,
                    None, None, None,
                    fmt_time(school_s), fmt_time(school_e),
                    day_str, day_label,
                    False, False, False, True, _sid("school"),
                ))

        # Split windows around meals
        clean_windows = []
        for ws, we in windows:
            cursor = ws
            meal_blocks = sorted(
                [m for m in MEAL_BREAKS if m["start"] < we and m["end"] > ws],
                key=lambda m: m["start"],
            )
            for mb in meal_blocks:
                mbs, mbe = max(mb["start"], ws), min(mb["end"], we)
                if cursor < mbs:
                    clean_windows.append((cursor, mbs))
                cursor = max(cursor, mbe)
            if cursor < we:
                clean_windows.append((cursor, we))

        # ── Add MEAL blocks ─────────────────────────────────────
        for mb in MEAL_BREAKS:
            if mb["start"] < sleep_at and mb["end"] > wake_up:
                day_slots.append(_make_slot(
                    None, mb["label"], "", "", mb["end"] - mb["start"],
                    None, None, None,
                    fmt_time(mb["start"]), fmt_time(mb["end"]),
                    day_str, day_label,
                    True, True, False, False, _sid("meal"),
                ))

        if task_idx >= n_tasks or not clean_windows:
            day_slots.sort(key=lambda s: _time_key(s["start_time"]))
            slots.extend(day_slots)
            continue

        # ── Fill windows with tasks ─────────────────────────────
        win_idx = 0
        cursor_time = clean_windows[0][0]

        while task_idx < n_tasks and win_idx < len(clean_windows):
            task, score = scored_tasks[task_idx]
            task_dur = task.duration
            ws, we = clean_windows[win_idx]

            if cursor_time < ws:
                cursor_time = ws

            if cursor_time + task_dur <= we:
                start_min = cursor_time
                end_min = cursor_time + task_dur
                day_slots.append(_make_slot(
                    task.id, task.name, task.category, task.priority,
                    task.duration, task.deadline, task.difficulty,
                    task.is_paper_based,
                    fmt_time(start_min), fmt_time(end_min),
                    day_str, day_label,
                    False, False, False, False, _sid("task"),
                ))
                cursor_time = end_min
                task_idx += 1

                # ── Break between tasks ─────────────────────────
                if task_idx < n_tasks and cursor_time + break_dur <= we:
                    day_slots.append(_make_slot(
                        None, "☕ Quick Break", "", "", break_dur,
                        None, None, None,
                        fmt_time(cursor_time), fmt_time(cursor_time + break_dur),
                        day_str, day_label,
                        True, False, False, False, _sid("break"),
                    ))
                    cursor_time += break_dur
            else:
                win_idx += 1
                if win_idx < len(clean_windows):
                    cursor_time = clean_windows[win_idx][0]

        # Sort day slots by start time
        day_slots.sort(key=lambda s: _time_key(s["start_time"]))
        slots.extend(day_slots)

        if task_idx >= n_tasks:
            break

    return slots


def _time_key(time_str: str) -> int:
    try:
        return parse_time_str(time_str)
    except Exception:
        return 0


def _sort_slots(slots: list[dict]) -> list[dict]:
    """Sort slots by (date, start_time). Day headers stay at top of each day group."""
    def _sort_key(s: dict):
        date = s.get("date") or ""
        # Headers sort first within their date
        if s.get("is_header"):
            return (date, -1)
        return (date, _time_key(s.get("start_time", "")))
    slots.sort(key=_sort_key)
    return slots


# ---------------------------------------------------------------------------
#  POST /api/timetable/generate
# ---------------------------------------------------------------------------

@router.post("/generate", response_model=List[SlotOut])
def generate_timetable(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    tasks = db.query(Task).filter(Task.user_id == user.id).all()
    if not tasks:
        _slot_store.pop(user.id, None)
        return []

    constraints = _get_or_create_constraints(db, user.id)

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

    scored = score_tasks(tasks, weights, constraints)

    has_manual = any(t.task_order_index is not None for t in tasks)
    if has_manual:
        max_order = max(
            (t.task_order_index for t in tasks if t.task_order_index is not None),
            default=0
        ) + 1
        for i, (task, score) in enumerate(scored):
            if task.task_order_index is not None:
                order_bonus = (max_order - task.task_order_index) / max_order * 2.0
                scored[i] = (task, score + order_bonus)
        scored.sort(key=lambda x: x[1], reverse=True)

    slots = build_multi_day_slots(scored, constraints)
    _slot_store[user.id] = slots
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
    ordered_ids = body.ordered_task_ids

    all_tasks = db.query(Task).filter(Task.user_id == user.id).all()
    user_task_ids = {t.id for t in all_tasks}
    task_map = {t.id: t for t in all_tasks}

    for tid in ordered_ids:
        if tid not in user_task_ids:
            raise HTTPException(status_code=400, detail=f"Task {tid} not found")

    seen = set(ordered_ids)
    full_order = list(ordered_ids)
    for t in all_tasks:
        if t.id not in seen:
            full_order.append(t.id)

    record_pairwise_comparisons(user.id, ordered_ids, db)

    for idx, tid in enumerate(full_order):
        if tid in task_map:
            task_map[tid].task_order_index = idx
    db.commit()

    constraints = _get_or_create_constraints(db, user.id)
    ordered_tasks = [task_map[tid] for tid in full_order if tid in task_map]
    scored = [(t, float(len(full_order) - i)) for i, t in enumerate(ordered_tasks)]

    slots = build_multi_day_slots(scored, constraints)
    _slot_store[user.id] = slots
    return slots


# ---------------------------------------------------------------------------
#  PUT /api/timetable/slots — update individual break/meal start_time/duration
# ---------------------------------------------------------------------------

class SlotUpdateItem(BaseModel):
    slot_id: str
    start_time: str | None = None   # "7:00 AM" format
    duration: int | None = None     # minutes


@router.put("/slots", response_model=List[SlotOut])
def update_slots(
    updates: List[SlotUpdateItem],
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Update individual slot start times and durations.
    All slot types (tasks, breaks, meals) can be edited.
    Records TimeAdjustment rows for ML training.
    """
    slots = _slot_store.get(user.id)
    if not slots:
        raise HTTPException(status_code=404, detail="No timetable generated yet")

    slot_map = {s["slot_id"]: s for s in slots}

    for upd in updates:
        if upd.slot_id not in slot_map:
            continue
        s = slot_map[upd.slot_id]

        if upd.start_time is not None:
            old_val = s.get("start_time", "")
            start_min = parse_time_str(upd.start_time)
            new_val = fmt_time(start_min)
            s["start_time"] = new_val
            # Record adjustment for ML
            _record_adjustment(db, user.id, s, "start_time", old_val, new_val)

        if upd.duration is not None and upd.duration > 0:
            old_val = str(s.get("duration", 0))
            s["duration"] = upd.duration
            # Recalculate end_time
            try:
                old_start = parse_time_str(s["start_time"])
                s["end_time"] = fmt_time(old_start + upd.duration)
            except Exception:
                pass
            # Record adjustment for ML
            _record_adjustment(db, user.id, s, "duration", old_val, str(upd.duration))

    _sort_slots(slots)
    _slot_store[user.id] = slots
    return slots


def _record_adjustment(db, user_id, slot, field, old_val, new_val):
    """Record a single field change as a TimeAdjustment row for ML training."""
    from datetime import date as dt_date
    try:
        day_str = slot.get("date", "")
        if day_str:
            d = dt_date.fromisoformat(day_str)
            dow = d.weekday()  # 0=Mon..6=Sun
        else:
            dow = None
        start_str = slot.get("start_time", "")
        hour = None
        if start_str:
            try:
                hour = parse_time_str(start_str) // 60
            except Exception:
                pass
        adj = TimeAdjustment(
            user_id=user_id,
            task_id=slot.get("task_id"),
            field=field,
            old_value=old_val,
            new_value=new_val,
            day_of_week=dow,
            hour_of_day=hour,
        )
        db.add(adj)
        db.commit()
    except Exception:
        pass  # Don't let recording failure break the save


# ---------------------------------------------------------------------------
#  DELETE /api/timetable/slots/{slot_id} — delete a break slot
# ---------------------------------------------------------------------------

@router.delete("/slots/{slot_id}", response_model=List[SlotOut])
def delete_slot(
    slot_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Delete a break slot from the timetable. Only break slots can be deleted."""
    slots = _slot_store.get(user.id)
    if not slots:
        raise HTTPException(status_code=404, detail="No timetable generated yet")

    target = None
    for s in slots:
        if s["slot_id"] == slot_id:
            target = s
            break

    if target is None:
        raise HTTPException(status_code=404, detail=f"Slot {slot_id} not found")

    if not target.get("is_break"):
        raise HTTPException(status_code=400, detail="Only break slots can be deleted")

    slots = [s for s in slots if s["slot_id"] != slot_id]
    _sort_slots(slots)
    _slot_store[user.id] = slots
    return slots


# ---------------------------------------------------------------------------
#  PUT /api/timetable/slots/{slot_id}/move — move a task to a different date
# ---------------------------------------------------------------------------

@router.put("/slots/{slot_id}/move", response_model=List[SlotOut])
def move_slot(
    slot_id: str,
    body: SlotMoveIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Move a study task slot to a different date.
    Validates that the new date is not past the task's deadline.
    Only study task slots can be moved (not breaks/meals/headers/school).
    """
    slots = _slot_store.get(user.id)
    if not slots:
        raise HTTPException(status_code=404, detail="No timetable generated yet")

    # Find the target slot
    target = None
    for s in slots:
        if s["slot_id"] == slot_id:
            target = s
            break

    if target is None:
        raise HTTPException(status_code=404, detail=f"Slot {slot_id} not found")

    # Only study tasks can be moved
    if target.get("is_break") or target.get("is_meal") or target.get("is_header") or target.get("is_school"):
        raise HTTPException(status_code=400, detail="Only study task slots can be moved between dates")

    new_date = body.new_date.strip()

    # Validate new_date format
    try:
        from datetime import date as dt_date
        new_d = dt_date.fromisoformat(new_date)
    except (ValueError, TypeError):
        raise HTTPException(status_code=400, detail=f"Invalid date format: {new_date}. Use YYYY-MM-DD.")

    # Validate not past deadline
    deadline_str = target.get("deadline")
    if deadline_str:
        try:
            dl = deadline_str.strip()[:10]
            deadline_d = dt_date.fromisoformat(dl)
            if new_d > deadline_d:
                raise HTTPException(
                    status_code=400,
                    detail=f"Cannot move past deadline ({deadline_str[:10]})"
                )
        except (ValueError, TypeError):
            pass  # If deadline is unparseable, allow the move

    # Update the slot's date and day_label
    old_date = target.get("date", "")
    target["date"] = new_date
    target["day_label"] = f"{new_d.strftime('%A')}, {new_d.strftime('%b')} {new_d.day}"

    # Record the move
    _record_adjustment(db, user.id, target, "date", old_date, new_date)

    _sort_slots(slots)
    _slot_store[user.id] = slots
    return slots
