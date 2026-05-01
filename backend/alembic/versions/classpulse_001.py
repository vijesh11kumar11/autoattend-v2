"""classpulse_001 — add ClassPulse tables (capsules, interactions, wall, resonances, access logs)

Revision ID: classpulse_001
Revises: d233e72bb7fc
Create Date: 2026-05-01 00:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = "classpulse_001"
down_revision: Union[str, None] = "d233e72bb7fc"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# Enum type names (must match SAEnum names in database.py)
CAPSULE_TYPE = sa.Enum(
    "notes", "slides", "reference", "assignment_material",
    "lab_manual", "previous_year", "formula_sheet",
    name="capsuletype",
)
CAPSULE_UNLOCK_MODE = sa.Enum(
    "always", "session_active", "after_attendance_marked", "attendance_gated",
    name="capsuleunlockmode",
)
CAPSULE_ACCESS_ACTION = sa.Enum(
    "view_attempt", "view_granted", "view_denied",
    "download_attempt", "download_granted", "download_denied",
    "quiz_start", "quiz_submit", "quiz_pass", "quiz_fail",
    name="capsuleaccessaction",
)
WALL_POST_STATUS = sa.Enum(
    "open", "answered", "resolved", "escalated",
    name="wallpoststatus",
)


def upgrade() -> None:
    bind = op.get_bind()
    CAPSULE_TYPE.create(bind, checkfirst=True)
    CAPSULE_UNLOCK_MODE.create(bind, checkfirst=True)
    CAPSULE_ACCESS_ACTION.create(bind, checkfirst=True)
    WALL_POST_STATUS.create(bind, checkfirst=True)

    # ── capsules ───────────────────────────────────────────────────
    op.create_table(
        "capsules",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("subject_id", sa.Integer(), nullable=False),
        sa.Column("teacher_id", sa.Integer(), nullable=False),
        sa.Column("section_id", sa.Integer(), nullable=True),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("capsule_type", CAPSULE_TYPE, nullable=False, server_default="notes"),
        sa.Column("file_url", sa.String(length=500), nullable=True),
        sa.Column("file_name", sa.String(length=255), nullable=True),
        sa.Column("file_size_kb", sa.Integer(), nullable=True),
        sa.Column("file_mime_type", sa.String(length=100), nullable=True),
        sa.Column("voice_memo_url", sa.String(length=500), nullable=True),
        sa.Column("voice_memo_duration_sec", sa.Integer(), nullable=True),
        sa.Column("ai_summary", sa.Text(), nullable=True),
        sa.Column("ai_quiz_json", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("ai_processed", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("unlock_mode", CAPSULE_UNLOCK_MODE, nullable=False, server_default="always"),
        sa.Column("min_attendance_pct", sa.Float(), nullable=False, server_default="75.0"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("view_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("download_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["subject_id"], ["subjects.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["teacher_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["section_id"], ["sections.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_capsules_id"), "capsules", ["id"], unique=False)
    op.create_index("ix_capsules_subject_id", "capsules", ["subject_id"], unique=False)
    op.create_index("ix_capsules_teacher_id", "capsules", ["teacher_id"], unique=False)
    op.create_index("ix_capsules_section_id", "capsules", ["section_id"], unique=False)
    op.create_index("ix_capsules_is_active",  "capsules", ["is_active"],  unique=False)
    op.create_index("ix_capsules_created_at", "capsules", ["created_at"], unique=False)

    # ── capsule_interactions ───────────────────────────────────────
    op.create_table(
        "capsule_interactions",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("capsule_id", sa.Integer(), nullable=False),
        sa.Column("student_id", sa.Integer(), nullable=False),
        sa.Column("first_opened_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_opened_at",  sa.DateTime(timezone=True), nullable=True),
        sa.Column("total_time_spent_sec", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("pages_viewed", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("total_pages",  sa.Integer(), nullable=False, server_default="0"),
        sa.Column("completion_pct", sa.Float(), nullable=False, server_default="0.0"),
        sa.Column("quiz_attempted", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("quiz_score", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("quiz_answers_json", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("quiz_passed", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("download_attempted", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("download_allowed",   sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("watermarked_url", sa.String(length=500), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["capsule_id"], ["capsules.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["student_id"], ["users.id"],    ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("capsule_id", "student_id", name="uq_capsule_interaction_capsule_student"),
    )
    op.create_index(op.f("ix_capsule_interactions_id"), "capsule_interactions", ["id"], unique=False)
    op.create_index("ix_capsule_interactions_capsule_id", "capsule_interactions", ["capsule_id"], unique=False)
    op.create_index("ix_capsule_interactions_student_id", "capsule_interactions", ["student_id"], unique=False)

    # ── class_wall_posts ───────────────────────────────────────────
    op.create_table(
        "class_wall_posts",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("subject_id", sa.Integer(), nullable=False),
        sa.Column("section_id", sa.Integer(), nullable=True),
        sa.Column("student_id", sa.Integer(), nullable=False),
        sa.Column("capsule_id", sa.Integer(), nullable=True),
        sa.Column("page_number", sa.Integer(), nullable=True),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("ai_suggested_answer", sa.Text(), nullable=True),
        sa.Column("ai_answer_confidence", sa.Float(), nullable=True),
        sa.Column("teacher_answer", sa.Text(), nullable=True),
        sa.Column("teacher_answered_by", sa.Integer(), nullable=True),
        sa.Column("teacher_answered_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("resonance_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("status", WALL_POST_STATUS, nullable=False, server_default="open"),
        sa.Column("is_hot", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("is_anonymous_to_peers", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["subject_id"], ["subjects.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["section_id"], ["sections.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["student_id"], ["users.id"],    ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["capsule_id"], ["capsules.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["teacher_answered_by"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_class_wall_posts_id"), "class_wall_posts", ["id"], unique=False)
    op.create_index("ix_class_wall_posts_subject_id", "class_wall_posts", ["subject_id"], unique=False)
    op.create_index("ix_class_wall_posts_section_id", "class_wall_posts", ["section_id"], unique=False)
    op.create_index("ix_class_wall_posts_student_id", "class_wall_posts", ["student_id"], unique=False)
    op.create_index("ix_class_wall_posts_capsule_id", "class_wall_posts", ["capsule_id"], unique=False)
    op.create_index("ix_class_wall_posts_status",     "class_wall_posts", ["status"],     unique=False)
    op.create_index("ix_class_wall_posts_is_hot",     "class_wall_posts", ["is_hot"],     unique=False)

    # ── class_wall_resonances ──────────────────────────────────────
    op.create_table(
        "class_wall_resonances",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("post_id",    sa.Integer(), nullable=False),
        sa.Column("student_id", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["post_id"],    ["class_wall_posts.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["student_id"], ["users.id"],            ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("post_id", "student_id", name="uq_class_wall_resonance_post_student"),
    )
    op.create_index(op.f("ix_class_wall_resonances_id"), "class_wall_resonances", ["id"], unique=False)
    op.create_index("ix_class_wall_resonances_post_id",    "class_wall_resonances", ["post_id"],    unique=False)
    op.create_index("ix_class_wall_resonances_student_id", "class_wall_resonances", ["student_id"], unique=False)

    # ── capsule_access_logs ────────────────────────────────────────
    op.create_table(
        "capsule_access_logs",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("capsule_id", sa.Integer(), nullable=False),
        sa.Column("user_id",    sa.Integer(), nullable=False),
        sa.Column("action", CAPSULE_ACCESS_ACTION, nullable=False),
        sa.Column("deny_reason", sa.String(length=200), nullable=True),
        sa.Column("ip_address",  sa.String(length=45),  nullable=True),
        sa.Column("user_agent",  sa.String(length=500), nullable=True),
        sa.Column("created_at",  sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["capsule_id"], ["capsules.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"],    ["users.id"],    ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_capsule_access_logs_id"), "capsule_access_logs", ["id"], unique=False)
    op.create_index("ix_capsule_access_logs_capsule_id", "capsule_access_logs", ["capsule_id"], unique=False)
    op.create_index("ix_capsule_access_logs_user_id",    "capsule_access_logs", ["user_id"],    unique=False)
    op.create_index("ix_capsule_access_logs_action",     "capsule_access_logs", ["action"],     unique=False)
    op.create_index("ix_capsule_access_logs_created_at", "capsule_access_logs", ["created_at"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_capsule_access_logs_created_at", table_name="capsule_access_logs")
    op.drop_index("ix_capsule_access_logs_action",     table_name="capsule_access_logs")
    op.drop_index("ix_capsule_access_logs_user_id",    table_name="capsule_access_logs")
    op.drop_index("ix_capsule_access_logs_capsule_id", table_name="capsule_access_logs")
    op.drop_index(op.f("ix_capsule_access_logs_id"),   table_name="capsule_access_logs")
    op.drop_table("capsule_access_logs")

    op.drop_index("ix_class_wall_resonances_student_id", table_name="class_wall_resonances")
    op.drop_index("ix_class_wall_resonances_post_id",    table_name="class_wall_resonances")
    op.drop_index(op.f("ix_class_wall_resonances_id"),   table_name="class_wall_resonances")
    op.drop_table("class_wall_resonances")

    op.drop_index("ix_class_wall_posts_is_hot",     table_name="class_wall_posts")
    op.drop_index("ix_class_wall_posts_status",     table_name="class_wall_posts")
    op.drop_index("ix_class_wall_posts_capsule_id", table_name="class_wall_posts")
    op.drop_index("ix_class_wall_posts_student_id", table_name="class_wall_posts")
    op.drop_index("ix_class_wall_posts_section_id", table_name="class_wall_posts")
    op.drop_index("ix_class_wall_posts_subject_id", table_name="class_wall_posts")
    op.drop_index(op.f("ix_class_wall_posts_id"),   table_name="class_wall_posts")
    op.drop_table("class_wall_posts")

    op.drop_index("ix_capsule_interactions_student_id", table_name="capsule_interactions")
    op.drop_index("ix_capsule_interactions_capsule_id", table_name="capsule_interactions")
    op.drop_index(op.f("ix_capsule_interactions_id"),   table_name="capsule_interactions")
    op.drop_table("capsule_interactions")

    op.drop_index("ix_capsules_created_at", table_name="capsules")
    op.drop_index("ix_capsules_is_active",  table_name="capsules")
    op.drop_index("ix_capsules_section_id", table_name="capsules")
    op.drop_index("ix_capsules_teacher_id", table_name="capsules")
    op.drop_index("ix_capsules_subject_id", table_name="capsules")
    op.drop_index(op.f("ix_capsules_id"),   table_name="capsules")
    op.drop_table("capsules")

    bind = op.get_bind()
    WALL_POST_STATUS.drop(bind, checkfirst=True)
    CAPSULE_ACCESS_ACTION.drop(bind, checkfirst=True)
    CAPSULE_UNLOCK_MODE.drop(bind, checkfirst=True)
    CAPSULE_TYPE.drop(bind, checkfirst=True)
