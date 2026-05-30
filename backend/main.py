"""
AutoAttend AI v2.0 — FastAPI entry point
"""

# ─────────────────────────────────────────────────────────────────────
# Sentry initialisation — MUST run before any FastAPI / SQLAlchemy
# imports so the integrations can patch the libraries on load.
# Reads SENTRY_DSN directly from the environment (via python-dotenv)
# to stay independent of the pydantic Settings import below. Skips
# silently when DSN is empty so dev/CI runs without Sentry.
# ─────────────────────────────────────────────────────────────────────
import os as _os
import logging as _logging

try:
    from dotenv import load_dotenv as _load_dotenv  # type: ignore
    _load_dotenv()
except Exception:  # pragma: no cover - dotenv is optional at runtime
    pass

_SENTRY_DSN = (_os.environ.get("SENTRY_DSN") or "").strip()
if _SENTRY_DSN:
    try:
        import sentry_sdk  # type: ignore
        from sentry_sdk.integrations.fastapi import FastApiIntegration  # type: ignore
        from sentry_sdk.integrations.sqlalchemy import SqlalchemyIntegration  # type: ignore

        sentry_sdk.init(
            dsn=_SENTRY_DSN,
            environment=(_os.environ.get("APP_ENV") or "production").strip(),
            release=(_os.environ.get("APP_VERSION") or "2.0.0").strip(),
            traces_sample_rate=1.0,
            integrations=[FastApiIntegration(), SqlalchemyIntegration()],
        )
        _logging.getLogger(__name__).info("📡 Sentry initialised (env=%s)", _os.environ.get("APP_ENV", "production"))
    except ImportError:
        _logging.getLogger(__name__).warning(
            "SENTRY_DSN is set but sentry-sdk is not installed — run `pip install -r requirements.txt`."
        )
    except Exception as _exc:  # pragma: no cover - never block startup on Sentry failure
        _logging.getLogger(__name__).warning("Sentry init skipped (%s)", _exc)

# ─────────────────────────────────────────────────────────────────────
# TODO: Enable OpenTelemetry when needed
# To re-enable: uncomment the imports and initialization below,
# set OTEL_EXPORTER_OTLP_ENDPOINT in your .env, and
# install opentelemetry-sdk opentelemetry-exporter-otlp
# ─────────────────────────────────────────────────────────────────────
# from opentelemetry import trace
# from opentelemetry.sdk.resources import Resource
# from opentelemetry.sdk.trace import TracerProvider
# from opentelemetry.sdk.trace.export import BatchSpanProcessor
# from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
# from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
# from opentelemetry.instrumentation.sqlalchemy import SQLAlchemyInstrumentor
#
# _otel_endpoint = (_os.environ.get("OTEL_EXPORTER_OTLP_ENDPOINT") or "").strip()
# if _otel_endpoint:
#     _resource = Resource.create({"service.name": "autoattend-backend"})
#     _provider = TracerProvider(resource=_resource)
#     _provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter(endpoint=_otel_endpoint)))
#     trace.set_tracer_provider(_provider)
#     # FastAPIInstrumentor / SQLAlchemyInstrumentor are wired after the
#     # `app` and `engine` objects are constructed (see below).

import asyncio
import logging
import sys
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone

from fastapi import FastAPI, HTTPException, Request, Response, WebSocket, WebSocketDisconnect, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address
from sqlalchemy import text
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.middleware.httpsredirect import HTTPSRedirectMiddleware
from starlette.middleware.trustedhost import TrustedHostMiddleware

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
from routes import suggestions
from routes import classpulse
from routes import live_session
from routes import principal
from routes import notifications
from routes import uploads
from routes import superadmin

# ── Logging configuration ──────────────────────────────────────────────
# NOTE: uvicorn overrides logging.basicConfig() after import, so we
# configure a dedicated handler on the root logger in a startup event
# to guarantee our format + levels survive uvicorn's setup.
LOG_FORMAT = (
    "%(asctime)s │ %(levelname)-7s │ %(name)-28s │ %(message)s"
)

logger = logging.getLogger(__name__)

# Schema creation is intentionally GATED. In production, run Alembic
# migrations (`alembic upgrade head`) before the app starts. The dev
# convenience auto-create runs only when AUTO_CREATE_TABLES=True or
# DEBUG=True (which also serves a local SQLite/dev DB).
if settings.AUTO_CREATE_TABLES or settings.DEBUG:
    Base.metadata.create_all(bind=engine)
    logger.info("📦 Base.metadata.create_all() applied (DEBUG/AUTO_CREATE_TABLES)")
else:
    logger.info("📦 Schema creation skipped — use 'alembic upgrade head' in production")

# Whether to expose interactive docs. Independent of DEBUG so an
# operator can keep DEBUG=True locally without exposing the OpenAPI
# schema, or expose docs in a staging environment with DEBUG=False.
_expose_docs = settings.EXPOSE_DOCS or settings.DEBUG

# ── Rate limiter ───────────────────────────────────────────────────────
limiter = Limiter(key_func=get_remote_address)

app = FastAPI(
    title=settings.APP_NAME,
    version="2.0.0",
    docs_url="/api/docs" if _expose_docs else None,
    redoc_url="/api/redoc" if _expose_docs else None,
    openapi_url="/api/openapi.json" if _expose_docs else None,
    # lifespan is bound later (see end of file) once _lifespan is defined.
)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)


# ─────────────────────────────────────────────────────────────────────
# TODO: Enable OpenTelemetry when needed
# (Continuation of the OTel block at the top of this file.)
# To re-enable: uncomment these instrumentor calls after uncommenting
# the imports above, and ensure OTEL_EXPORTER_OTLP_ENDPOINT is set.
# ─────────────────────────────────────────────────────────────────────
# if _otel_endpoint:
#     FastAPIInstrumentor.instrument_app(app)
#     SQLAlchemyInstrumentor().instrument(engine=engine)


# ─────────────────────────────────────────────────────────────────────
# TODO: Enable Prometheus metrics when needed
# To re-enable: uncomment below, install
# prometheus-fastapi-instrumentator, and set up
# a Prometheus scrape target pointing at /metrics
# ─────────────────────────────────────────────────────────────────────
# from prometheus_fastapi_instrumentator import Instrumentator
# Instrumentator().instrument(app).expose(app, endpoint="/metrics", include_in_schema=False)


# ── Global security headers middleware ────────────────────────────────
class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """
    Adds OWASP-recommended security headers to every HTTP response.
    Route-level overrides are preserved: if a route already set a header,
    we do not replace it.
    """

    _DEFAULTS = {
        "Strict-Transport-Security": "max-age=31536000; includeSubDomains; preload",
        "X-Content-Type-Options":    "nosniff",
        "X-Frame-Options":           "DENY",
        "X-XSS-Protection":          "1; mode=block",
        "Referrer-Policy":           "strict-origin-when-cross-origin",
        "Permissions-Policy":        "camera=(self), microphone=(self), geolocation=(self), bluetooth=(self)",
        "Content-Security-Policy": (
            "default-src 'self'; "
            "script-src 'self'; "
            "style-src 'self' 'unsafe-inline'; "
            "img-src 'self' data: blob:; "
            "connect-src 'self' wss: https:; "
            "frame-ancestors 'none'"
        ),
    }

    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        for header, value in self._DEFAULTS.items():
            response.headers.setdefault(header, value)
        return response


app.add_middleware(SecurityHeadersMiddleware)


# ── Request-ID middleware (correlates security_events + access logs) ──
import uuid as _uuid


class RequestIDMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        rid = request.headers.get("X-Request-ID") or _uuid.uuid4().hex
        request.state.request_id = rid
        response = await call_next(request)
        response.headers.setdefault("X-Request-ID", rid)
        return response


app.add_middleware(RequestIDMiddleware)


# ── Request body size cap (defence against memory exhaustion) ─────────
class MaxBodySizeMiddleware(BaseHTTPMiddleware):
    """Reject any request whose advertised Content-Length exceeds the
    configured cap. Streamed/chunked uploads that omit Content-Length are
    still bounded by uvicorn's per-connection limits."""

    async def dispatch(self, request: Request, call_next):
        cl = request.headers.get("content-length")
        if cl and cl.isdigit() and int(cl) > settings.MAX_REQUEST_BODY_BYTES:
            return JSONResponse(
                status_code=413,
                content={"detail": "Request body too large"},
            )
        return await call_next(request)


app.add_middleware(MaxBodySizeMiddleware)


# ── Per-request timeout (defence against slow/hung handlers) ───────────
class RequestTimeoutMiddleware(BaseHTTPMiddleware):
    """Cap any single request at REQUEST_TIMEOUT_SECONDS. Long-poll and
    WebSocket routes bypass this middleware automatically (WS uses its
    own protocol)."""

    async def dispatch(self, request: Request, call_next):
        try:
            return await asyncio.wait_for(
                call_next(request),
                timeout=settings.REQUEST_TIMEOUT_SECONDS,
            )
        except asyncio.TimeoutError:
            logger.warning("⏱️ request timeout: %s %s", request.method, request.url.path)
            return JSONResponse(
                status_code=504,
                content={"detail": "Server timeout while processing request"},
            )


app.add_middleware(RequestTimeoutMiddleware)


# ── HTTPS enforcement (production only) ──────────────────────────
# When FORCE_HTTPS=True we are the TLS terminator and any plain-http
# request must 301 to https. Behind a load balancer set FORCE_HTTPS=False
# and let the proxy handle redirects (it will set X-Forwarded-Proto).
if settings.FORCE_HTTPS and not settings.DEBUG:
    app.add_middleware(HTTPSRedirectMiddleware)
    logger.info("🔒 HTTPSRedirectMiddleware enabled")

# CORS — production list contains ONLY settings.FRONTEND_URL.
# Vite dev origin (http://localhost:5173) is added only when DEBUG=True.
_cors_origins = [settings.FRONTEND_URL]
if settings.DEBUG:
    _cors_origins += ["http://localhost:5173", "http://127.0.0.1:5173"]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Device-ID", "X-Client-Type", "X-Request-ID", "X-Requested-With", "Accept"],
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
app.include_router(principal.router)
app.include_router(sections.router)
app.include_router(tutor.router)
app.include_router(timetable.router)
app.include_router(twm.router)
app.include_router(leave.router)
app.include_router(analytics.router)
app.include_router(student_portal.router)
app.include_router(feed.router)
app.include_router(career.router)
app.include_router(suggestions.router)
app.include_router(classpulse.router)
app.include_router(uploads.router)
app.include_router(live_session.router)
app.include_router(notifications.router)
app.include_router(superadmin.router)


@app.get("/api/health")
def health():
    """Liveness + readiness probe.

    Returns 200 only when the DB is reachable. Load balancers / orchestrators
    can rely on the status code; the body is for human debugging.
    """
    db_ok = False
    db_error = None
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        db_ok = True
    except Exception as exc:
        db_error = str(exc)[:200]
        logger.error("❌ health DB check failed: %s", db_error)

    payload = {
        "status": "ok" if db_ok else "degraded",
        "version": "2.0.0",
        "db": "ok" if db_ok else "down",
    }
    if db_error and settings.DEBUG:
        payload["db_error"] = db_error
    return JSONResponse(
        status_code=200 if db_ok else 503,
        content=payload,
    )


# ── WebSocket: real-time live-session signalling ────────────────────────
from utils.session_manager import manager as live_ws_manager  # noqa: E402
from utils.auth_utils import decode_access_token  # noqa: E402
from database import LiveSession, LiveSessionParticipant, SessionLocal  # noqa: E402
from utils.live_session_ai import generate_ai_observation  # noqa: E402


def _verify_ws_token(token: str) -> dict | None:
    if not token:
        return None
    try:
        payload = decode_access_token(token)
    except Exception:
        return None
    return payload


@app.websocket("/ws/live/{session_id}/{user_id}")
async def live_session_ws(
    websocket: WebSocket,
    session_id: int,
    user_id: int,
    token: str = "",
):
    """Real-time channel for a live session.

    Auth precedence (most → least secure):
      1. httpOnly `aa_token` cookie sent on the WS handshake (web users).
      2. `Sec-WebSocket-Protocol: aa-jwt, <token>` subprotocol header
         (mobile/guest clients — keeps token OUT of URL & access logs).
      3. `?token=<JWT>` query param (DEPRECATED — kept for legacy clients;
         logged as WARNING so we can phase it out).

    The token's `id` (or `participant_id` for guests) must match the URL
    `user_id`.
    """
    # 1. Cookie
    cookie_token = websocket.cookies.get("aa_token")

    # 2. Subprotocol — browser/RN pass `new WebSocket(url, ["aa-jwt", token])`
    subproto_token = None
    chosen_subproto = None
    subprotos = websocket.headers.get("sec-websocket-protocol", "")
    if subprotos:
        parts = [p.strip() for p in subprotos.split(",")]
        if len(parts) >= 2 and parts[0] == "aa-jwt":
            subproto_token = parts[1]
            chosen_subproto = "aa-jwt"

    # 3. Query string fallback — DEBUG ONLY. In production the token would
    #    appear in proxy/access logs, so reject any client that tries it.
    query_token = ""
    if not cookie_token and not subproto_token and token:
        if settings.DEBUG:
            logger.warning("WS auth via ?token= query param (DEBUG fallback) │ session=%s user=%s ip=%s",
                           session_id, user_id, websocket.client.host if websocket.client else "?")
            query_token = token
        else:
            logger.warning("WS auth via ?token= query param REJECTED in production │ session=%s user=%s ip=%s",
                           session_id, user_id, websocket.client.host if websocket.client else "?")
            await websocket.close(code=4401)
            return

    payload = _verify_ws_token(cookie_token or subproto_token or query_token)
    if payload is None:
        await websocket.close(code=4401)
        return

    role = payload.get("role")
    token_uid = payload.get("id") or payload.get("participant_id")
    if token_uid is None or int(token_uid) != int(user_id):
        # Guests use participant_id as user_id in the URL; allow if it matches.
        if role != "guest" or int(payload.get("participant_id", -1)) != int(user_id):
            await websocket.close(code=4403)
            return

    # Verify the session exists and resolve teacher_id
    db = SessionLocal()
    try:
        sess = db.query(LiveSession).filter(LiveSession.id == session_id).first()
        if not sess:
            await websocket.close(code=4404)
            return
        is_teacher = role in ("teacher", "hod", "principal") and sess.teacher_id == int(token_uid or 0)
    finally:
        db.close()

    await live_ws_manager.connect(websocket, session_id, user_id,
                                  is_teacher=is_teacher,
                                  subprotocol=chosen_subproto)
    try:
        # Greet the joiner
        await websocket.send_json({
            "type": "ws_ready",
            "session_id": session_id,
            "user_id": user_id,
            "role": role,
            "is_teacher": is_teacher,
        })

        # F01 — start AI observation scheduler when the teacher connects
        if is_teacher:
            try:
                from routes.live_session import _ensure_observation_scheduler
                _ensure_observation_scheduler(session_id)
            except Exception as exc:
                logger.warning("observation scheduler start failed for %s: %s", session_id, exc)

        while True:
            data = await websocket.receive_json()
            event_type = (data or {}).get("type")

            # ── Teacher transcript → AI observation ────────────────────
            if event_type == "transcript_chunk" and is_teacher:
                text = (data.get("text") or "").strip()
                if text:
                    db2 = SessionLocal()
                    try:
                        obs = await generate_ai_observation(db2, sess.id, text)
                    except Exception as exc:
                        logger.warning("AI observation failed: %s", exc)
                        obs = None
                    finally:
                        db2.close()
                    if obs:
                        await live_ws_manager.send_to_teacher(session_id, {
                            "type": "ai_observation",
                            **(obs if isinstance(obs, dict) else {"observation": str(obs)}),
                        })

            # ── Student answers a pulse check ──────────────────────────
            elif event_type == "pulse_response":
                # Echo aggregate update to teacher
                await live_ws_manager.send_to_teacher(session_id, {
                    "type": "pulse_update",
                    "pulse_id": data.get("pulse_id"),
                    "answer": data.get("answer"),
                    "from_user_id": user_id,
                })

            # ── New doubt posted (server already saved via REST) ───────
            elif event_type == "doubt_posted":
                # Anonymised broadcast to all participants
                await live_ws_manager.broadcast_to_session(session_id, {
                    "type": "new_doubt",
                    "doubt_id": data.get("doubt_id"),
                    "question": data.get("question"),
                    "resonance_count": data.get("resonance_count", 0),
                })
                # Identified copy to teacher
                await live_ws_manager.send_to_teacher(session_id, {
                    "type": "new_doubt",
                    "doubt_id": data.get("doubt_id"),
                    "question": data.get("question"),
                    "resonance_count": data.get("resonance_count", 0),
                    "posted_by_user_id": user_id,
                })

            # ── Resonance click ────────────────────────────────────────
            elif event_type == "resonance":
                await live_ws_manager.send_to_teacher(session_id, {
                    "type": "hot_doubt",
                    "doubt_id": data.get("doubt_id"),
                    "resonance_count": data.get("resonance_count", 1),
                    "question": data.get("question"),
                })

            # ── Bandwidth alert ────────────────────────────────────────
            elif event_type == "low_bandwidth_detected":
                await live_ws_manager.send_to_teacher(session_id, {
                    "type": "bandwidth_alert",
                    "student_id": user_id,
                    "quality": data.get("quality", "poor"),
                })
                # Server can later push micro_summary frames; placeholder ack:
                await websocket.send_json({"type": "low_bandwidth_ack", "mode": "text"})

            # ── Ping/keepalive ─────────────────────────────────────────
            elif event_type == "ping":
                await websocket.send_json({"type": "pong"})

            else:
                # Unknown event — echo back for debugging
                await websocket.send_json({"type": "unknown_event", "received": event_type})

    except WebSocketDisconnect:
        live_ws_manager.disconnect(session_id, user_id)
        await live_ws_manager.broadcast_to_session(session_id, {
            "type": "student_left",
            "user_id": user_id,
            "total_count": len(live_ws_manager.participants(session_id)),
        })
    except Exception as exc:  # pragma: no cover
        logger.exception("WebSocket error: %s", exc)
        live_ws_manager.disconnect(session_id, user_id)


# Startup validator — invoked from _lifespan (no @app.on_event decorator;
# that API is deprecated in FastAPI >= 0.93 in favour of lifespan).
def _validate_security_config():
    """
    Refuse to start the app with insecure or missing security configuration.
    Runs before the first request is served.
    """
    errors: list[str] = []
    if not settings.SECRET_KEY or len(settings.SECRET_KEY) < 32:
        errors.append("SECRET_KEY must be set and at least 32 characters long")

    if settings.DEBUG and settings.FRONTEND_URL not in (
        "http://localhost:3000", "http://localhost:5173",
    ):
        errors.append(
            "DEBUG=True must not be used in production "
            f"(non-localhost FRONTEND_URL detected: {settings.FRONTEND_URL})"
        )

    if not settings.AZURE_FACE_KEY or settings.AZURE_FACE_KEY in (
        "YOUR_AZURE_KEY_1_HERE", "changeme", "placeholder",
    ):
        errors.append("AZURE_FACE_KEY must be configured with a real key")

    for key_name in ("TOTP_ENCRYPTION_KEY", "SESSION_SECRET_ENCRYPTION_KEY"):
        val = getattr(settings, key_name, "")
        if val and len(val) < 44:
            errors.append(f"{key_name} must be a valid Fernet key (44 base64 chars)")
        if not settings.DEBUG and not val:
            errors.append(f"{key_name} must be set in production (DEBUG=False)")

    # Asymmetric JWT: require matching key paths when ALGORITHM is non-symmetric.
    alg = (settings.ALGORITHM or "HS256").upper()
    if not alg.startswith("HS"):
        if not settings.JWT_PRIVATE_KEY_PATH or not settings.JWT_PUBLIC_KEY_PATH:
            errors.append(
                f"ALGORITHM={alg} requires JWT_PRIVATE_KEY_PATH and JWT_PUBLIC_KEY_PATH"
            )

    if errors:
        for e in errors:
            logger.critical("🚨 SECURITY CONFIG ERROR: %s", e)
        raise RuntimeError(
            "Security configuration invalid: " + "; ".join(errors)
        )
    logger.info("✅ Security configuration validated.")


# Optional-integration startup warnings (#105, #106, #107) — features
# silently degrade when these keys are blank; surface them loudly so an
# operator notices BEFORE users start hitting broken endpoints.
def _warn_optional_integrations():
    is_prod = not settings.DEBUG

    def _warn(missing: str, message: str):
        # In production these are real outages → ERROR; in DEBUG mode they
        # are expected (no real keys yet) → INFO.
        (logger.error if is_prod else logger.info)(
            "⚠️  %s missing — %s", missing, message
        )

    if not settings.NEWS_API_KEY:
        _warn(
            "NEWS_API_KEY",
            "News Feed will return an empty list (cards will show a "
            "'feed unavailable' banner instead of crashing).",
        )

    if not settings.AGORA_APP_ID or not settings.AGORA_APP_CERTIFICATE:
        _warn(
            "AGORA_APP_ID/CERTIFICATE",
            "ClassPulse live sessions will fail at /live/token — joining "
            "a live class will return HTTP 503.",
        )

    if not settings.MSG91_EMAIL_DOMAIN:
        _warn(
            "MSG91_EMAIL_DOMAIN",
            "Email OTP delivery via MSG91 will be rejected by the provider "
            "(MSG91 requires the verified sending domain).",
        )

    if not settings.FAST2SMS_API_KEY:
        _warn(
            "FAST2SMS_API_KEY",
            "SMS notifications are disabled — send_sms() returns "
            "{ok:false,error:'FAST2SMS_API_KEY not configured'}.",
        )

    if not (settings.GEMINI_API_KEY or settings.GROQ_API_KEY or settings.DEEPSEEK_API_KEY):
        _warn(
            "GEMINI_API_KEY/GROQ_API_KEY/DEEPSEEK_API_KEY",
            "All AI providers unconfigured — Career Roadmap and AI "
            "suggestion endpoints will return 503.",
        )


# Logging configuration — invoked from _lifespan.
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
    # Add our single handler.
    # When LOG_FORMAT_MODE='json', emit one JSON object per record so log
    # aggregators (Datadog/CloudWatch/ELK) can parse without regex rules.
    handler = logging.StreamHandler(sys.stdout)
    if getattr(settings, "LOG_FORMAT_MODE", "text").lower() == "json":
        import json as _json
        class _JsonFormatter(logging.Formatter):
            def format(self, record):  # noqa: D401
                payload = {
                    "ts":       self.formatTime(record, "%Y-%m-%dT%H:%M:%S"),
                    "level":    record.levelname,
                    "logger":   record.name,
                    "msg":      record.getMessage(),
                }
                if record.exc_info:
                    payload["exc"] = self.formatException(record.exc_info)
                # Surface request_id when our middleware attached it.
                rid = getattr(record, "request_id", None)
                if rid:
                    payload["request_id"] = rid
                return _json.dumps(payload, default=str)
        handler.setFormatter(_JsonFormatter())
    else:
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


def _purge_old_login_attempts():
    """Hourly job: drop LoginAttemptLog rows older than 30 days."""
    from database import LoginAttemptLog
    cutoff = datetime.now(tz=timezone.utc) - timedelta(days=30)
    db = SessionLocal()
    try:
        n = db.query(LoginAttemptLog).filter(
            LoginAttemptLog.attempted_at < cutoff
        ).delete(synchronize_session=False)
        db.commit()
        if n:
            logger.info("🧹 Purged %d login_attempt_log rows older than 30 days", n)
    except Exception as exc:
        logger.error("_purge_old_login_attempts failed: %s", exc)
        db.rollback()
    finally:
        db.close()


def _daily_cleanup_tokens():
    """
    Daily 04:00 — drop short-lived auth artifacts that have served their purpose:
      * face_verify_tokens : used OR older than 1 day
      * qr_tokens          : used OR older than 7 days
      * otp_logs           : expired more than 1 day ago
    """
    from database import FaceVerifyToken, QRToken, OTPLog
    now = datetime.now(tz=timezone.utc)
    db  = SessionLocal()
    try:
        n_face = db.query(FaceVerifyToken).filter(
            (FaceVerifyToken.used == True)  # noqa: E712
            | (FaceVerifyToken.expires_at < now - timedelta(days=1))
        ).delete(synchronize_session=False)

        n_qr = db.query(QRToken).filter(
            (QRToken.is_used == True)  # noqa: E712
            | (QRToken.created_at < now - timedelta(days=7))
        ).delete(synchronize_session=False)

        n_otp = db.query(OTPLog).filter(
            OTPLog.expires_at < now - timedelta(days=1)
        ).delete(synchronize_session=False)

        db.commit()
        if n_face or n_qr or n_otp:
            logger.info("🧹 Cleaned tokens │ face=%d qr=%d otp=%d", n_face, n_qr, n_otp)
    except Exception as exc:
        logger.error("_daily_cleanup_tokens failed: %s", exc)
        db.rollback()
    finally:
        db.close()


def _purge_expired_refresh_tokens():
    """Daily job: drop expired or long-revoked refresh tokens (>30 d)."""
    from database import RefreshToken
    now    = datetime.now(tz=timezone.utc)
    cutoff = now - timedelta(days=30)
    db = SessionLocal()
    try:
        n = db.query(RefreshToken).filter(
            (RefreshToken.expires_at < now)
            | ((RefreshToken.revoked == True) & (RefreshToken.revoked_at < cutoff))  # noqa: E712
        ).delete(synchronize_session=False)
        db.commit()
        if n:
            logger.info("🧹 Purged %d refresh_tokens rows (expired or long-revoked)", n)
    except Exception as exc:
        logger.error("_purge_expired_refresh_tokens failed: %s", exc)
        db.rollback()
    finally:
        db.close()


scheduler = BackgroundScheduler()
scheduler.add_job(_auto_expire_job,              "interval", minutes=1,        id="auto_expire")
scheduler.add_job(_daily_low_attendance_alerts,  "cron",     hour=20, minute=0, id="daily_alerts")
scheduler.add_job(_purge_old_login_attempts,     "interval", hours=1,          id="purge_login_attempts")
scheduler.add_job(_purge_expired_refresh_tokens, "cron",     hour=3,  minute=0, id="purge_refresh_tokens")
scheduler.add_job(_daily_cleanup_tokens,         "cron",     hour=4,  minute=0, id="cleanup_tokens")


# ── Lifespan: start scheduler at app boot, stop cleanly on shutdown ─────
@asynccontextmanager
async def _lifespan(app: FastAPI):
    # Startup — run validators and bring up the scheduler exactly once.
    _configure_logging()
    _validate_security_config()
    _warn_optional_integrations()
    if not scheduler.running:
        scheduler.start()
        logger.info("🕒 APScheduler started (5 jobs)")
    try:
        yield
    finally:
        # Shutdown — stop scheduler so background jobs do not keep DB
        # connections / threads alive across reloads or graceful restarts.
        if scheduler.running:
            try:
                scheduler.shutdown(wait=False)
                logger.info("🛑 APScheduler shut down cleanly")
            except Exception as exc:
                logger.warning("APScheduler shutdown failed: %s", exc)
        # Dispose the SQLAlchemy engine pool too — avoids leaked
        # connections during fast deploy cycles.
        try:
            engine.dispose()
            logger.info("🛑 SQLAlchemy engine pool disposed")
        except Exception as exc:
            logger.warning("engine.dispose() failed: %s", exc)


# Bind the lifespan to the FastAPI instance now that it is defined.
app.router.lifespan_context = _lifespan

