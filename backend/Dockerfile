# syntax=docker/dockerfile:1.7
# ──────────────────────────────────────────────────────────────────────
# AutoAttend AI — backend container
# ──────────────────────────────────────────────────────────────────────
# Build:  docker build -t autoattend-backend ./backend
# Run:    docker run --rm -p 8000:8000 --env-file backend/.env autoattend-backend
# ──────────────────────────────────────────────────────────────────────

FROM python:3.12-slim AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# System deps required by psycopg2-binary, cryptography, pillow, dlib (face),
# and tini for proper PID-1 signal forwarding.
RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential \
        libpq-dev \
        libjpeg-dev \
        zlib1g-dev \
        tini \
        curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install python deps first so they cache across code-only rebuilds.
COPY requirements.txt ./
RUN pip install --upgrade pip && pip install -r requirements.txt

# Copy application source.
COPY . .

# Create a non-root user (rootless container best practice).
RUN useradd --create-home --shell /usr/sbin/nologin app \
 && chown -R app:app /app
USER app

EXPOSE 8000

# Health check the operator can rely on for orchestrator readiness probes.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1:8000/health || exit 1

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
