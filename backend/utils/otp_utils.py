"""
AutoAttend AI v2.0 — OTP Utilities

MSG91 is used ONLY for:
  • Password change (authenticated user)
  • Forgot password (unauthenticated)
  • Device change request

Dual-channel: same OTP sent to both SMS and Email.
BOTH channels must be independently verified (verify_dual_otp).
OTP is stored as Argon2id hash — never plain text.
"""

import logging
import secrets
from datetime import UTC, datetime, timedelta

import requests
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError
from sqlalchemy.orm import Session

from config import settings
from database import OTPChannel, OTPLog, OTPPurpose, User

logger = logging.getLogger(__name__)

_ph = PasswordHasher()

# Maps caller's purpose string → DB OTPPurpose enum value.
# password_change and forgot_password both use password_reset at DB level;
# they are differentiated at the application layer via email subject/message.
_PURPOSE_DB_MAP: dict[str, OTPPurpose] = {
    "password_change": OTPPurpose.password_reset,
    "forgot_password": OTPPurpose.password_reset,
    "device_change": OTPPurpose.device_change,
}


# ═══════════════════════════════════════════════════════════════════════
# Phone normalisation (internal)
# ═══════════════════════════════════════════════════════════════════════


def _normalize_mobile(phone: str) -> str:
    """Normalize to MSG91 format: 91XXXXXXXXXX (no + prefix)."""
    cleaned = phone.strip().replace(" ", "").replace("-", "").lstrip("+")
    if cleaned.startswith("91") and len(cleaned) == 12:
        return cleaned
    if cleaned.startswith("0") and len(cleaned) == 11:
        return "91" + cleaned[1:]
    if len(cleaned) == 10:
        return "91" + cleaned
    return cleaned


# ═══════════════════════════════════════════════════════════════════════
# 1. OTP Generation
# ═══════════════════════════════════════════════════════════════════════


def generate_otp() -> str:
    """
    Cryptographically secure 6-digit OTP.
    Uses secrets.randbelow → always returns zero-padded string e.g. '048392'.
    """
    otp = secrets.randbelow(1_000_000)
    return str(otp).zfill(6)


# ═══════════════════════════════════════════════════════════════════════
# 2. SMS Sender
# ═══════════════════════════════════════════════════════════════════════


def send_sms_otp(phone: str, otp: str) -> bool:
    """
    Send OTP via MSG91 SMS OTP API.
    Returns True on success, False on any failure (never raises).
    Never logs the actual OTP value.
    """
    url = "https://control.msg91.com/api/v5/otp"
    headers = {
        "authkey": settings.MSG91_AUTH_KEY,
        "Content-Type": "application/json",
    }
    payload = {
        "template_id": settings.MSG91_OTP_TEMPLATE_ID,
        "mobile": f"91{phone}",
        "otp": otp,
    }
    try:
        resp = requests.post(url, json=payload, headers=headers, timeout=10)
        success = resp.status_code == 200
        if not success:
            logger.warning("SMS OTP failed for phone ending %s: %s", phone[-4:], resp.text)
        return success
    except Exception as exc:
        logger.error("SMS OTP exception for phone ending %s: %s", phone[-4:], exc)
        return False


# ═══════════════════════════════════════════════════════════════════════
# 3. Email Sender
# ═══════════════════════════════════════════════════════════════════════

_SUBJECT_MAP: dict[str, str] = {
    "password_change": "Password Change OTP - AutoAttend AI",
    "forgot_password": "Password Reset OTP - AutoAttend AI",
    "device_change": "Device Change OTP - AutoAttend AI",
}


def send_email_otp(email: str, otp: str, name: str, purpose: str) -> bool:
    """
    Send OTP via MSG91 Email API with a custom HTML body.
    Returns True on success, False on any failure (never raises).
    Never logs the actual OTP value.
    """
    url = "https://control.msg91.com/api/v5/email/send"
    headers = {
        "authkey": settings.MSG91_AUTH_KEY,
        "Content-Type": "application/json",
    }
    payload = {
        "to": [{"name": name, "email": email}],
        "from": {
            "name": "AutoAttend AI",
            "email": settings.MSG91_EMAIL_FROM,
        },
        "subject": _SUBJECT_MAP.get(purpose, "AutoAttend AI OTP"),
        "body": build_otp_email_html(otp, name, purpose),
    }
    try:
        resp = requests.post(url, json=payload, headers=headers, timeout=10)
        success = resp.status_code in (200, 202)
        if not success:
            logger.warning("Email OTP failed for %s: %s", mask_email(email), resp.text)
        return success
    except Exception as exc:
        logger.error("Email OTP exception for %s: %s", mask_email(email), exc)
        return False


# ═══════════════════════════════════════════════════════════════════════
# 4. HTML Email Builder
# ═══════════════════════════════════════════════════════════════════════

_PURPOSE_MSG: dict[str, str] = {
    "password_change": "You requested to change your AutoAttend password.",
    "forgot_password": "You requested a password reset.",
    "device_change": "You requested to change your registered device.",
}


def build_otp_email_html(otp: str, name: str, purpose: str) -> str:
    """Return a professional HTML email string with the OTP displayed prominently."""
    purpose_msg = _PURPOSE_MSG.get(purpose, "You requested a verification OTP.")
    digits = "  ".join(otp)  # e.g. "0  4  8  3  9  2"
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AutoAttend AI OTP</title>
</head>
<body style="margin:0;padding:0;background:#f4f6fb;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6fb;padding:32px 0;">
    <tr><td align="center">
      <table width="520" cellpadding="0" cellspacing="0"
             style="background:#ffffff;border-radius:10px;
                    box-shadow:0 2px 8px rgba(0,0,0,.08);overflow:hidden;">
        <!-- Header -->
        <tr>
          <td style="background:#1a237e;padding:28px 40px;">
            <h1 style="margin:0;color:#ffffff;font-size:24px;letter-spacing:1px;">
              AutoAttend AI
            </h1>
          </td>
        </tr>
        <!-- Body -->
        <tr>
          <td style="padding:36px 40px;">
            <p style="margin:0 0 16px;font-size:16px;color:#333;">
              Hello <strong>{name}</strong>,
            </p>
            <p style="margin:0 0 28px;font-size:15px;color:#555;">
              {purpose_msg}
            </p>
            <!-- OTP Box -->
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td align="center"
                    style="border:2px solid #1a237e;border-radius:8px;
                           padding:20px;background:#f0f4ff;">
                  <span style="font-size:36px;font-weight:700;
                               letter-spacing:10px;color:#1a237e;
                               font-family:Courier New,monospace;">
                    {digits}
                  </span>
                </td>
              </tr>
            </table>
            <p style="margin:20px 0 8px;font-size:13px;color:#777;text-align:center;">
              This OTP is valid for <strong>10 minutes only</strong>.
            </p>
            <p style="margin:0 0 24px;font-size:13px;color:#777;text-align:center;">
              <strong>Do NOT share this OTP with anyone.</strong>
            </p>
            <!-- Warning Box -->
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td style="border:1.5px solid #e53935;border-radius:6px;
                           padding:14px 18px;background:#fff5f5;">
                  <p style="margin:0;font-size:13px;color:#c62828;">
                    &#9888;&#65039; If you did not request this, contact your HOD immediately
                    and change your password.
                  </p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td style="background:#f8f9fa;padding:18px 40px;border-top:1px solid #e8eaf6;">
            <p style="margin:0;font-size:12px;color:#9e9e9e;text-align:center;">
              AutoAttend AI &nbsp;|&nbsp; {settings.COLLEGE_NAME}
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>"""


# ═══════════════════════════════════════════════════════════════════════
# 5. send_dual_otp — generate, store (Argon2), send both channels
# ═══════════════════════════════════════════════════════════════════════


def send_dual_otp(user_id: int, purpose: str, db: Session) -> dict:
    """
    Generates one OTP, hashes it with Argon2id, stores two OTPLog rows
    (one SMS, one Email), then dispatches both channels.

    Returns a status dict:
      {sms_sent, email_sent, phone_masked, email_masked, expires_at}
    """
    user: User = db.query(User).filter(User.id == user_id).first()
    otp = generate_otp()
    otp_hash = _ph.hash(otp)
    expires_at = datetime.now(tz=UTC) + timedelta(minutes=10)
    db_purpose = _PURPOSE_DB_MAP.get(purpose, OTPPurpose.password_reset)

    for channel in (OTPChannel.sms, OTPChannel.email):
        db.add(
            OTPLog(
                user_id=user_id,
                otp_hash=otp_hash,
                purpose=db_purpose,
                channel=channel,
                expires_at=expires_at,
                used=False,
            )
        )
    db.commit()

    sms_sent = send_sms_otp(user.phone or "", otp) if user.phone else False
    email_sent = send_email_otp(user.email, otp, user.name, purpose)

    return {
        "sms_sent": sms_sent,
        "email_sent": email_sent,
        "phone_masked": mask_phone(user.phone or ""),
        "email_masked": mask_email(user.email),
        "expires_at": expires_at,
    }


# ═══════════════════════════════════════════════════════════════════════
# 6. verify_dual_otp — independently verify SMS and Email OTPs
# ═══════════════════════════════════════════════════════════════════════


def verify_dual_otp(
    user_id: int,
    otp_entered_sms: str,
    otp_entered_email: str,
    purpose: str,
    db: Session,
) -> bool:
    """
    Verifies SMS and Email OTPs independently against their Argon2id hashes.
    BOTH must pass. On success, marks both records used=True.
    Returns False and logs a warning on any failure — never raises.
    """
    now = datetime.now(tz=UTC)
    db_purpose = _PURPOSE_DB_MAP.get(purpose, OTPPurpose.password_reset)

    sms_record = (
        db.query(OTPLog)
        .filter(
            OTPLog.user_id == user_id,
            OTPLog.purpose == db_purpose,
            OTPLog.channel == OTPChannel.sms,
            OTPLog.used == False,  # noqa: E712
            OTPLog.expires_at > now,
        )
        .order_by(OTPLog.created_at.desc())
        .first()
    )

    email_record = (
        db.query(OTPLog)
        .filter(
            OTPLog.user_id == user_id,
            OTPLog.purpose == db_purpose,
            OTPLog.channel == OTPChannel.email,
            OTPLog.used == False,  # noqa: E712
            OTPLog.expires_at > now,
        )
        .order_by(OTPLog.created_at.desc())
        .first()
    )

    if not sms_record or not email_record:
        logger.warning(
            "verify_dual_otp: no valid OTP records found — user_id=%d purpose=%s",
            user_id,
            purpose,
        )
        return False

    try:
        _ph.verify(sms_record.otp_hash, otp_entered_sms)
        _ph.verify(email_record.otp_hash, otp_entered_email)
    except VerifyMismatchError:
        logger.warning(
            "verify_dual_otp: OTP mismatch — user_id=%d purpose=%s",
            user_id,
            purpose,
        )
        return False
    except Exception as exc:
        logger.error(
            "verify_dual_otp: unexpected error — user_id=%d: %s",
            user_id,
            exc,
        )
        return False

    sms_record.used = True
    sms_record.used_at = now
    email_record.used = True
    email_record.used_at = now
    db.commit()
    return True


# ═══════════════════════════════════════════════════════════════════════
# 7-8. Masking Helpers
# ═══════════════════════════════════════════════════════════════════════


def mask_phone(phone: str) -> str:
    """'9876543210' → '******3210'  (last 4 digits visible)"""
    if not phone or len(phone) <= 4:
        return "****"
    return "*" * (len(phone) - 4) + phone[-4:]


def mask_email(email: str) -> str:
    """'priya@svec.edu.in' → 'p***@svec.edu.in'  (first char + *** + @domain)"""
    if "@" not in email:
        return "****"
    local, domain = email.split("@", 1)
    if len(local) <= 1:
        return email
    return local[0] + "***" + "@" + domain
