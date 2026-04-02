"""
AutoAttend AI v2.0 — QR Code Utilities

QR token lifecycle:
  • A 5-second rolling HMAC token is embedded in a QR image.
  • Each QR slot is single-use: the first valid scan inserts a QRToken row
    with ON CONFLICT DO NOTHING, so simultaneous scans are safely rejected.
  • ±1 slot (±5 s) grace period compensates for network latency.

Security properties:
  • HMAC-SHA256 binds the token to session_id + time_slot → unforgeable
  • hmac.compare_digest prevents timing attacks
  • PostgreSQL ON CONFLICT DO NOTHING prevents double-attendance race
"""

import base64
import hashlib
import hmac
import io
import logging
import time
from datetime import datetime, timezone

import qrcode
import qrcode.image.pil
from sqlalchemy import text
from sqlalchemy.orm import Session

from config import settings
from database import AttendanceSession, QRToken

logger = logging.getLogger(__name__)


# ═══════════════════════════════════════════════════════════════════════
# 1. generate_qr_token
# ═══════════════════════════════════════════════════════════════════════

def generate_qr_token(session_id: int, qr_secret: str) -> dict:
    """
    Generate a time-based HMAC QR token for the current 5-second slot.

    Returns:
      qr_data          — raw string embedded in the QR code
      qr_image_base64  — "data:image/png;base64,..." ready for <img src>
      time_slot        — integer slot index
      expires_at       — Unix timestamp when this slot ends
      seconds_remaining — seconds left in the current slot (0-5)
    """
    now        = time.time()
    expiry     = settings.QR_EXPIRY_SECONDS          # 5
    time_slot  = int(now) // expiry
    message    = f"{session_id}:{time_slot}"

    token = hmac.new(
        qr_secret.encode("utf-8"),
        message.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()

    qr_data    = f"{session_id}:{time_slot}:{token}"
    expires_at = (time_slot + 1) * expiry
    seconds_remaining = max(0.0, expires_at - now)

    # ── Build QR image ────────────────────────────────────────────────
    qr = qrcode.QRCode(
        version=2,
        error_correction=qrcode.ERROR_CORRECT_H,
        box_size=10,
        border=4,
    )
    qr.add_data(qr_data)
    qr.make(fit=True)

    img    = qr.make_image(fill_color="black", back_color="white")
    buffer = io.BytesIO()
    img.save(buffer, format="PNG")
    b64    = base64.b64encode(buffer.getvalue()).decode("ascii")

    return {
        "qr_data":          qr_data,
        "qr_image_base64":  f"data:image/png;base64,{b64}",
        "time_slot":        time_slot,
        "expires_at":       expires_at,
        "seconds_remaining": round(seconds_remaining, 2),
    }


# ═══════════════════════════════════════════════════════════════════════
# 2. validate_qr_token
# ═══════════════════════════════════════════════════════════════════════

def validate_qr_token(
    qr_data:    str,
    session_id: int,
    qr_secret:  str,
    student_id: int,
    db:         Session,
) -> dict:
    """
    Validate a scanned QR code and atomically mark the slot as used.

    Steps:
      a) Parse qr_data into (qr_session_id, time_slot, token)
      b) Verify session_id matches
      c) Check slot is within ±1 of current slot (±5 s grace)
      d) Recompute HMAC and compare with hmac.compare_digest
      e) Pre-check single-use (fast path)
      f) Atomic INSERT … ON CONFLICT DO NOTHING
      g) Return {valid: True, time_slot}

    Returns structured dict — never raises HTTPException.
    """
    # ── a) Parse ──────────────────────────────────────────────────────
    parts = qr_data.split(":")
    if len(parts) != 3:
        return {"valid": False, "reason": "Malformed QR data."}

    try:
        qr_session_id = int(parts[0])
        qr_time_slot  = int(parts[1])
        qr_token      = parts[2]
    except ValueError:
        return {"valid": False, "reason": "Malformed QR data."}

    # ── b) Session match ──────────────────────────────────────────────
    if qr_session_id != session_id:
        return {"valid": False, "reason": "QR code does not belong to this session."}

    # ── c) Time window (±1 slot = ±5 s grace) ────────────────────────
    expiry        = settings.QR_EXPIRY_SECONDS
    current_slot  = int(time.time()) // expiry
    if abs(current_slot - qr_time_slot) > 1:
        return {"valid": False, "reason": "QR code expired."}

    # ── d) HMAC verification (timing-safe) ───────────────────────────
    message  = f"{session_id}:{qr_time_slot}"
    expected = hmac.new(
        qr_secret.encode("utf-8"),
        message.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()

    if not hmac.compare_digest(expected, qr_token):
        logger.warning(
            "validate_qr_token: HMAC mismatch — session_id=%d student_id=%d",
            session_id, student_id,
        )
        return {"valid": False, "reason": "Invalid QR code."}

    # ── e) Fast-path: pre-check used ─────────────────────────────────
    existing = (
        db.query(QRToken)
        .filter(
            QRToken.session_id == session_id,
            QRToken.time_slot  == qr_time_slot,
            QRToken.is_used    == True,         # noqa: E712
        )
        .first()
    )
    if existing:
        return {"valid": False, "reason": "QR code already used."}

    # ── f) Atomic single-use INSERT (ON CONFLICT DO NOTHING) ─────────
    now = datetime.now(tz=timezone.utc)
    token_hash   = hashlib.sha256(qr_token.encode()).hexdigest()

    result = db.execute(
        text(
            """
            INSERT INTO qr_tokens
              (session_id, time_slot, token_hash, is_used, used_by, used_at, created_at)
            VALUES
              (:session_id, :time_slot, :token_hash, TRUE,
               :used_by, :used_at, :created_at)
            ON CONFLICT (session_id, time_slot)
            DO NOTHING
            """
        ),
        {
            "session_id": session_id,
            "time_slot":  qr_time_slot,
            "token_hash": token_hash,
            "used_by":    student_id,
            "used_at":    now,
            "created_at": now,
        },
    )
    db.commit()

    if result.rowcount == 0:
        # Another request beat us to it
        logger.info(
            "validate_qr_token: race condition — session_id=%d slot=%d student_id=%d",
            session_id, qr_time_slot, student_id,
        )
        return {"valid": False, "reason": "QR code already used (race condition)."}

    logger.info(
        "validate_qr_token: VALID — session_id=%d slot=%d student_id=%d",
        session_id, qr_time_slot, student_id,
    )
    return {"valid": True, "time_slot": qr_time_slot}


# ═══════════════════════════════════════════════════════════════════════
# 3. get_session_qr_secret
# ═══════════════════════════════════════════════════════════════════════

def get_session_qr_secret(session_id: int, db: Session) -> str | None:
    """
    Return the per-session QR secret stored in attendance_sessions.qr_secret.
    Returns None if the session does not exist.
    """
    session = (
        db.query(AttendanceSession.qr_secret)
        .filter(AttendanceSession.id == session_id)
        .first()
    )
    return session.qr_secret if session else None
