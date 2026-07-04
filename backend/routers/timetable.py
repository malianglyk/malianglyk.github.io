"""POST /api/timetable/generate — produce an optimized daily schedule."""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from typing import List
from pydantic import BaseModel

from database import get_db
from models import Task, User
from auth import get_current_user

router = APIRouter(prefix="/api/timetable", tags=["timetable"])


class SlotOut(BaseModel):
    name: str
    category: str
    priority: str
    duration: int
    deadline: str | None
    start_time: str      # e.g. "8:00 AM"
    end_time: str
    is_break: bool = False

    model_config = {"from_attributes": True}


def fmt_time(total_minutes: int) -> str:
    h = total_minutes // 60
    m = total_minutes % 60
    ampm = "AM" if h < 12 else "PM"
    h12 = h if h <= 12 else h - 12
    if h12 == 0:
        h12 = 12
    return f"{h12}:{m:02d} {ampm}"


@router.post("/generate", response_model=List[SlotOut])
def generate_timetable(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    tasks = db.query(Task).filter(Task.user_id == user.id).all()

    prio_order = {"high": 0, "medium": 1, "low": 2}
    sorted_tasks = sorted(tasks, key=lambda t: (
        prio_order.get(t.priority, 2),
        t.deadline or "9999-99-99",
        -t.duration,
    ))

    slots: list[dict] = []
    current_min = 8 * 60   # 8:00 AM
    END_DAY = 21 * 60      # 9:00 PM

    for i, task in enumerate(sorted_tasks):
        start_min = current_min
        end_min = min(current_min + task.duration, END_DAY)
        if start_min >= END_DAY:
            break

        slots.append({
            "name": task.name,
            "category": task.category,
            "priority": task.priority,
            "duration": task.duration,
            "deadline": task.deadline,
            "start_time": fmt_time(start_min),
            "end_time": fmt_time(end_min),
            "is_break": False,
        })
        current_min = end_min

        # insert breaks
        if i < len(sorted_tasks) - 1:
            break_len = 45 if (11.5 * 60 <= start_min < 12.5 * 60) else (20 if i % 3 == 2 else 10)
            break_end = min(current_min + break_len, END_DAY)
            label = "🍱 Lunch Break" if break_len >= 30 else "☕ Short Break"
            slots.append({
                "name": label,
                "category": "", "priority": "low", "duration": break_len,
                "deadline": None,
                "start_time": fmt_time(current_min),
                "end_time": fmt_time(break_end),
                "is_break": True,
            })
            current_min = break_end

    return slots
