from pydantic_settings import BaseSettings
from typing import Optional


class Settings(BaseSettings):

    # ── Database (PostgreSQL) ─────────────────────────────────────────
    DATABASE_URL: str
    DATABASE_URL_SYNC: str

    # ── JWT ───────────────────────────────────────────────────────────
    SECRET_KEY: str
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_HOURS: int = 8

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

    # ── MSG91 (ONLY for password change OTP) ──────────────────────────
    MSG91_AUTH_KEY: str
    MSG91_SENDER_ID: str = "ATTEND"
    MSG91_OTP_TEMPLATE_ID: str
    MSG91_EMAIL_TEMPLATE_ID: str = "autoattend_email_otp"
    MSG91_EMAIL_FROM: str
    MSG91_EMAIL_DOMAIN: str = ""

    # ── Twilio WhatsApp (for parent alerts) ───────────────────────────
    TWILIO_ACCOUNT_SID: str
    TWILIO_AUTH_TOKEN: str
    TWILIO_WHATSAPP_FROM: str = "whatsapp:+14155238886"

    # ── App settings ──────────────────────────────────────────────────
    APP_NAME: str = "AutoAttend AI"
    DEBUG: bool = True
    FRONTEND_URL: str = "http://localhost:3000"
    COLLEGE_NAME: str = "Your College Name"

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

    class Config:
        env_file = ".env"
        case_sensitive = True
        extra = "ignore"


settings = Settings()
