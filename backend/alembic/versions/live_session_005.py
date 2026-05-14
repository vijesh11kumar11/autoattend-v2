"""live_session_005 — ClassPulse F02/F03/F09 tables (PROMPT V5)

Revision ID: live_session_005
Revises: live_session_004
Create Date: 2026-05-14 09:00:00.000000

Adds the four tables introduced by Prompt Sets 8–10 of the ClassPulse
Live rollout. F10 (breakout rooms) reuses the existing
``live_session_breakout_rooms`` table introduced in earlier migrations,
so nothing new is needed here for that feature.

New tables:
  * live_engagement_snapshots   — per-minute classroom engagement %
  * live_student_engagement     — per-student heartbeat / activity counters
  * live_ai_interventions       — AI "raises hand" coach prompts
  * live_session_bookmarks      — auto + manual recording chapter markers
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "live_session_005"
down_revision: Union[str, None] = "live_session_004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── live_engagement_snapshots ────────────────────────────────────────
    op.create_table(
        "live_engagement_snapshots",
        sa.Column("id",              sa.Integer(),  primary_key=True),
        sa.Column("session_id",      sa.Integer(),  sa.ForeignKey("live_sessions.id", ondelete="CASCADE"), nullable=False),
        sa.Column("recorded_at",     sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("elapsed_mins",    sa.Integer(),  nullable=True),
        sa.Column("total_students",  sa.Integer(),  nullable=True),
        sa.Column("active_students", sa.Integer(),  nullable=True),
        sa.Column("engagement_pct",  sa.Float(),    nullable=True),
        sa.Column("event_label",     sa.String(120), nullable=True),
    )
    op.create_index("ix_les_session_id",  "live_engagement_snapshots", ["session_id"])
    op.create_index("ix_les_recorded_at", "live_engagement_snapshots", ["recorded_at"])

    # ── live_student_engagement ──────────────────────────────────────────
    op.create_table(
        "live_student_engagement",
        sa.Column("id",              sa.Integer(), primary_key=True),
        sa.Column("session_id",      sa.Integer(), sa.ForeignKey("live_sessions.id",                ondelete="CASCADE"), nullable=False),
        sa.Column("student_id",      sa.Integer(), sa.ForeignKey("users.id",                         ondelete="SET NULL"), nullable=True),
        sa.Column("participant_id",  sa.Integer(), sa.ForeignKey("live_session_participants.id",    ondelete="SET NULL"), nullable=True),
        sa.Column("heartbeat_count", sa.Integer(), server_default="0", nullable=False),
        sa.Column("last_active_at",  sa.DateTime(timezone=True), nullable=True),
        sa.Column("response_count",  sa.Integer(), server_default="0", nullable=False),
        sa.Column("doubt_count",     sa.Integer(), server_default="0", nullable=False),
        sa.Column("engagement_label", sa.String(50), nullable=True),
        sa.UniqueConstraint("session_id", "student_id",     name="uq_session_student_engagement"),
        sa.UniqueConstraint("session_id", "participant_id", name="uq_session_participant_engagement"),
    )

    # ── live_ai_interventions ────────────────────────────────────────────
    op.create_table(
        "live_ai_interventions",
        sa.Column("id",            sa.Integer(), primary_key=True),
        sa.Column("session_id",    sa.Integer(), sa.ForeignKey("live_sessions.id", ondelete="CASCADE"), nullable=False),
        sa.Column("int_type",      sa.String(50), nullable=True),
        sa.Column("message",       sa.Text(),     nullable=True),
        sa.Column("suggestion",    sa.Text(),     nullable=True),
        sa.Column("severity",      sa.String(20), nullable=True),
        sa.Column("action_taken",  sa.String(80), nullable=True),
        sa.Column("elapsed_mins",  sa.Integer(),  nullable=True),
        sa.Column("created_at",    sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_lai_session_id", "live_ai_interventions", ["session_id"])

    # ── live_session_bookmarks ───────────────────────────────────────────
    op.create_table(
        "live_session_bookmarks",
        sa.Column("id",            sa.Integer(), primary_key=True),
        sa.Column("session_id",    sa.Integer(), sa.ForeignKey("live_sessions.id", ondelete="CASCADE"), nullable=False),
        sa.Column("elapsed_secs",  sa.Integer(),  nullable=True),
        sa.Column("elapsed_mins",  sa.Integer(),  nullable=True),
        sa.Column("bookmark_type", sa.String(50), nullable=True),
        sa.Column("title",         sa.String(200), nullable=True),
        sa.Column("description",   sa.Text(),     nullable=True),
        sa.Column("added_by",      sa.String(20), server_default="ai", nullable=False),
        sa.Column("recording_url", sa.String(500), nullable=True),
        sa.Column("created_at",    sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_lsb_session_id",   "live_session_bookmarks", ["session_id"])
    op.create_index("ix_lsb_elapsed_secs", "live_session_bookmarks", ["elapsed_secs"])


def downgrade() -> None:
    op.drop_index("ix_lsb_elapsed_secs", table_name="live_session_bookmarks")
    op.drop_index("ix_lsb_session_id",   table_name="live_session_bookmarks")
    op.drop_table("live_session_bookmarks")

    op.drop_index("ix_lai_session_id", table_name="live_ai_interventions")
    op.drop_table("live_ai_interventions")

    op.drop_table("live_student_engagement")

    op.drop_index("ix_les_recorded_at", table_name="live_engagement_snapshots")
    op.drop_index("ix_les_session_id",  table_name="live_engagement_snapshots")
    op.drop_table("live_engagement_snapshots")
