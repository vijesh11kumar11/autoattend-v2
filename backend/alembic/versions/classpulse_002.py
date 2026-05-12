"""classpulse_002 — featured capsules + quiz retry telemetry

Revision ID: classpulse_002
Revises: classpulse_001
Create Date: 2026-05-01 12:00:00.000000

Adds:
  * capsules.featured / featured_by / featured_at  (HOD spotlight)
  * capsule_interactions.quiz_attempts_count       (per-student tries)
  * capsule_interactions.last_quiz_at              (cooldown anchor)
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "classpulse_002"
down_revision: Union[str, None] = "classpulse_001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── capsules: featured fields ─────────────────────────────────────
    op.add_column(
        "capsules",
        sa.Column("featured", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column(
        "capsules",
        sa.Column("featured_by", sa.Integer(), nullable=True),
    )
    op.add_column(
        "capsules",
        sa.Column("featured_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_capsules_featured_by_users",
        source_table="capsules",
        referent_table="users",
        local_cols=["featured_by"],
        remote_cols=["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_capsules_featured", "capsules", ["featured"])

    # ── capsule_interactions: quiz retry telemetry ────────────────────
    op.add_column(
        "capsule_interactions",
        sa.Column(
            "quiz_attempts_count", sa.Integer(),
            nullable=False, server_default="0",
        ),
    )
    op.add_column(
        "capsule_interactions",
        sa.Column("last_quiz_at", sa.DateTime(timezone=True), nullable=True),
    )

    # Drop server_defaults now that the columns are populated.
    op.alter_column("capsules", "featured", server_default=None)
    op.alter_column("capsule_interactions", "quiz_attempts_count", server_default=None)


def downgrade() -> None:
    op.drop_column("capsule_interactions", "last_quiz_at")
    op.drop_column("capsule_interactions", "quiz_attempts_count")
    op.drop_index("ix_capsules_featured", table_name="capsules")
    op.drop_constraint("fk_capsules_featured_by_users", "capsules", type_="foreignkey")
    op.drop_column("capsules", "featured_at")
    op.drop_column("capsules", "featured_by")
    op.drop_column("capsules", "featured")
