"""merge_heads

Revision ID: 0a4164c8f7c5
Revises: 0cd52f74cb08, a3f7b2c91d04
Create Date: 2026-04-04 16:14:19.912393

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0a4164c8f7c5'
down_revision: Union[str, None] = ('0cd52f74cb08', 'a3f7b2c91d04')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
