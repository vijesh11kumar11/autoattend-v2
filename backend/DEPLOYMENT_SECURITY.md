# TRACEIN — Deployment Security Checklist

This document covers production hardening for the AutoAttend AI v2.0
backend (FastAPI on Render) and database (PostgreSQL).

> Audience: ops / deployment lead.
> Status: living document — update on every infra change.

---

## 1. Secrets & environment

All secrets live in `.env` on the Render service (never committed). On any
host that holds a copy of `.env`:

```bash
chmod 600 .env
chown app_user:app_user .env
```

Required production keys (check `config.py` for the full list):

| Variable                          | Notes                                                  |
| --------------------------------- | ------------------------------------------------------ |
| `SECRET_KEY`                      | ≥ 32 random bytes. Used to sign JWT access tokens.     |
| `DATABASE_URL`                    | Must use TLS (`sslmode=require`).                      |
| `TOTP_ENCRYPTION_KEY`             | 44-char Fernet key. Generated via `Fernet.generate_key()`. |
| `SESSION_SECRET_ENCRYPTION_KEY`   | 44-char Fernet key for `qr_secret` / `bluetooth_token`. |
| `AZURE_FACE_KEY`                  | Real Azure Cognitive Services key.                     |
| `COOKIE_SECURE`                   | `True` in prod.                                        |
| `COOKIE_SAMESITE`                 | `strict` (or `none` only if Vercel and Render are on different sites). |
| `DEBUG`                           | `False` in prod.                                       |

### Secret rotation cadence

| Secret                          | Rotate every | On compromise |
| ------------------------------- | ------------ | ------------- |
| `SECRET_KEY` (JWT)              | 90 days      | Immediately. All access tokens invalidated; users must reauthenticate. |
| `TOTP_ENCRYPTION_KEY`           | 365 days     | Run dual-key migration: decrypt with old, re-encrypt with new. |
| `SESSION_SECRET_ENCRYPTION_KEY` | 365 days     | Same dual-key flow; or wait for sessions to expire (≤ 24h). |
| `AZURE_FACE_KEY`                | 90 days      | Rotate via Azure portal, swap env, restart service. |
| Database password               | 180 days     | Rotate immediately, push new `DATABASE_URL`. |
| Refresh tokens                  | Auto (7 days) | Bulk revoke via `revoke_all_refresh_tokens()` admin script. |

---

## 2. Database hardening

### 2.1 Restricted application user

Do **not** connect the app with a superuser. Create a least-privilege role:

```sql
-- Run as superuser, one time
CREATE ROLE traceln_app WITH LOGIN PASSWORD '<strong-random>';

-- Schema access
GRANT CONNECT ON DATABASE traceln_prod TO traceln_app;
GRANT USAGE   ON SCHEMA public        TO traceln_app;

-- Table privileges (no DDL, no GRANT)
GRANT SELECT, INSERT, UPDATE, DELETE
  ON ALL TABLES    IN SCHEMA public TO traceln_app;
GRANT USAGE, SELECT
  ON ALL SEQUENCES IN SCHEMA public TO traceln_app;

-- Apply to future tables (Alembic migrations)
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES   TO traceln_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT                  ON SEQUENCES TO traceln_app;

-- Explicitly deny destructive grants
REVOKE CREATE ON SCHEMA public FROM traceln_app;
```

A separate `traceln_migrator` role with DDL privileges is used **only**
when running `alembic upgrade head` during deploys.

### 2.2 Encrypted backups

* Render/managed PG: enable point-in-time recovery + daily snapshots.
* Manual `pg_dump` copies must be encrypted at rest:

  ```bash
  pg_dump "$DATABASE_URL" \
    | gzip \
    | gpg --symmetric --cipher-algo AES256 --batch --passphrase-file ~/.bk_pass \
    > "backup-$(date +%F).sql.gz.gpg"
  chmod 600 backup-*.sql.gz.gpg
  ```

* Backups stored off-site (S3 with SSE-KMS, bucket policy `aws:SecureTransport`).
* Retention: 30 days hot, 1 year cold.
* Quarterly restore drill into a staging DB.

### 2.3 Network

* DB accepts connections only from Render egress IPs (or private network).
* `pg_hba.conf` requires `hostssl ... scram-sha-256`.
* No public listener.

---

## 3. Field-level encryption

The following columns are stored encrypted with Fernet
(`SESSION_SECRET_ENCRYPTION_KEY`) — see `backend/utils/crypto_utils.py`:

* `attendance_sessions.qr_secret`
* `attendance_sessions.bluetooth_token`
* `users.totp_secret` (separate key: `TOTP_ENCRYPTION_KEY`)

Legacy plaintext rows are read transparently (decrypt falls back to the
stored value on `InvalidToken`). Run the one-time migration script
`backend/scripts/encrypt_session_secrets.py` during a maintenance window
to re-encrypt historical data.

---

## 4. Application hardening (already enforced in code)

| Control                          | Where                                          |
| -------------------------------- | ---------------------------------------------- |
| Password hashing                 | Argon2 (`utils/auth_utils.py`)                 |
| Account lockout                  | 5 failures → 15 min (`utils/auth_utils.py`)    |
| TOTP lockout                     | 5 failures → 15 min                            |
| Refresh-token rotation           | Reuse detection chain-revokes (`routes/auth.py`) |
| Cookie flags                     | `Secure; HttpOnly; SameSite` (config)          |
| Security headers                 | CSP, X-Frame-Options, HSTS (`main.py`)         |
| Rate limiting                    | slowapi on auth + refresh                      |
| GPS spoof rejection              | Mock flag + accuracy + velocity check          |
| BLE token rotation               | 30-second HMAC window                          |
| User-content sanitization        | `bleach.clean` on feed/suggestions/classpulse  |

---

## 5. Logging & monitoring

* Application logs → Render log drain.
* Security events → `logs/security_events.jsonl` (also mirrored to
  `security_events` table — see `utils/security_logger.py`).
* `CRITICAL` events alert on-call (configure via Render notifications or
  external SIEM).

Retention:
* `login_attempt_log`: 30 days (purge job).
* `security_events`: 1 year (DB).
* `refresh_tokens`: until expiry + 30 days.

---

## 6. Incident response quick reference

| Scenario                       | Action                                            |
| ------------------------------ | ------------------------------------------------- |
| Suspected token compromise     | Rotate `SECRET_KEY`, restart, force re-login.     |
| User account takeover          | `revoke_all_refresh_tokens(user_id)`, reset pwd.  |
| DB credential leak             | Rotate DB password, push new `DATABASE_URL`.      |
| Mass GPS spoofing detected     | Query `security_events` where `event_type='GPS_SPOOFING_DETECTED'`. |
| Lost encryption key            | Rows become unrecoverable — restore from backup.  |

---

_Last reviewed: 2025-01_
