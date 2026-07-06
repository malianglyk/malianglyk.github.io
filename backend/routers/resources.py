"""POST /api/resources/web-search      — Baidu web search
POST /api/resources/search-by-tasks  — search web for each task

Uses Baidu Qianfan AppBuilder AI Search API.
API key format: bce-v3/ALTAK-xxx/yyy — used directly as Bearer token.
"""
import os
import httpx
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from typing import List
from pydantic import BaseModel

from database import get_db
from models import Task, User
from auth import get_current_user

router = APIRouter(prefix="/api/resources", tags=["resources"])

# Baidu API configuration — the full bce-v3 key is used directly as a Bearer token
BAIDU_API_KEY = os.environ.get("BAIDU_API_KEY", "")
BAIDU_SEARCH_URL = "https://qianfan.baidubce.com/v2/ai_search/web_search"


async def _baidu_web_search(query: str, count: int = 10) -> list[dict]:
    """Search the web using Baidu Qianfan AppBuilder AI Search.

    Uses the BCE-format API key directly as a Bearer token
    (NO OAuth AK/SK exchange needed for Qianfan AppBuilder keys).
    """
    if not BAIDU_API_KEY:
        print("BAIDU_API_KEY not configured")
        return []

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(
                BAIDU_SEARCH_URL,
                headers={
                    "Authorization": f"Bearer {BAIDU_API_KEY}",
                    "Content-Type": "application/json",
                },
                json={
                    "messages": [{"content": query.strip(), "role": "user"}],
                    "search_source": "baidu_search_v2",
                    "resource_type_filter": [{"type": "web", "top_k": min(count, 20)}],
                },
            )
            if resp.status_code == 200:
                data = resp.json()
                results = []
                # Baidu Qianfan returns "references" array (not "resources")
                items = data.get("references") or data.get("resources") or data.get("result") or []
                for r in items:
                    results.append({
                        "title": r.get("title") or r.get("name", ""),
                        "url": r.get("url") or r.get("link", ""),
                        "summary": (r.get("snippet") or r.get("content") or r.get("summary", ""))[:300],
                        "kind": "Web",
                    })
                if results:
                    return results
                else:
                    print(f"Qianfan search returned no results. Response keys: {list(data.keys())}")
                    print(f"Full response: {str(data)[:500]}")
            else:
                print(f"Qianfan search FAILED: HTTP {resp.status_code}")
                print(f"Response: {resp.text[:500]}")
    except Exception as e:
        print(f"Qianfan search EXCEPTION: {e}")

    return []


class WebSearchRequest(BaseModel):
    query: str
    count: int = 10


class WebSearchResult(BaseModel):
    title: str
    url: str
    summary: str
    kind: str = "Web"


@router.post("/web-search", response_model=List[WebSearchResult])
async def web_search(
    body: WebSearchRequest,
    user: User = Depends(get_current_user),
):
    """Search the web via Baidu API."""
    if not BAIDU_API_KEY:
        return []

    results = await _baidu_web_search(body.query, body.count)
    return results


@router.post("/search-by-tasks", response_model=List[dict])
async def search_by_tasks(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Search Baidu for each task using name + category + description."""
    tasks = db.query(Task).filter(Task.user_id == user.id).all()

    all_results = []
    for task in tasks:
        query_parts = [task.name, task.category]
        if task.description:
            query_parts.append(task.description)
        query = " ".join(query_parts)

        web_results = []
        if BAIDU_API_KEY:
            try:
                web_results = await _baidu_web_search(query, 3)
            except Exception:
                pass

        all_results.append({
            "task_id": task.id,
            "task_name": task.name,
            "category": task.category,
            "search_query": query.strip(),
            "results": web_results,
        })

    return all_results
