"""rename face_verify_token.token to token_hash

Revision ID: e8a4c1d2f071
Revises: live_session_006
Create Date: 2026-05-28

Face-verify tokens are single-use with a 60-second TTL so any in-flight
rows are effectively expired by the time this migration runs. We delete
them first to avoid NOT-NULL constraint issues during the column rename,
then rename the column from `token` to `token_hash` to reflect that only
a SHA-256 hex digest is stored (never the raw token).
"""

from typing import Union

from alembic import op

# revision identifiers, used by Alembic
revision: str           = "e8a4c1d2f071"
down_revision: Union[str, None] = "live_session_006"
branch_labels           = None
depends_on              = None


def upgrade() -> None:
    # Delete in-flight rows — they're 60-second single-use tokens and
    # are already invalid by the time a migration is applied.
    op.execute("DELETE FROM face_verify_tokens")
    op.alter_column("face_verify_tokens", "token", new_column_name="token_hash")


def downgrade() -> None:
    op.alter_column("face_verify_tokens", "token_hash", new_column_name="token")
