"""Add smart_replay_clips table (Smart Replay — issue #118).

Stores student doubt → AI-identified timeline segment for completed
live sessions. Records are pruned after 30 days by a weekly scheduler job.

Revision ID: b2c3d4e5f6a7
Revises:     a9b1c2d3e4f5
Create Date: 2026-05-30
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "b2c3d4e5f6a7"
down_revision: Union[str, None] = "a9b1c2d3e4f5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _has_table(bind, table: str) -> bool:
    try:
        return sa.inspect(bind).has_table(table)
    except Exception:
        return False


def upgrade() -> None:
    bind = op.get_bind()
    if _has_table(bind, "smart_replay_clips"):
        return

    op.create_table(
        "smart_replay_clips",
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column("session_id", sa.Integer(), nullable=False),
        sa.Column("student_id", sa.Integer(), nullable=False),
        sa.Column("topic", sa.String(length=300), nullable=False),
        sa.Column("doubt_text", sa.Text(), nullable=True),
        sa.Column("start_offset_seconds", sa.Integer(), nullable=True),
        sa.Column("end_offset_seconds", sa.Integer(), nullable=True),
        sa.Column("ai_confidence", sa.Float(), nullable=True),
        sa.Column("ai_explanation", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        # Soft-delete + tenant columns (SoftDeleteMixin / TenantMixin)
        sa.Column(
            "is_deleted",
            sa.Boolean(),
            server_default=sa.text("false"),
            nullable=False,
        ),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("college_id", sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(
            ["session_id"], ["live_sessions.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["student_id"], ["users.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["college_id"], ["colleges.id"], ondelete="CASCADE"
        ),
    )
    op.create_index("ix_src_session_id", "smart_replay_clips", ["session_id"])
    op.create_index("ix_src_student_id", "smart_replay_clips", ["student_id"])
    op.create_index("ix_src_created_at", "smart_replay_clips", ["created_at"])
    op.create_index(
        "ix_smart_replay_clips_college_id", "smart_replay_clips", ["college_id"]
    )


def downgrade() -> None:
    bind = op.get_bind()
    if not _has_table(bind, "smart_replay_clips"):
        return
    op.drop_index("ix_smart_replay_clips_college_id", table_name="smart_replay_clips")
    op.drop_index("ix_src_created_at", table_name="smart_replay_clips")
    op.drop_index("ix_src_student_id", table_name="smart_replay_clips")
    op.drop_index("ix_src_session_id", table_name="smart_replay_clips")
    op.drop_table("smart_replay_clips")
