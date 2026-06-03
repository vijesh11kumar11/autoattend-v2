"""Add domain/plan/status/college_code to colleges; allow null users.college_id.

Closes issue #108 (super-admin panel prerequisites).

Revision ID: a9b1c2d3e4f5
Revises:     f2b8c9d3e017
Create Date: 2026-05-30
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "a9b1c2d3e4f5"
down_revision: Union[str, None] = "f2b8c9d3e017"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _has_col(bind, table: str, col: str) -> bool:
    try:
        insp = sa.inspect(bind)
    except Exception:
        return False
    try:
        return any(c["name"] == col for c in insp.get_columns(table))
    except Exception:
        return False


def upgrade() -> None:
    bind = op.get_bind()

    # 1) colleges: domain, plan, status, college_code ─────────────────
    with op.batch_alter_table("colleges") as batch:
        if not _has_col(bind, "colleges", "domain"):
            batch.add_column(sa.Column("domain", sa.String(255), nullable=True))
        if not _has_col(bind, "colleges", "plan"):
            batch.add_column(sa.Column("plan", sa.String(20), nullable=False, server_default="trial"))
        if not _has_col(bind, "colleges", "status"):
            batch.add_column(sa.Column("status", sa.String(20), nullable=False, server_default="active"))
        if not _has_col(bind, "colleges", "college_code"):
            batch.add_column(sa.Column("college_code", sa.String(64), nullable=True))

    # Unique indexes on domain + college_code (created after column add)
    try:
        op.create_index("ix_colleges_domain", "colleges", ["domain"], unique=True)
    except Exception:
        pass
    try:
        op.create_index("ix_colleges_college_code", "colleges", ["college_code"], unique=True)
    except Exception:
        pass

    # 2) users.college_id → nullable (super-admin accounts have none) ──
    try:
        with op.batch_alter_table("users") as batch:
            batch.alter_column("college_id", existing_type=sa.Integer(), nullable=True)
    except Exception:
        pass


def downgrade() -> None:
    try:
        with op.batch_alter_table("users") as batch:
            batch.alter_column("college_id", existing_type=sa.Integer(), nullable=False)
    except Exception:
        pass

    for ix in ("ix_colleges_college_code", "ix_colleges_domain"):
        try:
            op.drop_index(ix, table_name="colleges")
        except Exception:
            pass

    with op.batch_alter_table("colleges") as batch:
        for col in ("college_code", "status", "plan", "domain"):
            try:
                batch.drop_column(col)
            except Exception:
                pass
