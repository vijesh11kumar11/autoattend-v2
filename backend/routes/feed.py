"""
AutoAttend AI v2.0 — News Feed Routes

GET  /api/feed                    — paginated news feed (all roles)
GET  /api/feed/article/{id}       — single article detail
"""

import hashlib
import logging
import re
import time
from datetime import datetime, timezone
from typing import Optional

import requests as http_requests
from bs4 import BeautifulSoup
from fastapi import APIRouter, Depends, HTTPException, status

from config import settings
from utils.auth_utils import get_current_user

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/feed", tags=["Feed"])

# ═══════════════════════════════════════════════════════════════════════
# In-memory cache
# ═══════════════════════════════════════════════════════════════════════

_cache: dict[str, dict] = {}  # key → {"data": [...], "ts": float}
_CACHE_TTL = getattr(settings, "FEED_CACHE_MINUTES", 60) * 60  # seconds

_article_store: dict[str, dict] = {}  # article_id → full article dict


def _is_cache_fresh(key: str) -> bool:
    entry = _cache.get(key)
    if not entry:
        return False
    return (time.time() - entry["ts"]) < _CACHE_TTL


# ═══════════════════════════════════════════════════════════════════════
# NewsAPI queries per category
# ═══════════════════════════════════════════════════════════════════════

_NEWS_QUERIES = {
    "jobs":       "tech jobs India engineering hiring 2026",
    "education":  "scholarship India students university admission",
    "ai":         "artificial intelligence machine learning India students",
    "technology": "technology engineering computer science India",
    "future":     "startups innovation research India future",
}

_DEVTO_TAGS = {
    "jobs":       "career",
    "education":  "education",
    "ai":         "ai",
    "technology": "webdev",
    "future":     "beginners",
}

_CATEGORY_COLORS = {
    "jobs":       "blue",
    "education":  "green",
    "ai":         "purple",
    "technology": "orange",
    "future":     "pink",
}


# ═══════════════════════════════════════════════════════════════════════
# Helpers
# ═══════════════════════════════════════════════════════════════════════

def _time_ago(iso_str: str | None) -> str:
    if not iso_str:
        return "recently"
    try:
        dt = datetime.fromisoformat(iso_str.replace("Z", "+00:00"))
        now = datetime.now(tz=timezone.utc)
        diff = now - dt
        secs = int(diff.total_seconds())
        if secs < 60:
            return "just now"
        if secs < 3600:
            m = secs // 60
            return f"{m} min ago"
        if secs < 86400:
            h = secs // 3600
            return f"{h} hour{'s' if h > 1 else ''} ago"
        d = secs // 86400
        if d == 1:
            return "yesterday"
        if d < 30:
            return f"{d} days ago"
        return f"{d // 30} month{'s' if d // 30 > 1 else ''} ago"
    except Exception:
        return "recently"


def _reading_time(text: str | None) -> int:
    if not text:
        return 2
    words = len(text.split())
    return max(1, round(words / 200))


def _make_id(title: str, source: str) -> str:
    raw = f"{title}:{source}"
    return hashlib.md5(raw.encode()).hexdigest()[:12]


def _scrape_full_article(url: str) -> str | None:
    """Fetch and extract article text from source URL, return clean markdown."""
    if not url:
        return None
    try:
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                          "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        }
        resp = http_requests.get(url, headers=headers, timeout=12, allow_redirects=True)
        if resp.status_code != 200:
            return None

        soup = BeautifulSoup(resp.text, "lxml")

        # Remove unwanted elements
        for tag in soup.find_all(["script", "style", "nav", "footer", "header",
                                   "aside", "form", "iframe", "noscript",
                                   "figure", "figcaption", "button", "svg"]):
            tag.decompose()
        # Remove ads / social / related sections
        for tag in soup.find_all(class_=re.compile(
                r"share|social|comment|related|sidebar|advert|promo|newsletter|popup",
                re.I)):
            tag.decompose()

        # Try to find the main article body
        article_el = (
            soup.find("article")
            or soup.find("div", class_=re.compile(r"article|post|entry|content|story", re.I))
            or soup.find("main")
        )
        if not article_el:
            article_el = soup.body or soup

        # Build structured markdown
        blocks: list[str] = []
        seen_texts: set[str] = set()  # deduplicate
        in_list = False

        for el in article_el.find_all(["h1", "h2", "h3", "h4", "p", "blockquote",
                                        "ul", "ol", "li", "strong", "b"]):
            text = el.get_text(strip=True)
            if not text or len(text) < 20 or text in seen_texts:
                continue
            seen_texts.add(text)

            # Detect stat-like lines (short with numbers/symbols)
            is_stat = bool(re.match(r"^[~$₹€£\d]", text)) and len(text) < 200

            if el.name == "h1":
                in_list = False
                blocks.append(f"\n# {text}\n")
            elif el.name == "h2":
                in_list = False
                blocks.append(f"\n## {text}\n")
            elif el.name in ("h3", "h4"):
                in_list = False
                blocks.append(f"\n### {text}\n")
            elif el.name == "blockquote":
                in_list = False
                blocks.append(f"\n> {text}\n")
            elif el.name == "li":
                blocks.append(f"- {text}")
                in_list = True
            elif el.name in ("strong", "b") and el.parent and el.parent.name not in ("p", "li", "blockquote"):
                in_list = False
                blocks.append(f"\n**{text}**\n")
            elif is_stat:
                blocks.append(f"- **{text}**")
                in_list = True
            else:
                if in_list:
                    blocks.append("")  # gap after list
                    in_list = False
                blocks.append(text)

        if len(blocks) < 3:
            return None

        full_text = "\n\n".join(blocks)

        # Clean up excessive blank lines
        full_text = re.sub(r"\n{4,}", "\n\n\n", full_text)

        # Cap at ~5000 words
        words = full_text.split()
        if len(words) > 5000:
            full_text = " ".join(words[:5000]) + "\n\n---\n\n*Article trimmed — read full version at source.*"

        return full_text
    except Exception as exc:
        logger.debug("Scrape failed for %s: %s", url, exc)
        return None


# ═══════════════════════════════════════════════════════════════════════
# Fetchers
# ═══════════════════════════════════════════════════════════════════════

def _fetch_newsapi(query: str, category: str, page_size: int = 10) -> list[dict]:
    api_key = getattr(settings, "NEWS_API_KEY", "")
    if not api_key:
        return []
    try:
        resp = http_requests.get(
            "https://newsapi.org/v2/everything",
            params={
                "q": query,
                "sortBy": "publishedAt",
                "pageSize": page_size,
                "language": "en",
                "apiKey": api_key,
            },
            timeout=10,
        )
        if resp.status_code != 200:
            logger.warning("NewsAPI returned %d: %s", resp.status_code, resp.text[:200])
            return []
        articles = resp.json().get("articles", [])
        results = []
        for a in articles:
            if a.get("title") == "[Removed]":
                continue
            aid = _make_id(a.get("title", ""), a.get("source", {}).get("name", ""))
            published = a.get("publishedAt", "")
            content = a.get("content") or a.get("description") or ""
            desc = a.get("description") or ""
            article = {
                "id": aid,
                "title": a.get("title", ""),
                "description": desc[:200] if desc else "",
                "full_content": content,
                "image_url": a.get("urlToImage") or "",
                "source_name": a.get("source", {}).get("name", "Unknown"),
                "source_url": a.get("url", ""),
                "published_at": published,
                "time_ago": _time_ago(published),
                "category": category,
                "category_color": _CATEGORY_COLORS.get(category, "blue"),
                "reading_time": _reading_time(content),
            }
            results.append(article)
            _article_store[aid] = article
        return results
    except Exception as exc:
        logger.error("NewsAPI fetch failed: %s", exc)
        return []


def _fetch_devto(tag: str, category: str, per_page: int = 10) -> list[dict]:
    try:
        resp = http_requests.get(
            "https://dev.to/api/articles",
            params={"tag": tag, "per_page": per_page, "top": 7},
            timeout=10,
        )
        if resp.status_code != 200:
            return []
        articles = resp.json()
        results = []
        for a in articles:
            aid = _make_id(a.get("title", ""), "Dev.to")
            published = a.get("published_at") or a.get("created_at") or ""
            desc = a.get("description") or ""
            body = a.get("body_markdown") or a.get("body_html") or desc
            article = {
                "id": aid,
                "title": a.get("title", ""),
                "description": desc[:200] if desc else "",
                "full_content": body,
                "image_url": a.get("cover_image") or a.get("social_image") or "",
                "source_name": "Dev.to",
                "source_url": a.get("url", ""),
                "published_at": published,
                "time_ago": _time_ago(published),
                "category": category,
                "category_color": _CATEGORY_COLORS.get(category, "blue"),
                "reading_time": a.get("reading_time_minutes") or _reading_time(body),
            }
            results.append(article)
            _article_store[aid] = article
        return results
    except Exception as exc:
        logger.error("Dev.to fetch failed: %s", exc)
        return []


def _fetch_category(cat: str) -> list[dict]:
    news_q = _NEWS_QUERIES.get(cat, "education India")
    devto_tag = _DEVTO_TAGS.get(cat, "education")
    news = _fetch_newsapi(news_q, cat)
    devto = _fetch_devto(devto_tag, cat)
    # Interleave results
    merged = []
    ni, di = 0, 0
    while ni < len(news) or di < len(devto):
        if ni < len(news):
            merged.append(news[ni]); ni += 1
        if di < len(devto):
            merged.append(devto[di]); di += 1
    return merged


def _fetch_all() -> list[dict]:
    all_articles = []
    for cat in _NEWS_QUERIES:
        all_articles.extend(_fetch_category(cat))
    # Deduplicate by id
    seen = set()
    unique = []
    for a in all_articles:
        if a["id"] not in seen:
            seen.add(a["id"])
            unique.append(a)
    return unique


# ═══════════════════════════════════════════════════════════════════════
# GET /api/feed
# ═══════════════════════════════════════════════════════════════════════

@router.get("")
def get_feed(
    category: str = "all",
    page: int = 1,
    current_user: dict = Depends(get_current_user),
):
    category = category.lower().strip()
    if category not in ("all", "jobs", "education", "ai", "technology", "future"):
        category = "all"

    cache_key = f"feed:{category}"

    if not _is_cache_fresh(cache_key):
        if category == "all":
            data = _fetch_all()
        else:
            data = _fetch_category(category)
        _cache[cache_key] = {"data": data, "ts": time.time()}
        logger.info("📰 FEED REFRESH │ category=%s │ articles=%d", category, len(data))
    else:
        data = _cache[cache_key]["data"]

    # Pagination
    per_page = 12
    start = (page - 1) * per_page
    end = start + per_page
    page_data = data[start:end]

    return {
        "articles": page_data,
        "total": len(data),
        "page": page,
        "per_page": per_page,
        "has_more": end < len(data),
        "category": category,
        "cached": _is_cache_fresh(cache_key),
    }


# ═══════════════════════════════════════════════════════════════════════
# GET /api/feed/article/{article_id}
# ═══════════════════════════════════════════════════════════════════════

@router.get("/article/{article_id}")
def get_article(
    article_id: str,
    current_user: dict = Depends(get_current_user),
):
    article = _article_store.get(article_id)
    if not article:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Article not found.")

    # If content is truncated or poorly formatted, scrape full article
    content = article.get("full_content", "")
    needs_scrape = (
        bool(re.search(r"\[\+\d+ chars\]", content))
        or len(content) < 300
        or ("##" not in content and "- **" not in content and len(content) < 1500)
    )
    if needs_scrape and article.get("source_url"):
        scraped = _scrape_full_article(article["source_url"])
        if scraped and len(scraped) > len(content):
            article["full_content"] = scraped
            article["reading_time"] = _reading_time(scraped)
            _article_store[article_id] = article

    # Find related articles (same category, excluding self)
    cache_key = f"feed:{article['category']}"
    related = []
    if cache_key in _cache:
        for a in _cache[cache_key]["data"]:
            if a["id"] != article_id:
                related.append(a)
            if len(related) >= 3:
                break

    return {
        "article": article,
        "related": related,
    }
