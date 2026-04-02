"""
AutoAttend AI v2.0 — Authentication Utilities

Rules enforced here:
  • Students     → password only; TOTP NOT used; face is mandatory for QR attendance
  • Staff        → password + TOTP (mandatory); face optional
  • MSG91 OTP    → only for password/device change; NOT for login
  • TOTP         → only for teacher / hod / principal
"""

import secrets
from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pyotp
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError
from fastapi import Depends, Header, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import ExpiredSignatureError, JWTError, jwt
from sqlalchemy.orm import Session

from config import settings
from database import DeviceRegistry, FaceVerifyToken, User, UserRole, get_db

# ═══════════════════════════════════════════════════════════════════════
# Argon2id Password Hasher (settings-driven)
# ═══════════════════════════════════════════════════════════════════════

_ph = PasswordHasher(
    time_cost=settings.ARGON2_TIME_COST,
    memory_cost=settings.ARGON2_MEMORY_COST,
    parallelism=settings.ARGON2_PARALLELISM,
    hash_len=32,
    salt_len=16,
)


def hash_password(plain: str) -> str:
    """Return an Argon2id hash of the plain-text password."""
    return _ph.hash(plain)


def verify_password(plain: str, hashed: str) -> bool:
    """Verify plain password against stored Argon2id hash. Never raises."""
    try:
        _ph.verify(hashed, plain)
        return True
    except VerifyMismatchError:
        return False
    except Exception:
        return False


def needs_rehash(hashed: str) -> bool:
    """Return True if the stored hash was created with weaker parameters."""
    return _ph.check_needs_rehash(hashed)


# ═══════════════════════════════════════════════════════════════════════
# JWT Tokens
# ═══════════════════════════════════════════════════════════════════════

_bearer_scheme = HTTPBearer(auto_error=False)


def create_access_token(data: dict) -> str:
    """
    Create a signed JWT.

    Required keys in *data*:
      sub           – user email (or roll_number for students)
      id            – user.id (int)
      role          – UserRole string
      college_id    – int
      department_id – int | None
      face_enrolled – bool
      device_id     – hardware fingerprint string
    """
    payload = data.copy()

    now = datetime.now(tz=timezone.utc)
    payload.update({
        "jti": str(uuid4()),
        "iat": now,
        "exp": now + timedelta(hours=settings.ACCESS_TOKEN_EXPIRE_HOURS),
    })

    return jwt.encode(payload, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


def decode_access_token(token: str) -> dict:
    """
    Decode and validate a JWT.
    Raises HTTP 401 on any failure.
    """
    credentials_error = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        if payload.get("sub") is None:
            raise credentials_error
        # Reject TOTP session tokens used as regular access tokens
        if payload.get("purpose") == "totp_session":
            raise credentials_error
        return payload
    except ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token has expired",
            headers={"WWW-Authenticate": "Bearer"},
        )
    except JWTError:
        raise credentials_error


# ═══════════════════════════════════════════════════════════════════════
# TOTP  (teacher / hod / principal ONLY)
# ═══════════════════════════════════════════════════════════════════════

def generate_totp_secret() -> str:
    """Generate a new base-32 TOTP secret."""
    return pyotp.random_base32()


def get_totp_uri(secret: str, email: str) -> str:
    """
    Build a provisioning URI for QR code display in authenticator apps
    (Google Authenticator, Authy, etc.).
    """
    return pyotp.TOTP(secret).provisioning_uri(
        name=email,
        issuer_name=settings.TOTP_ISSUER,
    )


def verify_totp_code(secret: str, code: str) -> bool:
    """
    Verify a TOTP code.
    valid_window=1 accepts current, previous, and next 30-second window
    to handle minor clock drift between server and authenticator app.
    """
    totp = pyotp.TOTP(secret)
    return totp.verify(code, valid_window=1)


# ═══════════════════════════════════════════════════════════════════════
# Face Verify Token  (issued after face check, consumed on QR scan)
# ═══════════════════════════════════════════════════════════════════════

def create_face_verify_token(
    user_id: int,
    session_id: int,
    db: Session,
) -> str:
    """
    Issue a short-lived (60 s) face-verify token after Azure confirms
    the student's face. The token is single-use and tied to the session.
    """
    token = secrets.token_hex(32)
    expires_at = datetime.now(tz=timezone.utc) + timedelta(
        seconds=settings.FACE_VERIFY_TOKEN_EXPIRY_SECONDS
    )

    record = FaceVerifyToken(
        user_id=user_id,
        session_id=session_id,
        token=token,
        expires_at=expires_at,
        used=False,
    )
    db.add(record)
    db.commit()
    return token


def validate_face_verify_token(
    token: str,
    user_id: int,
    session_id: int,
    db: Session,
) -> bool:
    """
    Validate and atomically consume a face-verify token.
    Returns True only if the token is valid, unexpired, unused,
    and belongs to the correct user and session.
    """
    now = datetime.now(tz=timezone.utc)

    record = (
        db.query(FaceVerifyToken)
        .filter(
            FaceVerifyToken.token == token,
            FaceVerifyToken.user_id == user_id,
            FaceVerifyToken.session_id == session_id,
            FaceVerifyToken.used == False,  # noqa: E712
            FaceVerifyToken.expires_at > now,
        )
        .with_for_update()   # atomic lock prevents double-use
        .first()
    )

    if record is None:
        return False

    record.used = True
    db.commit()
    return True


# ═══════════════════════════════════════════════════════════════════════
# FastAPI dependency — current user
# ═══════════════════════════════════════════════════════════════════════

def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(_bearer_scheme),
    x_device_id: str = Header(default=""),
    db: Session = Depends(get_db),
) -> dict:
    """
    FastAPI dependency. Validates JWT, fetches the user row, and verifies
    that the request comes from the registered device.

    Returns a plain dict (not the ORM object) so it is JSON-serialisable
    and safe to pass through the entire request chain.
    """
    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )

    payload = decode_access_token(credentials.credentials)

    user: User | None = db.query(User).filter(User.id == payload.get("id")).first()

    if user is None or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found or inactive",
        )
    # ── Password-change token invalidation ───────────────────────────────
    iat = payload.get("iat")
    if user.password_changed_at and iat is not None:
        token_issued_at = (
            datetime.fromtimestamp(iat, tz=timezone.utc)
            if isinstance(iat, (int, float))
            else iat
        )
        if user.password_changed_at > token_issued_at:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Session invalidated due to password change. Please login again.",
                headers={"WWW-Authenticate": "Bearer"},
            )
    # ── Device binding check ──────────────────────────────────────────
    # Students must always send X-Device-Id header; staff may skip if
    # they haven't enrolled a device yet (e.g. web dashboard).
    if user.role == UserRole.student:
        device: DeviceRegistry | None = (
            db.query(DeviceRegistry)
            .filter(
                DeviceRegistry.user_id == user.id,
                DeviceRegistry.is_active == True,  # noqa: E712
            )
            .first()
        )
        if device and device.device_id != x_device_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Device mismatch — attendance must be marked from your registered device",
            )

    return {
        "id":               user.id,
        "name":             user.name,
        "email":            user.email,
        "role":             user.role.value,
        "college_id":       user.college_id,
        "department_id":    user.department_id,
        "face_enrolled":    user.face_enrolled,
        "totp_enabled":     user.totp_enabled,
        "face_auth_enabled": user.face_auth_enabled,
        "device_id":        x_device_id,
    }


# ═══════════════════════════════════════════════════════════════════════
# Role-Based FastAPI Dependencies
# ═══════════════════════════════════════════════════════════════════════

def _require_role(allowed: set[str]):
    """Factory: returns a FastAPI dependency that restricts by role."""
    def _dep(current_user: dict = Depends(get_current_user)) -> dict:
        if current_user["role"] not in allowed:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Access restricted. Required role(s): {', '.join(sorted(allowed))}",
            )
        return current_user
    return _dep


# Individual role dependencies — import and use directly in routers
principal_only     = _require_role({"principal"})
hod_or_above       = _require_role({"principal", "hod"})
teacher_or_above   = _require_role({"principal", "hod", "teacher"})
staff_only         = _require_role({"principal", "hod", "teacher"})
any_authenticated  = _require_role({"principal", "hod", "teacher", "student"})
student_only       = _require_role({"student"})


# ═══════════════════════════════════════════════════════════════════════
# First Login Check
# ═══════════════════════════════════════════════════════════════════════

def is_first_login(user_id: int, db: Session) -> bool:
    """
    Return True if the user has never logged in before (last_login is NULL).
    Used to redirect students to mandatory face registration on first login.
    """
    user: User | None = db.query(User).filter(User.id == user_id).first()
    if user is None:
        return False
    return user.last_login is None


def record_login(user_id: int, db: Session) -> None:
    """Stamp last_login = now (UTC) after a successful authentication."""
    db.query(User).filter(User.id == user_id).update(
        {"last_login": datetime.now(tz=timezone.utc)},
        synchronize_session=False,
    )
    db.commit()


# ═══════════════════════════════════════════════════════════════════════
# TOTP Session Token
# Short-lived token issued after password-OK, before the TOTP step.
# NOT a full access token — carries purpose="totp_session".
# ═══════════════════════════════════════════════════════════════════════

def create_totp_session_token(user_id: int) -> str:
    """
    Issue a 5-minute signed token after password verification.
    Rejected by decode_access_token / get_current_user so it cannot
    be used as a real access token.
    """
    now = datetime.now(tz=timezone.utc)
    payload = {
        "purpose": "totp_session",
        "user_id": user_id,
        "jti":     str(uuid4()),
        "iat":     now,
        "exp":     now + timedelta(minutes=5),
    }
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


def decode_totp_session_token(token: str) -> dict:
    """Decode and validate a TOTP session token. Raises HTTP 401 on any failure."""
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        if payload.get("purpose") != "totp_session":
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid session token type",
            )
        return payload
    except ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="TOTP session expired. Please login again.",
        )
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid session token",
        )

