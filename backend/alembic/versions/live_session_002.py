"""live_session_002 — wire AttendanceSession + ClassWallPost to live_sessions

Revision ID: live_session_002
Revises: live_session_001
Create Date: 2026-05-13 13:00:00.000000

Adds:
  * attendance_sessions.session_type           (text — "offline" | "live_online")
  * attendance_sessions.linked_live_session_id (FK -> live_sessions.id)
  * class_wall_posts.live_session_id           (FK -> live_sessions.id)
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "live_session_002"
down_revision: Union[str, None] = "live_session_001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # attendance_sessions
    op.add_column(
        "attendance_sessions",
        sa.Column("session_type", sa.String(length=20), nullable=False, server_default="offline"),
    )
    op.add_column(
        "attendance_sessions",
        sa.Column("linked_live_session_id", sa.Integer(), nullable=True),
    )
    op.create_foreign_key(
        "fk_attendance_sessions_live_session",
        source_table="attendance_sessions",
        referent_table="live_sessions",
        local_cols=["linked_live_session_id"],
        remote_cols=["id"],
        ondelete="SET NULL",
    )
    op.create_index(
        "ix_attendance_sessions_linked_live_session_id",
        "attendance_sessions",
        ["linked_live_session_id"],
    )
    # drop server default now rows are populated
    op.alter_column("attendance_sessions", "session_type", server_default=None)

    # class_wall_posts
    op.add_column(
        "class_wall_posts",
        sa.Column("live_session_id", sa.Integer(), nullable=True),
    )
    op.create_foreign_key(
        "fk_class_wall_posts_live_session",
        source_table="class_wall_posts",
        referent_table="live_sessions",
        local_cols=["live_session_id"],
        remote_cols=["id"],
        ondelete="SET NULL",
    )
    op.create_index(
        "ix_class_wall_posts_live_session_id",
        "class_wall_posts",
        ["live_session_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_class_wall_posts_live_session_id", table_name="class_wall_posts")
    op.drop_constraint("fk_class_wall_posts_live_session", "class_wall_posts", type_="foreignkey")
    op.drop_column("class_wall_posts", "live_session_id")

    op.drop_index("ix_attendance_sessions_linked_live_session_id", table_name="attendance_sessions")
    op.drop_constraint("fk_attendance_sessions_live_session", "attendance_sessions", type_="foreignkey")
    op.drop_column("attendance_sessions", "linked_live_session_id")
    op.drop_column("attendance_sessions", "session_type")
