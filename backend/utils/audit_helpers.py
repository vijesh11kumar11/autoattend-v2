"""Centralized helper for logging staff/admin mutations.

Wraps utils.security_logger.sec_logger with the ADMIN_ACTION event type and
a standardized payload schema (action / target_id / before / after).
Used wherever a staff member mutates state belonging to another user.
"""
from __future__ import annotations

from typing import Any

from fastapi import Request
from sqlalchemy.orm import Session

from utils.security_logger import SecurityEventType, Severity, sec_logger


def audit_admin_action(
    action: str,
    *,
    request: Request | None,
    current_user: dict,
    db: Session | None = None,
    target_id: Any = None,
    before: Any = None,
    after: Any = None,
    extra: dict | None = None,
    severity: Severity = Severity.INFO,
) -> None:
    """Persist an ADMIN_ACTION security event. Never raises."""
    try:
        details: dict[str, Any] = {
            "action": action,
            "target_id": target_id,
        }
        if before is not None:
            details["before"] = before
        if after is not None:
            details["after"] = after
        if extra:
            details.update(extra)

        ip = (
            request.client.host
            if request is not None and request.client is not None
            else None
        )
        ua = (
            request.headers.get("user-agent")
            if request is not None
            else None
        )
        req_id = (
            getattr(request.state, "request_id", None)
            if request is not None
            else None
        )

        sec_logger.log(
            SecurityEventType.ADMIN_ACTION,
            severity,
            user_id=current_user.get("id") if current_user else None,
            college_id=current_user.get("college_id") if current_user else None,
            ip_address=ip,
            user_agent=ua,
            details=details,
            request_id=req_id,
            db=db,
        )
    except Exception:
        # Never block the actual mutation because logging failed.
        pass
