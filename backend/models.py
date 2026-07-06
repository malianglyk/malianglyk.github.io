"""SQLAlchemy ORM models + Pydantic request/response schemas."""
from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey, Float
from sqlalchemy.orm import relationship
from datetime import datetime

from database import Base


# ---------------------------------------------------------------------------
#  ORM Model — User
# ---------------------------------------------------------------------------
class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(50), unique=True, index=True, nullable=False)
    hashed_password = Column(String(128), nullable=False)
    created_at = Column(DateTime, default=datetime.now)

    tasks = relationship("Task", back_populates="owner", cascade="all, delete-orphan")
    constraints = relationship("UserConstraints", back_populates="owner", uselist=False, cascade="all, delete-orphan")
    preferences = relationship("UserPreferences", back_populates="owner", uselist=False, cascade="all, delete-orphan")


# ---------------------------------------------------------------------------
#  ORM Model — Task
# ---------------------------------------------------------------------------
class Task(Base):
    __tablename__ = "tasks"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    name = Column(String(200), nullable=False)
    category = Column(String(50), default="Other")
    priority = Column(String(10), default="medium")   # high / medium / low
    duration = Column(Integer, default=45)             # minutes
    deadline = Column(String(50), nullable=True)       # "YYYY-MM-DD HH:MM"
    description = Column(String(500), nullable=True)
    difficulty = Column(Integer, default=3)            # 1-5 scale
    is_paper_based = Column(Boolean, default=False)    # handwritten vs digital
    task_order_index = Column(Integer, nullable=True)  # manual ordering in timetable
    created_at = Column(DateTime, default=datetime.now)

    owner = relationship("User", back_populates="tasks")


# ---------------------------------------------------------------------------
#  ORM Model — UserConstraints
# ---------------------------------------------------------------------------
class UserConstraints(Base):
    """Per-user time constraints for timetable generation.
    Times are stored as minutes since midnight (e.g. 480 = 8:00 AM).
    Break/meal times are edited directly in the timetable."""

    __tablename__ = "user_constraints"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), unique=True, nullable=False)
    wake_up_time = Column(Integer, default=420)     # 7:00 AM
    sleep_time = Column(Integer, default=1320)       # 10:00 PM
    school_start = Column(Integer, default=480)      # 8:00 AM
    school_end = Column(Integer, default=900)        # 3:00 PM

    owner = relationship("User", back_populates="constraints")


# ---------------------------------------------------------------------------
#  ORM Model — PairwiseComparison
# ---------------------------------------------------------------------------
class PairwiseComparison(Base):
    """Records "user preferred task_a BEFORE task_b" (A > B).
    These pairs train the ranking model."""

    __tablename__ = "pairwise_comparisons"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    task_a_id = Column(Integer, ForeignKey("tasks.id"), nullable=False)
    task_b_id = Column(Integer, ForeignKey("tasks.id"), nullable=False)
    created_at = Column(DateTime, default=datetime.now)

    owner = relationship("User")


# ---------------------------------------------------------------------------
#  ORM Model — UserPreferences
# ---------------------------------------------------------------------------
class UserPreferences(Base):
    """Learned feature weights and training metadata per user."""

    __tablename__ = "user_preferences"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), unique=True, nullable=False)
    weights_json = Column(String(2000), default='{}')
    num_comparisons = Column(Integer, default=0)
    last_trained_at = Column(DateTime, nullable=True)
    training_loss = Column(Float, nullable=True)

    owner = relationship("User", back_populates="preferences")


# ---------------------------------------------------------------------------
#  Pydantic Schemas
# ---------------------------------------------------------------------------
from pydantic import BaseModel, Field
from typing import Optional


# ---- Auth ----
class UserSignup(BaseModel):
    username: str = Field(..., min_length=2, max_length=50)
    password: str = Field(..., min_length=4, max_length=100)


class UserLogin(BaseModel):
    username: str
    password: str


class UserOut(BaseModel):
    id: int
    username: str
    created_at: datetime

    model_config = {"from_attributes": True}


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


# ---- Tasks ----
class TaskCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    category: str = "Other"
    priority: str = "medium"
    duration: int = Field(default=45, ge=5, le=480)
    deadline: Optional[str] = None
    description: Optional[str] = None
    difficulty: int = Field(default=3, ge=1, le=5)
    is_paper_based: bool = False


class TaskUpdate(BaseModel):
    name: Optional[str] = None
    category: Optional[str] = None
    priority: Optional[str] = None
    duration: Optional[int] = Field(default=None, ge=5, le=480)
    deadline: Optional[str] = None
    description: Optional[str] = None
    difficulty: Optional[int] = Field(default=None, ge=1, le=5)
    is_paper_based: Optional[bool] = None


class TaskOut(BaseModel):
    id: int
    user_id: int
    name: str
    category: str
    priority: str
    duration: int
    deadline: Optional[str]
    description: Optional[str]
    difficulty: int
    is_paper_based: bool
    task_order_index: Optional[int] = None
    created_at: datetime

    model_config = {"from_attributes": True}


# ---- Timetable ----
class SlotOut(BaseModel):
    task_id: int | None = None      # None for breaks/meals/headers
    name: str
    category: str
    priority: str
    duration: int
    deadline: str | None
    difficulty: int | None = None
    is_paper_based: bool | None = None
    start_time: str                 # e.g. "8:00 AM"
    end_time: str
    date: str | None = None         # "YYYY-MM-DD"
    day_label: str | None = None    # "Monday, Jul 7"
    is_break: bool = False
    is_meal: bool = False
    is_header: bool = False
    is_school: bool = False         # School-time block (no tasks allowed)
    slot_id: str = ""               # Unique ID for inline editing (e.g. "break-0", "task-5")

    model_config = {"from_attributes": True}


class SlotUpdate(BaseModel):
    """For editing individual break/meal start time and duration."""
    start_time: str | None = None   # "HH:MM" 24h format
    duration: int | None = None     # minutes


class ReorderIn(BaseModel):
    ordered_task_ids: list[int]


# ---- Constraints ----
class ConstraintsIn(BaseModel):
    wake_up_time: str = "07:00"    # "HH:MM" format, user-facing
    sleep_time: str = "22:00"
    school_start: str = "08:00"
    school_end: str = "15:00"


class ConstraintsOut(BaseModel):
    wake_up_time: str
    sleep_time: str
    school_start: str
    school_end: str


# ---- Preferences / Weights ----
class WeightsOut(BaseModel):
    weights: dict[str, float]       # e.g. {"subject_Math": 0.12, ...}
    num_comparisons: int
    last_trained_at: datetime | None
    training_loss: float | None
    is_default: bool                # True if using cold-start defaults


class TrainStatsOut(BaseModel):
    weights: dict[str, float]
    num_comparisons: int
    num_pairs_used: int
    training_loss: float
    top_features: list[tuple[str, float]]  # top 5 features by weight magnitude
    last_trained_at: datetime | None
