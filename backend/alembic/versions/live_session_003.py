"""live_session_003 — auto-generated capsule fields (PROMPT 6)

Revision ID: live_session_003
Revises: live_session_002
Create Date: 2026-05-13 14:00:00.000000

Adds to `capsules`:
  * is_auto_generated      (boolean, default false)
  * source_live_session_id (FK -> live_sessions.id)
  * chapters               (jsonb)
  * student_specific_notes (jsonb)
  * homework_suggestion    (text)
  * recording_url          (varchar 500)
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "live_session_003"
down_revision: Union[str, None] = "live_session_002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "capsules",
        sa.Column("is_auto_generated", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column(
        "capsules",
        sa.Column("source_live_session_id", sa.Integer(), nullable=True),
    )
    op.add_column("capsules", sa.Column("chapters",               postgresql.JSONB(), nullable=True))
    op.add_column("capsules", sa.Column("student_specific_notes", postgresql.JSONB(), nullable=True))
    op.add_column("capsules", sa.Column("homework_suggestion",    sa.Text(),          nullable=True))
    op.add_column("capsules", sa.Column("recording_url",          sa.String(length=500), nullable=True))

    op.create_foreign_key(
        "fk_capsules_source_live_session_id",
        source_table="capsules",
        referent_table="live_sessions",
        local_cols=["source_live_session_id"],
        remote_cols=["id"],
        ondelete="SET NULL",
    )
    op.create_index(
        "ix_capsules_source_live_session_id",
        "capsules",
        ["source_live_session_id"],
    )
    op.create_index(
        "ix_capsules_is_auto_generated",
        "capsules",
        ["is_auto_generated"],
    )
    # drop server default now rows are populated
    op.alter_column("capsules", "is_auto_generated", server_default=None)


def downgrade() -> None:
    op.drop_index("ix_capsules_is_auto_generated", table_name="capsules")
    op.drop_index("ix_capsules_source_live_session_id", table_name="capsules")
    op.drop_constraint("fk_capsules_source_live_session_id", "capsules", type_="foreignkey")
    op.drop_column("capsules", "recording_url")
    op.drop_column("capsules", "homework_suggestion")
    op.drop_column("capsules", "student_specific_notes")
    op.drop_column("capsules", "chapters")
    op.drop_column("capsules", "source_live_session_id")
    op.drop_column("capsules", "is_auto_generated")
