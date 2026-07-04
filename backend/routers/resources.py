"""GET  /api/resources/search?q=keyword   — search crawled data
POST /api/resources/analyze             — return resources for each task
"""
import json
import os
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from typing import List
from pydantic import BaseModel

from database import get_db
from models import Task, User
from auth import get_current_user

router = APIRouter(prefix="/api/resources", tags=["resources"])

DATA_FILE = os.path.join(os.path.dirname(__file__), "..", "data.json")

# Inline resource DB (same as original HTML) — fallback when data.json unavailable
RESOURCE_DB = {
    "Math": {
        "videos": [
            ["Khan Academy — Math", "https://www.khanacademy.org/math"],
            ["3Blue1Brown (YouTube)", "https://www.youtube.com/@3blue1brown"],
            ["Eddie Woo — Math Lessons", "https://www.youtube.com/@misterwootube"],
        ],
        "practice": [
            ["Wolfram Alpha", "https://www.wolframalpha.com/"],
            ["Brilliant — Interactive Math", "https://brilliant.org/math/"],
            ["IXL Math Practice", "https://www.ixl.com/math/"],
        ],
        "reference": [
            ["Desmos — Graphing Calculator", "https://www.desmos.com/calculator"],
            ["Math is Fun", "https://www.mathsisfun.com/"],
        ],
    },
    "Science": {
        "videos": [
            ["Khan Academy — Science", "https://www.khanacademy.org/science"],
            ["CrashCourse (YouTube)", "https://www.youtube.com/@crashcourse"],
            ["Veritasium (YouTube)", "https://www.youtube.com/@veritasium"],
        ],
        "practice": [
            ["PhET Interactive Simulations", "https://phet.colorado.edu/"],
            ["CK-12 Foundation", "https://www.ck12.org/"],
        ],
        "reference": [
            ["Britannica — Science", "https://www.britannica.com/browse/Science"],
            ["NASA Education", "https://www.nasa.gov/learning-resources/"],
        ],
    },
    "History": {
        "videos": [
            ["CrashCourse — History", "https://www.youtube.com/playlist?list=PLBDA2E52FB1EF80C9"],
            ["OverSimplified (YouTube)", "https://www.youtube.com/@OverSimplifiedHistory"],
        ],
        "practice": [
            ["Quizlet — History", "https://quizlet.com/subjects/history/"],
            ["Sporcle — History Quizzes", "https://www.sporcle.com/games/category/history"],
        ],
        "reference": [
            ["Wikipedia — History Portal", "https://en.wikipedia.org/wiki/Portal:History"],
            ["World History Encyclopedia", "https://www.worldhistory.org/"],
        ],
    },
    "English": {
        "videos": [
            ["CrashCourse — Literature", "https://www.youtube.com/playlist?list=PL8dPuuaLjXtOeEc9ME62zTfqc0h6Pe8vb"],
            ["TED-Ed", "https://ed.ted.com/"],
        ],
        "practice": [
            ["Purdue OWL — Writing Lab", "https://owl.purdue.edu/owl/purdue_owl.html"],
            ["Grammarly", "https://www.grammarly.com/"],
        ],
        "reference": [
            ["Project Gutenberg", "https://www.gutenberg.org/"],
            ["SparkNotes", "https://www.sparknotes.com/"],
        ],
    },
    "CS": {
        "videos": [
            ["freeCodeCamp", "https://www.freecodecamp.org/"],
            ["Harvard CS50", "https://cs50.harvard.edu/"],
        ],
        "practice": [
            ["LeetCode", "https://leetcode.com/"],
            ["HackerRank", "https://www.hackerrank.com/"],
        ],
        "reference": [
            ["MDN Web Docs", "https://developer.mozilla.org/"],
            ["W3Schools", "https://www.w3schools.com/"],
        ],
    },
    "Language": {
        "videos": [["Duolingo", "https://www.duolingo.com/"]],
        "practice": [["Quizlet — Languages", "https://quizlet.com/subjects/languages/"], ["Memrise", "https://www.memrise.com/"]],
        "reference": [["WordReference", "https://www.wordreference.com/"], ["Linguee", "https://www.linguee.com/"]],
    },
    "Art": {
        "videos": [["Proko (YouTube)", "https://www.youtube.com/@ProkoTV"]],
        "practice": [],
        "reference": [["Google Arts & Culture", "https://artsandculture.google.com/"], ["WikiArt", "https://www.wikiart.org/"]],
    },
    "Other": {
        "videos": [["Khan Academy", "https://www.khanacademy.org/"], ["TED Talks", "https://www.ted.com/talks"]],
        "practice": [["Quizlet", "https://quizlet.com/"], ["Chegg", "https://www.chegg.com/"]],
        "reference": [["Wikipedia", "https://en.wikipedia.org/"], ["Britannica", "https://www.britannica.com/"]],
    },
}


def _load_json():
    try:
        with open(DATA_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return None


class SearchResult(BaseModel):
    title: str
    summary: str = ""
    url: str = ""
    category: str = ""
    kind: str = ""           # Wikipedia | Khan Academy | Related
    model_config = {"from_attributes": True}


class TaskResource(BaseModel):
    task_name: str
    category: str
    priority: str
    duration: int
    videos: list[list[str]]
    practice: list[list[str]]
    reference: list[list[str]]


@router.get("/search", response_model=List[SearchResult])
def search_resources(q: str = Query(..., min_length=1), user: User = Depends(get_current_user)):
    """Search crawled data.json + fallback DB for a keyword."""
    data = _load_json()
    results: list[SearchResult] = []
    query = q.lower()

    if data:
        # Wikipedia summaries
        for r in data.get("resources", []):
            hay = (r.get("title", "") + " " + r.get("summary", "") + " " + r.get("category", "")).lower()
            if query in hay:
                results.append(SearchResult(
                    title=r["title"], summary=(r.get("summary") or "")[:300],
                    url=r.get("url", ""), category=r.get("category", ""),
                    kind="Wikipedia",
                ))

        # Khan Academy
        for r in data.get("khan_academy", []):
            if query in r.get("title", "").lower():
                results.append(SearchResult(
                    title=r["title"], summary=r.get("kind", ""),
                    url=r.get("url", ""), kind="Khan Academy",
                ))

        # Related
        for topic, links in data.get("related", {}).items():
            if query in topic.lower():
                for link in links:
                    results.append(SearchResult(
                        title=link["title"], url=link.get("url", ""),
                        kind=f"Related: {topic}",
                    ))

    # Limit to 40 results
    return results[:40]


@router.post("/analyze", response_model=List[TaskResource])
def analyze_tasks(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Return curated resources for each of the user's tasks."""
    tasks = db.query(Task).filter(Task.user_id == user.id).all()
    out = []
    for task in tasks:
        res = RESOURCE_DB.get(task.category, RESOURCE_DB["Other"])
        out.append(TaskResource(
            task_name=task.name,
            category=task.category,
            priority=task.priority,
            duration=task.duration,
            videos=res["videos"],
            practice=res["practice"],
            reference=res["reference"],
        ))
    return out
