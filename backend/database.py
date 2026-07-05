"""SQLite database setup — auto-creates tables on startup."""
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, DeclarativeBase

import os
# Use persistent volume in production, local file in dev
DB_PATH = os.environ.get("DB_PATH", "./planner.db")

# Ensure the directory exists for the database file
db_dir = os.path.dirname(os.path.abspath(DB_PATH))
os.makedirs(db_dir, exist_ok=True)

DATABASE_URL = f"sqlite:///{DB_PATH}"

engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def get_db():
    """FastAPI dependency — yields a DB session per request."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db():
    """Create all tables (call once at startup)."""
    Base.metadata.create_all(bind=engine)
