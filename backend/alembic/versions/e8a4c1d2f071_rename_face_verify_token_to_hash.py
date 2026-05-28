"""Rename face_verify_tokens.token -> token_hash (SHA-256 hashed at rest).

Revision ID: e8a4c1d2f071
Revises: live_session_006
Create Date: 2026-05-28 12:00:00.000000

Security rationale
------------------
Previously `face_verify_tokens.token` stored the raw hex token, mirroring an
insecure pattern. QR tokens already use `token_hash`; this migration brings
face tokens in line. Existing rows are short-lived (60 s) and single-use so
re-hashing legacy values is unnecessary — we simply truncate any in-flight
tokens (they would have expired by the time this migration ran in any real
deployment).
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "e8a4c1d2f071"
down_revision: Union[str, None] = "live_session_006"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Drop any in-flight rows (they expire in 60 s anyway and can't be
    # retro-hashed since we never stored the original).
    op.execute("DELETE FROM face_verify_tokens")
    op.alter_column(
        "face_verify_tokens",
        "token",
        new_column_name="token_hash",
        existing_type=sa.String(length=255),
        existing_nullable=False,
    )


def downgrade() -> None:
    op.execute("DELETE FROM face_verify_tokens")
    op.alter_column(
        "face_verify_tokens",
        "token_hash",
        new_column_name="token",
        existing_type=sa.String(length=255),
        existing_nullable=False,
    )
