"""
Principal-only admin routes.

Currently exposes the security event review feed sourced from the
`security_events` table (written by utils.security_logger).
"""

from __future__ import annotations

from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import desc
from sqlalchemy.orm import Session

from database import SecurityEvent, get_db
from utils.auth_utils import principal_only

router = APIRouter(prefix="/api/principal", tags=["principal"])


@router.get("/security-events")
def list_security_events(
    event_type:    Optional[str]      = Query(None, max_length=64),
    severity:      Optional[str]      = Query(None, regex="^(INFO|WARN|CRITICAL)$"),
    user_id:       Optional[int]      = Query(None, ge=1),
    date_from:     Optional[datetime] = None,
    date_to:       Optional[datetime] = None,
    page:          int = Query(1,  ge=1),
    page_size:     int = Query(50, ge=1, le=200),
    current_user:  dict     = Depends(principal_only),
    db:            Session  = Depends(get_db),
):
    """Paginated view of structured security events for principal review."""
    q = db.query(SecurityEvent)

    if event_type:
        q = q.filter(SecurityEvent.event_type == event_type)
    if severity:
        q = q.filter(SecurityEvent.severity == severity)
    if user_id is not None:
        q = q.filter(SecurityEvent.user_id == user_id)
    if date_from:
        q = q.filter(SecurityEvent.timestamp_utc >= date_from)
    if date_to:
        q = q.filter(SecurityEvent.timestamp_utc <= date_to)

    # Scope to the principal's college (defence in depth)
    college_id = current_user.get("college_id")
    if college_id is not None:
        q = q.filter(
            (SecurityEvent.college_id == college_id) | (SecurityEvent.college_id.is_(None))
        )

    total = q.count()
    rows  = (
        q.order_by(desc(SecurityEvent.timestamp_utc))
         .offset((page - 1) * page_size)
         .limit(page_size)
         .all()
    )

    return {
        "page":       page,
        "page_size":  page_size,
        "total":      total,
        "items": [
            {
                "id":            r.id,
                "event_type":    r.event_type,
                "severity":      r.severity,
                "timestamp_utc": r.timestamp_utc.isoformat() if r.timestamp_utc else None,
                "user_id":       r.user_id,
                "college_id":    r.college_id,
                "ip_address":    r.ip_address,
                "user_agent":    r.user_agent,
                "request_id":    r.request_id,
                "details":       r.details or {},
            }
            for r in rows
        ],
    }
