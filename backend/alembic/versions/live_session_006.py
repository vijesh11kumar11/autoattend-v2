"""live_session_006 — pulse_checks (live), observations, mastery, warmups

Revision ID: live_session_006
Revises: live_session_005
Create Date: 2026-05-14 11:00:00.000000

Closes the migration coverage gap discovered during the PS12 audit.
The following models had been declared in ``database.py`` but never
materialised by an Alembic revision (they were only being created by
``Base.metadata.create_all`` during dev startup):

  * live_pulse_checks
  * live_pulse_responses
  * live_session_observations
  * student_topic_mastery
  * student_preclass_warmups

This revision creates all of them so a fresh ``alembic upgrade head``
on an empty database produces a fully working schema.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "live_session_006"
down_revision: Union[str, None] = "live_session_005"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── live_pulse_checks ────────────────────────────────────────────────
    op.create_table(
        "live_pulse_checks",
        sa.Column("id",              sa.Integer(),  primary_key=True),
        sa.Column("live_session_id", sa.Integer(),  sa.ForeignKey("live_sessions.id", ondelete="CASCADE"), nullable=False),
        sa.Column("question",        sa.String(500), nullable=False),
        sa.Column("option_a",        sa.String(200), nullable=False),
        sa.Column("option_b",        sa.String(200), nullable=False),
        sa.Column("option_c",        sa.String(200), nullable=False),
        sa.Column("option_d",        sa.String(200), nullable=False),
        sa.Column("correct_option",  sa.String(1),   nullable=True),
        sa.Column("duration_secs",   sa.Integer(),   server_default="30", nullable=False),
        sa.Column("sent_at",         sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("closed_at",       sa.DateTime(timezone=True), nullable=True),
        sa.Column("is_active",       sa.Boolean(),   server_default=sa.text("true"), nullable=False),
        sa.Column("ai_insight",      sa.Text(),      nullable=True),
        sa.Column("total_responses", sa.Integer(),   server_default="0", nullable=False),
        sa.Column("correct_count",   sa.Integer(),   server_default="0", nullable=False),
        sa.Column("option_a_count",  sa.Integer(),   server_default="0", nullable=False),
        sa.Column("option_b_count",  sa.Integer(),   server_default="0", nullable=False),
        sa.Column("option_c_count",  sa.Integer(),   server_default="0", nullable=False),
        sa.Column("option_d_count",  sa.Integer(),   server_default="0", nullable=False),
    )
    op.create_index("ix_live_pulse_checks_session_id", "live_pulse_checks", ["live_session_id"])

    # ── live_pulse_responses ────────────────────────────────────────────
    op.create_table(
        "live_pulse_responses",
        sa.Column("id",              sa.Integer(),  primary_key=True),
        sa.Column("pulse_id",        sa.Integer(),  sa.ForeignKey("live_pulse_checks.id",            ondelete="CASCADE"), nullable=False),
        sa.Column("live_session_id", sa.Integer(),  sa.ForeignKey("live_sessions.id",                ondelete="CASCADE"), nullable=False),
        sa.Column("participant_id",  sa.Integer(),  sa.ForeignKey("live_session_participants.id",   ondelete="SET NULL"), nullable=True),
        sa.Column("student_id",      sa.Integer(),  sa.ForeignKey("users.id",                         ondelete="SET NULL"), nullable=True),
        sa.Column("guest_name",      sa.String(100), nullable=True),
        sa.Column("chosen_option",   sa.String(1),   nullable=False),
        sa.Column("is_correct",      sa.Boolean(),   nullable=True),
        sa.Column("answered_at",     sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("pulse_id", "participant_id", name="uq_live_pulse_participant"),
    )
    op.create_index("ix_live_pulse_responses_pulse_id", "live_pulse_responses", ["pulse_id"])

    # ── live_session_observations ───────────────────────────────────────
    op.create_table(
        "live_session_observations",
        sa.Column("id",              sa.Integer(),  primary_key=True),
        sa.Column("live_session_id", sa.Integer(),  sa.ForeignKey("live_sessions.id", ondelete="CASCADE"), nullable=False),
        sa.Column("obs_type",        sa.String(50), nullable=True),
        sa.Column("message",         sa.Text(),     nullable=True),
        sa.Column("suggestion",      sa.Text(),     nullable=True),
        sa.Column("severity",        sa.String(20), nullable=True),
        sa.Column("created_at",      sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("is_read",         sa.Boolean(),  server_default=sa.text("false"), nullable=False),
    )
    op.create_index("ix_live_session_observations_session_id", "live_session_observations", ["live_session_id"])
    op.create_index("ix_live_session_observations_created_at", "live_session_observations", ["created_at"])

    # ── student_topic_mastery ───────────────────────────────────────────
    op.create_table(
        "student_topic_mastery",
        sa.Column("id",              sa.Integer(),  primary_key=True),
        sa.Column("student_id",      sa.Integer(),  sa.ForeignKey("users.id",     ondelete="CASCADE"), nullable=False),
        sa.Column("subject_id",      sa.Integer(),  sa.ForeignKey("subjects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("topic",           sa.String(200), nullable=False),
        sa.Column("mastery_pct",     sa.Float(),     server_default="50", nullable=False),
        sa.Column("sessions_seen",   sa.Integer(),   server_default="0",  nullable=False),
        sa.Column("last_updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("student_id", "subject_id", "topic", name="uq_student_topic"),
    )
    op.create_index("ix_student_topic_mastery_student_id", "student_topic_mastery", ["student_id"])
    op.create_index("ix_student_topic_mastery_subject_id", "student_topic_mastery", ["subject_id"])

    # ── student_preclass_warmups ────────────────────────────────────────
    op.create_table(
        "student_preclass_warmups",
        sa.Column("id",           sa.Integer(),  primary_key=True),
        sa.Column("student_id",   sa.Integer(),  sa.ForeignKey("users.id",          ondelete="CASCADE"), nullable=False),
        sa.Column("session_id",   sa.Integer(),  sa.ForeignKey("live_sessions.id", ondelete="CASCADE"), nullable=False),
        sa.Column("subject_id",   sa.Integer(),  sa.ForeignKey("subjects.id",      ondelete="CASCADE"), nullable=False),
        sa.Column("warmup_type",  sa.String(50), nullable=True),
        sa.Column("content",      sa.Text(),     nullable=True),
        sa.Column("focus_topics", postgresql.JSONB(), nullable=True),
        sa.Column("is_sent",      sa.Boolean(),  server_default=sa.text("false"), nullable=False),
        sa.Column("created_at",   sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("student_id", "session_id", name="uq_student_preclass_warmup"),
    )
    op.create_index("ix_student_preclass_warmups_student_id", "student_preclass_warmups", ["student_id"])
    op.create_index("ix_student_preclass_warmups_session_id", "student_preclass_warmups", ["session_id"])


def downgrade() -> None:
    op.drop_index("ix_student_preclass_warmups_session_id", table_name="student_preclass_warmups")
    op.drop_index("ix_student_preclass_warmups_student_id", table_name="student_preclass_warmups")
    op.drop_table("student_preclass_warmups")

    op.drop_index("ix_student_topic_mastery_subject_id", table_name="student_topic_mastery")
    op.drop_index("ix_student_topic_mastery_student_id", table_name="student_topic_mastery")
    op.drop_table("student_topic_mastery")

    op.drop_index("ix_live_session_observations_created_at", table_name="live_session_observations")
    op.drop_index("ix_live_session_observations_session_id", table_name="live_session_observations")
    op.drop_table("live_session_observations")

    op.drop_index("ix_live_pulse_responses_pulse_id", table_name="live_pulse_responses")
    op.drop_table("live_pulse_responses")

    op.drop_index("ix_live_pulse_checks_session_id", table_name="live_pulse_checks")
    op.drop_table("live_pulse_checks")
