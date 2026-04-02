"""
AutoAttend AI v2.0 — Push Notification Utilities

Uses Expo push notification service via exponent_server_sdk.
Provides a single `send_push_notification` function used by:
  - attendance.mark (attendance marked confirmation)
  - attendance.start_session (session started alert to enrolled students)
  - APScheduler daily job (low-attendance warnings)
  - auth flow (OTP backup notification)
  - HOD approval (device-change approval notification)
"""

import logging
from typing import Optional

from exponent_server_sdk import (
    DeviceNotRegisteredError,
    PushClient,
    PushMessage,
    PushServerError,
)
from sqlalchemy.orm import Session

from database import User

logger = logging.getLogger(__name__)

_client = PushClient()


def send_push_notification(
    user_id: int,
    title: str,
    body: str,
    db: Session,
    data: Optional[dict] = None,
) -> bool:
    """
    Send a push notification to a single user via Expo push service.

    Returns True if sent successfully, False otherwise.
    Silently logs errors — never raises so callers aren't disrupted.
    """
    user: Optional[User] = db.query(User).filter(User.id == user_id).first()
    if not user or not user.push_token:
        logger.debug("No push token for user_id=%d, skipping notification.", user_id)
        return False

    token = user.push_token
    if not token.startswith("ExponentPushToken["):
        logger.warning("Invalid push token format for user_id=%d: %s", user_id, token[:30])
        return False

    try:
        response = _client.publish(
            PushMessage(
                to=token,
                title=title,
                body=body,
                data=data or {},
                sound="default",
                priority="high",
            )
        )
        response.validate_response()
        logger.info("Push sent to user_id=%d title=%r", user_id, title)
        return True
    except DeviceNotRegisteredError:
        logger.info("Push token expired for user_id=%d, clearing.", user_id)
        user.push_token = None
        db.commit()
        return False
    except PushServerError as exc:
        logger.error("Expo push server error for user_id=%d: %s", user_id, exc)
        return False
    except Exception as exc:
        logger.error("Push notification failed for user_id=%d: %s", user_id, exc)
        return False


def send_push_to_many(
    user_ids: list[int],
    title: str,
    body: str,
    db: Session,
    data: Optional[dict] = None,
) -> int:
    """
    Send a push notification to multiple users.
    Returns count of successfully sent notifications.
    """
    users = db.query(User).filter(
        User.id.in_(user_ids),
        User.push_token.isnot(None),
    ).all()

    if not users:
        return 0

    messages = []
    token_user_map = {}
    for user in users:
        if user.push_token and user.push_token.startswith("ExponentPushToken["):
            messages.append(
                PushMessage(
                    to=user.push_token,
                    title=title,
                    body=body,
                    data=data or {},
                    sound="default",
                    priority="high",
                )
            )
            token_user_map[user.push_token] = user

    if not messages:
        return 0

    sent = 0
    try:
        responses = PushClient().publish_multiple(messages)
        for i, response in enumerate(responses):
            try:
                response.validate_response()
                sent += 1
            except DeviceNotRegisteredError:
                token = messages[i].to
                if token in token_user_map:
                    token_user_map[token].push_token = None
            except Exception as exc:
                logger.warning("Push failed for one recipient: %s", exc)
        db.commit()
    except PushServerError as exc:
        logger.error("Expo push bulk error: %s", exc)
    except Exception as exc:
        logger.error("Push bulk send failed: %s", exc)

    logger.info("Push bulk: %d/%d sent for title=%r", sent, len(messages), title)
    return sent
