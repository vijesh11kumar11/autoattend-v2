"""
AutoAttend AI v2.0 — FastAPI entry point
"""

import logging
import sys

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address

from config import settings
from database import Base, engine
from routes import alerts, attendance, auth, face, faculty, qr, reports, sections, students
from routes import timetable, tutor, users
from routes import twm
from routes import leave
from routes import analytics
from routes import student_portal
from routes import feed
from routes import career

# ── Logging configuration ──────────────────────────────────────────────
# NOTE: uvicorn overrides logging.basicConfig() after import, so we
# configure a dedicated handler on the root logger in a startup event
# to guarantee our format + levels survive uvicorn's setup.
LOG_FORMAT = (
    "%(asctime)s │ %(levelname)-7s │ %(name)-28s │ %(message)s"
)

logger = logging.getLogger(__name__)

# Create all tables (idempotent)
Base.metadata.create_all(bind=engine)

# ── Rate limiter ───────────────────────────────────────────────────────
limiter = Limiter(key_func=get_remote_address)

app = FastAPI(
    title=settings.APP_NAME,
    version="2.0.0",
    docs_url="/api/docs",
    redoc_url="/api/redoc",
)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# CORS — allow the Vite dev server and production frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.FRONTEND_URL, "http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── register routers ───────────────────────────────────────────────────
app.include_router(auth.router)
app.include_router(face.router)
app.include_router(attendance.router)
app.include_router(qr.router)
app.include_router(students.router)
app.include_router(faculty.router)
app.include_router(reports.router)
app.include_router(alerts.router)
app.include_router(users.router)
app.include_router(sections.router)
app.include_router(tutor.router)
app.include_router(timetable.router)
app.include_router(twm.router)
app.include_router(leave.router)
app.include_router(analytics.router)
app.include_router(student_portal.router)
app.include_router(feed.router)
app.include_router(career.router)


@app.get("/api/health")
def health():
    return {"status": "ok", "version": "2.0.0"}


@app.on_event("startup")
def _configure_logging():
    """
    Configure logging AFTER uvicorn has set up its own handlers.
    This ensures our format and levels are actually applied.
    """
    root = logging.getLogger()
    # Remove ALL existing handlers (including uvicorn's duplicates)
    root.handlers.clear()
    # Also clear uvicorn's own loggers' handlers to prevent double output
    for uvi_name in ("uvicorn", "uvicorn.error", "uvicorn.access"):
        uvi_logger = logging.getLogger(uvi_name)
        uvi_logger.handlers.clear()
        uvi_logger.propagate = True  # let them use root handler
    # Add our single handler
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(logging.Formatter(LOG_FORMAT, datefmt="%Y-%m-%d %H:%M:%S"))
    root.addHandler(handler)
    root.setLevel(logging.INFO)
    # Silence noisy libraries
    for noisy in ("sqlalchemy.engine", "sqlalchemy.engine.Engine",
                  "urllib3", "httpcore", "watchfiles", "httpx"):
        noisy_logger = logging.getLogger(noisy)
        noisy_logger.handlers.clear()   # remove echo=True handler
        noisy_logger.setLevel(logging.WARNING)
        noisy_logger.propagate = True
    # Disable SQLAlchemy echo (echo=True resets logger to INFO on every query)
    engine.echo = False
    logger.info("✅ AutoAttend logging configured — all route loggers active")


# ═══════════════════════════════════════════════════════════════════════
# APScheduler — background jobs
# ═══════════════════════════════════════════════════════════════════════

from apscheduler.schedulers.background import BackgroundScheduler
from database import SessionLocal
from routes.attendance import auto_expire_sessions
from utils.notification_utils import send_push_notification


def _auto_expire_job():
    """Run every minute — expire stale sessions."""
    db = SessionLocal()
    try:
        auto_expire_sessions(db)
    except Exception as exc:
        logger.error("auto_expire_sessions failed: %s", exc)
    finally:
        db.close()


def _daily_low_attendance_alerts():
    """
    Run daily at 20:00 — send push notifications to students
    whose attendance is below the threshold in any subject.
    """
    from sqlalchemy import func as sqlfunc
    from database import (
        AttendanceRecord, AttendanceSession, AttendanceStatus,
        Subject, User, UserRole,
    )

    db = SessionLocal()
    try:
        threshold = settings.ATTENDANCE_THRESHOLD

        # Get each student's per-subject attendance %
        total_sub = (
            db.query(
                AttendanceRecord.student_id,
                AttendanceSession.subject_id,
                sqlfunc.count(AttendanceRecord.id).label("total"),
                sqlfunc.sum(
                    sqlfunc.cast(
                        AttendanceRecord.status == AttendanceStatus.present, Integer
                    )
                ).label("present"),
            )
            .join(AttendanceSession, AttendanceSession.id == AttendanceRecord.session_id)
            .group_by(AttendanceRecord.student_id, AttendanceSession.subject_id)
            .all()
        )

        for row in total_sub:
            pct = (row.present or 0) * 100.0 / row.total if row.total else 100
            if pct < threshold:
                needed = 0
                if row.total > 0:
                    # How many more present classes to reach threshold
                    # (present + x) / (total + x) >= threshold/100
                    import math
                    x = math.ceil(
                        (threshold * row.total / 100 - (row.present or 0))
                        / (1 - threshold / 100)
                    )
                    needed = max(x, 1)

                subject = db.query(Subject).filter(Subject.id == row.subject_id).first()
                subj_name = subject.name if subject else "a subject"

                send_push_notification(
                    user_id=row.student_id,
                    title=f"⚠️ Low Attendance Warning",
                    body=f"Your {subj_name} attendance is {pct:.0f}%. Need {needed} more classes.",
                    db=db,
                    data={"type": "low_attendance", "subject_id": row.subject_id},
                )

        logger.info("Daily low-attendance alerts processed: %d records checked.", len(total_sub))
    except Exception as exc:
        logger.error("_daily_low_attendance_alerts failed: %s", exc)
    finally:
        db.close()


# Need Integer for cast in the job
from sqlalchemy import Integer

scheduler = BackgroundScheduler()
scheduler.add_job(_auto_expire_job, "interval", minutes=1, id="auto_expire")
scheduler.add_job(_daily_low_attendance_alerts, "cron", hour=20, minute=0, id="daily_alerts")
scheduler.start()

