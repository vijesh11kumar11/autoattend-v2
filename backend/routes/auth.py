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
import logging
from datetime import UTC, datetime, timedelta

import qrcode
from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    Header,
    HTTPException,
    Request,
    Response,
    status,
)
from slowapi import Limiter
from slowapi.util import get_remote_address
from sqlalchemy.orm import Session

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
    RefreshTokenRequest,
    RefreshTokenResponse,
    ResetPasswordRequest,
    TOTPConfirmRequest,
    TOTPSetupResponse,
    VerifyTOTPRequest,
)
from utils.auth_utils import (
    REFRESH_COOKIE_NAME,
    TEST_STUDENT_ROLLS,
    any_authenticated,
    clear_auth_cookie,
    clear_refresh_cookie,
    create_access_token,
    create_refresh_token,
    create_totp_session_token,
    decode_totp_session_token,
    decrypt_totp_secret,
    encrypt_totp_secret,
    generate_totp_secret,
    get_totp_uri,
    hash_password,
    is_ip_locked,
    is_user_locked,
    log_login_attempt,
    needs_rehash,
    record_login,
    record_login_failure,
    record_login_success,
    revoke_all_refresh_tokens,
    revoke_refresh_token,
    rotate_refresh_token,
    set_auth_cookie,
    set_refresh_cookie,
    staff_only,
    verify_password,
    verify_totp_code,
)
from utils.email_utils import send_welcome_email
from utils.otp_utils import (
    send_dual_otp,
    verify_dual_otp,
)
from utils.security_logger import SecurityEventType, Severity, sec_logger

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/auth", tags=["Authentication"])
limiter = Limiter(key_func=get_remote_address)

_TOTP_MAX_FAIL = 3
_TOTP_LOCK_MINUTES = 15


# ─── Internal helpers ──────────────────────────────────────────────────


def _build_jwt(user: User, device_id: str) -> str:
    return create_access_token(
        {
            "sub": user.email if user.role != UserRole.student else user.roll_number,
            "id": user.id,
            "name": user.name,
            "role": user.role.value,
            "college_id": user.college_id,
            "department_id": user.department_id,
            "face_enrolled": user.face_enrolled,
            "device_id": device_id,
        }
    )


def _issue_token(response: Response, user: User, device_id: str, client_type: str) -> str:
    """
    Build a JWT and, for web clients, also set it as an httpOnly cookie.
    Mobile clients (X-Client-Type: mobile) receive the token in the JSON
    body only — no cookie is set.
    """
    token = _build_jwt(user, device_id)
    if (client_type or "").lower() != "mobile":
        set_auth_cookie(response, token)
    return token


def _issue_refresh(
    response: Response,
    user: User,
    device_id: str,
    client_type: str,
    db: Session,
) -> str | None:
    """
    Mint a new refresh token. Web clients get it as an httpOnly cookie and
    receive `None` in the JSON body; mobile clients get the raw token in
    the JSON body and no cookie is set.
    """
    raw = create_refresh_token(user.id, device_id, db)
    if (client_type or "").lower() == "mobile":
        return raw
    set_refresh_cookie(response, raw)
    return None


def _totp_qr_base64(uri: str) -> str:
    img = qrcode.make(uri)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    b64 = base64.b64encode(buf.getvalue()).decode()
    return f"data:image/png;base64,{b64}"


def _get_user_by_identifier(identifier: str, db: Session) -> User | None:
    """Find user by email (staff) or roll_number (student).

    Roll-number lookup is case-insensitive so mobile keyboards that
    auto-capitalise or auto-lowercase the input still match.
    """
    identifier = identifier.strip()
    if "@" in identifier:
        return db.query(User).filter(User.email == identifier.lower()).first()
    # Normalise to uppercase — roll numbers are stored as e.g. KCT23ECE001
    return db.query(User).filter(User.roll_number == identifier.upper()).first()


# ═══════════════════════════════════════════════════════════════════════
# POST /api/auth/login
# ═══════════════════════════════════════════════════════════════════════


@router.post("/login", response_model=LoginResponse)
@limiter.limit("60/minute")
def login(
    request: Request,
    body: LoginRequest,
    response: Response,
    background_tasks: BackgroundTasks,
    x_device_id: str = Header(default=""),
    x_client_type: str = Header(default="web"),
    db: Session = Depends(get_db),
):
    now = datetime.now(tz=UTC)
    invalid_creds = HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid credentials")
    ip_addr = request.client.host if request.client else None
    ua = request.headers.get("user-agent")

    logger.info(
        "🔐 LOGIN attempt │ identifier='%s' │ IP=%s │ device=%s",
        body.identifier,
        ip_addr or "unknown",
        x_device_id or "none",
    )

    # 0. IP-based brute-force lockout (defends against credential-stuffing)
    ip_locked, ip_lock_secs = is_ip_locked(ip_addr, db)
    if ip_locked:
        logger.warning(
            "🔐 LOGIN blocked │ IP=%s │ exceeded %d failed attempts in 15 min", ip_addr, 20
        )
        log_login_attempt(
            db,
            ip_address=ip_addr,
            user_identifier=body.identifier,
            success=False,
            failure_reason="ip_locked",
            user_agent=ua,
        )
        sec_logger.log(
            SecurityEventType.LOGIN_LOCKED,
            Severity.CRITICAL,
            ip_address=ip_addr,
            user_agent=ua,
            details={"ip_lockout": True, "identifier": body.identifier, "window_minutes": 15},
            request_id=getattr(request.state, "request_id", None) if request else None,
            db=db,
        )
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            "Too many failed login attempts from this network. Try again later.",
        )

    # 1. Find user
    user = _get_user_by_identifier(body.identifier, db)
    if not user or not user.is_active:
        logger.warning(
            "🔐 LOGIN failed │ identifier='%s' │ reason=user not found or inactive", body.identifier
        )
        log_login_attempt(
            db,
            ip_address=ip_addr,
            user_identifier=body.identifier,
            success=False,
            failure_reason="user_not_found_or_inactive",
            user_agent=ua,
        )
        raise invalid_creds

    # 1b. Pre-check password brute-force lockout
    locked, secs = is_user_locked(user)
    if locked:
        minutes = max(1, secs // 60)
        logger.warning(
            "🔐 LOGIN blocked │ user_id=%d │ password lockout %d s remaining", user.id, secs
        )
        log_login_attempt(
            db,
            ip_address=ip_addr,
            user_identifier=body.identifier,
            success=False,
            failure_reason="account_locked",
            user_agent=ua,
        )
        sec_logger.log(
            SecurityEventType.LOGIN_LOCKED,
            Severity.WARN,
            user_id=user.id,
            ip_address=ip_addr,
            user_agent=ua,
            details={"identifier": body.identifier, "remaining_seconds": secs},
            request_id=getattr(request.state, "request_id", None) if request else None,
            db=db,
        )
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            f"Too many failed login attempts. Try again in {minutes} minute(s).",
        )

    logger.info(
        "🔐 LOGIN │ user found │ id=%d │ role=%s │ name='%s'", user.id, user.role.value, user.name
    )

    # 2. Verify Argon2 password (constant-time)
    if not verify_password(body.password, user.password_hash):
        now_locked, lock_secs = record_login_failure(user, db)
        logger.warning(
            "🔐 LOGIN failed │ user_id=%d │ reason=invalid password │ fail_count=%d",
            user.id,
            user.login_fail_count or 0,
        )
        log_login_attempt(
            db,
            ip_address=ip_addr,
            user_identifier=body.identifier,
            success=False,
            failure_reason="invalid_password",
            user_agent=ua,
        )
        sec_logger.log(
            SecurityEventType.LOGIN_FAILURE,
            Severity.WARN,
            user_id=user.id,
            ip_address=ip_addr,
            user_agent=ua,
            details={"identifier": body.identifier, "fail_count": user.login_fail_count or 0},
            request_id=getattr(request.state, "request_id", None) if request else None,
            db=db,
        )
        if now_locked:
            sec_logger.log(
                SecurityEventType.LOGIN_LOCKED,
                Severity.CRITICAL,
                user_id=user.id,
                ip_address=ip_addr,
                user_agent=ua,
                details={"lock_seconds": lock_secs},
                request_id=getattr(request.state, "request_id", None) if request else None,
                db=db,
            )
            raise HTTPException(
                status.HTTP_429_TOO_MANY_REQUESTS,
                f"Too many failed attempts. Account locked for {lock_secs // 60} minute(s).",
            )
        raise invalid_creds

    # Successful password → reset password-lockout counters (TOTP still pending for staff)
    record_login_success(user, db)

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
            logger.warning(
                "🔐 LOGIN blocked │ user_id=%d │ TOTP locked for %d more min(s)", user.id, remaining
            )
            raise HTTPException(
                status.HTTP_423_LOCKED,
                f"Account locked for {remaining} more minute(s) due to too many TOTP failures",
            )
        # Lock has expired — reset
        user.totp_fail_count = 0
        user.totp_locked_until = None
        db.commit()
        logger.info("🔐 LOGIN │ user_id=%d │ TOTP lock expired — counter reset", user.id)

    # ── STUDENT FLOW ───────────────────────────────────────────────────
    if user.role == UserRole.student:
        logger.info(
            "🎓 STUDENT LOGIN │ student_id=%d │ roll=%s │ face_enrolled=%s",
            user.id,
            user.roll_number,
            user.face_enrolled,
        )
        existing_device: DeviceRegistry | None = (
            db.query(DeviceRegistry).filter(DeviceRegistry.user_id == user.id).first()
        )

        if existing_device is None:
            # First login — MUST present a device_id so we can bind it now.
            # Without this, a student could attend from any device until the
            # next login bound one (1st-login binding window bypass).
            if not x_device_id:
                logger.warning(
                    "🎓 STUDENT LOGIN blocked │ student_id=%d │ first login but no X-Device-ID header",
                    user.id,
                )
                log_login_attempt(
                    db,
                    ip_address=ip_addr,
                    user_identifier=body.identifier,
                    success=False,
                    failure_reason="missing_device_id",
                    user_agent=ua,
                )
                raise HTTPException(
                    status.HTTP_400_BAD_REQUEST,
                    "Device identifier required for student login. Reinstall the app or clear site data and try again.",
                )
            db.add(
                DeviceRegistry(
                    user_id=user.id,
                    device_id=x_device_id,
                    is_active=True,
                    bound_at=now,
                )
            )
            db.commit()
            logger.info(
                "🎓 STUDENT LOGIN │ student_id=%d │ first login — device registered: %s",
                user.id,
                x_device_id,
            )
            # First-login welcome email — best-effort, runs after the response
            # so it never adds latency to or blocks the login. No-op when the
            # student has no email or the welcome template is unconfigured.
            if user.email:
                background_tasks.add_task(send_welcome_email, user.email, user.name)
        elif existing_device.device_id != x_device_id:
            # Friends-test rolls: silently re-bind to the new device so testers
            # can hop between phones/browsers without manual DB resets. This
            # bypass is gated to a hardcoded list (TEST_STUDENT_ROLLS) and has
            # no effect on real student accounts.
            if user.roll_number in TEST_STUDENT_ROLLS:
                logger.info(
                    "🧪 TEST STUDENT │ student_id=%d │ roll=%s │ re-binding device %s → %s",
                    user.id,
                    user.roll_number,
                    existing_device.device_id,
                    x_device_id,
                )
                existing_device.device_id = x_device_id
                existing_device.bound_at = now
                db.commit()
            else:
                logger.warning(
                    "🎓 STUDENT LOGIN blocked │ student_id=%d │ device mismatch │ registered=%s │ got=%s",
                    user.id,
                    existing_device.device_id,
                    x_device_id,
                )
                raise HTTPException(
                    status.HTTP_403_FORBIDDEN,
                    "Device mismatch. Use the device change flow to register a new device.",
                )
        else:
            logger.info("🎓 STUDENT LOGIN │ student_id=%d │ device matched ✓", user.id)

        record_login(user.id, db)
        log_login_attempt(
            db, ip_address=ip_addr, user_identifier=body.identifier, success=True, user_agent=ua
        )
        logger.info(
            "🎓 STUDENT LOGIN success │ student_id=%d │ JWT issued │ face_enrollment_required=%s",
            user.id,
            not user.face_enrolled,
        )
        return LoginResponse(
            access_token=_issue_token(response, user, x_device_id, x_client_type),
            refresh_token=_issue_refresh(response, user, x_device_id, x_client_type, db),
            role=user.role.value,
            name=user.name,
            face_enrollment_required=not user.face_enrolled,
        )

    # ── STAFF FLOW ─────────────────────────────────────────────────────
    logger.info(
        "👨‍🏫 STAFF LOGIN │ user_id=%d │ role=%s │ totp_enabled=%s",
        user.id,
        user.role.value,
        user.totp_enabled,
    )
    if user.totp_enabled:
        # Return a short-lived TOTP challenge token — full JWT comes after TOTP
        logger.info(
            "👨‍🏫 STAFF LOGIN │ user_id=%d │ TOTP challenge issued — awaiting 6-digit code", user.id
        )
        return LoginResponse(
            requires_totp=True,
            totp_session_token=create_totp_session_token(user.id),
        )

    # TOTP not yet set up → issue JWT but flag that setup is required
    record_login(user.id, db)
    log_login_attempt(
        db,
        ip_address=ip_addr,
        user_identifier=body.identifier,
        success=True,
        failure_reason="totp_setup_required",
        user_agent=ua,
    )
    logger.info(
        "👨‍🏫 STAFF LOGIN success │ user_id=%d │ JWT issued │ totp_setup_required=True", user.id
    )
    return LoginResponse(
        access_token=_issue_token(response, user, x_device_id, x_client_type),
        refresh_token=_issue_refresh(response, user, x_device_id, x_client_type, db),
        role=user.role.value,
        name=user.name,
        totp_setup_required=True,
    )


# ═══════════════════════════════════════════════════════════════════════
# POST /api/auth/verify-totp
# ═══════════════════════════════════════════════════════════════════════


@router.post("/verify-totp", response_model=LoginResponse)
def verify_totp_endpoint(
    body: VerifyTOTPRequest,
    response: Response,
    x_device_id: str = Header(default=""),
    x_client_type: str = Header(default="web"),
    db: Session = Depends(get_db),
):
    payload = decode_totp_session_token(body.totp_session_token)
    user_id: int = payload["user_id"]

    logger.info("🔑 TOTP verify attempt │ user_id=%d", user_id)

    user: User | None = (
        db.query(User).filter(User.id == user_id, User.is_active == True).first()  # noqa: E712
    )
    if not user:
        # NEVER differentiate "user not found" from "wrong TOTP" — that
        # leaks account existence to anyone holding a valid session token.
        logger.warning(
            "🔑 TOTP verify failed │ user_id=%d │ reason=user not found (returning generic error)",
            user_id,
        )
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid TOTP code.")

    now = datetime.now(tz=UTC)

    # Check if already locked
    if user.totp_locked_until and user.totp_locked_until > now:
        remaining = int((user.totp_locked_until - now).total_seconds() / 60) + 1
        logger.warning(
            "🔑 TOTP verify blocked │ user_id=%d │ locked for %d more min(s)", user_id, remaining
        )
        raise HTTPException(
            status.HTTP_423_LOCKED,
            f"Account locked for {remaining} more minute(s). Try again later.",
        )

    # Verify the TOTP code
    if not verify_totp_code(decrypt_totp_secret(user.totp_secret), body.totp_code):
        user.totp_fail_count = (user.totp_fail_count or 0) + 1
        logger.warning(
            "🔑 TOTP verify failed │ user_id=%d │ fail_count=%d/%d",
            user_id,
            user.totp_fail_count,
            _TOTP_MAX_FAIL,
        )
        if user.totp_fail_count >= _TOTP_MAX_FAIL:
            user.totp_locked_until = now + timedelta(minutes=_TOTP_LOCK_MINUTES)
            db.commit()
            logger.warning(
                "🔑 TOTP ACCOUNT LOCKED │ user_id=%d │ locked for %d min",
                user_id,
                _TOTP_LOCK_MINUTES,
            )
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
    user.totp_fail_count = 0
    user.totp_locked_until = None
    db.commit()

    record_login(user.id, db)
    logger.info(
        "🔑 TOTP verify success │ user_id=%d │ role=%s │ JWT issued ✓", user.id, user.role.value
    )
    return LoginResponse(
        access_token=_issue_token(response, user, x_device_id, x_client_type),
        refresh_token=_issue_refresh(response, user, x_device_id, x_client_type, db),
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
    uri = get_totp_uri(secret, current_user["email"])
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
    body: TOTPConfirmRequest,
    current_user: dict = Depends(staff_only),
    db: Session = Depends(get_db),
):
    if not verify_totp_code(body.secret, body.totp_code):
        logger.warning("🔧 TOTP confirm failed │ user_id=%d │ invalid code", current_user["id"])
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Invalid TOTP code. Please rescan the QR code and try again.",
        )

    db.query(User).filter(User.id == current_user["id"]).update(
        {"totp_secret": encrypt_totp_secret(body.secret), "totp_enabled": True},
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
    current_user: dict = Depends(any_authenticated),
    db: Session = Depends(get_db),
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
    body: ConfirmPasswordChangeRequest,
    current_user: dict = Depends(any_authenticated),
    db: Session = Depends(get_db),
):
    if not verify_dual_otp(current_user["id"], body.otp_sms, body.otp_email, "password_change", db):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid or expired OTP")

    now = datetime.now(tz=UTC)
    db.query(User).filter(User.id == current_user["id"]).update(
        {
            "password_hash": hash_password(body.new_password),
            "password_changed_at": now,  # invalidates all existing JWTs
        },
        synchronize_session=False,
    )
    db.commit()
    revoke_all_refresh_tokens(current_user["id"], db)
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
        logger.warning(
            "🔑 RESET PASSWORD failed │ identifier='%s' │ user not found/inactive", body.identifier
        )
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid OTP or identifier")

    if not verify_dual_otp(user.id, body.otp_sms, body.otp_email, "forgot_password", db):
        logger.warning("🔑 RESET PASSWORD failed │ user_id=%d │ invalid/expired OTP", user.id)
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid or expired OTP")

    now = datetime.now(tz=UTC)
    db.query(User).filter(User.id == user.id).update(
        {
            "password_hash": hash_password(body.new_password),
            "password_changed_at": now,
        },
        synchronize_session=False,
    )
    db.commit()
    revoke_all_refresh_tokens(user.id, db)
    logger.info("🔑 RESET PASSWORD success │ user_id=%d │ password changed ✓", user.id)
    return MessageResponse(
        message="Password reset successfully. Please login with your new password."
    )


# ═══════════════════════════════════════════════════════════════════════
# POST /api/auth/enable-face  (staff only)
# ═══════════════════════════════════════════════════════════════════════


@router.post("/enable-face", response_model=EnableFaceResponse)
def enable_face(
    current_user: dict = Depends(staff_only),
    db: Session = Depends(get_db),
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
    current_user: dict = Depends(staff_only),
    db: Session = Depends(get_db),
):
    # DB fields cleared here. Azure person cleanup is in face_utils.py (future prompt).
    db.query(User).filter(User.id == current_user["id"]).update(
        {
            "face_auth_enabled": False,
            "face_enrolled": False,
            "face_enrolled_at": None,
            "azure_person_id": None,
        },
        synchronize_session=False,
    )
    db.commit()
    return MessageResponse(message="Face authentication disabled and enrollment data cleared.")


# ═══════════════════════════════════════════════════════════════════════
# POST /api/auth/logout
# ═══════════════════════════════════════════════════════════════════════


@router.post("/logout", response_model=MessageResponse)
def logout(
    request: Request,
    response: Response,
    body: RefreshTokenRequest | None = None,
    current_user: dict = Depends(any_authenticated),
    db: Session = Depends(get_db),
):
    """
    Clears the web auth cookie and revokes the refresh token. For mobile
    (Bearer token) clients, the app must drop the access token from
    secure storage and pass its refresh_token in the body to revoke it.
    """
    raw_refresh = (
        body.refresh_token if body and body.refresh_token else None
    ) or request.cookies.get(REFRESH_COOKIE_NAME)
    if raw_refresh:
        revoke_refresh_token(raw_refresh, db)
    clear_auth_cookie(response)
    clear_refresh_cookie(response)
    return MessageResponse(message="Logged out successfully.")


# ═══════════════════════════════════════════════════════════════════════
# POST /api/auth/refresh  (rotation — web reads cookie, mobile reads body)
# ═══════════════════════════════════════════════════════════════════════


@router.post("/refresh", response_model=RefreshTokenResponse)
@limiter.limit("60/minute")
def refresh_token_endpoint(
    request: Request,
    response: Response,
    body: RefreshTokenRequest | None = None,
    x_device_id: str = Header(default=""),
    x_client_type: str = Header(default="web"),
    db: Session = Depends(get_db),
):
    raw = (body.refresh_token if body and body.refresh_token else None) or request.cookies.get(
        REFRESH_COOKIE_NAME
    )
    user, new_raw = rotate_refresh_token(raw, db)

    new_access = _build_jwt(user, x_device_id)
    is_mobile = (x_client_type or "").lower() == "mobile"
    if not is_mobile:
        set_auth_cookie(response, new_access)
        set_refresh_cookie(response, new_raw)

    return RefreshTokenResponse(
        access_token=new_access,
        refresh_token=new_raw if is_mobile else None,
    )


# ═══════════════════════════════════════════════════════════════════════
# GET /api/auth/me
# ═══════════════════════════════════════════════════════════════════════


@router.get("/me", response_model=ProfileResponse)
def me(
    current_user: dict = Depends(any_authenticated),
    db: Session = Depends(get_db),
):
    from database import Course  # local import to avoid circular reference

    user: User | None = db.query(User).filter(User.id == current_user["id"]).first()
    if not user:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")

    logger.info(
        "👤 PROFILE accessed │ user_id=%d │ role=%s │ name='%s'",
        user.id,
        user.role.value,
        user.name,
    )

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
