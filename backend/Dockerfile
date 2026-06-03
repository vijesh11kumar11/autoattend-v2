# syntax=docker/dockerfile:1.7
# ──────────────────────────────────────────────────────────────────────
# AutoAttend AI — backend container (multi-stage, non-root, prod-ready)
# ──────────────────────────────────────────────────────────────────────
# Build:  docker build -t autoattend-backend ./backend
# Run:    docker run --rm -p 8000:8000 --env-file backend/.env autoattend-backend
# ──────────────────────────────────────────────────────────────────────

# ── Stage 1: builder — install dependencies into an isolated venv ──
FROM python:3.12-slim AS builder

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    VIRTUAL_ENV=/opt/venv \
    PATH="/opt/venv/bin:$PATH"

# Build-time system deps (kept out of the final image).
RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential \
        libpq-dev \
        libjpeg-dev \
        zlib1g-dev \
    && rm -rf /var/lib/apt/lists/*

# Self-contained virtualenv that we copy into the runtime stage.
RUN python -m venv "$VIRTUAL_ENV"

WORKDIR /app
COPY requirements.txt ./
RUN pip install --upgrade pip && pip install -r requirements.txt

# ── Stage 2: runtime — slim image with only what's needed to run ──
FROM python:3.12-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    VIRTUAL_ENV=/opt/venv \
    PATH="/opt/venv/bin:$PATH" \
    WEB_CONCURRENCY=2

# Runtime-only system deps: libpq for psycopg2, tini for PID-1 signal
# forwarding, curl for the health check.
RUN apt-get update && apt-get install -y --no-install-recommends \
        libpq5 \
        tini \
        curl \
    && rm -rf /var/lib/apt/lists/*

# Bring over the pre-built virtualenv from the builder stage.
COPY --from=builder /opt/venv /opt/venv

WORKDIR /app

# Copy application source.
COPY . .

# Ensure the entrypoint is executable (git may not preserve +x on all hosts).
RUN chmod +x /app/docker-entrypoint.sh

# Create a non-root user (rootless container best practice).
RUN useradd --create-home --shell /usr/sbin/nologin app \
 && chown -R app:app /app
USER app

EXPOSE 8000

# Health check the operator can rely on for orchestrator readiness probes.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1:8000/api/health || exit 1

# tini → entrypoint (applies migrations) → server. WEB_CONCURRENCY controls the
# uvicorn worker count (default 2); override per host CPU allocation.
ENTRYPOINT ["/usr/bin/tini", "--", "/app/docker-entrypoint.sh"]
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port 8000 --workers ${WEB_CONCURRENCY}"]
