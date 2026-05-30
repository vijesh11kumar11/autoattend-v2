"""add_document_s3_key_to_leave_requests

Revision ID: e1a2b3c4d5f6
Revises: c4d8f9a1b206
Create Date: 2026-05-30 09:00:00.000000

Adds a nullable ``document_s3_key`` column to ``leave_requests`` for
S3-backed supporting documents (issues #45 / #116). Existing
``document_url`` column is left intact so legacy rows continue to work.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e1a2b3c4d5f6'
down_revision: Union[str, None] = 'c4d8f9a1b206'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'leave_requests',
        sa.Column('document_s3_key', sa.String(length=500), nullable=True),
    )


def downgrade() -> None:
    op.drop_column('leave_requests', 'document_s3_key')
