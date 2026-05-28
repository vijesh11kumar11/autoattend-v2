"""Security hardening: login lockout, refresh tokens, GPS snapshots

Revision ID: b7c3d9e4f521
Revises:    e8a4c1d2f071
Create Date: 2025-01-25
"""

from alembic import op
import sqlalchemy as sa


revision        = "b7c3d9e4f521"
down_revision   = "e8a4c1d2f071"
branch_labels   = None
depends_on      = None


def upgrade() -> None:
    # ── User: password-lockout counters ─────────────────────────────────
    op.add_column(
        "users",
        sa.Column("login_fail_count", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column(
        "users",
        sa.Column("login_locked_until", sa.DateTime(timezone=True), nullable=True),
    )

    # ── LoginAttemptLog ─────────────────────────────────────────────────
    op.create_table(
        "login_attempt_log",
        sa.Column("id",              sa.Integer(),       primary_key=True),
        sa.Column("ip_address",      sa.String(64),      nullable=True),
        sa.Column("user_identifier", sa.String(255),     nullable=True),
        sa.Column("success",         sa.Boolean(),       nullable=False, server_default=sa.text("false")),
        sa.Column("failure_reason",  sa.String(255),     nullable=True),
        sa.Column("user_agent",      sa.String(500),     nullable=True),
        sa.Column(
            "attempted_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
    )
    op.create_index("ix_login_attempt_log_ip",          "login_attempt_log", ["ip_address"])
    op.create_index("ix_login_attempt_log_identifier",  "login_attempt_log", ["user_identifier"])
    op.create_index("ix_login_attempt_log_attempted",   "login_attempt_log", ["attempted_at"])
    op.create_index("ix_login_attempt_log_success",     "login_attempt_log", ["success"])

    # ── RefreshToken ────────────────────────────────────────────────────
    op.create_table(
        "refresh_tokens",
        sa.Column("id",                sa.Integer(),     primary_key=True),
        sa.Column(
            "user_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("token_hash",        sa.String(255),   nullable=False),
        sa.Column("device_id",         sa.String(500),   nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.Column("expires_at",        sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked",           sa.Boolean(),     nullable=False, server_default=sa.text("false")),
        sa.Column("revoked_at",        sa.DateTime(timezone=True), nullable=True),
        sa.Column("replaced_by_hash",  sa.String(255),   nullable=True),
    )
    op.create_index("ix_refresh_tokens_user_id", "refresh_tokens", ["user_id"])
    op.create_index("ix_refresh_tokens_hash",    "refresh_tokens", ["token_hash"], unique=True)
    op.create_index("ix_refresh_tokens_expires", "refresh_tokens", ["expires_at"])

    # ── StudentGPSSnapshot ──────────────────────────────────────────────
    op.create_table(
        "student_gps_snapshots",
        sa.Column("id",          sa.Integer(),     primary_key=True),
        sa.Column(
            "user_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("latitude",    sa.Float(),       nullable=False),
        sa.Column("longitude",   sa.Float(),       nullable=False),
        sa.Column(
            "recorded_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.UniqueConstraint("user_id", name="uq_student_gps_snapshot_user"),
    )
    op.create_index(
        "ix_student_gps_snapshots_user_id", "student_gps_snapshots", ["user_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_student_gps_snapshots_user_id", table_name="student_gps_snapshots")
    op.drop_table("student_gps_snapshots")

    op.drop_index("ix_refresh_tokens_expires", table_name="refresh_tokens")
    op.drop_index("ix_refresh_tokens_hash",    table_name="refresh_tokens")
    op.drop_index("ix_refresh_tokens_user_id", table_name="refresh_tokens")
    op.drop_table("refresh_tokens")

    op.drop_index("ix_login_attempt_log_success",     table_name="login_attempt_log")
    op.drop_index("ix_login_attempt_log_attempted",   table_name="login_attempt_log")
    op.drop_index("ix_login_attempt_log_identifier",  table_name="login_attempt_log")
    op.drop_index("ix_login_attempt_log_ip",          table_name="login_attempt_log")
    op.drop_table("login_attempt_log")

    op.drop_column("users", "login_locked_until")
    op.drop_column("users", "login_fail_count")
