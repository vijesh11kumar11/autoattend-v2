"""Super-admin panel routes (Traceln internal tooling). Issue #108.

All endpoints are mounted under ``/api/admin`` and protected by
:func:`utils.auth_utils.require_super_admin`. The super-admin role has
``college_id = None`` and bypasses the global tenant filter (see
``database.py :: _autotenant_and_softdelete``).

Implements:
  • GET    /api/admin/colleges                       (paginated, includes soft-deleted)
  • POST   /api/admin/colleges                       (create college)
  • PATCH  /api/admin/colleges/{college_id}          (update fields / suspend)
  • POST   /api/admin/colleges/{college_id}/principal (provision principal)
  • POST   /api/admin/users/{user_id}/reset-password (cross-college reset)
  • GET    /api/admin/stats                          (platform totals)
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Body, Depends, HTTPException, Query, status
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from database import College, User, UserRole, get_db
from utils.auth_utils import hash_password, require_super_admin
from utils.pagination import CursorPage, encode_cursor

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/admin", tags=["super-admin"])

ALLOWED_PLANS = {"trial", "active", "suspended", "cancelled"}
DEACTIVATING_PLANS = {"suspended", "cancelled"}


# ═══════════════════════════════════════════════════════════════════════
# Pydantic schemas
# ═══════════════════════════════════════════════════════════════════════

class CollegeCreateIn(BaseModel):
    name:   str = Field(..., min_length=2, max_length=255)
    domain: Optional[str] = Field(None, max_length=255)
    plan:   str = Field("trial", pattern="^(trial|active|suspended|cancelled)$")


class CollegeUpdateIn(BaseModel):
    name:   Optional[str] = Field(None, min_length=2, max_length=255)
    domain: Optional[str] = Field(None, max_length=255)
    plan:   Optional[str] = Field(None, pattern="^(trial|active|suspended|cancelled)$")
    status: Optional[str] = Field(None, pattern="^(active|inactive)$")


class CollegeOut(BaseModel):
    id:             int
    name:           str
    domain:         Optional[str]
    college_code:   Optional[str]
    plan:           str
    status:         str
    created_at:     Optional[datetime]
    is_deleted:     bool
    deleted_at:     Optional[datetime]
    user_count:     int = 0
    student_count:  int = 0

    model_config = {"from_attributes": True}


class PrincipalCreateIn(BaseModel):
    name:     str       = Field(..., min_length=2, max_length=255)
    email:    EmailStr
    phone:    Optional[str] = Field(None, max_length=20)
    password: str       = Field(..., min_length=8, max_length=128)


class UserOut(BaseModel):
    id:         int
    name:       str
    email:      str
    phone:      Optional[str]
    role:       str
    college_id: Optional[int]
    is_active:  bool
    created_at: Optional[datetime]

    model_config = {"from_attributes": True}


class PasswordResetIn(BaseModel):
    new_password: str = Field(..., min_length=8, max_length=128)


# ═══════════════════════════════════════════════════════════════════════
# Helpers
# ═══════════════════════════════════════════════════════════════════════

def _serialize_college(c: College, user_count: int = 0, student_count: int = 0) -> dict:
    return {
        "id":            c.id,
        "name":          c.name,
        "domain":        c.domain,
        "college_code":  c.college_code,
        "plan":          c.plan or "trial",
        "status":        c.status or "active",
        "created_at":    c.created_at,
        "is_deleted":    bool(c.is_deleted),
        "deleted_at":    c.deleted_at,
        "user_count":    int(user_count),
        "student_count": int(student_count),
    }


def _send_welcome_email_safe(*, to_email: str, name: str, password: str, college_name: str) -> bool:
    """Send a welcome email with credentials. Best-effort, never raises.

    Reuses MSG91 transport (see utils/otp_utils.py). If MSG91 is not
    configured the call silently succeeds-with-False so the principal
    is still created and the caller can show the credentials in the UI.
    """
    try:
        import requests
        from config import settings
        if not getattr(settings, "MSG91_AUTH_KEY", None):
            logger.info("MSG91 not configured — skipping welcome email to %s", to_email)
            return False
        body = (
            f"<p>Hi {name},</p>"
            f"<p>You have been provisioned as the <b>Principal</b> for "
            f"<b>{college_name}</b> on AutoAttend AI.</p>"
            f"<p><b>Login email:</b> {to_email}<br/>"
            f"<b>Temporary password:</b> <code>{password}</code></p>"
            f"<p>Please log in and change your password immediately.</p>"
            f"<p>— Traceln Team</p>"
        )
        payload = {
            "to":      [{"name": name, "email": to_email}],
            "from":    {"name": "AutoAttend AI", "email": settings.MSG91_EMAIL_FROM},
            "subject": f"Welcome to AutoAttend AI — {college_name}",
            "body":    body,
        }
        headers = {"authkey": settings.MSG91_AUTH_KEY, "Content-Type": "application/json"}
        resp = requests.post("https://control.msg91.com/api/v5/email/send",
                             json=payload, headers=headers, timeout=10)
        return resp.status_code in (200, 202)
    except Exception as exc:
        logger.warning("Welcome email failed for %s: %s", to_email, exc)
        return False


# ═══════════════════════════════════════════════════════════════════════
# 1. GET /api/admin/colleges — paginated list (includes soft-deleted)
# ═══════════════════════════════════════════════════════════════════════

@router.get("/colleges", response_model=CursorPage[CollegeOut])
def list_colleges(
    limit:        int = Query(default=20, ge=1, le=100),
    cursor:       Optional[str] = Query(default=None),
    current_user: dict = Depends(require_super_admin),
    db:           Session = Depends(get_db),
):
    # Super-admin context lets us see soft-deleted rows.
    q = db.query(College).execution_options(include_deleted=True)

    if cursor:
        from utils.pagination import decode_cursor
        last_id = decode_cursor(cursor)
        q = q.filter(College.id > last_id)

    rows = q.order_by(College.id.asc()).limit(limit + 1).all()
    has_more = len(rows) > limit
    rows = rows[:limit]

    if not rows:
        return CursorPage(items=[], next_cursor=None, has_more=False, total=None)

    college_ids = [c.id for c in rows]

    # Aggregate counts in one round-trip each (still cheap for the
    # super-admin listing size).
    user_counts = dict(
        db.query(User.college_id, func.count(User.id))
          .filter(User.college_id.in_(college_ids))
          .group_by(User.college_id)
          .all()
    )
    student_counts = dict(
        db.query(User.college_id, func.count(User.id))
          .filter(User.college_id.in_(college_ids), User.role == UserRole.student)
          .group_by(User.college_id)
          .all()
    )

    items = [
        _serialize_college(
            c,
            user_count=user_counts.get(c.id, 0),
            student_count=student_counts.get(c.id, 0),
        )
        for c in rows
    ]
    next_cursor = encode_cursor(rows[-1].id) if has_more else None
    return CursorPage(items=items, next_cursor=next_cursor, has_more=has_more, total=None)


# ═══════════════════════════════════════════════════════════════════════
# 2. POST /api/admin/colleges — create
# ═══════════════════════════════════════════════════════════════════════

@router.post("/colleges", response_model=CollegeOut, status_code=status.HTTP_201_CREATED)
def create_college(
    body:         CollegeCreateIn,
    current_user: dict = Depends(require_super_admin),
    db:           Session = Depends(get_db),
):
    if body.domain:
        clash = (
            db.query(College)
              .execution_options(include_deleted=True)
              .filter(College.domain == body.domain)
              .first()
        )
        if clash:
            raise HTTPException(status.HTTP_409_CONFLICT, "Domain already registered")

    college = College(
        name=body.name,
        domain=body.domain,
        plan=body.plan,
        status="active",
        college_code=str(uuid.uuid4()),
    )
    db.add(college)
    db.commit()
    db.refresh(college)
    return _serialize_college(college)


# ═══════════════════════════════════════════════════════════════════════
# 3. PATCH /api/admin/colleges/{college_id} — update
# ═══════════════════════════════════════════════════════════════════════

@router.patch("/colleges/{college_id}", response_model=CollegeOut)
def update_college(
    college_id:   int,
    body:         CollegeUpdateIn,
    current_user: dict = Depends(require_super_admin),
    db:           Session = Depends(get_db),
):
    college = (
        db.query(College)
          .execution_options(include_deleted=True)
          .filter(College.id == college_id)
          .first()
    )
    if not college:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "College not found")

    updates = body.model_dump(exclude_unset=True)

    if "domain" in updates and updates["domain"] and updates["domain"] != college.domain:
        clash = (
            db.query(College)
              .execution_options(include_deleted=True)
              .filter(College.domain == updates["domain"], College.id != college.id)
              .first()
        )
        if clash:
            raise HTTPException(status.HTTP_409_CONFLICT, "Domain already registered")

    for field in ("name", "domain", "plan", "status"):
        if field in updates and updates[field] is not None:
            setattr(college, field, updates[field])

    # Cascade: suspend/cancel plan → soft-delete college + deactivate its users
    if updates.get("plan") in DEACTIVATING_PLANS:
        now = datetime.now(timezone.utc)
        college.is_deleted = True
        college.deleted_at = now
        college.status = "inactive"
        (
            db.query(User)
              .execution_options(include_deleted=True)
              .filter(User.college_id == college.id)
              .update({User.is_active: False}, synchronize_session=False)
        )

    db.commit()
    db.refresh(college)
    return _serialize_college(college)


# ═══════════════════════════════════════════════════════════════════════
# 4. POST /api/admin/colleges/{id}/principal — provision principal
# ═══════════════════════════════════════════════════════════════════════

@router.post(
    "/colleges/{college_id}/principal",
    response_model=UserOut,
    status_code=status.HTTP_201_CREATED,
)
def create_principal(
    college_id:   int,
    body:         PrincipalCreateIn,
    current_user: dict = Depends(require_super_admin),
    db:           Session = Depends(get_db),
):
    college = (
        db.query(College)
          .execution_options(include_deleted=True)
          .filter(College.id == college_id)
          .first()
    )
    if not college:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "College not found")
    if college.is_deleted:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Cannot add principal to a deleted college")

    email_clash = db.query(User).filter(User.email == body.email).first()
    if email_clash:
        raise HTTPException(status.HTTP_409_CONFLICT, "A user with that email already exists")

    principal = User(
        college_id=college.id,
        name=body.name,
        email=body.email,
        phone=body.phone,
        role=UserRole.principal,
        password_hash=hash_password(body.password),
        is_active=True,
    )
    db.add(principal)
    db.commit()
    db.refresh(principal)

    # Best-effort welcome email — never blocks creation
    _send_welcome_email_safe(
        to_email=body.email,
        name=body.name,
        password=body.password,
        college_name=college.name,
    )

    return UserOut.model_validate(principal)


# ═══════════════════════════════════════════════════════════════════════
# 5. POST /api/admin/users/{user_id}/reset-password
# ═══════════════════════════════════════════════════════════════════════

@router.post("/users/{user_id}/reset-password")
def reset_user_password(
    user_id:      int,
    body:         PasswordResetIn,
    current_user: dict = Depends(require_super_admin),
    db:           Session = Depends(get_db),
):
    user = (
        db.query(User)
          .execution_options(include_deleted=True)
          .filter(User.id == user_id)
          .first()
    )
    if not user:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")

    user.password_hash = hash_password(body.new_password)
    user.password_changed_at = datetime.now(timezone.utc)
    db.commit()
    return {"ok": True, "user_id": user.id, "message": "Password reset successfully"}


# ═══════════════════════════════════════════════════════════════════════
# 6. GET /api/admin/stats — platform totals
# ═══════════════════════════════════════════════════════════════════════

@router.get("/stats")
def platform_stats(
    current_user: dict = Depends(require_super_admin),
    db:           Session = Depends(get_db),
):
    total_colleges = (
        db.query(func.count(College.id))
          .execution_options(include_deleted=True)
          .scalar() or 0
    )
    total_users = (
        db.query(func.count(User.id))
          .execution_options(include_deleted=True)
          .scalar() or 0
    )
    total_students = (
        db.query(func.count(User.id))
          .execution_options(include_deleted=True)
          .filter(User.role == UserRole.student)
          .scalar() or 0
    )

    plan_breakdown_rows = (
        db.query(College.plan, func.count(College.id))
          .execution_options(include_deleted=True)
          .group_by(College.plan)
          .all()
    )
    plan_counts = {"trial": 0, "active": 0, "suspended": 0, "cancelled": 0}
    for plan_value, count in plan_breakdown_rows:
        if plan_value in plan_counts:
            plan_counts[plan_value] = int(count)

    return {
        "total_colleges": int(total_colleges),
        "total_users":    int(total_users),
        "total_students": int(total_students),
        "colleges_by_plan": plan_counts,
    }
