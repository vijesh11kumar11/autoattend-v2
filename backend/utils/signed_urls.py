"""
Signed-URL token helpers for ClassPulse capsule serving.

Used by:
  • POST /api/classpulse/student/capsule/{id}/open  → returns
    `signed_view_url` and (when allowed) `signed_download_url`
  • GET  /api/classpulse/serve/{token}              → verifies + serves

Tokens are signed with SECRET_KEY, expire in 30 minutes by default,
and carry the file path + capsule + student + access mode.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime, timedelta

from fastapi import HTTPException, status
from jose import ExpiredSignatureError, JWTError, jwt

from config import settings

logger = logging.getLogger(__name__)

CAPSULE_TOKEN_PURPOSE = "capsule_access"
DEFAULT_TTL_MINUTES = 30


def generate_signed_capsule_url(
    file_path: str,
    student_id: int,
    capsule_id: int,
    expires_in_minutes: int = DEFAULT_TTL_MINUTES,
    mode: str = "view",
) -> str:
    """
    Build a signed URL token granting access to one capsule file.

    `mode` ∈ {"view", "download"}.  Returns the relative API path that
    the client should hit (e.g. `/api/classpulse/serve/<jwt>`).
    """
    if mode not in {"view", "download"}:
        raise ValueError("mode must be 'view' or 'download'")
    now = datetime.now(tz=UTC)
    payload = {
        "file_path": file_path,
        "student_id": int(student_id),
        "capsule_id": int(capsule_id),
        "mode": mode,
        "purpose": CAPSULE_TOKEN_PURPOSE,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(minutes=expires_in_minutes)).timestamp()),
    }
    token = jwt.encode(payload, settings.SECRET_KEY, algorithm=settings.ALGORITHM)
    return f"/api/classpulse/serve/{token}"


def verify_signed_url(token: str) -> dict:
    """
    Decode + validate a capsule-access JWT. Raises HTTP 403 on any
    failure (signature, expiry, wrong purpose).
    """
    if not token or not isinstance(token, str):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Invalid signed URL")
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
    except ExpiredSignatureError:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Signed URL expired")
    except JWTError:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Invalid signed URL")

    if payload.get("purpose") != CAPSULE_TOKEN_PURPOSE:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Wrong token purpose")
    if "student_id" not in payload or "capsule_id" not in payload:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Malformed token payload")
    payload.setdefault("mode", "view")
    return payload
