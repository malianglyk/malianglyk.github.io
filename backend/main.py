"""
Student Planner — FastAPI Backend
==================================
Run:  cd backend && uvicorn main:app --reload --port 8000

Endpoints:
  /api/auth/signup          POST   create account
  /api/auth/login           POST   get JWT token
  /api/auth/me              GET    current user
  /api/tasks                GET    list tasks
  /api/tasks                POST   create task
  /api/tasks/{id}           PUT    update task
  /api/tasks/{id}           DELETE
  /api/timetable/generate      POST   generate schedule (ML-optimised)
  /api/timetable/order         POST   record manual reorder
  /api/timetable/slots         PUT    update individual break/meal times
  /api/resources/web-search    POST   Baidu web search
  /api/resources/search-by-tasks POST search web for each task
  /api/preferences/constraints GET/PUT user time constraints
  /api/preferences/weights     GET    ML feature weights
  /api/preferences/train       POST   train ML model
  /api/preferences/stats       GET    model training stats
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from database import init_db
from routers import auth, tasks, timetable, resources, preferences

app = FastAPI(title="Student Planner API", version="1.0.0")

# Allow React dev server (localhost:5173) and production builds
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:3000",
        "https://student-smart-planner.pages.dev",
        "https://*.student-smart-planner.pages.dev",
        "https://student-smart-planner.studyplnr.workers.dev",
        "https://*.studyplnr.workers.dev",
        "https://*.workers.dev",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register routers
app.include_router(auth.router)
app.include_router(tasks.router)
app.include_router(timetable.router)
app.include_router(resources.router)
app.include_router(preferences.router)


@app.on_event("startup")
def on_startup():
    init_db()


@app.get("/")
def root():
    return {"message": "Student Planner API — see /docs for Swagger UI"}
