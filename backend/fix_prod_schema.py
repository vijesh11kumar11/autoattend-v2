"""
fix_prod_schema.py — adds columns that are missing from the production DB
because multi-tenant / soft-delete migrations were never applied there.

Safe to run multiple times: every ALTER uses IF NOT EXISTS.

Run AFTER:  alembic stamp head
Then run:   python seed_friends_test.py

Usage:
    DATABASE_URL_SYNC="postgresql+psycopg2://..." python fix_prod_schema.py
"""
import os, sys
sys.path.insert(0, os.path.dirname(__file__))

from sqlalchemy import create_engine, text
from config import settings

DB_URL = settings.DATABASE_URL_SYNC
engine = create_engine(DB_URL)

FIXES = [
    # ── colleges ──────────────────────────────────────────────────────
    "ALTER TABLE colleges ADD COLUMN IF NOT EXISTS domain         VARCHAR(255) UNIQUE",
    "ALTER TABLE colleges ADD COLUMN IF NOT EXISTS college_code   VARCHAR(64)  UNIQUE",
    "ALTER TABLE colleges ADD COLUMN IF NOT EXISTS plan           VARCHAR(20)  NOT NULL DEFAULT 'trial'",
    "ALTER TABLE colleges ADD COLUMN IF NOT EXISTS status         VARCHAR(20)  NOT NULL DEFAULT 'active'",
    "ALTER TABLE colleges ADD COLUMN IF NOT EXISTS is_deleted     BOOLEAN      NOT NULL DEFAULT FALSE",
    "ALTER TABLE colleges ADD COLUMN IF NOT EXISTS deleted_at     TIMESTAMPTZ",

    # ── departments ───────────────────────────────────────────────────
    "ALTER TABLE departments ADD COLUMN IF NOT EXISTS is_deleted  BOOLEAN NOT NULL DEFAULT FALSE",
    "ALTER TABLE departments ADD COLUMN IF NOT EXISTS deleted_at  TIMESTAMPTZ",

    # ── courses ───────────────────────────────────────────────────────
    "ALTER TABLE courses ADD COLUMN IF NOT EXISTS college_id      INTEGER REFERENCES colleges(id) ON DELETE CASCADE",
    "ALTER TABLE courses ADD COLUMN IF NOT EXISTS is_deleted      BOOLEAN NOT NULL DEFAULT FALSE",
    "ALTER TABLE courses ADD COLUMN IF NOT EXISTS deleted_at      TIMESTAMPTZ",

    # ── sections ──────────────────────────────────────────────────────
    "ALTER TABLE sections ADD COLUMN IF NOT EXISTS college_id     INTEGER REFERENCES colleges(id) ON DELETE CASCADE",
    "ALTER TABLE sections ADD COLUMN IF NOT EXISTS is_deleted     BOOLEAN NOT NULL DEFAULT FALSE",
    "ALTER TABLE sections ADD COLUMN IF NOT EXISTS deleted_at     TIMESTAMPTZ",

    # ── subjects ──────────────────────────────────────────────────────
    "ALTER TABLE subjects ADD COLUMN IF NOT EXISTS college_id     INTEGER REFERENCES colleges(id) ON DELETE CASCADE",
    "ALTER TABLE subjects ADD COLUMN IF NOT EXISTS is_deleted     BOOLEAN NOT NULL DEFAULT FALSE",
    "ALTER TABLE subjects ADD COLUMN IF NOT EXISTS deleted_at     TIMESTAMPTZ",

    # ── users ─────────────────────────────────────────────────────────
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS is_deleted            BOOLEAN NOT NULL DEFAULT FALSE",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at            TIMESTAMPTZ",
    # from 763bc9ff866d_add_totp_fail_face_auth_password_.py
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_fail_count       INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_locked_until     TIMESTAMPTZ",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS face_auth_enabled     BOOLEAN NOT NULL DEFAULT FALSE",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS password_changed_at  TIMESTAMPTZ",
    # from a3f7b2c91d04_add_push_token_to_users.py
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS push_token            VARCHAR(500)",
    # from b7c3d9e4f521_security_lockout_refresh_gps_tables.py
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS login_fail_count      INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS login_locked_until    TIMESTAMPTZ",

    # ── timetable ─────────────────────────────────────────────────────
    "ALTER TABLE timetable ADD COLUMN IF NOT EXISTS college_id    INTEGER REFERENCES colleges(id) ON DELETE CASCADE",
    "ALTER TABLE timetable ADD COLUMN IF NOT EXISTS is_deleted    BOOLEAN NOT NULL DEFAULT FALSE",
    "ALTER TABLE timetable ADD COLUMN IF NOT EXISTS deleted_at    TIMESTAMPTZ",

    # ── attendance_sessions ───────────────────────────────────────────
    "ALTER TABLE attendance_sessions ADD COLUMN IF NOT EXISTS college_id   INTEGER REFERENCES colleges(id) ON DELETE CASCADE",
    "ALTER TABLE attendance_sessions ADD COLUMN IF NOT EXISTS is_deleted   BOOLEAN NOT NULL DEFAULT FALSE",
    "ALTER TABLE attendance_sessions ADD COLUMN IF NOT EXISTS deleted_at   TIMESTAMPTZ",

    # ── attendance_records ────────────────────────────────────────────
    "ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS is_deleted    BOOLEAN NOT NULL DEFAULT FALSE",
    "ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS deleted_at    TIMESTAMPTZ",

    # ── device_registry ───────────────────────────────────────────────
    "ALTER TABLE device_registry ADD COLUMN IF NOT EXISTS college_id       INTEGER REFERENCES colleges(id) ON DELETE CASCADE",
    "ALTER TABLE device_registry ADD COLUMN IF NOT EXISTS is_deleted       BOOLEAN NOT NULL DEFAULT FALSE",
    "ALTER TABLE device_registry ADD COLUMN IF NOT EXISTS deleted_at       TIMESTAMPTZ",

    # ── capsules ──────────────────────────────────────────────────────
    "ALTER TABLE capsules ADD COLUMN IF NOT EXISTS college_id              INTEGER REFERENCES colleges(id) ON DELETE CASCADE",
    "ALTER TABLE capsules ADD COLUMN IF NOT EXISTS is_deleted              BOOLEAN NOT NULL DEFAULT FALSE",
    "ALTER TABLE capsules ADD COLUMN IF NOT EXISTS deleted_at              TIMESTAMPTZ",

    # ── leave_requests ────────────────────────────────────────────────
    "ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS college_id        INTEGER REFERENCES colleges(id) ON DELETE CASCADE",
    "ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS is_deleted        BOOLEAN NOT NULL DEFAULT FALSE",
    "ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS deleted_at        TIMESTAMPTZ",
    "ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS document_s3_key   VARCHAR(500)",

    # ── tutor_assignments ─────────────────────────────────────────────
    "ALTER TABLE tutor_assignments ADD COLUMN IF NOT EXISTS college_id     INTEGER REFERENCES colleges(id) ON DELETE CASCADE",
    "ALTER TABLE tutor_assignments ADD COLUMN IF NOT EXISTS is_deleted     BOOLEAN NOT NULL DEFAULT FALSE",
    "ALTER TABLE tutor_assignments ADD COLUMN IF NOT EXISTS deleted_at     TIMESTAMPTZ",

    # ── refresh_tokens ────────────────────────────────────────────────
    "ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS college_id        INTEGER REFERENCES colleges(id) ON DELETE CASCADE",
    "ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS is_deleted        BOOLEAN NOT NULL DEFAULT FALSE",
    "ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS deleted_at        TIMESTAMPTZ",

    # ── career_roadmaps ───────────────────────────────────────────────
    "ALTER TABLE career_roadmaps ADD COLUMN IF NOT EXISTS college_id       INTEGER REFERENCES colleges(id) ON DELETE CASCADE",
    "ALTER TABLE career_roadmaps ADD COLUMN IF NOT EXISTS is_deleted       BOOLEAN NOT NULL DEFAULT FALSE",
    "ALTER TABLE career_roadmaps ADD COLUMN IF NOT EXISTS deleted_at       TIMESTAMPTZ",

    # ── suggestions ───────────────────────────────────────────────────
    "ALTER TABLE suggestions ADD COLUMN IF NOT EXISTS college_id           INTEGER REFERENCES colleges(id) ON DELETE CASCADE",
    "ALTER TABLE suggestions ADD COLUMN IF NOT EXISTS is_deleted           BOOLEAN NOT NULL DEFAULT FALSE",
    "ALTER TABLE suggestions ADD COLUMN IF NOT EXISTS deleted_at           TIMESTAMPTZ",

    # ── live_sessions ─────────────────────────────────────────────────
    "ALTER TABLE live_sessions ADD COLUMN IF NOT EXISTS college_id         INTEGER REFERENCES colleges(id) ON DELETE CASCADE",
    "ALTER TABLE live_sessions ADD COLUMN IF NOT EXISTS is_deleted         BOOLEAN NOT NULL DEFAULT FALSE",
    "ALTER TABLE live_sessions ADD COLUMN IF NOT EXISTS deleted_at         TIMESTAMPTZ",
]

INDEXES = [
    "CREATE INDEX IF NOT EXISTS ix_colleges_domain        ON colleges(domain)",
    "CREATE UNIQUE INDEX IF NOT EXISTS uq_colleges_domain ON colleges(domain)",
    "CREATE UNIQUE INDEX IF NOT EXISTS uq_colleges_code   ON colleges(college_code)",
    "CREATE INDEX IF NOT EXISTS ix_courses_college_id     ON courses(college_id)",
    "CREATE INDEX IF NOT EXISTS ix_sections_college_id    ON sections(college_id)",  # type: ignore
    "CREATE INDEX IF NOT EXISTS ix_subjects_college_id    ON subjects(college_id)",
]

with engine.connect() as conn:
    for sql in FIXES:
        try:
            conn.execute(text(sql))
            print(f"  ✅ {sql[:80]}")
        except Exception as e:
            print(f"  ⚠️  SKIP ({e.__class__.__name__}): {sql[:60]}")
    for sql in INDEXES:
        try:
            conn.execute(text(sql))
            print(f"  ✅ {sql[:80]}")
        except Exception as e:
            print(f"  ⚠️  SKIP index: {e.__class__.__name__}")
    conn.commit()

print("\n✅ Schema fix complete — run seed_friends_test.py now.\n")
