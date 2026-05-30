from pydantic_settings import BaseSettings
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
    FAST2SMS_API_KEY: str = "will_add_later"
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

    # ── Multi-tenancy ─────────────────────────────────────────────────
    # Set True only after ops has backfilled college_id on all legacy rows.
    # Safe to deploy with False — isolation logic is plumbed but dormant.
    ENFORCE_TENANT_ISOLATION: bool = False

    # ── App settings ──────────────────────────────────────────────────
    APP_NAME: str = "AutoAttend AI"
    DEBUG: bool = False
    FRONTEND_URL: str = "http://localhost:3000"
    COLLEGE_NAME: str = "Your College Name"

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

    class Config:
        env_file = ".env"
        case_sensitive = True
        extra = "ignore"


settings = Settings()
