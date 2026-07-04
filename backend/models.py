"""SQLAlchemy ORM models + Pydantic request/response schemas."""
from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey
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
    created_at = Column(DateTime, default=datetime.utcnow)

    tasks = relationship("Task", back_populates="owner", cascade="all, delete-orphan")


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
    deadline = Column(String(20), nullable=True)       # "YYYY-MM-DD"
    description = Column(String(500), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    owner = relationship("User", back_populates="tasks")


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

class TaskUpdate(BaseModel):
    name: Optional[str] = None
    category: Optional[str] = None
    priority: Optional[str] = None
    duration: Optional[int] = Field(default=None, ge=5, le=480)
    deadline: Optional[str] = None
    description: Optional[str] = None

class TaskOut(BaseModel):
    id: int
    user_id: int
    name: str
    category: str
    priority: str
    duration: int
    deadline: Optional[str]
    description: Optional[str]
    created_at: datetime

    model_config = {"from_attributes": True}
