"""
AutoAttend AI v2.0 — Structured security event logger.

Writes one JSON line per event to logs/security_events.jsonl and, for
WARN/CRITICAL events, also inserts a row into the security_events table.

Usage:
    from utils.security_logger import sec_logger, SecurityEventType, Severity

    sec_logger.log(
        SecurityEventType.LOGIN_FAILURE,
        Severity.WARN,
        ip_address=request.client.host,
        user_agent=request.headers.get("user-agent"),
        details={"identifier": body.identifier, "reason": "bad_password"},
        request_id=getattr(request.state, "request_id", None),
        db=db,
    )
"""

from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timezone
from enum import Enum
from typing import Any

logger = logging.getLogger(__name__)


class SecurityEventType(str, Enum):
    LOGIN_SUCCESS              = "LOGIN_SUCCESS"
    LOGIN_FAILURE              = "LOGIN_FAILURE"
    LOGIN_LOCKED               = "LOGIN_LOCKED"
    TOTP_SUCCESS               = "TOTP_SUCCESS"
    TOTP_FAILURE               = "TOTP_FAILURE"
    TOTP_LOCKED                = "TOTP_LOCKED"
    PASSWORD_CHANGED           = "PASSWORD_CHANGED"
    PASSWORD_RESET             = "PASSWORD_RESET"
    DEVICE_MISMATCH            = "DEVICE_MISMATCH"
    FACE_VERIFY_SUCCESS        = "FACE_VERIFY_SUCCESS"
    FACE_VERIFY_FAILURE        = "FACE_VERIFY_FAILURE"
    QR_INVALID                 = "QR_INVALID"
    GPS_SPOOFING_DETECTED      = "GPS_SPOOFING_DETECTED"
    BLE_MISMATCH               = "BLE_MISMATCH"
    ATTENDANCE_FRAUD_SUSPECTED = "ATTENDANCE_FRAUD_SUSPECTED"
    UNAUTHORIZED_ACCESS        = "UNAUTHORIZED_ACCESS"
    TOKEN_EXPIRED              = "TOKEN_EXPIRED"
    RATE_LIMIT_EXCEEDED        = "RATE_LIMIT_EXCEEDED"
    ADMIN_ACTION               = "ADMIN_ACTION"
    ROOTED_DEVICE_DETECTED     = "ROOTED_DEVICE_DETECTED"


class Severity(str, Enum):
    INFO     = "INFO"
    WARN     = "WARN"
    CRITICAL = "CRITICAL"


# ─── File handler ────────────────────────────────────────────────────────
_LOG_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "logs")
os.makedirs(_LOG_DIR, exist_ok=True)
_LOG_FILE = os.path.join(_LOG_DIR, "security_events.jsonl")

_jsonl_logger = logging.getLogger("traceln.security_events")
_jsonl_logger.propagate = False
if not _jsonl_logger.handlers:
    _h = logging.FileHandler(_LOG_FILE, encoding="utf-8")
    _h.setFormatter(logging.Formatter("%(message)s"))
    _jsonl_logger.addHandler(_h)
    _jsonl_logger.setLevel(logging.INFO)


class SecurityEventLogger:
    """Singleton helper. Use the module-level `sec_logger`."""

    def log(
        self,
        event_type: SecurityEventType,
        severity: Severity,
        *,
        user_id: int | None = None,
        ip_address: str | None = None,
        user_agent: str | None = None,
        college_id: int | None = None,
        details: dict[str, Any] | None = None,
        request_id: str | None = None,
        db: Any = None,
    ) -> None:
        record = {
            "ts":         datetime.now(tz=timezone.utc).isoformat(),
            "event_type": event_type.value,
            "severity":   severity.value,
            "user_id":    user_id,
            "college_id": college_id,
            "ip":         ip_address,
            "ua":         (user_agent or "")[:500] or None,
            "request_id": request_id,
            "details":    details or {},
        }

        # 1) JSONL file
        try:
            _jsonl_logger.info(json.dumps(record, default=str))
        except Exception as exc:  # pragma: no cover
            logger.error("security_logger jsonl write failed: %s", exc)

        # 2) CRITICAL also bubbles to root logger so it lands in stdout
        if severity == Severity.CRITICAL:
            logger.critical("🚨 SECURITY %s: %s", event_type.value, details or {})
        elif severity == Severity.WARN:
            logger.warning("⚠️  SECURITY %s: %s", event_type.value, details or {})

        # 3) WARN/CRITICAL → DB (best-effort)
        if db is not None and severity in (Severity.WARN, Severity.CRITICAL):
            try:
                from database import SecurityEvent  # local import avoids cycle
                row = SecurityEvent(
                    event_type    = event_type.value,
                    severity      = severity.value,
                    user_id       = user_id,
                    college_id    = college_id,
                    ip_address    = ip_address,
                    user_agent    = (user_agent or "")[:500] or None,
                    request_id    = request_id,
                    details       = details or {},
                )
                db.add(row)
                db.commit()
            except Exception as exc:  # pragma: no cover
                logger.error("security_logger DB insert failed: %s", exc)
                try:
                    db.rollback()
                except Exception:
                    pass


sec_logger = SecurityEventLogger()
