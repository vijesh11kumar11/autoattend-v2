"""Multi-tenant (college_id) + soft-delete columns on all business tables.

Closes issues #99, #100, #101, #104.

* Adds ``college_id`` (nullable FK to ``colleges.id``, ON DELETE CASCADE)
  + matching index to every business-data table that doesn't already
  carry one. Audit / log tables are intentionally skipped.
* Adds ``is_deleted`` (BOOLEAN NOT NULL DEFAULT FALSE) and
  ``deleted_at`` (TIMESTAMPTZ NULL) to every business-data table
  including ``colleges`` itself. Pure log / audit tables are skipped.
* Uses ``batch_alter_table`` for SQLite compatibility.
* Existing rows are unaffected: ``is_deleted`` defaults to FALSE so all
  previously-visible rows stay visible after migration.

Revision ID: f2b8c9d3e017
Revises:     e1a2b3c4d5f6
Create Date: 2026-05-30
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "f2b8c9d3e017"
down_revision: Union[str, None] = "e1a2b3c4d5f6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# Tables that should receive `college_id` (and an index). Skipped:
#   - colleges           (is the tenant root)
#   - departments, users (already have college_id)
#   - security_events    (already has college_id)
#   - otp_log            (intentionally cross-tenant)
#   - attendance_audit, alerts_log, face_change_log,
#     login_attempt_log, capsule_access_logs   (audit / log tables)
#   - liveness_challenges (short-lived auth artefact, derives from user)
TENANT_TABLES = [
    "courses",
    "sections",
    "subjects",
    "device_registry",
    "timetable",
    "attendance_sessions",
    "qr_tokens",
    "face_verify_tokens",
    "attendance_records",
    "tutor_assignments",
    "twm_sessions",
    "twm_attendance",
    "leave_requests",
    "attendance_disputes",
    "career_roadmaps",
    "suggestions",
    "suggestion_ai_reports",
    "capsules",
    "capsule_interactions",
    "class_wall_posts",
    "class_wall_resonances",
    "live_sessions",
    "live_session_participants",
    "live_session_events",
    "pulse_checks",
    "live_pulse_checks",
    "live_pulse_responses",
    "live_session_observations",
    "student_topic_mastery",
    "student_preclass_warmups",
    "live_engagement_snapshots",
    "live_student_engagement",
    "live_ai_interventions",
    "live_session_bookmarks",
    "student_knowledge_graphs",
    "live_session_breakout_rooms",
    "refresh_tokens",
    "student_gps_snapshots",
]

# Tables that should receive soft-delete columns. Includes `colleges`
# (only super-admin can soft-delete a college) and excludes pure log /
# audit tables whose rows are immutable history.
SOFT_DELETE_TABLES = [
    "colleges",
    "departments",
    "users",
    "courses",
    "sections",
    "subjects",
    "device_registry",
    "timetable",
    "attendance_sessions",
    "qr_tokens",
    "face_verify_tokens",
    "attendance_records",
    "tutor_assignments",
    "twm_sessions",
    "twm_attendance",
    "leave_requests",
    "attendance_disputes",
    "career_roadmaps",
    "suggestions",
    "suggestion_ai_reports",
    "capsules",
    "capsule_interactions",
    "class_wall_posts",
    "class_wall_resonances",
    "live_sessions",
    "live_session_participants",
    "live_session_events",
    "pulse_checks",
    "live_pulse_checks",
    "live_pulse_responses",
    "live_session_observations",
    "student_topic_mastery",
    "student_preclass_warmups",
    "live_engagement_snapshots",
    "live_student_engagement",
    "live_ai_interventions",
    "live_session_bookmarks",
    "student_knowledge_graphs",
    "live_session_breakout_rooms",
    "refresh_tokens",
    "student_gps_snapshots",
    "security_events",
]


def _table_exists(bind, table_name: str) -> bool:
    # Offline mode (MockConnection) has no inspection — assume the table
    # exists so DDL is still emitted in --sql output.
    try:
        insp = sa.inspect(bind)
    except Exception:
        return True
    return table_name in insp.get_table_names()


def _column_exists(bind, table_name: str, column_name: str) -> bool:
    try:
        insp = sa.inspect(bind)
    except Exception:
        return False
    try:
        return any(c["name"] == column_name for c in insp.get_columns(table_name))
    except Exception:
        return False


def upgrade() -> None:
    bind = op.get_bind()

    # 1) college_id + index ────────────────────────────────────────────
    for table in TENANT_TABLES:
        if not _table_exists(bind, table):
            continue
        if _column_exists(bind, table, "college_id"):
            continue
        with op.batch_alter_table(table) as batch:
            batch.add_column(
                sa.Column(
                    "college_id",
                    sa.Integer(),
                    sa.ForeignKey("colleges.id", ondelete="CASCADE"),
                    nullable=True,
                )
            )
        op.create_index(
            f"ix_{table}_college_id",
            table,
            ["college_id"],
            unique=False,
        )

    # 2) is_deleted + deleted_at ───────────────────────────────────────
    for table in SOFT_DELETE_TABLES:
        if not _table_exists(bind, table):
            continue
        with op.batch_alter_table(table) as batch:
            if not _column_exists(bind, table, "is_deleted"):
                batch.add_column(
                    sa.Column(
                        "is_deleted",
                        sa.Boolean(),
                        nullable=False,
                        server_default=sa.text("false"),
                    )
                )
            if not _column_exists(bind, table, "deleted_at"):
                batch.add_column(
                    sa.Column(
                        "deleted_at",
                        sa.DateTime(timezone=True),
                        nullable=True,
                    )
                )


def downgrade() -> None:
    # Reverse order: drop soft-delete first, then college_id.
    for table in SOFT_DELETE_TABLES:
        try:
            with op.batch_alter_table(table) as batch:
                batch.drop_column("deleted_at")
                batch.drop_column("is_deleted")
        except Exception:
            pass

    for table in TENANT_TABLES:
        try:
            op.drop_index(f"ix_{table}_college_id", table_name=table)
        except Exception:
            pass
        try:
            with op.batch_alter_table(table) as batch:
                batch.drop_column("college_id")
        except Exception:
            pass
