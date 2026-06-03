"""live_session_001 — ClassPulse Live foundation

Revision ID: live_session_001
Revises: classpulse_002
Create Date: 2026-05-13 12:00:00.000000

Creates 6 new tables:
  * live_sessions
  * live_session_participants
  * live_session_events
  * pulse_checks
  * student_knowledge_graphs
  * live_session_breakout_rooms
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = "live_session_001"
down_revision: Union[str, None] = "classpulse_002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# ── Enum type names (must match SAEnum(name=...) in database.py) ──
# Use postgresql.ENUM(create_type=False): we create the types ourselves
# via _ensure_pg_enum() (raw idempotent SQL) so op.create_table must NOT
# re-emit CREATE TYPE (which would fail with DuplicateObject).
# NOTE: sa.Enum silently ignores create_type — only postgresql.ENUM honors it.
LIVE_SESSION_TYPE       = postgresql.ENUM("standalone", "capsule_locked", "public",                                name="livesessiontype",       create_type=False)
LIVE_SESSION_STATUS     = postgresql.ENUM("scheduled", "waiting", "live", "ended", "cancelled",                    name="livesessionstatus",     create_type=False)
LIVE_PARTICIPANT_TYPE   = postgresql.ENUM("teacher", "student", "guest", "external",                               name="liveparticipanttype",   create_type=False)
LIVE_CONNECTION_QUALITY = postgresql.ENUM("excellent", "good", "poor", "offline",                                  name="liveconnectionquality", create_type=False)
LIVE_EVENT_TYPE         = postgresql.ENUM(
    "session_start", "session_end",
    "student_joined", "student_left",
    "ai_observation", "ai_intervention",
    "teacher_response", "confusion_detected",
    "topic_change", "pace_alert",
    "pulse_check_started", "pulse_check_ended",
    "breakout_started", "breakout_ended",
    "hot_doubt_detected", "liveness_check",
    "bandwidth_switch", "whiteboard_generated",
    name="liveeventtype", create_type=False,
)
LIVE_EVENT_TRIGGER  = postgresql.ENUM("ai", "teacher", "student", "system",        name="liveeventtrigger",  create_type=False)
PULSE_CHECK_TRIGGER = postgresql.ENUM("teacher", "ai",                             name="pulsechecktrigger", create_type=False)
PULSE_CHECK_ANSWER  = postgresql.ENUM("A", "B", "C", "D",                          name="pulsecheckanswer",  create_type=False)
KNOWLEDGE_LEVEL     = postgresql.ENUM("strong", "moderate", "weak", "not_covered", name="knowledgelevel",    create_type=False)

# Companion objects WITH create_type=True for the explicit .create() calls
# below (we want those to actually create the types).
_CREATE_ENUMS = [
    sa.Enum("standalone", "capsule_locked", "public",          name="livesessiontype"),
    sa.Enum("scheduled", "waiting", "live", "ended", "cancelled", name="livesessionstatus"),
    sa.Enum("teacher", "student", "guest", "external",       name="liveparticipanttype"),
    sa.Enum("excellent", "good", "poor", "offline",          name="liveconnectionquality"),
    sa.Enum(
        "session_start", "session_end",
        "student_joined", "student_left",
        "ai_observation", "ai_intervention",
        "teacher_response", "confusion_detected",
        "topic_change", "pace_alert",
        "pulse_check_started", "pulse_check_ended",
        "breakout_started", "breakout_ended",
        "hot_doubt_detected", "liveness_check",
        "bandwidth_switch", "whiteboard_generated",
        name="liveeventtype",
    ),
    sa.Enum("ai", "teacher", "student", "system",         name="liveeventtrigger"),
    sa.Enum("teacher", "ai",                              name="pulsechecktrigger"),
    sa.Enum("A", "B", "C", "D",                           name="pulsecheckanswer"),
    sa.Enum("strong", "moderate", "weak", "not_covered",  name="knowledgelevel"),
]


def _ensure_pg_enum(bind, name: str, values: tuple[str, ...]) -> None:
    """Idempotent CREATE TYPE for a PostgreSQL ENUM (raw SQL, transaction-safe)."""
    quoted_values = ", ".join("'" + v.replace("'", "''") + "'" for v in values)
    bind.exec_driver_sql(f"""
        DO $$
        BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = '{name}') THEN
                CREATE TYPE {name} AS ENUM ({quoted_values});
            END IF;
        END
        $$;
    """)


def upgrade() -> None:
    # ── Create enum types up-front (idempotent) ───────────────────────
    bind = op.get_bind()
    _ensure_pg_enum(bind, "livesessiontype",      ("standalone", "capsule_locked", "public"))
    _ensure_pg_enum(bind, "livesessionstatus",    ("scheduled", "waiting", "live", "ended", "cancelled"))
    _ensure_pg_enum(bind, "liveparticipanttype",  ("teacher", "student", "guest", "external"))
    _ensure_pg_enum(bind, "liveconnectionquality", ("excellent", "good", "poor", "offline"))
    _ensure_pg_enum(bind, "liveeventtype", (
        "session_start", "session_end",
        "student_joined", "student_left",
        "ai_observation", "ai_intervention",
        "teacher_response", "confusion_detected",
        "topic_change", "pace_alert",
        "pulse_check_started", "pulse_check_ended",
        "breakout_started", "breakout_ended",
        "hot_doubt_detected", "liveness_check",
        "bandwidth_switch", "whiteboard_generated",
    ))
    _ensure_pg_enum(bind, "liveeventtrigger",  ("ai", "teacher", "student", "system"))
    _ensure_pg_enum(bind, "pulsechecktrigger", ("teacher", "ai"))
    _ensure_pg_enum(bind, "pulsecheckanswer",  ("A", "B", "C", "D"))
    _ensure_pg_enum(bind, "knowledgelevel",    ("strong", "moderate", "weak", "not_covered"))

    # ── live_sessions ─────────────────────────────────────────────────
    op.create_table(
        "live_sessions",
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column("session_type", LIVE_SESSION_TYPE, nullable=False),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("teacher_id", sa.Integer(), nullable=False),
        sa.Column("subject_id", sa.Integer(), nullable=True),
        sa.Column("section_id", sa.Integer(), nullable=True),
        sa.Column("capsule_id", sa.Integer(), nullable=True),
        sa.Column("timetable_id", sa.Integer(), nullable=True),
        sa.Column("status", LIVE_SESSION_STATUS, nullable=False, server_default="waiting"),
        sa.Column("join_link", sa.String(length=100), nullable=False),
        sa.Column("join_password", sa.String(length=100), nullable=True),
        sa.Column("max_guests", sa.Integer(), nullable=False, server_default="50"),
        sa.Column("allow_guests", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("allow_guest_interaction", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("recording_enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("recording_url", sa.String(length=500), nullable=True),
        sa.Column("transcript_text", sa.Text(), nullable=True),
        sa.Column("ai_session_log", postgresql.JSONB(), nullable=True),
        sa.Column("session_health_score", sa.Integer(), nullable=True),
        sa.Column("health_report_json", postgresql.JSONB(), nullable=True),
        sa.Column("auto_capsule_id", sa.Integer(), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("duration_minutes", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["teacher_id"],   ["users.id"],     ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["subject_id"],   ["subjects.id"],  ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["section_id"],   ["sections.id"],  ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["capsule_id"],   ["capsules.id"],  ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["timetable_id"], ["timetable.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["auto_capsule_id"], ["capsules.id"], ondelete="SET NULL"),
        sa.UniqueConstraint("join_link", name="uq_live_sessions_join_link"),
    )
    op.create_index("ix_live_sessions_join_link",  "live_sessions", ["join_link"])
    op.create_index("ix_live_sessions_teacher_id", "live_sessions", ["teacher_id"])
    op.create_index("ix_live_sessions_subject_id", "live_sessions", ["subject_id"])
    op.create_index("ix_live_sessions_section_id", "live_sessions", ["section_id"])
    op.create_index("ix_live_sessions_status",     "live_sessions", ["status"])
    op.create_index("ix_live_sessions_created_at", "live_sessions", ["created_at"])

    # ── live_session_participants ─────────────────────────────────────
    op.create_table(
        "live_session_participants",
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column("live_session_id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=True),
        sa.Column("participant_type", LIVE_PARTICIPANT_TYPE, nullable=False),
        sa.Column("guest_name", sa.String(length=100), nullable=True),
        sa.Column("guest_email", sa.String(length=200), nullable=True),
        sa.Column("joined_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("left_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("total_duration_seconds", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("is_attendance_counted", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("attendance_record_id", sa.Integer(), nullable=True),
        sa.Column("last_heartbeat", sa.DateTime(timezone=True), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("camera_on", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("mic_on", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("connection_quality", LIVE_CONNECTION_QUALITY, nullable=False, server_default="good"),
        sa.Column("liveness_check_passed", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("liveness_check_time", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["live_session_id"], ["live_sessions.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["attendance_record_id"], ["attendance_records.id"], ondelete="SET NULL"),
    )
    op.create_index("ix_lsp_live_session_id", "live_session_participants", ["live_session_id"])
    op.create_index("ix_lsp_user_id",         "live_session_participants", ["user_id"])
    op.create_index("ix_lsp_is_active",       "live_session_participants", ["is_active"])

    # ── live_session_events ───────────────────────────────────────────
    op.create_table(
        "live_session_events",
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column("live_session_id", sa.Integer(), nullable=False),
        sa.Column("event_type", LIVE_EVENT_TYPE, nullable=False),
        sa.Column("event_timestamp", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("triggered_by", LIVE_EVENT_TRIGGER, nullable=False),
        sa.Column("affected_student_ids", postgresql.JSONB(), nullable=True),
        sa.Column("ai_observation_text", sa.Text(), nullable=True),
        sa.Column("teacher_action_taken", sa.String(length=500), nullable=True),
        sa.Column("metadata_json", postgresql.JSONB(), nullable=True),
        sa.ForeignKeyConstraint(["live_session_id"], ["live_sessions.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_lse_live_session_id", "live_session_events", ["live_session_id"])
    op.create_index("ix_lse_event_type",      "live_session_events", ["event_type"])
    op.create_index("ix_lse_event_timestamp", "live_session_events", ["event_timestamp"])

    # ── pulse_checks ──────────────────────────────────────────────────
    op.create_table(
        "pulse_checks",
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column("live_session_id", sa.Integer(), nullable=False),
        sa.Column("question_text", sa.Text(), nullable=False),
        sa.Column("option_a", sa.String(length=300), nullable=False),
        sa.Column("option_b", sa.String(length=300), nullable=False),
        sa.Column("option_c", sa.String(length=300), nullable=False),
        sa.Column("option_d", sa.String(length=300), nullable=False),
        sa.Column("correct_answer", PULSE_CHECK_ANSWER, nullable=False),
        sa.Column("explanation", sa.Text(), nullable=True),
        sa.Column("triggered_by", PULSE_CHECK_TRIGGER, nullable=False),
        sa.Column("triggered_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("duration_seconds", sa.Integer(), nullable=False, server_default="30"),
        sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("total_responses", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("correct_responses", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("response_distribution", postgresql.JSONB(), nullable=True),
        sa.Column("ai_analysis", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(["live_session_id"], ["live_sessions.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_pulse_checks_live_session_id", "pulse_checks", ["live_session_id"])
    op.create_index("ix_pulse_checks_triggered_at",    "pulse_checks", ["triggered_at"])

    # ── student_knowledge_graphs ──────────────────────────────────────
    op.create_table(
        "student_knowledge_graphs",
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column("student_id", sa.Integer(), nullable=False),
        sa.Column("subject_id", sa.Integer(), nullable=False),
        sa.Column("topic_name", sa.String(length=200), nullable=False),
        sa.Column("understanding_level", KNOWLEDGE_LEVEL, nullable=False, server_default="not_covered"),
        sa.Column("confidence_score", sa.Float(), nullable=False, server_default="0.0"),
        sa.Column("last_assessed_session_id", sa.Integer(), nullable=True),
        sa.Column("times_confused", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("times_understood", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("last_updated", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("ai_notes", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(["student_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["subject_id"], ["subjects.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["last_assessed_session_id"], ["live_sessions.id"], ondelete="SET NULL"),
        sa.UniqueConstraint("student_id", "subject_id", "topic_name", name="uq_skg_student_subject_topic"),
    )
    op.create_index("ix_skg_student_id", "student_knowledge_graphs", ["student_id"])
    op.create_index("ix_skg_subject_id", "student_knowledge_graphs", ["subject_id"])
    op.create_index("ix_skg_topic_name", "student_knowledge_graphs", ["topic_name"])

    # ── live_session_breakout_rooms ───────────────────────────────────
    op.create_table(
        "live_session_breakout_rooms",
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column("live_session_id", sa.Integer(), nullable=False),
        sa.Column("room_name", sa.String(length=100), nullable=False),
        sa.Column("room_number", sa.Integer(), nullable=False),
        sa.Column("participant_ids", postgresql.JSONB(), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("ai_monitoring_log", postgresql.JSONB(), nullable=True),
        sa.Column("productivity_score", sa.Integer(), nullable=True),
        sa.Column("peer_expert_detected_user_id", sa.Integer(), nullable=True),
        sa.Column("is_stuck", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("teacher_visited", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.ForeignKeyConstraint(["live_session_id"], ["live_sessions.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["peer_expert_detected_user_id"], ["users.id"], ondelete="SET NULL"),
    )
    op.create_index("ix_lsbr_live_session_id", "live_session_breakout_rooms", ["live_session_id"])


def downgrade() -> None:
    op.drop_index("ix_lsbr_live_session_id", table_name="live_session_breakout_rooms")
    op.drop_table("live_session_breakout_rooms")

    op.drop_index("ix_skg_topic_name", table_name="student_knowledge_graphs")
    op.drop_index("ix_skg_subject_id", table_name="student_knowledge_graphs")
    op.drop_index("ix_skg_student_id", table_name="student_knowledge_graphs")
    op.drop_table("student_knowledge_graphs")

    op.drop_index("ix_pulse_checks_triggered_at", table_name="pulse_checks")
    op.drop_index("ix_pulse_checks_live_session_id", table_name="pulse_checks")
    op.drop_table("pulse_checks")

    op.drop_index("ix_lse_event_timestamp", table_name="live_session_events")
    op.drop_index("ix_lse_event_type",      table_name="live_session_events")
    op.drop_index("ix_lse_live_session_id", table_name="live_session_events")
    op.drop_table("live_session_events")

    op.drop_index("ix_lsp_is_active",       table_name="live_session_participants")
    op.drop_index("ix_lsp_user_id",         table_name="live_session_participants")
    op.drop_index("ix_lsp_live_session_id", table_name="live_session_participants")
    op.drop_table("live_session_participants")

    op.drop_index("ix_live_sessions_created_at", table_name="live_sessions")
    op.drop_index("ix_live_sessions_status",     table_name="live_sessions")
    op.drop_index("ix_live_sessions_section_id", table_name="live_sessions")
    op.drop_index("ix_live_sessions_subject_id", table_name="live_sessions")
    op.drop_index("ix_live_sessions_teacher_id", table_name="live_sessions")
    op.drop_index("ix_live_sessions_join_link",  table_name="live_sessions")
    op.drop_table("live_sessions")

    bind = op.get_bind()
    for enum_name in (
        "knowledgelevel", "pulsecheckanswer", "pulsechecktrigger",
        "liveeventtrigger", "liveeventtype", "liveconnectionquality",
        "liveparticipanttype", "livesessionstatus", "livesessiontype",
    ):
        sa.Enum(name=enum_name).drop(bind, checkfirst=True)
