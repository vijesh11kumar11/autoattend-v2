"""
AutoAttend AI v2.0 — Transactional Email Utilities (MSG91 templates)

Best-effort senders for NON-OTP transactional email, built on MSG91's
template email API. Every function here is non-blocking and never raises:
a failed, missing-email, or unconfigured send is logged and returns False
so callers (login, provisioning, notifications) keep working unchanged.

Templates are configured in the MSG91 dashboard and selected via env:
  • MSG91_WELCOME_TEMPLATE_ID       → first-login welcome (traceln_welcome)
  • MSG91_NOTIFICATION_TEMPLATE_ID  → generic notification (traceln_notification)

OTP email lives separately in utils/otp_utils.py (custom HTML body) and is
intentionally NOT changed by this module.
"""

import logging

import requests

from config import settings

logger = logging.getLogger(__name__)

_MSG91_EMAIL_URL = "https://control.msg91.com/api/v5/email/send"


# ═══════════════════════════════════════════════════════════════════════
# Internal helpers
# ═══════════════════════════════════════════════════════════════════════


def _mask_email(email: str) -> str:
    """Mask an email for logs: 'jo***@example.com'. Never raises."""
    try:
        local, _, domain = (email or "").partition("@")
        if not domain:
            return "***"
        shown = local[:2] if len(local) > 2 else local[:1]
        return f"{shown}***@{domain}"
    except Exception:
        return "***"


def _send_template_email(
    to_email: str,
    name: str,
    template_id: str,
    variables: dict,
) -> bool:
    """
    Send a single MSG91 template email. Best-effort; never raises.

    Returns True only when MSG91 accepts the request (HTTP 200/202).
    Returns False (logged) on missing recipient, missing config, non-2xx,
    or any transport exception.
    """
    if not to_email or "@" not in to_email:
        return False
    if not getattr(settings, "MSG91_AUTH_KEY", None) or not template_id:
        logger.info(
            "Template email skipped (MSG91/template not configured) → %s",
            _mask_email(to_email),
        )
        return False

    payload = {
        "recipients": [
            {
                "to": [{"name": name or to_email, "email": to_email}],
                "variables": variables or {},
            }
        ],
        "from": {"name": settings.APP_NAME, "email": settings.MSG91_EMAIL_FROM},
        "domain": settings.MSG91_EMAIL_DOMAIN,
        "template_id": template_id,
    }
    headers = {"authkey": settings.MSG91_AUTH_KEY, "Content-Type": "application/json"}
    try:
        resp = requests.post(_MSG91_EMAIL_URL, json=payload, headers=headers, timeout=10)
        ok = resp.status_code in (200, 202)
        if not ok:
            logger.warning(
                "Template email failed (template=%s) for %s: %s",
                template_id,
                _mask_email(to_email),
                resp.text,
            )
        return ok
    except Exception as exc:
        logger.error(
            "Template email exception (template=%s) for %s: %s",
            template_id,
            _mask_email(to_email),
            exc,
        )
        return False


# ═══════════════════════════════════════════════════════════════════════
# Public senders
# ═══════════════════════════════════════════════════════════════════════


def send_welcome_email(to_email: str, name: str, college_name: str | None = None) -> bool:
    """
    Send the first-login welcome email (MSG91 template `traceln_welcome`).

    Best-effort: returns False without sending if the recipient has no email
    or the welcome template is not configured. Never raises, never blocks the
    login flow.

    Template variable used (matches the approved MSG91 template):
      {{student_name}}
    """
    variables = {"student_name": name or ""}
    return _send_template_email(to_email, name, settings.MSG91_WELCOME_TEMPLATE_ID, variables)


def send_notification_email(
    to_email: str,
    name: str,
    message: str,
    subject: str | None = None,
) -> bool:
    """
    Generic notification email (MSG91 template `traceln_notification`).

    NOTE: this template is currently DISABLED — it was rejected by MSG91, so
    MSG91_NOTIFICATION_TEMPLATE_ID is left blank and this function is a logged
    no-op. The helper is kept ready so it works the moment an approved
    template id is set in the env. Never raises.

    Template variable expected when re-enabled:
      {{student_name}}, {{message}}
    """
    variables = {
        "student_name": name or "",
        "message": message or "",
    }
    return _send_template_email(to_email, name, settings.MSG91_NOTIFICATION_TEMPLATE_ID, variables)
