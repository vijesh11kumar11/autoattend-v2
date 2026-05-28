"""
AutoAttend AI v2.0 — User endpoints

POST  /api/users/register-push-token
"""

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from database import User, get_db
from utils.auth_utils import any_authenticated

import logging
logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/users", tags=["Users"])


class PushTokenRequest(BaseModel):
    push_token: str = Field(..., min_length=10, max_length=500)


class PushTokenResponse(BaseModel):
    message: str


@router.post("/register-push-token", response_model=PushTokenResponse)
def register_push_token(
    body:         PushTokenRequest,
    current_user: dict    = Depends(any_authenticated),
    db:           Session = Depends(get_db),
):
    """Store (or update) the Expo push notification token for the current user."""
    token = body.push_token.strip()
    if not token.startswith("ExponentPushToken["):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Invalid push token format. Expected ExponentPushToken[...].",
        )

    user: User = db.query(User).filter(User.id == current_user["id"]).first()
    if not user:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found.")

    from utils.crypto_utils import encrypt_field
    user.push_token = encrypt_field(token)
    db.commit()

    return PushTokenResponse(message="Push token registered successfully.")
