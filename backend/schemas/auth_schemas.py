"""
AutoAttend AI v2.0 — Auth Pydantic Schemas
"""

from typing import Optional

from pydantic import BaseModel, Field

# ═══════════════════════════════════════════════════════════════════════
# Login
# ═══════════════════════════════════════════════════════════════════════


class LoginRequest(BaseModel):
    identifier: str = Field(..., description="Email for staff, roll number for students")
    password: str = Field(..., min_length=6)


class LoginResponse(BaseModel):
    """
    One response model handles all login outcomes via optional fields:
    - Student success        → access_token + face_enrollment_required
    - Staff TOTP pending     → requires_totp + totp_session_token
    - Staff TOTP not set up  → access_token + totp_setup_required
    - Staff TOTP verified    → access_token + role + name
    """

    access_token: Optional[str] = None
    token_type: str = "bearer"
    # Mobile clients receive the refresh token in JSON body
    # (web clients receive it via httpOnly cookie).
    refresh_token: Optional[str] = None
    role: Optional[str] = None
    name: Optional[str] = None
    # Student-specific
    face_enrollment_required: Optional[bool] = None
    # Staff TOTP challenge
    requires_totp: Optional[bool] = None
    totp_session_token: Optional[str] = None
    # Staff first-time TOTP setup
    totp_setup_required: Optional[bool] = None


class RefreshTokenRequest(BaseModel):
    """Mobile body for /api/auth/refresh; web sends the refresh cookie instead."""

    refresh_token: Optional[str] = None


class RefreshTokenResponse(BaseModel):
    access_token: str
    refresh_token: Optional[str] = None  # only populated for mobile
    token_type: str = "bearer"


# ═══════════════════════════════════════════════════════════════════════
# TOTP Verification
# ═══════════════════════════════════════════════════════════════════════


class VerifyTOTPRequest(BaseModel):
    totp_session_token: str
    totp_code: str = Field(..., min_length=6, max_length=6, pattern=r"^\d{6}$")


# ═══════════════════════════════════════════════════════════════════════
# TOTP Setup
# ═══════════════════════════════════════════════════════════════════════


class TOTPSetupResponse(BaseModel):
    secret: str
    qr_image: str  # data:image/png;base64,...
    instructions: str


class TOTPConfirmRequest(BaseModel):
    secret: str
    totp_code: str = Field(..., min_length=6, max_length=6, pattern=r"^\d{6}$")


# ═══════════════════════════════════════════════════════════════════════
# Password Change (authenticated — must be logged in)
# ═══════════════════════════════════════════════════════════════════════


class PasswordChangeRequestResponse(BaseModel):
    sms_sent: bool
    email_sent: bool
    phone_masked: str
    email_masked: str
    expires_in: int = 600  # seconds


class ConfirmPasswordChangeRequest(BaseModel):
    otp_sms: str = Field(..., min_length=6, max_length=6)
    otp_email: str = Field(..., min_length=6, max_length=6)
    new_password: str = Field(..., min_length=8)


# ═══════════════════════════════════════════════════════════════════════
# Forgot / Reset Password (unauthenticated)
# ═══════════════════════════════════════════════════════════════════════


class ForgotPasswordRequest(BaseModel):
    identifier: str = Field(..., description="Email or roll number")


class ForgotPasswordResponse(BaseModel):
    message: str = "OTP sent to registered mobile and email"
    phone_masked: str = ""
    email_masked: str = ""


class ResetPasswordRequest(BaseModel):
    identifier: str
    otp_sms: str = Field(..., min_length=6, max_length=6)
    otp_email: str = Field(..., min_length=6, max_length=6)
    new_password: str = Field(..., min_length=8)


# ═══════════════════════════════════════════════════════════════════════
# Face Settings (staff only)
# ═══════════════════════════════════════════════════════════════════════


class EnableFaceResponse(BaseModel):
    face_auth_enabled: bool
    message: str


# ═══════════════════════════════════════════════════════════════════════
# Profile
# ═══════════════════════════════════════════════════════════════════════


class ProfileResponse(BaseModel):
    id: int
    name: str
    email: str
    role: str
    college_id: int
    department_id: Optional[int]
    face_enrolled: bool
    totp_enabled: bool
    face_auth_enabled: bool
    phone: Optional[str]
    roll_number: Optional[str]
    semester: Optional[int]
    course_name: Optional[str] = None


# ═══════════════════════════════════════════════════════════════════════
# Generic
# ═══════════════════════════════════════════════════════════════════════


class MessageResponse(BaseModel):
    message: str
