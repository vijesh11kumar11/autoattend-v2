"""
AutoAttend AI v2.0 — Authentication Routes

POST   /api/auth/login
POST   /api/auth/verify-totp
GET    /api/auth/totp-setup
POST   /api/auth/totp-confirm
POST   /api/auth/request-password-change
POST   /api/auth/confirm-password-change
POST   /api/auth/forgot-password
POST   /api/auth/reset-password
POST   /api/auth/enable-face
POST   /api/auth/disable-face
POST   /api/auth/logout
GET    /api/auth/me

Login rules enforced:
  Students  → roll_number + password (no TOTP)
  Staff     → email + password + TOTP (mandatory)
  MSG91 OTP → password/device change only, NOT login
"""

import base64
import io
from datetime import datetime, timedelta, timezone

import qrcode
from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from slowapi import Limiter
from slowapi.util import get_remote_address
from sqlalchemy.orm import Session

from config import settings
from database import DeviceRegistry, User, UserRole, get_db
from schemas.auth_schemas import (
    ConfirmPasswordChangeRequest,
    EnableFaceResponse,
    ForgotPasswordRequest,
    ForgotPasswordResponse,
    LoginRequest,
    LoginResponse,
    MessageResponse,
    PasswordChangeRequestResponse,
    ProfileResponse,
    ResetPasswordRequest,
    TOTPConfirmRequest,
    TOTPSetupResponse,
    VerifyTOTPRequest,
)
from utils.auth_utils import (
    any_authenticated,
    create_access_token,
    create_totp_session_token,
    decode_totp_session_token,
    generate_totp_secret,
    get_current_user,
    get_totp_uri,
    hash_password,
    is_first_login,
    needs_rehash,
    record_login,
    staff_only,
    verify_password,
    verify_totp_code,
)
from utils.otp_utils import (
    mask_email,
    mask_phone,
    send_dual_otp,
    verify_dual_otp,
)

import logging
logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/auth", tags=["Authentication"])
limiter = Limiter(key_func=get_remote_address)

_TOTP_MAX_FAIL     = 3
_TOTP_LOCK_MINUTES = 15


# ─── Internal helpers ──────────────────────────────────────────────────

def _build_jwt(user: User, device_id: str) -> str:
    return create_access_token({
        "sub":           user.email if user.role != UserRole.student else user.roll_number,
        "id":            user.id,
        "role":          user.role.value,
        "college_id":    user.college_id,
        "department_id": user.department_id,
        "face_enrolled": user.face_enrolled,
        "device_id":     device_id,
    })


def _totp_qr_base64(uri: str) -> str:
    img = qrcode.make(uri)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    b64 = base64.b64encode(buf.getvalue()).decode()
    return f"data:image/png;base64,{b64}"


def _get_user_by_identifier(identifier: str, db: Session) -> User | None:
    """Find user by email (staff) or roll_number (student)."""
    identifier = identifier.strip()
    if "@" in identifier:
        return db.query(User).filter(User.email == identifier.lower()).first()
    return db.query(User).filter(User.roll_number == identifier).first()


# ═══════════════════════════════════════════════════════════════════════
# POST /api/auth/login
# ═══════════════════════════════════════════════════════════════════════

@router.post("/login", response_model=LoginResponse)
@limiter.limit("5/15minutes")
def login(
    request:     Request,
    body:        LoginRequest,
    x_device_id: str     = Header(default=""),
    db:          Session = Depends(get_db),
):
    now            = datetime.now(tz=timezone.utc)
    invalid_creds  = HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid credentials")

    logger.info("🔐 LOGIN attempt │ identifier='%s' │ IP=%s │ device=%s",
                body.identifier, request.client.host if request.client else "unknown", x_device_id or "none")

    # 1. Find user
    user = _get_user_by_identifier(body.identifier, db)
    if not user or not user.is_active:
        logger.warning("🔐 LOGIN failed │ identifier='%s' │ reason=user not found or inactive", body.identifier)
        raise invalid_creds

    logger.info("🔐 LOGIN │ user found │ id=%d │ role=%s │ name='%s'",
                user.id, user.role.value, user.name)

    # 2. Verify Argon2 password (constant-time)
    if not verify_password(body.password, user.password_hash):
        logger.warning("🔐 LOGIN failed │ user_id=%d │ reason=invalid password", user.id)
        raise invalid_creds

    logger.info("🔐 LOGIN │ user_id=%d │ password verified ✓", user.id)

    # 3. Silently rehash if parameters changed (e.g. after Argon2 tuning)
    if needs_rehash(user.password_hash):
        user.password_hash = hash_password(body.password)
        db.commit()
        logger.info("🔐 LOGIN │ user_id=%d │ password rehashed (Argon2 tuning)", user.id)

    # 4. TOTP lock check (staff only)
    if user.role != UserRole.student and user.totp_locked_until:
        if user.totp_locked_until > now:
            remaining = int((user.totp_locked_until - now).total_seconds() / 60) + 1
            logger.warning("🔐 LOGIN blocked │ user_id=%d │ TOTP locked for %d more min(s)", user.id, remaining)
            raise HTTPException(
                status.HTTP_423_LOCKED,
                f"Account locked for {remaining} more minute(s) due to too many TOTP failures",
            )
        # Lock has expired — reset
        user.totp_fail_count  = 0
        user.totp_locked_until = None
        db.commit()
        logger.info("🔐 LOGIN │ user_id=%d │ TOTP lock expired — counter reset", user.id)

    # ── STUDENT FLOW ───────────────────────────────────────────────────
    if user.role == UserRole.student:
        logger.info("🎓 STUDENT LOGIN │ student_id=%d │ roll=%s │ face_enrolled=%s",
                    user.id, user.roll_number, user.face_enrolled)
        existing_device: DeviceRegistry | None = (
            db.query(DeviceRegistry)
            .filter(DeviceRegistry.user_id == user.id)
            .first()
        )

        if existing_device is None:
            # First login — auto-register device
            if x_device_id:
                db.add(DeviceRegistry(
                    user_id=user.id,
                    device_id=x_device_id,
                    is_active=True,
                    bound_at=now,
                ))
                db.commit()
                logger.info("🎓 STUDENT LOGIN │ student_id=%d │ first login — device registered: %s",
                            user.id, x_device_id)
            else:
                logger.info("🎓 STUDENT LOGIN │ student_id=%d │ first login — no device_id header", user.id)
        elif existing_device.device_id != x_device_id:
            logger.warning("🎓 STUDENT LOGIN blocked │ student_id=%d │ device mismatch │ registered=%s │ got=%s",
                           user.id, existing_device.device_id, x_device_id)
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                "Device mismatch. Use the device change flow to register a new device.",
            )
        else:
            logger.info("🎓 STUDENT LOGIN │ student_id=%d │ device matched ✓", user.id)

        record_login(user.id, db)
        logger.info("🎓 STUDENT LOGIN success │ student_id=%d │ JWT issued │ face_enrollment_required=%s",
                    user.id, not user.face_enrolled)
        return LoginResponse(
            access_token=_build_jwt(user, x_device_id),
            role=user.role.value,
            name=user.name,
            face_enrollment_required=not user.face_enrolled,
        )

    # ── STAFF FLOW ─────────────────────────────────────────────────────
    logger.info("👨‍🏫 STAFF LOGIN │ user_id=%d │ role=%s │ totp_enabled=%s",
                user.id, user.role.value, user.totp_enabled)
    if user.totp_enabled:
        # Return a short-lived TOTP challenge token — full JWT comes after TOTP
        logger.info("👨‍🏫 STAFF LOGIN │ user_id=%d │ TOTP challenge issued — awaiting 6-digit code", user.id)
        return LoginResponse(
            requires_totp=True,
            totp_session_token=create_totp_session_token(user.id),
        )

    # TOTP not yet set up → issue JWT but flag that setup is required
    record_login(user.id, db)
    logger.info("👨‍🏫 STAFF LOGIN success │ user_id=%d │ JWT issued │ totp_setup_required=True", user.id)
    return LoginResponse(
        access_token=_build_jwt(user, x_device_id),
        role=user.role.value,
        name=user.name,
        totp_setup_required=True,
    )


# ═══════════════════════════════════════════════════════════════════════
# POST /api/auth/verify-totp
# ═══════════════════════════════════════════════════════════════════════

@router.post("/verify-totp", response_model=LoginResponse)
def verify_totp_endpoint(
    body:        VerifyTOTPRequest,
    x_device_id: str     = Header(default=""),
    db:          Session = Depends(get_db),
):
    payload = decode_totp_session_token(body.totp_session_token)
    user_id: int = payload["user_id"]

    logger.info("🔑 TOTP verify attempt │ user_id=%d", user_id)

    user: User | None = (
        db.query(User)
        .filter(User.id == user_id, User.is_active == True)  # noqa: E712
        .first()
    )
    if not user:
        logger.warning("🔑 TOTP verify failed │ user_id=%d │ reason=user not found", user_id)
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "User not found")

    now = datetime.now(tz=timezone.utc)

    # Check if already locked
    if user.totp_locked_until and user.totp_locked_until > now:
        remaining = int((user.totp_locked_until - now).total_seconds() / 60) + 1
        logger.warning("🔑 TOTP verify blocked │ user_id=%d │ locked for %d more min(s)", user_id, remaining)
        raise HTTPException(
            status.HTTP_423_LOCKED,
            f"Account locked for {remaining} more minute(s). Try again later.",
        )

    # Verify the TOTP code
    if not verify_totp_code(user.totp_secret, body.totp_code):
        user.totp_fail_count = (user.totp_fail_count or 0) + 1
        logger.warning("🔑 TOTP verify failed │ user_id=%d │ fail_count=%d/%d",
                       user_id, user.totp_fail_count, _TOTP_MAX_FAIL)
        if user.totp_fail_count >= _TOTP_MAX_FAIL:
            user.totp_locked_until = now + timedelta(minutes=_TOTP_LOCK_MINUTES)
            db.commit()
            logger.warning("🔑 TOTP ACCOUNT LOCKED │ user_id=%d │ locked for %d min", user_id, _TOTP_LOCK_MINUTES)
            raise HTTPException(
                status.HTTP_423_LOCKED,
                f"Too many incorrect attempts. Account locked for {_TOTP_LOCK_MINUTES} minutes.",
            )
        db.commit()
        remaining_attempts = _TOTP_MAX_FAIL - user.totp_fail_count
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED,
            f"Invalid TOTP code. {remaining_attempts} attempt(s) remaining.",
        )

    # Success — reset failure counters
    user.totp_fail_count   = 0
    user.totp_locked_until = None
    db.commit()

    record_login(user.id, db)
    logger.info("🔑 TOTP verify success │ user_id=%d │ role=%s │ JWT issued ✓", user.id, user.role.value)
    return LoginResponse(
        access_token=_build_jwt(user, x_device_id),
        role=user.role.value,
        name=user.name,
    )


# ═══════════════════════════════════════════════════════════════════════
# GET /api/auth/totp-setup  (staff only — generates secret + QR)
# ═══════════════════════════════════════════════════════════════════════

@router.get("/totp-setup", response_model=TOTPSetupResponse)
def totp_setup(current_user: dict = Depends(staff_only)):
    logger.info("🔧 TOTP setup requested │ user_id=%d", current_user["id"])
    secret = generate_totp_secret()
    uri    = get_totp_uri(secret, current_user["email"])
    return TOTPSetupResponse(
        secret=secret,
        qr_image=_totp_qr_base64(uri),
        instructions=(
            "Scan this QR code with Google Authenticator, Authy, or any TOTP app. "
            "Then enter the 6-digit code below to confirm setup and activate TOTP."
        ),
    )


# ═══════════════════════════════════════════════════════════════════════
# POST /api/auth/totp-confirm  (staff only — saves secret after scan)
# ═══════════════════════════════════════════════════════════════════════

@router.post("/totp-confirm", response_model=MessageResponse)
def totp_confirm(
    body:         TOTPConfirmRequest,
    current_user: dict    = Depends(staff_only),
    db:           Session = Depends(get_db),
):
    if not verify_totp_code(body.secret, body.totp_code):
        logger.warning("🔧 TOTP confirm failed │ user_id=%d │ invalid code", current_user["id"])
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Invalid TOTP code. Please rescan the QR code and try again.",
        )

    db.query(User).filter(User.id == current_user["id"]).update(
        {"totp_secret": body.secret, "totp_enabled": True},
        synchronize_session=False,
    )
    db.commit()
    logger.info("🔧 TOTP enabled │ user_id=%d │ TOTP now active ✓", current_user["id"])
    return MessageResponse(
        message="TOTP enabled successfully. You will be required to enter a code on every login."
    )


# ═══════════════════════════════════════════════════════════════════════
# POST /api/auth/request-password-change  (must be logged in)
# ═══════════════════════════════════════════════════════════════════════

@router.post("/request-password-change", response_model=PasswordChangeRequestResponse)
def request_password_change(
    current_user: dict    = Depends(any_authenticated),
    db:           Session = Depends(get_db),
):
    result = send_dual_otp(current_user["id"], "password_change", db)
    return PasswordChangeRequestResponse(
        sms_sent=result["sms_sent"],
        email_sent=result["email_sent"],
        phone_masked=result["phone_masked"],
        email_masked=result["email_masked"],
        expires_in=600,
    )


# ═══════════════════════════════════════════════════════════════════════
# POST /api/auth/confirm-password-change  (must be logged in)
# ═══════════════════════════════════════════════════════════════════════

@router.post("/confirm-password-change", response_model=MessageResponse)
def confirm_password_change(
    body:         ConfirmPasswordChangeRequest,
    current_user: dict    = Depends(any_authenticated),
    db:           Session = Depends(get_db),
):
    if not verify_dual_otp(
        current_user["id"], body.otp_sms, body.otp_email, "password_change", db
    ):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid or expired OTP")

    now = datetime.now(tz=timezone.utc)
    db.query(User).filter(User.id == current_user["id"]).update(
        {
            "password_hash":      hash_password(body.new_password),
            "password_changed_at": now,   # invalidates all existing JWTs
        },
        synchronize_session=False,
    )
    db.commit()
    return MessageResponse(message="Password changed successfully. Please login again.")


# ═══════════════════════════════════════════════════════════════════════
# POST /api/auth/forgot-password  (unauthenticated)
# ═══════════════════════════════════════════════════════════════════════

@router.post("/forgot-password", response_model=ForgotPasswordResponse)
@limiter.limit("3/hour")
def forgot_password(request: Request, body: ForgotPasswordRequest, db: Session = Depends(get_db)):
    """
    Always returns the same generic message — never reveals whether the
    identifier exists (prevents user-enumeration attacks).
    """
    user = _get_user_by_identifier(body.identifier, db)

    if user and user.is_active:
        logger.info("🔑 FORGOT PASSWORD │ user_id=%d │ OTP sent via SMS+email", user.id)
        result = send_dual_otp(user.id, "forgot_password", db)

        # Backup push notification for OTP
        from utils.notification_utils import send_push_notification
        send_push_notification(
            user_id=user.id,
            title="🔑 AutoAttend OTP",
            body="Your AutoAttend OTP is ready. Check your SMS and email.",
            db=db,
            data={"type": "otp_notification"},
        )

        return ForgotPasswordResponse(
            phone_masked=result["phone_masked"],
            email_masked=result["email_masked"],
        )

    # User not found — return generic masked placeholders (no enumeration leak)
    return ForgotPasswordResponse(
        phone_masked="****",
        email_masked="****@****",
    )


# ═══════════════════════════════════════════════════════════════════════
# POST /api/auth/reset-password  (unauthenticated)
# ═══════════════════════════════════════════════════════════════════════

@router.post("/reset-password", response_model=MessageResponse)
def reset_password(body: ResetPasswordRequest, db: Session = Depends(get_db)):
    user = _get_user_by_identifier(body.identifier, db)

    if not user or not user.is_active:
        logger.warning("🔑 RESET PASSWORD failed │ identifier='%s' │ user not found/inactive", body.identifier)
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid OTP or identifier")

    if not verify_dual_otp(user.id, body.otp_sms, body.otp_email, "forgot_password", db):
        logger.warning("🔑 RESET PASSWORD failed │ user_id=%d │ invalid/expired OTP", user.id)
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid or expired OTP")

    now = datetime.now(tz=timezone.utc)
    db.query(User).filter(User.id == user.id).update(
        {
            "password_hash":      hash_password(body.new_password),
            "password_changed_at": now,
        },
        synchronize_session=False,
    )
    db.commit()
    logger.info("🔑 RESET PASSWORD success │ user_id=%d │ password changed ✓", user.id)
    return MessageResponse(message="Password reset successfully. Please login with your new password.")


# ═══════════════════════════════════════════════════════════════════════
# POST /api/auth/enable-face  (staff only)
# ═══════════════════════════════════════════════════════════════════════

@router.post("/enable-face", response_model=EnableFaceResponse)
def enable_face(
    current_user: dict    = Depends(staff_only),
    db:           Session = Depends(get_db),
):
    db.query(User).filter(User.id == current_user["id"]).update(
        {"face_auth_enabled": True},
        synchronize_session=False,
    )
    db.commit()
    return EnableFaceResponse(
        face_auth_enabled=True,
        message="Face authentication enabled. Please complete face enrollment from the face setup page.",
    )


# ═══════════════════════════════════════════════════════════════════════
# POST /api/auth/disable-face  (staff only)
# ═══════════════════════════════════════════════════════════════════════

@router.post("/disable-face", response_model=MessageResponse)
def disable_face(
    current_user: dict    = Depends(staff_only),
    db:           Session = Depends(get_db),
):
    # DB fields cleared here. Azure person cleanup is in face_utils.py (future prompt).
    db.query(User).filter(User.id == current_user["id"]).update(
        {
            "face_auth_enabled": False,
            "face_enrolled":     False,
            "face_enrolled_at":  None,
            "azure_person_id":   None,
        },
        synchronize_session=False,
    )
    db.commit()
    return MessageResponse(message="Face authentication disabled and enrollment data cleared.")


# ═══════════════════════════════════════════════════════════════════════
# POST /api/auth/logout
# ═══════════════════════════════════════════════════════════════════════

@router.post("/logout", response_model=MessageResponse)
def logout(current_user: dict = Depends(any_authenticated)):
    """
    JWTs are stateless. True session invalidation is handled via
    password_changed_at (checked in get_current_user).
    The frontend must delete the token from secure storage on logout.
    """
    return MessageResponse(message="Logged out successfully.")


# ═══════════════════════════════════════════════════════════════════════
# GET /api/auth/me
# ═══════════════════════════════════════════════════════════════════════

@router.get("/me", response_model=ProfileResponse)
def me(
    current_user: dict    = Depends(any_authenticated),
    db:           Session = Depends(get_db),
):
    from database import Course  # local import to avoid circular reference
    user: User | None = db.query(User).filter(User.id == current_user["id"]).first()
    if not user:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")

    logger.info("👤 PROFILE accessed │ user_id=%d │ role=%s │ name='%s'",
                user.id, user.role.value, user.name)

    course_name = None
    if user.course_id:
        course = db.query(Course).filter(Course.id == user.course_id).first()
        if course:
            course_name = course.name

    return ProfileResponse(
        id=user.id,
        name=user.name,
        email=user.email,
        role=user.role.value,
        college_id=user.college_id,
        department_id=user.department_id,
        face_enrolled=user.face_enrolled,
        totp_enabled=user.totp_enabled,
        face_auth_enabled=user.face_auth_enabled,
        phone=user.phone,
        roll_number=user.roll_number,
        semester=user.semester,
        course_name=course_name,
    )
