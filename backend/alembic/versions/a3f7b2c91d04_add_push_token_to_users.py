"""add push_token to users

Revision ID: a3f7b2c91d04
Revises: d9826a2178e3
Create Date: 2026-04-02 10:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "a3f7b2c91d04"
down_revision = "d9826a2178e3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("push_token", sa.String(500), nullable=True))
    op.create_index("ix_users_push_token", "users", ["push_token"])


def downgrade() -> None:
    op.drop_index("ix_users_push_token", table_name="users")
    op.drop_column("users", "push_token")
