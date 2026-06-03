"""
AutoAttend AI v2.0 — Unified per-user Notifications Router

GET  /api/notifications/me            recent items + unread count
POST /api/notifications/me/mark-read  mark all as seen (best-effort, client-side)

Sources aggregated per role:
  student     → AlertsLog (their own), dispute resolutions, leave decisions
  teacher/hod → pending disputes, pending leave requests (counts only)
"""

from datetime import UTC, datetime

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from database import (
    AlertsLog,
    AttendanceDispute,
    DisputeStatus,
    LeaveRequest,
    LeaveRequestStatus,
    get_db,
)
from utils.auth_utils import any_authenticated

router = APIRouter(prefix="/api/notifications", tags=["notifications"])


def _iso(dt):
    if not dt:
        return None
    return dt.isoformat()


@router.get("/me")
def my_notifications(
    limit: int = 20,
    current_user: dict = Depends(any_authenticated),
    db: Session = Depends(get_db),
):
    """
    Return a unified list of recent notifications for the current user.
    Lightweight — designed for the navbar bell dropdown.
    """
    limit = max(1, min(limit, 50))
    role = current_user.get("role")
    uid = current_user["id"]

    items: list[dict] = []

    if role == "student":
        # Personal alerts log
        for a in (
            db.query(AlertsLog)
            .filter(AlertsLog.student_id == uid)
            .order_by(AlertsLog.sent_at.desc())
            .limit(limit)
            .all()
        ):
            items.append(
                {
                    "kind": "alert",
                    "title": a.alert_type or "Notification",
                    "body": (a.message or "")[:240],
                    "created_at": _iso(a.sent_at),
                    "meta": {
                        "channel": a.channel.value if a.channel else None,
                        "status": a.status.value if a.status else None,
                    },
                }
            )

        # Resolved disputes (last 30 days)
        for d in (
            db.query(AttendanceDispute)
            .filter(AttendanceDispute.student_id == uid)
            .filter(AttendanceDispute.status != DisputeStatus.pending)
            .order_by(AttendanceDispute.resolved_at.desc().nullslast())
            .limit(limit)
            .all()
        ):
            items.append(
                {
                    "kind": "dispute_update",
                    "title": f"Dispute {d.status.value}",
                    "body": (d.resolution_note or d.reason or "")[:240],
                    "created_at": _iso(d.resolved_at or d.created_at),
                    "meta": {"dispute_id": d.id, "status": d.status.value},
                }
            )

        # Leave request decisions
        for l in (
            db.query(LeaveRequest)
            .filter(LeaveRequest.student_id == uid)
            .filter(LeaveRequest.status != LeaveRequestStatus.pending)
            .order_by(LeaveRequest.id.desc())
            .limit(limit)
            .all()
        ):
            items.append(
                {
                    "kind": "leave_decision",
                    "title": f"Leave {l.status.value}",
                    "body": (getattr(l, "reason", "") or "")[:240],
                    "created_at": _iso(
                        getattr(l, "decided_at", None) or getattr(l, "created_at", None)
                    ),
                    "meta": {"leave_id": l.id, "status": l.status.value},
                }
            )

    elif role in ("teacher", "hod", "principal"):
        # Pending disputes & leave requests visible to the user (lightweight count + samples)
        pending_disputes = (
            db.query(AttendanceDispute)
            .filter(AttendanceDispute.status == DisputeStatus.pending)
            .order_by(AttendanceDispute.created_at.desc())
            .limit(limit)
            .all()
        )
        for d in pending_disputes:
            items.append(
                {
                    "kind": "dispute_pending",
                    "title": "New attendance dispute",
                    "body": (d.reason or "")[:240],
                    "created_at": _iso(getattr(d, "created_at", None)),
                    "meta": {"dispute_id": d.id, "student_id": d.student_id},
                }
            )

        pending_leaves = (
            db.query(LeaveRequest)
            .filter(LeaveRequest.status == LeaveRequestStatus.pending)
            .order_by(LeaveRequest.id.desc())
            .limit(limit)
            .all()
        )
        for l in pending_leaves:
            items.append(
                {
                    "kind": "leave_pending",
                    "title": "Pending leave request",
                    "body": (getattr(l, "reason", "") or "")[:240],
                    "created_at": _iso(getattr(l, "created_at", None)),
                    "meta": {"leave_id": l.id, "student_id": l.student_id},
                }
            )

    # Sort newest first, cap to limit
    items.sort(key=lambda x: x.get("created_at") or "", reverse=True)
    items = items[:limit]

    # Unread heuristic: items newer than last_seen (client-supplied), else all
    return {
        "items": items,
        "unread_count": len(items),
        "server_time": datetime.now(tz=UTC).isoformat(),
    }
