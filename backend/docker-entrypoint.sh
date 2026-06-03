#!/bin/sh
# ──────────────────────────────────────────────────────────────────────
# AutoAttend backend container entrypoint.
#
# Applies any pending Alembic migrations (idempotent — "alembic upgrade
# head" is a no-op when the schema is already current) and then execs the
# server process so it becomes PID 1's child for correct signal handling.
#
# Set RUN_MIGRATIONS=false to skip the migration step (e.g. when a separate
# one-shot job owns schema changes).
# ──────────────────────────────────────────────────────────────────────
set -e

if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
  echo "[entrypoint] Applying database migrations (alembic upgrade head)..."
  alembic upgrade head
else
  echo "[entrypoint] RUN_MIGRATIONS=false — skipping migrations."
fi

echo "[entrypoint] Starting: $*"
exec "$@"
