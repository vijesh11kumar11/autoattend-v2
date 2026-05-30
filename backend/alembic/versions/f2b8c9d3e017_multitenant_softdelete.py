"""Multi-tenancy + soft-delete: add college_id, is_deleted, deleted_at

Adds soft-delete columns (is_deleted, deleted_at) to 41 tables and a
tenant-scoping college_id FK column to 38 of those tables.  The three
tables that already carry college_id (departments, users) or that ARE
the tenants table (colleges) only receive the soft-delete columns.

Columns are added as nullable / defaulted so the migration is fully
backward-compatible with live data.  Ops can backfill college_id on
legacy rows and then enable ENFORCE_TENANT_ISOLATION per environment.

Revision ID: f2b8c9d3e017
Revises: c4d8f9a1b206
Create Date: 2026-05-30 08:00:00.000000
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "f2b8c9d3e017"
down_revision: Union[str, None] = "c4d8f9a1b206"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# ── Tables that receive ONLY soft-delete cols (colleges IS the tenant table;
#    departments + users already have college_id)
_SOFT_ONLY = [
    "colleges",
    "departments",
    "users",
]

# ── Tables that receive BOTH soft-delete cols AND college_id FK
_SOFT_AND_TENANT = [
    "courses",
    "sections",
    "subjects",
    "device_registry",
    "timetable",
    "attendance_sessions",
    "attendance_records",
    "attendance_audit",
    "alerts_log",
    "face_change_log",
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
    "capsule_access_logs",
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
]

_ALL_SOFT = _SOFT_ONLY + _SOFT_AND_TENANT


def upgrade() -> None:
    # ── Add soft-delete columns to all 41 tables ─────────────────────────
    for tbl in _ALL_SOFT:
        op.add_column(
            tbl,
            sa.Column(
                "is_deleted",
                sa.Boolean(),
                nullable=False,
                server_default=sa.text("false"),
            ),
        )
        op.add_column(
            tbl,
            sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        )

    # ── Add college_id FK + index to the 38 tenant-scoped tables ─────────
    for tbl in _SOFT_AND_TENANT:
        op.add_column(
            tbl,
            sa.Column("college_id", sa.Integer(), nullable=True),
        )
        op.create_foreign_key(
            f"fk_{tbl}_college_id",
            tbl,
            "colleges",
            ["college_id"],
            ["id"],
            ondelete="CASCADE",
        )
        op.create_index(
            f"ix_{tbl}_college_id",
            tbl,
            ["college_id"],
        )


def downgrade() -> None:
    # ── Remove college_id FK + index from the 38 tenant-scoped tables ────
    for tbl in reversed(_SOFT_AND_TENANT):
        op.drop_index(f"ix_{tbl}_college_id", table_name=tbl)
        op.drop_constraint(f"fk_{tbl}_college_id", tbl, type_="foreignkey")
        op.drop_column(tbl, "college_id")

    # ── Remove soft-delete columns from all 41 tables ────────────────────
    for tbl in reversed(_ALL_SOFT):
        op.drop_column(tbl, "deleted_at")
        op.drop_column(tbl, "is_deleted")
