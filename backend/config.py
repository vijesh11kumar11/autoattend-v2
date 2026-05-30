from pydantic_settings import BaseSettings
from pydantic import field_validator
from typing import Optional


class Settings(BaseSettings):

    # ── Database (PostgreSQL) ─────────────────────────────────────────
    DATABASE_URL: str
    DATABASE_URL_SYNC: str

    # ── JWT ───────────────────────────────────────────────────────────
    SECRET_KEY: str
    ALGORITHM: str = "HS256"  # default symmetric; set RS256/ES256/EdDSA + key paths to enable asymmetric
    # Asymmetric JWT (opt-in). When set + ALGORITHM is RS256/ES256/EdDSA,
    # encode uses the private PEM and decode uses the public PEM.
    JWT_PRIVATE_KEY_PATH: str = ""
    JWT_PUBLIC_KEY_PATH: str = ""
    # Access token is now short-lived; refresh tokens rotate it.
    # Roll out the frontend refresh handler BEFORE lowering this value.
    ACCESS_TOKEN_EXPIRE_HOURS: int = 1
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7

    # ── Argon2 password hashing ───────────────────────────────────────
    ARGON2_TIME_COST: int = 3
    ARGON2_MEMORY_COST: int = 65536
    ARGON2_PARALLELISM: int = 2

    # ── TOTP (for teacher/hod/principal only) ─────────────────────────
    TOTP_ISSUER: str = "AutoAttend AI"

    # ── Azure Face API ────────────────────────────────────────────────
    AZURE_FACE_ENDPOINT: str
    AZURE_FACE_KEY: str
    AZURE_PERSON_GROUP_ID: str = "autoattend_college"

    # ── MSG91 (OTP + email only) ────────────────────────────────────
    MSG91_AUTH_KEY: str
    MSG91_SENDER_ID: str = "ATTEND"
    MSG91_OTP_TEMPLATE_ID: str
    MSG91_EMAIL_TEMPLATE_ID: str = "autoattend_email_otp"
    MSG91_EMAIL_FROM: str
    MSG91_EMAIL_DOMAIN: str = ""

    # ── Fast2SMS (Quick route SMS for notifications) ─────────────
    # REQUIRED in production. Empty string keeps SMS disabled but startup
    # validator + send_sms log an ERROR every time SMS is attempted so the
    # outage is visible (was previously silently swallowed).
    FAST2SMS_API_KEY: str = ""
    # ── News Feed ─────────────────────────────────────────────────────
    NEWS_API_KEY: str = ""
    FEED_CACHE_MINUTES: int = 60
    # ── AI — Career Roadmap ───────────────────────────────────────────
    GEMINI_API_KEY: str = ""
    GROQ_API_KEY: str = ""
    DEEPSEEK_API_KEY: str = ""
    DEEPSEEK_BASE_URL: str = "https://api.deepseek.com/v1"
    # ── Twilio WhatsApp (for parent alerts) ───────────────────────────
    TWILIO_ACCOUNT_SID: str
    TWILIO_AUTH_TOKEN: str
    TWILIO_WHATSAPP_FROM: str = "whatsapp:+14155238886"

    # ── App settings ──────────────────────────────────────────────────
    APP_NAME: str = "AutoAttend AI"
    DEBUG: bool = False
    FRONTEND_URL: str = "http://localhost:3000"
    COLLEGE_NAME: str = "Your College Name"
    # ── Production hardening ──────────────────────────────
    # Expose /api/docs, /api/redoc, /api/openapi.json. Independent of
    # DEBUG so an operator can disable them in dev too. Defaults to the
    # value of DEBUG via the validator below if not explicitly set.
    EXPOSE_DOCS: bool = False
    # Enforce HTTPS redirect for plain-http requests (only meaningful when
    # the app is the TLS terminator; behind a load balancer the proxy
    # usually handles this and X-Forwarded-Proto should be trusted).
    FORCE_HTTPS: bool = False
    # Hard cap on any single request body (bytes). 10 MiB by default —
    # uploads/face frames go to dedicated endpoints with larger caps.
    MAX_REQUEST_BODY_BYTES: int = 10 * 1024 * 1024
    # Per-request hard timeout (seconds). Long-running handlers exceeding
    # this are aborted with 504 to stop them holding DB connections.
    REQUEST_TIMEOUT_SECONDS: int = 60
    # Auto-run Base.metadata.create_all() at startup. NEVER True in
    # production — always use Alembic migrations.
    AUTO_CREATE_TABLES: bool = False
    # ── Auth cookie (web only — mobile keeps Bearer token) ─────────────
    # In production: COOKIE_SECURE=True, COOKIE_SAMESITE=strict.
    # For cross-site (vercel frontend + render backend): COOKIE_SAMESITE=none + COOKIE_SECURE=True.
    # For local dev over plain http: COOKIE_SECURE=False, COOKIE_SAMESITE=lax.
    COOKIE_SECURE:   bool = True
    COOKIE_SAMESITE: str  = "strict"

    # ── TOTP secret encryption (Fernet symmetric key) ──────────────────
    # Generate with: python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
    # Leave blank to disable encryption (legacy plaintext storage).
    TOTP_ENCRYPTION_KEY: str = ""

    # ── Session secrets at-rest encryption (qr_secret, bluetooth_token) ─
    # Same Fernet format. May reuse TOTP_ENCRYPTION_KEY value or a separate key.
    SESSION_SECRET_ENCRYPTION_KEY: str = ""

    # ── DB connection pool (tunable per deployment scale) ────────────
    # Defaults match the previous hardcoded values in database.py.
    DB_POOL_SIZE: int = 10
    DB_MAX_OVERFLOW: int = 20
    DB_POOL_RECYCLE_SECONDS: int = 1800   # recycle stale conns hourly-ish
    DB_POOL_TIMEOUT_SECONDS: int = 30     # wait for free conn before failing

    # ── Logging ──────────────────────────────────────────────────────
    # 'text' (default human-readable pipe-separated lines) or 'json'
    # (one JSON object per log record — ready for Datadog/ELK/CloudWatch).
    LOG_FORMAT_MODE: str = "text"

    # ── Attendance rules ──────────────────────────────────────────────
    ATTENDANCE_THRESHOLD: float = 75.0

    # ── QR settings ───────────────────────────────────────────────────
    QR_EXPIRY_SECONDS: int = 5

    # ── Face verify token (how long after face verify student can scan QR)
    FACE_VERIFY_TOKEN_EXPIRY_SECONDS: int = 60

    # ── GPS settings ──────────────────────────────────────────────────
    GPS_RADIUS_METERS: float = 50.0
    GPS_ACCURACY_THRESHOLD_METERS: float = 50.0

    # ── Bluetooth ─────────────────────────────────────────────────────
    BLUETOOTH_REQUIRED: bool = False

    # ── Leave policy ──────────────────────────────────────────────────
    LEAVE_MAX_DAYS_PER_REQUEST: int = 14
    LEAVE_ALLOW_PAST_DATE_DAYS: int = 2
    LEAVE_DOCUMENT_REQUIRED_TYPES: str = "medical,sports"

    # ── ClassPulse Live ───────────────────────────────────────────────
    LIVE_SESSION_HEARTBEAT_INTERVAL: int = 30
    LIVE_SESSION_MIN_ATTENDANCE_MINUTES: int = 30
    LIVE_SESSION_LIVENESS_CHECK_INTERVAL: int = 600

    # ── Agora RTC (WebRTC provider for live sessions) ─────────────────
    AGORA_APP_ID: str = ""
    AGORA_APP_CERTIFICATE: str = ""
    AGORA_TOKEN_EXPIRY_SECONDS: int = 3600

    # ── Sentry (error + performance tracking) ─────────────────────────
    # Leave SENTRY_DSN empty to disable Sentry entirely (dev-friendly).
    SENTRY_DSN: str = ""
    APP_ENV: str = "production"
    APP_VERSION: str = "2.0.0"

    # ── OpenTelemetry (DISABLED — placeholder for future enablement) ──
    # TODO: Enable OpenTelemetry when needed
    # To re-enable: uncomment OTel init block in main.py, set this var
    # in your .env, and install opentelemetry-sdk opentelemetry-exporter-otlp
    OTEL_EXPORTER_OTLP_ENDPOINT: str = ""

    # ── Web Push (VAPID keys) ─────────────────────────────────────────
    # Web Push VAPID keys — generate with: npx web-push generate-vapid-keys
    # Leave blank to disable web push (notifications simply won't send).
    VAPID_PRIVATE_KEY: str = ""
    VAPID_PUBLIC_KEY: str = ""
    VAPID_SUBJECT: str = "mailto:admin@traceln.app"

    class Config:
        env_file = ".env"
        case_sensitive = True
        extra = "ignore"

    # ── Numeric range validation (#98) ─────────────────────────────
    # Surface bad operator config at startup instead of at first request.
    @field_validator("ATTENDANCE_THRESHOLD")
    @classmethod
    def _check_attendance_threshold(cls, v: float) -> float:
        if not (0.0 <= v <= 100.0):
            raise ValueError("ATTENDANCE_THRESHOLD must be between 0 and 100")
        return v

    @field_validator(
        "QR_EXPIRY_SECONDS",
        "FACE_VERIFY_TOKEN_EXPIRY_SECONDS",
        "ACCESS_TOKEN_EXPIRE_HOURS",
        "REFRESH_TOKEN_EXPIRE_DAYS",
        "LEAVE_MAX_DAYS_PER_REQUEST",
        "LEAVE_ALLOW_PAST_DATE_DAYS",
        "LIVE_SESSION_HEARTBEAT_INTERVAL",
        "LIVE_SESSION_MIN_ATTENDANCE_MINUTES",
        "LIVE_SESSION_LIVENESS_CHECK_INTERVAL",
        "AGORA_TOKEN_EXPIRY_SECONDS",
        "FEED_CACHE_MINUTES",
        "REQUEST_TIMEOUT_SECONDS",
        "MAX_REQUEST_BODY_BYTES",
        "DB_POOL_SIZE",
        "DB_MAX_OVERFLOW",
        "DB_POOL_RECYCLE_SECONDS",
        "DB_POOL_TIMEOUT_SECONDS",
        "ARGON2_TIME_COST",
        "ARGON2_MEMORY_COST",
        "ARGON2_PARALLELISM",
    )
    @classmethod
    def _check_positive_int(cls, v: int, info) -> int:
        if v < 1:
            raise ValueError(f"{info.field_name} must be >= 1 (got {v})")
        return v

    @field_validator("GPS_RADIUS_METERS", "GPS_ACCURACY_THRESHOLD_METERS")
    @classmethod
    def _check_positive_float(cls, v: float, info) -> float:
        if v <= 0:
            raise ValueError(f"{info.field_name} must be > 0 (got {v})")
        return v

    @field_validator("LOG_FORMAT_MODE")
    @classmethod
    def _check_log_format(cls, v: str) -> str:
        v = (v or "text").lower()
        if v not in ("text", "json"):
            raise ValueError("LOG_FORMAT_MODE must be 'text' or 'json'")
        return v

    @field_validator("COOKIE_SAMESITE")
    @classmethod
    def _check_samesite(cls, v: str) -> str:
        v = (v or "strict").lower()
        if v not in ("strict", "lax", "none"):
            raise ValueError("COOKIE_SAMESITE must be one of: strict, lax, none")
        return v


settings = Settings()
