"""
AutoAttend AI v2.0 — Authentication Utilities

Rules enforced here:
  • Students     → password only; TOTP NOT used; face is mandatory for QR attendance
  • Staff        → password + TOTP (mandatory); face optional
  • MSG91 OTP    → only for password/device change; NOT for login
  • TOTP         → only for teacher / hod / principal
"""

import hashlib
import secrets
from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pyotp
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError
from cryptography.fernet import Fernet, InvalidToken
from fastapi import Depends, Header, HTTPException, Request, Response, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import ExpiredSignatureError, JWTError, jwt
from sqlalchemy.orm import Session

from config import settings
from database import DeviceRegistry, FaceVerifyToken, LoginAttemptLog, RefreshToken, User, UserRole, get_db

# ═══════════════════════════════════════════════════════════════════════
# Auth cookie helpers (web only — mobile uses Bearer)
# ═══════════════════════════════════════════════════════════════════════

AUTH_COOKIE_NAME = "aa_token"


# ── JWT key resolution (HS* uses SECRET_KEY; RS*/ES*/EdDSA use PEM files) ──
_JWT_PRIVATE_KEY: str | None = None
_JWT_PUBLIC_KEY: str | None = None


def _load_jwt_keys() -> None:
    """Lazily load asymmetric JWT keys from disk if ALGORITHM is non-symmetric.

    Symmetric (HS*) → returns SECRET_KEY for both encode and decode.
    Asymmetric      → loads PEMs once; raises RuntimeError if paths missing.
    """
    global _JWT_PRIVATE_KEY, _JWT_PUBLIC_KEY
    alg = (settings.ALGORITHM or "HS256").upper()
    if alg.startswith("HS"):
        return  # nothing to load
    if _JWT_PRIVATE_KEY is not None and _JWT_PUBLIC_KEY is not None:
        return
    if not settings.JWT_PRIVATE_KEY_PATH or not settings.JWT_PUBLIC_KEY_PATH:
        raise RuntimeError(
            f"ALGORITHM={alg} requires JWT_PRIVATE_KEY_PATH and JWT_PUBLIC_KEY_PATH."
        )
    with open(settings.JWT_PRIVATE_KEY_PATH, "r", encoding="utf-8") as f:
        _JWT_PRIVATE_KEY = f.read()
    with open(settings.JWT_PUBLIC_KEY_PATH, "r", encoding="utf-8") as f:
        _JWT_PUBLIC_KEY = f.read()


def jwt_signing_key() -> str:
    """Return the key used to SIGN tokens (private PEM or shared secret)."""
    alg = (settings.ALGORITHM or "HS256").upper()
    if alg.startswith("HS"):
        return settings.SECRET_KEY
    _load_jwt_keys()
    return _JWT_PRIVATE_KEY  # type: ignore[return-value]


def jwt_verify_key() -> str:
    """Return the key used to VERIFY tokens (public PEM or shared secret)."""
    alg = (settings.ALGORITHM or "HS256").upper()
    if alg.startswith("HS"):
        return settings.SECRET_KEY
    _load_jwt_keys()
    return _JWT_PUBLIC_KEY  # type: ignore[return-value]


def set_auth_cookie(response: Response, token: str) -> None:
    """Set the httpOnly auth cookie on a FastAPI Response."""
    response.set_cookie(
        key=AUTH_COOKIE_NAME,
        value=token,
        httponly=True,
        secure=settings.COOKIE_SECURE,
        samesite=settings.COOKIE_SAMESITE,
        max_age=settings.ACCESS_TOKEN_EXPIRE_HOURS * 3600,
        path="/",
    )


def clear_auth_cookie(response: Response) -> None:
    """Delete the auth cookie."""
    response.delete_cookie(key=AUTH_COOKIE_NAME, path="/")


# ═══════════════════════════════════════════════════════════════════════
# TOTP secret encryption (Fernet)
# ═══════════════════════════════════════════════════════════════════════

_fernet: Fernet | None = None
if settings.TOTP_ENCRYPTION_KEY:
    try:
        _fernet = Fernet(settings.TOTP_ENCRYPTION_KEY.encode())
    except Exception:
        _fernet = None  # malformed key → fall back to plaintext (logged once at startup)


def encrypt_totp_secret(secret: str) -> str:
    """Encrypt a TOTP secret for storage. Returns plaintext unchanged if no key is configured."""
    if not secret or _fernet is None:
        return secret
    return _fernet.encrypt(secret.encode()).decode()


def decrypt_totp_secret(stored: str) -> str:
    """
    Decrypt a stored TOTP secret. Transparently handles legacy plaintext rows:
    if Fernet decryption fails (InvalidToken) we assume the value is legacy
    plaintext and return it as-is.
    """
    if not stored or _fernet is None:
        return stored
    try:
        return _fernet.decrypt(stored.encode()).decode()
    except InvalidToken:
        return stored  # legacy plaintext — caller may re-encrypt on next write


# ═══════════════════════════════════════════════════════════════════════
# Password brute-force lockout
# ═══════════════════════════════════════════════════════════════════════

LOGIN_MAX_ATTEMPTS    = 5
LOGIN_LOCKOUT_MINUTES = 15


def is_user_locked(user: User) -> tuple[bool, int]:
    """
    Returns (locked, seconds_remaining). seconds_remaining is 0 if not locked.
    """
    if not user or not user.login_locked_until:
        return False, 0
    now = datetime.now(tz=timezone.utc)
    locked_until = user.login_locked_until
    if locked_until.tzinfo is None:
        locked_until = locked_until.replace(tzinfo=timezone.utc)
    if locked_until <= now:
        return False, 0
    return True, int((locked_until - now).total_seconds())


def record_login_failure(user: User, db: Session) -> tuple[bool, int]:
    """
    Increment fail counter on User. Lock for LOGIN_LOCKOUT_MINUTES if threshold hit.
    Returns (now_locked, seconds_until_unlock).
    """
    if not user:
        return False, 0
    user.login_fail_count = (user.login_fail_count or 0) + 1
    if user.login_fail_count >= LOGIN_MAX_ATTEMPTS:
        unlock_at = datetime.now(tz=timezone.utc) + timedelta(minutes=LOGIN_LOCKOUT_MINUTES)
        user.login_locked_until = unlock_at
        user.login_fail_count   = 0
        db.commit()
        return True, LOGIN_LOCKOUT_MINUTES * 60
    db.commit()
    return False, 0


def record_login_success(user: User, db: Session) -> None:
    """Reset fail counter and lock on successful authentication."""
    if not user:
        return
    if user.login_fail_count or user.login_locked_until:
        user.login_fail_count   = 0
        user.login_locked_until = None
        db.commit()


def log_login_attempt(
    db: Session,
    *,
    ip_address: str | None,
    user_identifier: str | None,
    success: bool,
    failure_reason: str | None = None,
    user_agent: str | None = None,
) -> None:
    """Best-effort SIEM log row. Never raises."""
    try:
        db.add(LoginAttemptLog(
            ip_address      = (ip_address or "")[:64] or None,
            user_identifier = (user_identifier or "")[:255] or None,
            success         = bool(success),
            failure_reason  = (failure_reason or "")[:255] or None,
            user_agent      = (user_agent or "")[:500] or None,
        ))
        db.commit()
    except Exception:
        try:
            db.rollback()
        except Exception:
            pass


# ── IP-based brute-force lockout (defends against credential-stuffing) ──
# If more than IP_LOCKOUT_THRESHOLD failed logins from a single IP within
# IP_LOCKOUT_WINDOW_MIN, block further attempts from that IP for the rest
# of the window. Protects against username-enumeration where the attacker
# rotates identifiers — per-user lockout cannot catch this.
IP_LOCKOUT_THRESHOLD: int = 20
IP_LOCKOUT_WINDOW_MIN: int = 15


def is_ip_locked(ip_address: str | None, db: Session) -> tuple[bool, int]:
    """Return (locked, remaining_failures_before_lock_or_seconds_left)."""
    if not ip_address:
        return False, 0
    try:
        window_start = datetime.now(tz=timezone.utc) - timedelta(minutes=IP_LOCKOUT_WINDOW_MIN)
        count = (
            db.query(LoginAttemptLog)
            .filter(
                LoginAttemptLog.ip_address == ip_address,
                LoginAttemptLog.success.is_(False),
                LoginAttemptLog.attempted_at >= window_start,
            )
            .count()
        )
        if count >= IP_LOCKOUT_THRESHOLD:
            return True, IP_LOCKOUT_WINDOW_MIN * 60
        return False, max(0, IP_LOCKOUT_THRESHOLD - count)
    except Exception:
        return False, 0


# ═══════════════════════════════════════════════════════════════════════
# Refresh-token rotation (httpOnly cookie for web, JSON body for mobile)
# ═══════════════════════════════════════════════════════════════════════

REFRESH_COOKIE_NAME = "aa_refresh"


def _hash_refresh(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


def set_refresh_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        key       = REFRESH_COOKIE_NAME,
        value     = token,
        httponly  = True,
        secure    = settings.COOKIE_SECURE,
        samesite  = settings.COOKIE_SAMESITE,
        max_age   = settings.REFRESH_TOKEN_EXPIRE_DAYS * 86400,
        path      = "/api/auth",   # only sent to /api/auth/* endpoints
    )


def clear_refresh_cookie(response: Response) -> None:
    response.delete_cookie(key=REFRESH_COOKIE_NAME, path="/api/auth")


def create_refresh_token(user_id: int, device_id: str | None, db: Session) -> str:
    """
    Issue a new refresh token. Only the SHA-256 hash is persisted.
    Returns the raw token (returned once to the caller).
    """
    raw        = secrets.token_urlsafe(48)
    expires_at = datetime.now(tz=timezone.utc) + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS)
    db.add(RefreshToken(
        user_id    = user_id,
        token_hash = _hash_refresh(raw),
        device_id  = (device_id or "")[:500] or None,
        expires_at = expires_at,
    ))
    db.commit()
    return raw


def rotate_refresh_token(raw_token: str, db: Session) -> tuple[User, str]:
    """
    Consume a refresh token, issue a new one (rotation).
    Returns (user, new_raw_refresh).
    Raises HTTPException(401) on any failure (invalid / expired / revoked / reuse).
    """
    err = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid or expired refresh token",
    )
    if not raw_token:
        raise err
    token_hash = _hash_refresh(raw_token)
    row: RefreshToken | None = (
        db.query(RefreshToken).filter(RefreshToken.token_hash == token_hash).first()
    )
    if row is None:
        raise err

    now = datetime.now(tz=timezone.utc)
    expires_at = row.expires_at
    if expires_at and expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)

    # Detect reuse of an already-rotated token → revoke entire chain (security best practice)
    if row.revoked:
        try:
            db.query(RefreshToken).filter(
                RefreshToken.user_id == row.user_id,
                RefreshToken.revoked == False,  # noqa: E712
            ).update({"revoked": True, "revoked_at": now}, synchronize_session=False)
            db.commit()
        except Exception:
            db.rollback()
        raise err

    if expires_at and expires_at <= now:
        raise err

    user = db.query(User).filter(User.id == row.user_id, User.is_active == True).first()  # noqa: E712
    if user is None:
        raise err

    # Issue new refresh, mark old revoked + replaced_by
    new_raw = secrets.token_urlsafe(48)
    new_hash = _hash_refresh(new_raw)
    new_row = RefreshToken(
        user_id    = row.user_id,
        token_hash = new_hash,
        device_id  = row.device_id,
        expires_at = now + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS),
    )
    db.add(new_row)
    row.revoked          = True
    row.revoked_at       = now
    row.replaced_by_hash = new_hash
    db.commit()
    return user, new_raw


def revoke_refresh_token(raw_token: str, db: Session) -> None:
    """Mark a single refresh token as revoked. Silent on failure."""
    if not raw_token:
        return
    try:
        row = db.query(RefreshToken).filter(
            RefreshToken.token_hash == _hash_refresh(raw_token)
        ).first()
        if row and not row.revoked:
            row.revoked    = True
            row.revoked_at = datetime.now(tz=timezone.utc)
            db.commit()
    except Exception:
        db.rollback()


def revoke_all_refresh_tokens(user_id: int, db: Session) -> int:
    """Revoke every active refresh token for a user. Returns count revoked."""
    try:
        now = datetime.now(tz=timezone.utc)
        n = db.query(RefreshToken).filter(
            RefreshToken.user_id == user_id,
            RefreshToken.revoked == False,  # noqa: E712
        ).update({"revoked": True, "revoked_at": now}, synchronize_session=False)
        db.commit()
        return int(n or 0)
    except Exception:
        db.rollback()
        return 0


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

    return jwt.encode(payload, jwt_signing_key(), algorithm=settings.ALGORITHM)


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
        payload = jwt.decode(token, jwt_verify_key(), algorithms=[settings.ALGORITHM])
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

def _hash_face_token(raw_token: str) -> str:
    """SHA-256 hash a face-verify token for storage / lookup."""
    return hashlib.sha256(raw_token.encode()).hexdigest()


def create_face_verify_token(
    user_id: int,
    session_id: int,
    db: Session,
) -> str:
    """
    Issue a short-lived (60 s) face-verify token after Azure confirms
    the student's face. Only the SHA-256 hash is persisted; the raw
    token is returned once to the caller.
    """
    raw_token  = secrets.token_hex(32)
    expires_at = datetime.now(tz=timezone.utc) + timedelta(
        seconds=settings.FACE_VERIFY_TOKEN_EXPIRY_SECONDS
    )

    record = FaceVerifyToken(
        user_id=user_id,
        session_id=session_id,
        token_hash=_hash_face_token(raw_token),
        expires_at=expires_at,
        used=False,
    )
    db.add(record)
    db.commit()
    return raw_token


def validate_face_verify_token(
    token: str,
    user_id: int,
    session_id: int,
    db: Session,
) -> bool:
    """
    Validate and atomically consume a face-verify token. The incoming
    raw token is hashed before lookup; returns True only if the hash
    matches an unexpired, unused row for the correct user + session.
    """
    now = datetime.now(tz=timezone.utc)
    token_hash = _hash_face_token(token)

    record = (
        db.query(FaceVerifyToken)
        .filter(
            FaceVerifyToken.token_hash == token_hash,
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
    request:     Request,
    credentials: HTTPAuthorizationCredentials = Depends(_bearer_scheme),
    x_device_id: str = Header(default=""),
    db:          Session = Depends(get_db),
) -> dict:
    """
    FastAPI dependency. Validates JWT, fetches the user row, and verifies
    that the request comes from the registered device.

    Token resolution order:
      1. Authorization: Bearer <token>  (mobile + legacy web)
      2. Cookie aa_token                 (web — httpOnly cookie)

    Returns a plain dict (not the ORM object) so it is JSON-serialisable
    and safe to pass through the entire request chain.
    """
    token: str | None = credentials.credentials if credentials else None
    if not token:
        token = request.cookies.get(AUTH_COOKIE_NAME)

    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )

    payload = decode_access_token(token)

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
        "iat":              payload.get("iat"),
    }


# ── Re-auth requirement (sensitive actions) ─────────────────────────────
def require_recent_auth(max_age_minutes: int = 5):
    """FastAPI dependency factory. Requires the access token's iat to be
    within `max_age_minutes`. Used to gate sensitive actions (password
    change, leave approval, dispute resolution, etc.).

    Returns 401 with `{detail: "reauth_required"}` so the frontend can
    prompt for password re-entry and call /api/auth/reauth.
    """
    def _dep(current_user: dict = Depends(get_current_user)) -> dict:
        iat_raw = current_user.get("iat")
        if iat_raw is None:
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "reauth_required")
        iat_dt = (
            datetime.fromtimestamp(float(iat_raw), tz=timezone.utc)
            if isinstance(iat_raw, (int, float))
            else iat_raw
        )
        age = datetime.now(tz=timezone.utc) - iat_dt
        if age > timedelta(minutes=max_age_minutes):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="reauth_required",
            )
        return current_user
    return _dep


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
    return jwt.encode(payload, jwt_signing_key(), algorithm=settings.ALGORITHM)


def decode_totp_session_token(token: str) -> dict:
    """Decode and validate a TOTP session token. Raises HTTP 401 on any failure."""
    try:
        payload = jwt.decode(token, jwt_verify_key(), algorithms=[settings.ALGORITHM])
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

