"""
AutoAttend AI v2.0 — QR Token Routes

GET  /api/qr/token/{session_id}     — generate rotating QR (teacher)
GET  /api/qr/countdown/{session_id} — seconds remaining in current slot
"""

import time

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.orm import Session

from database import AttendanceSession, SessionStatus, get_db
from utils.auth_utils import teacher_or_above
from utils.qr_utils import generate_qr_token, get_session_qr_secret

router = APIRouter(prefix="/api/qr", tags=["QR"])


# ═══════════════════════════════════════════════════════════════════════
# GET /api/qr/token/{session_id}
# ═══════════════════════════════════════════════════════════════════════

@router.get("/token/{session_id}")
def get_qr_token(
    session_id:   int,
    response:     Response,
    current_user: dict    = Depends(teacher_or_above),
    db:           Session = Depends(get_db),
):
    """
    Generate and return a rotating QR token for an active attendance session.

    • Only the teacher who owns the session (or HOD/Principal) can call this.
    • Called by the frontend every 4 seconds for smooth QR rotation.
    • Response is never cached (Cache-Control: no-cache, no-store).
    """
    session = db.query(AttendanceSession).filter(AttendanceSession.id == session_id).first()

    if not session:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Attendance session not found.")

    if session.status != SessionStatus.active:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Session is not active.")

    # Only the owning teacher (or HOD/Principal) may generate QR tokens
    caller_role = current_user["role"]
    if caller_role == "teacher" and session.teacher_id != current_user["id"]:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "You are not the teacher of this session.",
        )

    # College boundary check for HOD/Principal
    if caller_role in {"hod", "principal"}:
        subject = session.subject   # lazy-loaded relationship
        if subject.course.department.college_id != current_user["college_id"]:
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                "This session does not belong to your college.",
            )

    qr_secret = session.qr_secret
    result    = generate_qr_token(session_id, qr_secret)

    # Prevent client / proxy caching — QR must always be fresh
    response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    response.headers["Pragma"]        = "no-cache"
    response.headers["Expires"]       = "0"

    return result


# ═══════════════════════════════════════════════════════════════════════
# GET /api/qr/countdown/{session_id}
# ═══════════════════════════════════════════════════════════════════════

@router.get("/countdown/{session_id}")
def get_qr_countdown(
    session_id:   int,
    current_user: dict    = Depends(teacher_or_above),
    db:           Session = Depends(get_db),
):
    """
    Return seconds remaining in the current QR slot (0–5).
    Used by the frontend countdown timer beneath the QR image.
    """
    session = db.query(AttendanceSession).filter(AttendanceSession.id == session_id).first()

    if not session:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Attendance session not found.")

    if session.status != SessionStatus.active:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Session is not active.")

    # Only owning teacher (or HOD/Principal) may read countdown
    caller_role = current_user["role"]
    if caller_role == "teacher" and session.teacher_id != current_user["id"]:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "You are not the teacher of this session.",
        )

    from config import settings
    expiry       = settings.QR_EXPIRY_SECONDS   # 5
    now          = time.time()
    current_slot = int(now) // expiry
    slot_end     = (current_slot + 1) * expiry
    seconds_remaining = max(0, round(slot_end - now, 2))

    return {"seconds_remaining": seconds_remaining}

