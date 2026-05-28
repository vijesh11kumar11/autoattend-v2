"""
AutoAttend AI v2.0 — Field-level encryption helpers.

Wraps cryptography.fernet to encrypt sensitive at-rest values such as
attendance_sessions.qr_secret and attendance_sessions.bluetooth_token.

Backwards compatibility:
  If decryption fails (InvalidToken) we assume the value is a legacy
  plaintext row written before encryption was enabled and return it as-is.
  Callers may re-encrypt on next write.

Configuration:
  settings.SESSION_SECRET_ENCRYPTION_KEY  — 44-char base64 Fernet key.
  If empty/unset, encryption is a no-op (returns value unchanged) so
  development environments keep working without a key configured.
"""

from __future__ import annotations

import logging

from cryptography.fernet import Fernet, InvalidToken

from config import settings

logger = logging.getLogger(__name__)

_fernet: Fernet | None = None
if getattr(settings, "SESSION_SECRET_ENCRYPTION_KEY", ""):
    try:
        _fernet = Fernet(settings.SESSION_SECRET_ENCRYPTION_KEY.encode())
        logger.info("🔐 Field encryption ENABLED for session secrets")
    except Exception as e:
        logger.error(
            "SESSION_SECRET_ENCRYPTION_KEY is malformed (%s) — encryption disabled",
            e,
        )
        _fernet = None
else:
    logger.warning(
        "SESSION_SECRET_ENCRYPTION_KEY not set — session secrets will be stored "
        "PLAINTEXT. Set this in production."
    )


def encrypt_field(value: str | None) -> str | None:
    """Encrypt a value with the session Fernet key. No-op if key not configured."""
    if value is None or value == "" or _fernet is None:
        return value
    return _fernet.encrypt(value.encode()).decode()


def decrypt_field(stored: str | None) -> str | None:
    """
    Decrypt a value. Transparently returns legacy plaintext rows unchanged
    when Fernet decryption fails (InvalidToken). Never raises.
    """
    if stored is None or stored == "" or _fernet is None:
        return stored
    try:
        return _fernet.decrypt(stored.encode()).decode()
    except InvalidToken:
        # Legacy plaintext row — caller may re-encrypt on next write
        return stored
    except Exception as e:
        logger.error("decrypt_field unexpected error: %s — returning stored value", e)
        return stored
