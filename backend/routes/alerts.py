"""
AutoAttend AI v2.0 — Alerts Router (HOD)

Endpoints:
  GET  /api/alerts/hod/history          alert history table
  GET  /api/alerts/hod/defaulters/count count of dept defaulters (for preview)
  POST /api/alerts/hod/send-bulk        send WhatsApp to all dept defaulters
  POST /api/alerts/hod/send-custom      send custom message to one student
"""

import base64
import logging
from datetime import date, datetime, timezone
from typing import Optional

import requests as http_requests
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import case, func
from sqlalchemy.orm import Session

from config import settings
from database import (
    AlertChannel,
    AlertsLog,
    AlertStatus,
    AttendanceRecord,
    AttendanceSession,
    AttendanceStatus,
    Course,
    SessionStatus,
    Subject,
    User,
    UserRole,
    get_db,
)
from utils.auth_utils import hod_or_above

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/alerts", tags=["alerts"])

# ── scope helpers (mirrors faculty.py) ───────────────────────────────

def _course_ids_for_dept(dept_id: int, db: Session) -> list[int]:
    return [r[0] for r in db.query(Course.id).filter(Course.department_id == dept_id).all()]


def _subject_ids_for_courses(course_ids: list[int], db: Session) -> list[int]:
    if not course_ids:
        return []
    return [r[0] for r in db.query(Subject.id).filter(Subject.course_id.in_(course_ids)).all()]


def _student_ids_for_courses(course_ids: list[int], db: Session) -> list[int]:
    if not course_ids:
        return []
    return [
        r[0] for r in db.query(User.id).filter(
            User.course_id.in_(course_ids),
            User.role == UserRole.student,
            User.is_active == True,  # noqa: E712
        ).all()
    ]


def _defaulter_student_ids(course_ids: list[int], db: Session) -> list[int]:
    """Return IDs of students below ATTENDANCE_THRESHOLD across all their subjects."""
    subject_ids = _subject_ids_for_courses(course_ids, db)
    student_ids = _student_ids_for_courses(course_ids, db)
    if not subject_ids or not student_ids:
        return []

    ended_ids = [
        r[0] for r in db.query(AttendanceSession.id).filter(
            AttendanceSession.subject_id.in_(subject_ids),
            AttendanceSession.status == SessionStatus.ended,
        ).all()
    ]
    if not ended_ids:
        return []

    subq = (
        db.query(
            AttendanceRecord.student_id,
            func.count(AttendanceRecord.id).label("total"),
            func.sum(
                case((AttendanceRecord.status == AttendanceStatus.present, 1), else_=0)
            ).label("present"),
        )
        .filter(
            AttendanceRecord.session_id.in_(ended_ids),
            AttendanceRecord.student_id.in_(student_ids),
        )
        .group_by(AttendanceRecord.student_id)
        .subquery()
    )

    rows = (
        db.query(subq.c.student_id)
        .filter(
            subq.c.total > 0,
            (subq.c.present * 100.0 / subq.c.total) < settings.ATTENDANCE_THRESHOLD,
        )
        .all()
    )
    return [r[0] for r in rows]


# ── Twilio WhatsApp sender (matches faculty.py implementation) ────────

def _send_twilio_whatsapp(phone: str, message: str) -> dict:
    try:
        phone = phone.strip()
        if not phone.startswith("+"):
            phone = "+" + phone
        credentials = base64.b64encode(
            f"{settings.TWILIO_ACCOUNT_SID}:{settings.TWILIO_AUTH_TOKEN}".encode()
        ).decode()
        resp = http_requests.post(
            f"https://api.twilio.com/2010-04-01/Accounts/{settings.TWILIO_ACCOUNT_SID}/Messages.json",
            headers={"Authorization": f"Basic {credentials}"},
            data={
                "From": settings.TWILIO_WHATSAPP_FROM,
                "To":   f"whatsapp:{phone}",
                "Body": message,
            },
            timeout=10,
        )
        if resp.status_code in (200, 201):
            return {"ok": True, "sid": resp.json().get("sid")}
        return {"ok": False, "error": resp.json().get("message", "Twilio error")}
    except Exception as exc:
        logger.error("Twilio send failed: %s", exc)
        return {"ok": False, "error": str(exc)}


# ═══════════════════════════════════════════════════════════════════════
# GET /api/alerts/hod/history
# ═══════════════════════════════════════════════════════════════════════

@router.get("/hod/history")
def alert_history(
    alert_type:   Optional[str]  = Query(None),
    alert_status: Optional[str]  = Query(None, alias="status"),
    date_from:    Optional[date] = Query(None),
    date_to:      Optional[date] = Query(None),
    limit:        int            = Query(100, ge=1, le=500),
    current_user: dict           = Depends(hod_or_above),
    db:           Session        = Depends(get_db),
):
    dept_id    = current_user.get("department_id")
    course_ids = _course_ids_for_dept(dept_id, db)
    student_ids = _student_ids_for_courses(course_ids, db)

    q = (
        db.query(AlertsLog, User.name.label("student_name"), User.roll_number)
        .join(User, AlertsLog.student_id == User.id)
        .filter(AlertsLog.student_id.in_(student_ids))
    )
    if alert_type:
        q = q.filter(AlertsLog.alert_type == alert_type)
    if alert_status:
        try:
            q = q.filter(AlertsLog.status == AlertStatus(alert_status))
        except ValueError:
            pass
    if date_from:
        q = q.filter(AlertsLog.sent_at >= datetime.combine(date_from, datetime.min.time()))
    if date_to:
        q = q.filter(AlertsLog.sent_at <= datetime.combine(date_to, datetime.max.time()))

    rows = q.order_by(AlertsLog.sent_at.desc()).limit(limit).all()

    return [
        {
            "id":             r.AlertsLog.id,
            "student_id":     r.AlertsLog.student_id,
            "student_name":   r.student_name,
            "roll_number":    r.roll_number,
            "alert_type":     r.AlertsLog.alert_type,
            "channel":        r.AlertsLog.channel.value,
            "status":         r.AlertsLog.status.value,
            "message":        r.AlertsLog.message,
            "sent_at":        r.AlertsLog.sent_at.isoformat() if r.AlertsLog.sent_at else None,
            "external_id":    r.AlertsLog.external_id,
        }
        for r in rows
    ]


# ═══════════════════════════════════════════════════════════════════════
# GET /api/alerts/hod/defaulters/count
# ═══════════════════════════════════════════════════════════════════════

@router.get("/hod/defaulters/count")
def defaulters_count(
    current_user: dict    = Depends(hod_or_above),
    db:           Session = Depends(get_db),
):
    dept_id    = current_user.get("department_id")
    course_ids = _course_ids_for_dept(dept_id, db)
    ids        = _defaulter_student_ids(course_ids, db)
    return {"count": len(ids), "student_ids": ids}


# ═══════════════════════════════════════════════════════════════════════
# POST /api/alerts/hod/send-bulk
# ═══════════════════════════════════════════════════════════════════════

class BulkAlertBody(BaseModel):
    message: str


@router.post("/hod/send-bulk")
def send_bulk_alert(
    body:         BulkAlertBody,
    current_user: dict    = Depends(hod_or_above),
    db:           Session = Depends(get_db),
):
    """
    Send WhatsApp alerts to parents of all defaulters in the HOD's department.
    """
    message = body.message.strip()
    if not message:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Message cannot be empty.")
    if len(message) > 1600:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Message too long (max 1600 chars).")

    dept_id    = current_user.get("department_id")
    course_ids = _course_ids_for_dept(dept_id, db)
    student_ids = _defaulter_student_ids(course_ids, db)

    if not student_ids:
        return {"sent": 0, "failed": 0, "skipped": 0, "results": []}

    results = []
    for sid in student_ids:
        stu = db.query(User).filter(User.id == sid).first()
        if not stu or not stu.parent_phone:
            log = AlertsLog(
                student_id = sid,
                alert_type = "low_attendance",
                message    = message,
                status     = AlertStatus.failed,
                channel    = AlertChannel.whatsapp,
            )
            db.add(log)
            results.append({"student_id": sid, "status": "failed",
                             "reason": "No parent phone on record"})
            continue

        wa = _send_twilio_whatsapp(stu.parent_phone, message)
        log = AlertsLog(
            student_id  = sid,
            alert_type  = "low_attendance",
            message     = message,
            status      = AlertStatus.sent if wa["ok"] else AlertStatus.failed,
            channel     = AlertChannel.whatsapp,
            external_id = wa.get("sid"),
        )
        db.add(log)
        results.append({
            "student_id":   sid,
            "student_name": stu.name,
            "status":       "sent" if wa["ok"] else "failed",
            "reason":       wa.get("error"),
        })

    db.commit()
    sent   = sum(1 for r in results if r["status"] == "sent")
    failed = sum(1 for r in results if r["status"] == "failed")
    return {"sent": sent, "failed": failed, "results": results}


# ═══════════════════════════════════════════════════════════════════════
# POST /api/alerts/hod/send-custom
# ═══════════════════════════════════════════════════════════════════════

class CustomAlertBody(BaseModel):
    student_id: int
    message:    str


@router.post("/hod/send-custom")
def send_custom_alert(
    body:         CustomAlertBody,
    current_user: dict    = Depends(hod_or_above),
    db:           Session = Depends(get_db),
):
    message = body.message.strip()
    if not message:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Message cannot be empty.")
    if len(message) > 1600:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Message too long (max 1600 chars).")

    dept_id    = current_user.get("department_id")
    course_ids = _course_ids_for_dept(dept_id, db)
    valid_ids  = set(_student_ids_for_courses(course_ids, db))

    if body.student_id not in valid_ids:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Student not in your department.")

    stu = db.query(User).filter(User.id == body.student_id).first()
    if not stu:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Student not found.")

    if not stu.parent_phone:
        log = AlertsLog(
            student_id = stu.id,
            alert_type = "custom",
            message    = message,
            status     = AlertStatus.failed,
            channel    = AlertChannel.whatsapp,
        )
        db.add(log)
        db.commit()
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            "No parent phone number on record for this student.")

    wa = _send_twilio_whatsapp(stu.parent_phone, message)
    log = AlertsLog(
        student_id  = stu.id,
        alert_type  = "custom",
        message     = message,
        status      = AlertStatus.sent if wa["ok"] else AlertStatus.failed,
        channel     = AlertChannel.whatsapp,
        external_id = wa.get("sid"),
    )
    db.add(log)
    db.commit()

    return {
        "status":       "sent" if wa["ok"] else "failed",
        "student_name": stu.name,
        "reason":       wa.get("error"),
    }

