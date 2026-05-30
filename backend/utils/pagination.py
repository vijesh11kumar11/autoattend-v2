"""Cursor-based pagination helper — issue #72.

Standardised response wrapper + helpers used by all paginated endpoints.

Usage
-----
```python
from fastapi import APIRouter, Query
from utils.pagination import CursorPage, paginate, DEFAULT_PAGE_SIZES

@router.get("/students", response_model=CursorPage[StudentOut])
def list_students(
    limit:  int = Query(default=DEFAULT_PAGE_SIZES["students"], ge=1, le=100),
    cursor: str | None = Query(default=None),
    db: Session = Depends(get_db),
):
    q = db.query(Student).order_by(Student.id)
    return paginate(q, limit=limit, cursor=cursor, order_column=Student.id)
```

Backwards-compatible (opt-in) mode
----------------------------------
For existing endpoints that already return a raw ``list[...]`` and whose
consumers cannot be updated atomically, use :func:`paginate_or_list`:
the wrapper is returned only when the caller sends ``?cursor=`` (or
``?paginated=true``), otherwise a plain list is returned — preserving
the old contract while letting new clients adopt the cursor protocol.
"""

from __future__ import annotations

import base64
import logging
from typing import Generic, Optional, TypeVar

from fastapi import HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Query as ORMQuery

logger = logging.getLogger(__name__)

T = TypeVar("T")

# ── Default page sizes (issue #72 spec) ────────────────────────────────
DEFAULT_PAGE_SIZES = {
    "students": 20,
    "teachers": 20,
    "attendance": 30,
    "leave": 20,
    "disputes": 20,
    "alerts": 20,
    "reports": 10,
    "audit": 25,
    "default": 20,
}
MAX_LIMIT = 100


# ── Response model ─────────────────────────────────────────────────────
class CursorPage(BaseModel, Generic[T]):
    """Standard cursor-pagination envelope.

    * ``items``       – this page of records
    * ``next_cursor`` – opaque cursor for the *next* page, or ``None`` if exhausted
    * ``has_more``    – ``True`` when ``next_cursor`` is non-null
    * ``total``       – always ``None`` (counting is expensive; intentional)
    """

    items: list[T]
    next_cursor: Optional[str] = None
    has_more: bool = False
    total: Optional[int] = None  # kept for API stability; never populated


# ── Cursor codec ───────────────────────────────────────────────────────
def encode_cursor(record_id: int) -> str:
    """Encode an integer id as a URL-safe base64 cursor."""
    raw = str(int(record_id)).encode("utf-8")
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def decode_cursor(cursor: str) -> int:
    """Decode a cursor back to an integer id. Raises HTTP 400 on bad input."""
    try:
        padded = cursor + "=" * (-len(cursor) % 4)
        raw = base64.urlsafe_b64decode(padded.encode("ascii"))
        return int(raw.decode("utf-8"))
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid pagination cursor",
        )


# ── Core paginator ─────────────────────────────────────────────────────
def paginate(
    query: ORMQuery,
    *,
    limit: int,
    cursor: Optional[str],
    order_column,
    descending: bool = False,
) -> CursorPage:
    """Apply cursor + limit to a SQLAlchemy ORM query and build a CursorPage.

    Algorithm:
      1. If cursor is supplied, decode → last_id and filter
         ``order_column > last_id`` (or ``<`` when descending).
      2. Fetch ``limit + 1`` rows so we can detect ``has_more`` without a COUNT.
      3. If the extra row exists, drop it and compute the next cursor from
         the last item in the returned page.
    """
    limit = max(1, min(int(limit), MAX_LIMIT))

    if cursor:
        last_id = decode_cursor(cursor)
        query = query.filter(order_column < last_id if descending else order_column > last_id)

    query = query.order_by(order_column.desc() if descending else order_column.asc())
    rows = query.limit(limit + 1).all()

    has_more = len(rows) > limit
    items = rows[:limit]
    next_cursor: Optional[str] = None
    if has_more and items:
        # ``order_column`` is on the model — extract the value from the last item.
        last = items[-1]
        attr = order_column.key if hasattr(order_column, "key") else "id"
        next_cursor = encode_cursor(getattr(last, attr))

    return CursorPage(items=items, next_cursor=next_cursor, has_more=has_more, total=None)


def paginate_or_list(
    query: ORMQuery,
    *,
    limit: int,
    cursor: Optional[str],
    order_column,
    paginated: bool = False,
    descending: bool = False,
):
    """Backwards-compatible variant.

    Returns the :class:`CursorPage` wrapper when the caller opts in
    (``cursor`` provided OR ``paginated=True``). Otherwise returns a plain
    ``list`` capped at ``limit`` — preserving the legacy ``list[...]``
    response shape so existing frontend ``.map(...)`` calls keep working.
    """
    page = paginate(
        query, limit=limit, cursor=cursor, order_column=order_column, descending=descending
    )
    if cursor or paginated:
        return page
    return page.items
