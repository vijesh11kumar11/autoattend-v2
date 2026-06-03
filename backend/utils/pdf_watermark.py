"""
ClassPulse — Enterprise PDF Watermarking

Per-recipient watermarks (visible diagonal + header/footer banners) plus
an invisible steganographic marker so leaked documents can be traced
even if the visible watermark is cropped.

Files are written to <UPLOAD_ROOT>/watermarked/ and auto-deleted after
WATERMARK_TTL_SECONDS (default 1 hour).
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
import os
import uuid
from datetime import datetime

from config import settings

logger = logging.getLogger(__name__)

# ── Paths / TTL ──────────────────────────────────────────────────────────
_BASE_UPLOADS = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "uploads", "classpulse")
)
WATERMARKED_DIR = os.path.join(_BASE_UPLOADS, "watermarked")
WATERMARK_TTL_SECONDS = 3600

os.makedirs(WATERMARKED_DIR, exist_ok=True)


def _safe_remove(path: str) -> None:
    try:
        if path and os.path.isfile(path):
            os.remove(path)
            logger.info("🗑️ watermark TTL expired, removed %s", path)
    except OSError as e:
        logger.debug("watermark cleanup failed for %s: %s", path, e)


async def _schedule_deletion(path: str, delay_sec: int = WATERMARK_TTL_SECONDS) -> None:
    try:
        await asyncio.sleep(delay_sec)
    except asyncio.CancelledError:
        return
    _safe_remove(path)


def _ascii(text: str) -> str:
    """PyMuPDF default helv font is Latin-1; strip non-encodable chars."""
    return text.encode("latin-1", "replace").decode("latin-1")


async def watermark_pdf_for_student(
    file_path: str,
    student_name: str,
    roll_no: str,
    subject_name: str,
    capsule_title: str,
    college_name: str,
) -> str:
    """
    Apply visible + invisible watermarks to a PDF for a specific student.

    Returns the path to the freshly watermarked PDF. The file is scheduled
    for deletion after WATERMARK_TTL_SECONDS via ``asyncio.create_task``.
    Fails-safe: if PyMuPDF is missing or the source PDF is unreadable,
    raises so the caller can deny the download.
    """
    try:
        import fitz  # PyMuPDF
    except ImportError as e:
        raise RuntimeError("PyMuPDF (fitz) is not installed") from e

    if not file_path or not os.path.isfile(file_path):
        raise FileNotFoundError(f"Source PDF not found: {file_path}")

    out_name = f"{uuid.uuid4().hex}_{(roll_no or 'student').replace('/', '_')}.pdf"
    out_path = os.path.join(WATERMARKED_DIR, out_name)

    diag_text = _ascii(f"CONFIDENTIAL - {student_name} ({roll_no or 'N/A'})")
    header_text = _ascii(
        "WARNING: This document is personalized. Sharing is a violation "
        "of academic integrity policy."
    )
    timestamp = datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC")
    footer_text = _ascii(
        f"{college_name} | {subject_name} | {capsule_title} | "
        f"Downloaded by: {student_name} ({roll_no or 'N/A'}) | {timestamp}"
    )

    # Loop over pages and apply visible watermarks.
    with fitz.open(file_path) as doc:
        for page in doc:
            rect = page.rect
            page_w, page_h = rect.width, rect.height

            # ── (a) Diagonal CONFIDENTIAL watermark — center, rotated -45 ──
            try:
                page.insert_textbox(
                    fitz.Rect(0, page_h * 0.40, page_w, page_h * 0.60),
                    diag_text,
                    fontsize=40,
                    fontname="helv",
                    color=(1.0, 0.0, 0.0),
                    fill_opacity=0.12,
                    stroke_opacity=0.12,
                    align=1,
                    rotate=0,  # rotate via morph below for stable bbox
                    overlay=True,
                    morph=(fitz.Point(page_w / 2, page_h / 2), fitz.Matrix(1, 1).prerotate(-45)),
                )
            except Exception as e:
                logger.warning("diagonal watermark failed on a page: %s", e)

            # ── (b) Footer black bar with metadata ──────────────────────
            footer_rect = fitz.Rect(0, page_h - 25, page_w, page_h)
            page.draw_rect(footer_rect, color=(0, 0, 0), fill=(0, 0, 0), overlay=True)
            page.insert_textbox(
                fitz.Rect(8, page_h - 22, page_w - 8, page_h - 4),
                footer_text,
                fontsize=7,
                fontname="helv",
                color=(1, 1, 1),
                align=1,
                overlay=True,
            )

            # ── (c) Header dark-red strip with sharing warning ──────────
            header_rect = fitz.Rect(0, 0, page_w, 18)
            page.draw_rect(header_rect, color=(1, 0.94, 0.94), fill=(1, 0.94, 0.94), overlay=True)
            page.insert_textbox(
                fitz.Rect(8, 2, page_w - 8, 16),
                header_text,
                fontsize=8,
                fontname="helv",
                color=(0.8, 0, 0),
                align=1,
                overlay=True,
            )

        doc.save(out_path, deflate=True)

    # Invisible steganographic marker (best effort — never blocks).
    try:
        student_id = _stable_int_hash(roll_no or student_name)
        capsule_id = _stable_int_hash(capsule_title)
        add_invisible_steganographic_marker(out_path, student_id, capsule_id)
    except Exception as e:
        logger.debug("stego marker failed: %s", e)

    # Schedule deletion. Loop is required to be running in async context.
    try:
        asyncio.create_task(_schedule_deletion(out_path))
    except RuntimeError:
        # No running loop — caller is sync. Best-effort: leave file for
        # the periodic cleanup job in classpulse.py to remove.
        logger.debug("no running event loop — TTL cleanup deferred")

    return out_path


def _stable_int_hash(s: str) -> int:
    """Deterministic non-cryptographic int from any string (for stego ids)."""
    digest = hashlib.sha256((s or "").encode("utf-8")).digest()
    return int.from_bytes(digest[:4], "big")


def add_invisible_steganographic_marker(file_path: str, student_id: int, capsule_id: int) -> str:
    """
    Embed an invisible (white-on-white, fontsize=1) tracer in the page-1
    margin of a PDF so leaked documents can be traced even if the visible
    watermark is cropped.

    Returns the file_path (mutates in place).
    """
    try:
        import fitz
    except ImportError as e:
        raise RuntimeError("PyMuPDF (fitz) is not installed") from e

    if not os.path.isfile(file_path):
        raise FileNotFoundError(file_path)

    timestamp = int(datetime.utcnow().timestamp())
    secret = getattr(settings, "SECRET_KEY", "") or ""
    digest = hashlib.sha256(f"{student_id}:{capsule_id}:{secret}".encode()).hexdigest()[:16]
    marker = f"WATERMARK:{student_id}:{capsule_id}:{timestamp}:{digest}"

    with fitz.open(file_path) as doc:
        if doc.page_count == 0:
            return file_path
        page = doc[0]
        # Tiny margin position (top-left, 2pt from edge)
        try:
            page.insert_text(
                fitz.Point(2, 6),
                marker,
                fontsize=1,
                fontname="helv",
                color=(1, 1, 1),  # white-on-white -> invisible
                overlay=True,
            )
        except Exception as e:
            logger.debug("stego insert_text failed: %s", e)
            return file_path
        # Save in-place
        tmp = file_path + ".stego.tmp"
        doc.save(tmp, deflate=True)

    os.replace(tmp, file_path)
    return file_path


def cleanup_expired_watermarks() -> int:
    """Delete watermarked files older than TTL. Returns count removed."""
    if not os.path.isdir(WATERMARKED_DIR):
        return 0
    cutoff = datetime.utcnow().timestamp() - WATERMARK_TTL_SECONDS
    removed = 0
    for fname in os.listdir(WATERMARKED_DIR):
        fpath = os.path.join(WATERMARKED_DIR, fname)
        try:
            if os.path.isfile(fpath) and os.path.getmtime(fpath) < cutoff:
                os.remove(fpath)
                removed += 1
        except OSError:
            continue
    return removed
