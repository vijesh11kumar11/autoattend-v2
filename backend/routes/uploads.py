"""
AutoAttend AI v2.0 — Generic upload routes

Currently handles leave-request supporting documents (issues #45 / #116).
Other future upload kinds can be added here.

Endpoints:
  POST /api/uploads/leave-document       — multipart upload, returns s3_key
  GET  /api/uploads/signed-url/{key:path} — short-lived GET URL for download
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status

from utils.auth_utils import any_authenticated
from utils.s3_utils import generate_signed_url, upload_leave_document

router = APIRouter(prefix="/api/uploads", tags=["uploads"])

# Mirror the validator in s3_utils so we reject early without paying for an
# S3 round-trip on obvious failures.
_MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024  # 5 MB


@router.post("/leave-document")
async def upload_leave_document_endpoint(
    file: UploadFile = File(...),
    leave_request_id: Optional[int] = Form(None),
    current_user: dict = Depends(any_authenticated),
):
    """Upload a supporting document for a leave request.

    Returns ``{"s3_key": "...", "filename": "..."}``. The signed download
    URL must be requested separately via ``/api/uploads/signed-url/{key}``.
    """
    contents = await file.read()
    if not contents:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Empty file")
    if len(contents) > _MAX_FILE_SIZE_BYTES:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"File too large — max {_MAX_FILE_SIZE_BYTES // (1024 * 1024)} MB",
        )

    s3_key = upload_leave_document(
        file_bytes=contents,
        original_filename=file.filename or "document",
        leave_request_id=leave_request_id,
    )
    return {"s3_key": s3_key, "filename": file.filename}


@router.get("/signed-url/{file_key:path}")
def get_signed_url(
    file_key: str,
    current_user: dict = Depends(any_authenticated),
):
    """Return a short-lived (1 h) pre-signed GET URL for a stored document."""
    if not file_key.startswith("leave-documents/"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid file key")
    url = generate_signed_url(file_key, expiry_seconds=3600)
    return {"url": url, "expires_in": 3600}
