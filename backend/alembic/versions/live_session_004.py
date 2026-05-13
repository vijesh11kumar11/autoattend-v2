"""live_session_004 — add agora_uid to live_session_participants (PROMPT V4)

Revision ID: live_session_004
Revises: live_session_003
Create Date: 2026-05-13 16:30:00.000000

Adds:
  * live_session_participants.agora_uid (BigInteger, nullable)

Used by the frontend to map Agora video tiles (which only carry numeric
UIDs) back to real participant names and roles.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "live_session_004"
down_revision: Union[str, None] = "live_session_003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "live_session_participants",
        sa.Column("agora_uid", sa.BigInteger(), nullable=True),
    )
    op.create_index(
        "ix_lsp_agora_uid",
        "live_session_participants",
        ["agora_uid"],
    )


def downgrade() -> None:
    op.drop_index("ix_lsp_agora_uid", table_name="live_session_participants")
    op.drop_column("live_session_participants", "agora_uid")
