"""
AutoAttend AI v2.0 — S3 storage helpers

Used by `/api/uploads/leave-document` and `/api/uploads/signed-url/...`
to store supporting documents for leave requests (issues #45 / #116).

All credentials are sourced from `settings` (read from env). The module
is intentionally tolerant of missing credentials so the app keeps
running in dev — calls that need S3 raise HTTPException(503).
"""

from __future__ import annotations

import logging
import os
import uuid
from typing import Optional

from fastapi import HTTPException, status

from config import settings

logger = logging.getLogger(__name__)

# Allowed MIME / extension restrictions for leave documents
_ALLOWED_EXTENSIONS = {".pdf", ".jpg", ".jpeg", ".png"}
_MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024  # 5 MB

# Lazy-imported boto3 — keeps the dependency optional in dev.
_s3_client_singleton = None


def _is_configured() -> bool:
    return bool(
        settings.AWS_ACCESS_KEY_ID
        and settings.AWS_SECRET_ACCESS_KEY
        and settings.AWS_S3_BUCKET_NAME
    )


def get_s3_client():
    """Return a memoised boto3 S3 client. Raises 503 if AWS is not configured."""
    global _s3_client_singleton
    if _s3_client_singleton is not None:
        return _s3_client_singleton

    if not _is_configured():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="File storage not configured",
        )

    try:
        import boto3  # type: ignore
    except ImportError as exc:  # pragma: no cover - boto3 listed in requirements
        logger.error("boto3 is not installed — run `pip install -r requirements.txt`")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="File storage not configured",
        ) from exc

    _s3_client_singleton = boto3.client(
        "s3",
        aws_access_key_id=settings.AWS_ACCESS_KEY_ID,
        aws_secret_access_key=settings.AWS_SECRET_ACCESS_KEY,
        region_name=settings.AWS_REGION or "ap-south-1",
    )
    return _s3_client_singleton


def _validate_upload(file_bytes: bytes, original_filename: str) -> str:
    """Validate size + extension. Returns the lowercase extension."""
    if not file_bytes:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Empty file")
    if len(file_bytes) > _MAX_FILE_SIZE_BYTES:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"File too large — max {_MAX_FILE_SIZE_BYTES // (1024 * 1024)} MB",
        )
    name = os.path.basename(original_filename or "").strip()
    if not name:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Missing filename")
    ext = os.path.splitext(name)[1].lower()
    if ext not in _ALLOWED_EXTENSIONS:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Invalid file type — only PDF, JPG, JPEG, PNG are allowed",
        )
    return ext


_EXT_TO_CONTENT_TYPE = {
    ".pdf": "application/pdf",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
}


def upload_leave_document(
    file_bytes: bytes,
    original_filename: str,
    leave_request_id: Optional[int] = None,
) -> str:
    """
    Upload bytes to S3 under `leave-documents/{leave_request_id|new}/{uuid}_{name}`.
    Returns the S3 key. Raises HTTPException on validation / config errors.
    """
    ext = _validate_upload(file_bytes, original_filename)

    safe_name = os.path.basename(original_filename).replace("/", "_").replace("\\", "_")
    folder = str(leave_request_id) if leave_request_id is not None else "new"
    s3_key = f"leave-documents/{folder}/{uuid.uuid4().hex}_{safe_name}"

    client = get_s3_client()
    try:
        client.put_object(
            Bucket=settings.AWS_S3_BUCKET_NAME,
            Key=s3_key,
            Body=file_bytes,
            ContentType=_EXT_TO_CONTENT_TYPE.get(ext, "application/octet-stream"),
            ServerSideEncryption="AES256",
        )
    except HTTPException:
        raise
    except Exception as exc:  # pragma: no cover - depends on AWS connectivity
        logger.error("S3 put_object failed: %s", exc)
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            "Failed to store file",
        ) from exc

    return s3_key


# Prefixes that the read-presign helper is allowed to serve.
_ALLOWED_KEY_PREFIXES = ("leave-documents/", "session-recordings/")


def generate_signed_url(s3_key: str, expiry_seconds: int = 3600) -> str:
    """Return a pre-signed GET URL for the object. Raises 503 if AWS not set."""
    if not s3_key or not s3_key.startswith(_ALLOWED_KEY_PREFIXES):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid file key")

    client = get_s3_client()
    try:
        return client.generate_presigned_url(
            "get_object",
            Params={"Bucket": settings.AWS_S3_BUCKET_NAME, "Key": s3_key},
            ExpiresIn=int(expiry_seconds),
        )
    except Exception as exc:  # pragma: no cover - depends on AWS
        logger.error("S3 presign failed: %s", exc)
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            "Failed to generate file URL",
        ) from exc


# ═══════════════════════════════════════════════════════════════════════
# Smart Replay — session recording (video) storage (issue #118)
# ═══════════════════════════════════════════════════════════════════════

_ALLOWED_VIDEO_EXTENSIONS = {".mp4", ".webm", ".mov", ".m4v"}
_VIDEO_EXT_TO_CONTENT_TYPE = {
    ".mp4": "video/mp4",
    ".webm": "video/webm",
    ".mov": "video/quicktime",
    ".m4v": "video/x-m4v",
}


def is_s3_configured() -> bool:
    """Public helper so callers can degrade gracefully when S3 is off."""
    return _is_configured()


def _build_recording_key(session_id: int, original_filename: str) -> tuple[str, str]:
    name = os.path.basename(original_filename or "").strip()
    if not name:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Missing filename")
    ext = os.path.splitext(name)[1].lower()
    if ext not in _ALLOWED_VIDEO_EXTENSIONS:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Invalid video type — only MP4, WEBM, MOV, M4V are allowed",
        )
    safe_name = name.replace("/", "_").replace("\\", "_")
    return f"session-recordings/{int(session_id)}/{uuid.uuid4().hex}_{safe_name}", ext


def generate_recording_upload_url(
    session_id: int,
    original_filename: str,
    expiry_seconds: int = 3600,
) -> dict:
    """
    Return a pre-signed PUT URL so the browser can upload a session
    recording straight to S3 (no proxying through the API). The caller
    then persists the returned ``s3_key`` on ``LiveSession.recording_url``.
    Raises 503 when S3 is not configured.
    """
    s3_key, ext = _build_recording_key(session_id, original_filename)
    content_type = _VIDEO_EXT_TO_CONTENT_TYPE.get(ext, "application/octet-stream")
    client = get_s3_client()
    try:
        url = client.generate_presigned_url(
            "put_object",
            Params={
                "Bucket": settings.AWS_S3_BUCKET_NAME,
                "Key": s3_key,
                "ContentType": content_type,
                "ServerSideEncryption": "AES256",
            },
            ExpiresIn=int(expiry_seconds),
        )
    except Exception as exc:  # pragma: no cover - depends on AWS
        logger.error("S3 recording presign (PUT) failed: %s", exc)
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            "Failed to generate upload URL",
        ) from exc
    return {
        "upload_url": url,
        "s3_key": s3_key,
        "content_type": content_type,
        "expires_in": int(expiry_seconds),
    }


def upload_session_recording(
    file_bytes: bytes,
    original_filename: str,
    session_id: int,
) -> str:
    """
    Server-side upload of a recording (fallback when the browser cannot
    PUT directly). Returns the S3 key. Raises HTTPException on errors.
    """
    if not file_bytes:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Empty file")
    s3_key, ext = _build_recording_key(session_id, original_filename)
    client = get_s3_client()
    try:
        client.put_object(
            Bucket=settings.AWS_S3_BUCKET_NAME,
            Key=s3_key,
            Body=file_bytes,
            ContentType=_VIDEO_EXT_TO_CONTENT_TYPE.get(ext, "application/octet-stream"),
            ServerSideEncryption="AES256",
        )
    except HTTPException:
        raise
    except Exception as exc:  # pragma: no cover - depends on AWS connectivity
        logger.error("S3 recording put_object failed: %s", exc)
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            "Failed to store recording",
        ) from exc
    return s3_key
