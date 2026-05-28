"""add security_events table

Revision ID: c4d8f9a1b206
Revises: b7c3d9e4f521
Create Date: 2025-01-20 00:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision: str = "c4d8f9a1b206"
down_revision: Union[str, None] = "b7c3d9e4f521"
branch_labels: Union[str, Sequence[str], None] = None
depends_on:    Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "security_events",
        sa.Column("id",            sa.Integer(),       primary_key=True),
        sa.Column("event_type",    sa.String(64),      nullable=False),
        sa.Column("severity",      sa.String(16),      nullable=False),
        sa.Column("timestamp_utc", sa.DateTime(timezone=True),
                  server_default=sa.text("now()"), nullable=False),
        sa.Column("user_id",       sa.Integer(),       nullable=True),
        sa.Column("college_id",    sa.Integer(),       nullable=True),
        sa.Column("ip_address",    sa.String(64),      nullable=True),
        sa.Column("user_agent",    sa.String(500),     nullable=True),
        sa.Column("request_id",    sa.String(36),      nullable=True),
        sa.Column("details",       postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.ForeignKeyConstraint(["user_id"],    ["users.id"],    ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["college_id"], ["colleges.id"], ondelete="SET NULL"),
    )
    op.create_index("ix_security_events_id",            "security_events", ["id"])
    op.create_index("ix_security_events_timestamp",     "security_events", ["timestamp_utc"])
    op.create_index("ix_security_events_event_type",    "security_events", ["event_type"])
    op.create_index("ix_security_events_severity",      "security_events", ["severity"])
    op.create_index("ix_security_events_user_id",       "security_events", ["user_id"])
    op.create_index("ix_security_events_request_id",    "security_events", ["request_id"])
    op.create_index("ix_security_events_ts_type",       "security_events", ["timestamp_utc", "event_type"])


def downgrade() -> None:
    op.drop_index("ix_security_events_ts_type",    table_name="security_events")
    op.drop_index("ix_security_events_request_id", table_name="security_events")
    op.drop_index("ix_security_events_user_id",    table_name="security_events")
    op.drop_index("ix_security_events_severity",   table_name="security_events")
    op.drop_index("ix_security_events_event_type", table_name="security_events")
    op.drop_index("ix_security_events_timestamp",  table_name="security_events")
    op.drop_index("ix_security_events_id",         table_name="security_events")
    op.drop_table("security_events")
