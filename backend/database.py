"""
AutoAttend AI v2.0 — Database schema
SQLAlchemy 2.0 synchronous engine (psycopg2)
15 tables, all timestamps UTC.
"""

import enum

from sqlalchemy import (
    BigInteger,
    Boolean,
    Column,
    Date,
    DateTime,
    Enum as SAEnum,
    Float,
    ForeignKey,
    Index,
    Integer,
    SmallInteger,
    String,
    Text,
    Time,
    UniqueConstraint,
    create_engine,
    event,
    func,
    text as sa_text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import (
    DeclarativeBase,
    Session,
    declared_attr,
    relationship,
    sessionmaker,
    with_loader_criteria,
)

from config import settings


# ═══════════════════════════════════════════════════════════════════════
# Python Enums  (names must match PostgreSQL type names below)
# ═══════════════════════════════════════════════════════════════════════

class UserRole(str, enum.Enum):
    super_admin = "super_admin"
    principal   = "principal"
    hod         = "hod"
    teacher     = "teacher"
    student     = "student"


class OTPPurpose(str, enum.Enum):
    password_reset = "password_reset"
    device_change  = "device_change"
    face_reenroll  = "face_reenroll"
    email_verify   = "email_verify"
    phone_verify   = "phone_verify"


class OTPChannel(str, enum.Enum):
    sms   = "sms"
    email = "email"


class DayOfWeek(str, enum.Enum):
    monday    = "monday"
    tuesday   = "tuesday"
    wednesday = "wednesday"
    thursday  = "thursday"
    friday    = "friday"
    saturday  = "saturday"


class SessionStatus(str, enum.Enum):
    active  = "active"
    ended   = "ended"
    expired = "expired"


class AttendanceStatus(str, enum.Enum):
    present       = "present"
    absent        = "absent"
    late          = "late"
    medical_leave = "medical_leave"
    duty_leave    = "duty_leave"


class MarkedBy(str, enum.Enum):
    qr_scan     = "qr_scan"
    manual      = "manual"
    auto_absent = "auto_absent"


class AuditResult(str, enum.Enum):
    success = "success"
    failed  = "failed"


class AlertStatus(str, enum.Enum):
    sent    = "sent"
    failed  = "failed"
    pending = "pending"


class AlertChannel(str, enum.Enum):
    whatsapp = "whatsapp"
    sms      = "sms"
    email    = "email"


class LeaveType(str, enum.Enum):
    medical   = "medical"
    duty      = "duty"
    personal  = "personal"
    emergency = "emergency"
    sports    = "sports"
    other     = "other"


class LeaveRequestStatus(str, enum.Enum):
    pending   = "pending"
    approved  = "approved"
    rejected  = "rejected"
    cancelled = "cancelled"


# ── ClassPulse Live (live_session_001) ────────────────────────────────

class LiveSessionType(str, enum.Enum):
    standalone      = "standalone"
    capsule_locked  = "capsule_locked"
    public          = "public"


class LiveSessionStatus(str, enum.Enum):
    scheduled = "scheduled"
    waiting   = "waiting"
    live      = "live"
    ended     = "ended"
    cancelled = "cancelled"


class LiveParticipantType(str, enum.Enum):
    teacher  = "teacher"
    student  = "student"
    guest    = "guest"
    external = "external"


class LiveConnectionQuality(str, enum.Enum):
    excellent = "excellent"
    good      = "good"
    poor      = "poor"
    offline   = "offline"


class LiveEventType(str, enum.Enum):
    session_start         = "session_start"
    session_end           = "session_end"
    student_joined        = "student_joined"
    student_left          = "student_left"
    ai_observation        = "ai_observation"
    ai_intervention       = "ai_intervention"
    teacher_response      = "teacher_response"
    confusion_detected    = "confusion_detected"
    topic_change          = "topic_change"
    pace_alert            = "pace_alert"
    pulse_check_started   = "pulse_check_started"
    pulse_check_ended     = "pulse_check_ended"
    breakout_started      = "breakout_started"
    breakout_ended        = "breakout_ended"
    hot_doubt_detected    = "hot_doubt_detected"
    liveness_check        = "liveness_check"
    bandwidth_switch      = "bandwidth_switch"
    whiteboard_generated  = "whiteboard_generated"


class LiveEventTrigger(str, enum.Enum):
    ai      = "ai"
    teacher = "teacher"
    student = "student"
    system  = "system"


class PulseCheckTrigger(str, enum.Enum):
    teacher = "teacher"
    ai      = "ai"


class PulseCheckAnswer(str, enum.Enum):
    A = "A"
    B = "B"
    C = "C"
    D = "D"


class KnowledgeLevel(str, enum.Enum):
    strong       = "strong"
    moderate     = "moderate"
    weak         = "weak"
    not_covered  = "not_covered"


# ═══════════════════════════════════════════════════════════════════════
# SQLAlchemy Base
# ═══════════════════════════════════════════════════════════════════════

class Base(DeclarativeBase):
    pass


# ═══════════════════════════════════════════════════════════════════════
# Multi-tenant / soft-delete mixins  (issues #99, #100, #101, #104)
# ───────────────────────────────────────────────────────────────────────
# These mixins are additive — they are applied to every business-data
# model class via class-inheritance. The companion Alembic migration
# adds the matching columns to the existing schema. Existing models
# that already declare their own `college_id` (User, Department,
# SecurityEvent) do NOT inherit TenantMixin to avoid a duplicate column.
# ═══════════════════════════════════════════════════════════════════════

class SoftDeleteMixin:
    """Adds is_deleted / deleted_at columns to a model.

    The global ``do_orm_execute`` listener below transparently filters
    out soft-deleted rows from every ORM SELECT, so existing list
    queries keep working unchanged. Pass ``execution_options(include_deleted=True)``
    on a query to opt out (super-admin views, recovery tools, audits).
    """
    is_deleted = Column(Boolean, nullable=False, server_default=sa_text("false"), default=False)
    deleted_at = Column(DateTime(timezone=True), nullable=True)


class TenantMixin:
    """Adds a nullable ``college_id`` foreign key + index to a model.

    Nullable because (a) backfill is performed by ops post-migration and
    (b) some rows legitimately have no tenant (e.g. global config rows).
    """
    @declared_attr
    def college_id(cls):  # noqa: N805 — SQLAlchemy convention
        return Column(
            Integer,
            ForeignKey("colleges.id", ondelete="CASCADE"),
            nullable=True,
            index=True,
        )


def active_query(model, db):
    """Return a query for ``model`` that excludes soft-deleted rows.

    Equivalent to ``db.query(model).filter(model.is_deleted == False)``.
    Safe to call on models that do not inherit SoftDeleteMixin — returns
    the unfiltered query in that case.
    """
    q = db.query(model)
    if hasattr(model, "is_deleted"):
        q = q.filter(model.is_deleted == False)  # noqa: E712
    return q


def tenant_query(model, db, college_id):
    """Return a query for ``model`` scoped to a single college and active rows.

    Falls back to :func:`active_query` for models that don't have college_id.
    """
    q = active_query(model, db)
    if college_id is not None and hasattr(model, "college_id"):
        q = q.filter(model.college_id == college_id)
    return q


# ═══════════════════════════════════════════════════════════════════════
# Engine & Session
# ═══════════════════════════════════════════════════════════════════════

engine = create_engine(
    settings.DATABASE_URL_SYNC,
    pool_pre_ping=True,
    pool_size=settings.DB_POOL_SIZE,
    max_overflow=settings.DB_MAX_OVERFLOW,
    pool_recycle=settings.DB_POOL_RECYCLE_SECONDS,
    pool_timeout=settings.DB_POOL_TIMEOUT_SECONDS,
    echo=settings.DEBUG,
)

SessionLocal = sessionmaker(
    bind=engine,
    autocommit=False,
    autoflush=False,
)


# ═══════════════════════════════════════════════════════════════════════
# Global ORM execute listener — auto soft-delete & tenant filtering
# ───────────────────────────────────────────────────────────────────────
# Every ORM SELECT against a model that inherits SoftDeleteMixin /
# TenantMixin is transparently amended with ``is_deleted = false`` and,
# when ENFORCE_TENANT_ISOLATION is on, ``college_id = <current>``.
#
# Opt-outs:
#   • db.execute(stmt.execution_options(include_deleted=True))
#   • db.execute(stmt.execution_options(skip_tenant_filter=True))
#   • db.info["skip_tenant_filter"] = True   (super-admin sessions)
# ═══════════════════════════════════════════════════════════════════════

@event.listens_for(SessionLocal, "do_orm_execute")
def _autotenant_and_softdelete(execute_state):
    if not execute_state.is_select:
        return
    opts = execute_state.execution_options or {}
    session_info = getattr(execute_state.session, "info", {}) or {}

    # 1) Soft-delete filter (always on unless explicitly opted out).
    if not opts.get("include_deleted", False):
        execute_state.statement = execute_state.statement.options(
            with_loader_criteria(
                SoftDeleteMixin,
                lambda cls: cls.is_deleted == False,  # noqa: E712
                include_aliases=True,
            )
        )

    # 2) Tenant filter (off by default; gated by feature flag).
    enforce = getattr(settings, "ENFORCE_TENANT_ISOLATION", False)
    skip_tenant = opts.get("skip_tenant_filter") or session_info.get("skip_tenant_filter")
    college_id = session_info.get("college_id")
    if enforce and not skip_tenant and college_id is not None:
        execute_state.statement = execute_state.statement.options(
            with_loader_criteria(
                TenantMixin,
                lambda cls: cls.college_id == college_id,
                include_aliases=True,
            )
        )


# ═══════════════════════════════════════════════════════════════════════
# TABLE 1 — colleges
# ═══════════════════════════════════════════════════════════════════════

class College(Base, SoftDeleteMixin):
    __tablename__ = "colleges"

    id            = Column(Integer, primary_key=True, index=True)
    name          = Column(String(255), nullable=False)
    domain        = Column(String(255), nullable=True, unique=True, index=True)
    college_code  = Column(String(64),  nullable=True, unique=True, index=True)
    plan          = Column(String(20),  nullable=False, server_default="trial", default="trial")
    status        = Column(String(20),  nullable=False, server_default="active", default="active")
    address       = Column(Text, nullable=True)
    phone         = Column(String(20),  nullable=True)
    email         = Column(String(255), nullable=True)
    logo_url      = Column(String(500), nullable=True)
    created_at    = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    # Relationships
    departments = relationship("Department", back_populates="college", cascade="all, delete-orphan")
    users       = relationship("User", back_populates="college")


# ═══════════════════════════════════════════════════════════════════════
# TABLE 2 — departments
# ═══════════════════════════════════════════════════════════════════════

class Department(Base, SoftDeleteMixin):
    __tablename__ = "departments"
    __table_args__ = (
        UniqueConstraint("college_id", "code", name="uq_department_college_code"),
        Index("ix_departments_college_id", "college_id"),
    )

    id         = Column(Integer, primary_key=True, index=True)
    college_id = Column(Integer, ForeignKey("colleges.id", ondelete="CASCADE"), nullable=False)
    name       = Column(String(255), nullable=False)
    code       = Column(String(20), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    # Relationships
    college = relationship("College", back_populates="departments")
    courses = relationship("Course", back_populates="department", cascade="all, delete-orphan")
    users   = relationship("User", back_populates="department")


# ═══════════════════════════════════════════════════════════════════════
# TABLE 3 — courses
# ═══════════════════════════════════════════════════════════════════════

class Course(Base, SoftDeleteMixin, TenantMixin):
    __tablename__ = "courses"
    __table_args__ = (
        UniqueConstraint("department_id", "code", name="uq_course_department_code"),
        Index("ix_courses_department_id", "department_id"),
    )

    id             = Column(Integer, primary_key=True, index=True)
    department_id  = Column(Integer, ForeignKey("departments.id", ondelete="CASCADE"), nullable=False)
    name           = Column(String(255), nullable=False)
    code           = Column(String(20), nullable=False)
    duration_years = Column(SmallInteger, nullable=False, default=4)
    created_at     = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    # Relationships
    department = relationship("Department", back_populates="courses")
    subjects   = relationship("Subject", back_populates="course", cascade="all, delete-orphan")
    students   = relationship("User", back_populates="course")
    sections   = relationship("Section", back_populates="course", cascade="all, delete-orphan")


# ═══════════════════════════════════════════════════════════════════════
# TABLE 4b — sections  (A, B, C subdivisions of course+semester)
# ═══════════════════════════════════════════════════════════════════════

class Section(Base, SoftDeleteMixin, TenantMixin):
    __tablename__ = "sections"
    __table_args__ = (
        UniqueConstraint("course_id", "semester", "name", name="uq_section_course_semester_name"),
        Index("ix_sections_course_id",      "course_id"),
        Index("ix_sections_department_id",  "department_id"),
    )

    id            = Column(Integer, primary_key=True, index=True)
    department_id = Column(Integer, ForeignKey("departments.id", ondelete="CASCADE"), nullable=False)
    course_id     = Column(Integer, ForeignKey("courses.id",     ondelete="CASCADE"), nullable=False)
    semester      = Column(SmallInteger, nullable=False)
    name          = Column(String(10), nullable=False)           # "A", "B", "C"
    max_strength  = Column(Integer, nullable=True)
    created_at    = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    # Relationships
    department          = relationship("Department")
    course              = relationship("Course", back_populates="sections")
    students            = relationship("User", back_populates="section")
    attendance_sessions = relationship("AttendanceSession", back_populates="section")


# ═══════════════════════════════════════════════════════════════════════
# TABLE 5 — users  (defined before Subject to allow FK ref in Subject)
# ═══════════════════════════════════════════════════════════════════════

class User(Base, SoftDeleteMixin):
    __tablename__ = "users"
    __table_args__ = (
        Index("ix_users_college_id",    "college_id"),
        Index("ix_users_department_id", "department_id"),
        Index("ix_users_role",          "role"),
        Index("ix_users_is_active",     "is_active"),
    )

    id               = Column(Integer, primary_key=True, index=True)
    college_id       = Column(Integer, ForeignKey("colleges.id",    ondelete="CASCADE"),   nullable=True)
    department_id    = Column(Integer, ForeignKey("departments.id", ondelete="SET NULL"),  nullable=True)
    course_id        = Column(Integer, ForeignKey("courses.id",     ondelete="SET NULL"),  nullable=True)
    section_id       = Column(Integer, ForeignKey("sections.id",    ondelete="SET NULL"),  nullable=True)
    name             = Column(String(255), nullable=False)
    email            = Column(String(255), unique=True, nullable=False, index=True)
    phone            = Column(String(20), nullable=True)
    roll_number      = Column(String(50), unique=True, nullable=True, index=True)
    role             = Column(SAEnum(UserRole, name="userrole"), nullable=False)
    password_hash    = Column(String(500), nullable=False)
    totp_secret      = Column(String(255), nullable=True)
    totp_enabled     = Column(Boolean, default=False, nullable=False)
    azure_person_id  = Column(String(255), nullable=True)
    face_enrolled    = Column(Boolean, default=False, nullable=False)
    face_enrolled_at = Column(DateTime(timezone=True), nullable=True)
    semester         = Column(SmallInteger, nullable=True)
    parent_phone     = Column(String(20), nullable=True)
    parent_email     = Column(String(255), nullable=True)
    push_token       = Column(String(500), nullable=True, index=True)
    is_active           = Column(Boolean, default=True,  nullable=False)
    totp_fail_count     = Column(Integer, default=0,     nullable=False)
    totp_locked_until   = Column(DateTime(timezone=True), nullable=True)
    login_fail_count    = Column(Integer, default=0,     nullable=False)
    login_locked_until  = Column(DateTime(timezone=True), nullable=True)
    face_auth_enabled   = Column(Boolean, default=False, nullable=False)
    password_changed_at = Column(DateTime(timezone=True), nullable=True)
    last_login          = Column(DateTime(timezone=True), nullable=True)
    created_at          = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at       = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    # Relationships
    college    = relationship("College",    back_populates="users")
    department = relationship("Department", back_populates="users")
    course     = relationship("Course",     back_populates="students")
    section    = relationship("Section",    back_populates="students")

    taught_subjects    = relationship("Subject", back_populates="teacher")
    timetable_entries  = relationship("Timetable", back_populates="teacher", foreign_keys="[Timetable.teacher_id]")
    attendance_sessions = relationship("AttendanceSession", back_populates="teacher")
    attendance_records = relationship("AttendanceRecord",   back_populates="student")
    otp_logs           = relationship("OTPLog", back_populates="user", cascade="all, delete-orphan")
    alerts             = relationship("AlertsLog", back_populates="student")

    # Disambiguated (multiple FKs from related table to User)
    device_registry = relationship(
        "DeviceRegistry",
        foreign_keys="[DeviceRegistry.user_id]",
        back_populates="user",
        uselist=False,
        cascade="all, delete-orphan",
    )
    face_change_logs = relationship(
        "FaceChangeLog",
        foreign_keys="[FaceChangeLog.student_id]",
        back_populates="student",
    )


# ═══════════════════════════════════════════════════════════════════════
# TABLE 4 — subjects
# ═══════════════════════════════════════════════════════════════════════

class Subject(Base, SoftDeleteMixin, TenantMixin):
    __tablename__ = "subjects"
    __table_args__ = (
        UniqueConstraint("course_id", "code", "semester", name="uq_subject_course_code_semester"),
        Index("ix_subjects_course_id",   "course_id"),
        Index("ix_subjects_teacher_id",  "teacher_id"),
        Index("ix_subjects_semester",    "semester"),
    )

    id              = Column(Integer, primary_key=True, index=True)
    course_id       = Column(Integer, ForeignKey("courses.id", ondelete="CASCADE"),  nullable=False)
    teacher_id      = Column(Integer, ForeignKey("users.id",   ondelete="SET NULL"), nullable=True)
    name            = Column(String(255), nullable=False)
    code            = Column(String(20), nullable=False)
    semester        = Column(SmallInteger, nullable=False)
    total_lectures  = Column(Integer, nullable=False, default=0)
    created_at      = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    # Relationships
    course   = relationship("Course",               back_populates="subjects")
    teacher  = relationship("User", foreign_keys=[teacher_id], back_populates="taught_subjects")

    timetable_entries   = relationship("Timetable",           back_populates="subject")
    attendance_sessions = relationship("AttendanceSession",   back_populates="subject")


# ═══════════════════════════════════════════════════════════════════════
# TABLE 6 — device_registry
# ═══════════════════════════════════════════════════════════════════════

class DeviceRegistry(Base, SoftDeleteMixin, TenantMixin):
    __tablename__ = "device_registry"
    __table_args__ = (
        UniqueConstraint("user_id", name="uq_device_registry_user"),
        Index("ix_device_registry_user_id", "user_id"),
    )

    id          = Column(Integer, primary_key=True, index=True)
    user_id     = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"),   nullable=False)
    device_id   = Column(String(500), nullable=False)
    device_name = Column(String(255), nullable=True)
    device_os   = Column(String(100), nullable=True)
    is_active   = Column(Boolean, default=True, nullable=False)
    bound_at    = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    approved_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)

    # Relationships
    user     = relationship("User", foreign_keys=[user_id],     back_populates="device_registry")
    approver = relationship("User", foreign_keys=[approved_by])


# ═══════════════════════════════════════════════════════════════════════
# TABLE 7 — otp_log
# ═══════════════════════════════════════════════════════════════════════

class OTPLog(Base):
    __tablename__ = "otp_log"
    __table_args__ = (
        Index("ix_otp_log_user_id",    "user_id"),
        Index("ix_otp_log_expires_at", "expires_at"),
        Index("ix_otp_log_used",       "used"),
    )

    id         = Column(Integer, primary_key=True, index=True)
    user_id    = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    otp_hash   = Column(String(255), nullable=False)
    purpose    = Column(SAEnum(OTPPurpose, name="otppurpose"), nullable=False)
    channel    = Column(SAEnum(OTPChannel, name="otpchannel"), nullable=False)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    used       = Column(Boolean, default=False, nullable=False)
    used_at    = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    # Relationships
    user = relationship("User", back_populates="otp_logs")


# ═══════════════════════════════════════════════════════════════════════
# TABLE 8 — timetable
# ═══════════════════════════════════════════════════════════════════════

class Timetable(Base, SoftDeleteMixin, TenantMixin):
    __tablename__ = "timetable"
    __table_args__ = (
        UniqueConstraint("subject_id", "day_of_week", "start_time", name="uq_timetable_subject_day_start"),
        Index("ix_timetable_subject_id",  "subject_id"),
        Index("ix_timetable_teacher_id",  "teacher_id"),
        Index("ix_timetable_day_of_week", "day_of_week"),
        Index("ix_timetable_section_id",  "section_id"),
    )

    id            = Column(Integer, primary_key=True, index=True)
    subject_id    = Column(Integer, ForeignKey("subjects.id", ondelete="SET NULL"), nullable=True)  # NULL for TWM entries
    teacher_id    = Column(Integer, ForeignKey("users.id",    ondelete="CASCADE"), nullable=False)
    day_of_week   = Column(SAEnum(DayOfWeek, name="dayofweek"), nullable=False)
    start_time    = Column(String(10), nullable=False)   # HH:MM
    end_time      = Column(String(10), nullable=False)   # HH:MM
    room          = Column(String(50), nullable=True)
    section_id    = Column(Integer, ForeignKey("sections.id", ondelete="SET NULL"), nullable=True)
    period_number = Column(SmallInteger, nullable=True)  # 1st period, 2nd period, etc.
    is_lab        = Column(Boolean, default=False)       # lab sessions can be 2x duration
    color_tag     = Column(String(20), nullable=True)    # hex color for UI display
    is_twm        = Column(Boolean, default=False)       # True → TWM period (not a subject period)
    tutor_id      = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)

    # Relationships
    subject = relationship("Subject", back_populates="timetable_entries")
    teacher = relationship("User",    back_populates="timetable_entries", foreign_keys=[teacher_id])
    section = relationship("Section")
    tutor   = relationship("User",    foreign_keys=[tutor_id])


# ═══════════════════════════════════════════════════════════════════════
# TABLE 9 — attendance_sessions
# ═══════════════════════════════════════════════════════════════════════

class AttendanceSession(Base, SoftDeleteMixin, TenantMixin):
    __tablename__ = "attendance_sessions"
    __table_args__ = (
        UniqueConstraint("subject_id", "date", "section_id", name="uq_attendance_session_subject_date_section"),
        Index("ix_attendance_sessions_subject_id", "subject_id"),
        Index("ix_attendance_sessions_teacher_id", "teacher_id"),
        Index("ix_attendance_sessions_date",       "date"),
        Index("ix_attendance_sessions_status",     "status"),
        Index("ix_attendance_sessions_section_id", "section_id"),
    )

    id                = Column(Integer, primary_key=True, index=True)
    subject_id        = Column(Integer, ForeignKey("subjects.id",  ondelete="CASCADE"), nullable=False)
    teacher_id        = Column(Integer, ForeignKey("users.id",     ondelete="CASCADE"), nullable=False)
    section_id        = Column(Integer, ForeignKey("sections.id",  ondelete="SET NULL"), nullable=True)
    date              = Column(Date, nullable=False)
    start_time        = Column(Time, nullable=False)
    end_time          = Column(Time, nullable=True)
    status            = Column(SAEnum(SessionStatus, name="sessionstatus"), default=SessionStatus.active, nullable=False)
    teacher_latitude  = Column(Float, nullable=True)
    teacher_longitude = Column(Float, nullable=True)
    bluetooth_token   = Column(String(255), nullable=True)
    qr_secret         = Column(String(255), nullable=False)
    total_students    = Column(Integer, default=0, nullable=False)
    present_count     = Column(Integer, default=0, nullable=False)
    # ── ClassPulse Live integration (live_session_002) ───────────────
    session_type             = Column(String(20), default="offline", nullable=False)
    linked_live_session_id   = Column(Integer, ForeignKey("live_sessions.id", ondelete="SET NULL"), nullable=True)
    created_at        = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    # Relationships
    subject = relationship("Subject", back_populates="attendance_sessions")
    teacher = relationship("User",    back_populates="attendance_sessions")
    section = relationship("Section", back_populates="attendance_sessions")

    qr_tokens          = relationship("QRToken",          back_populates="session", cascade="all, delete-orphan")
    face_verify_tokens = relationship("FaceVerifyToken",  back_populates="session", cascade="all, delete-orphan")
    attendance_records = relationship("AttendanceRecord", back_populates="session", cascade="all, delete-orphan")
    audit_logs         = relationship("AttendanceAudit",  back_populates="session", cascade="all, delete-orphan")


# ═══════════════════════════════════════════════════════════════════════
# TABLE 10 — qr_tokens
# ═══════════════════════════════════════════════════════════════════════

class QRToken(Base, SoftDeleteMixin, TenantMixin):
    __tablename__ = "qr_tokens"
    __table_args__ = (
        UniqueConstraint("session_id", "time_slot", name="uq_qr_token_session_timeslot"),
        Index("ix_qr_tokens_session_id", "session_id"),
        Index("ix_qr_tokens_time_slot",  "time_slot"),
        Index("ix_qr_tokens_is_used",    "is_used"),
    )

    id         = Column(Integer, primary_key=True, index=True)
    session_id = Column(Integer, ForeignKey("attendance_sessions.id", ondelete="CASCADE"), nullable=False)
    token_hash = Column(String(255), nullable=False)
    time_slot  = Column(BigInteger, nullable=False)
    is_used    = Column(Boolean, default=False, nullable=False)
    used_by    = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    used_at    = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    # Relationships
    session    = relationship("AttendanceSession", back_populates="qr_tokens")
    used_by_user = relationship("User", foreign_keys=[used_by])


# ═══════════════════════════════════════════════════════════════════════
# TABLE 11 — face_verify_tokens
# ═══════════════════════════════════════════════════════════════════════

class FaceVerifyToken(Base, SoftDeleteMixin, TenantMixin):
    __tablename__ = "face_verify_tokens"
    __table_args__ = (
        Index("ix_face_verify_tokens_user_id",    "user_id"),
        Index("ix_face_verify_tokens_session_id", "session_id"),
        Index("ix_face_verify_tokens_expires_at", "expires_at"),
        Index("ix_face_verify_tokens_used",       "used"),
    )

    id         = Column(Integer, primary_key=True, index=True)
    user_id    = Column(Integer, ForeignKey("users.id",               ondelete="CASCADE"), nullable=False)
    token_hash = Column(String(255), nullable=False, unique=True)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    used       = Column(Boolean, default=False, nullable=False)
    session_id = Column(Integer, ForeignKey("attendance_sessions.id", ondelete="CASCADE"), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    # Relationships
    user    = relationship("User",              foreign_keys=[user_id])
    session = relationship("AttendanceSession", back_populates="face_verify_tokens")


# ═══════════════════════════════════════════════════════════════════════
# TABLE 12 — attendance_records
# ═══════════════════════════════════════════════════════════════════════

class AttendanceRecord(Base, SoftDeleteMixin, TenantMixin):
    __tablename__ = "attendance_records"
    __table_args__ = (
        UniqueConstraint("session_id", "student_id", name="uq_attendance_record_session_student"),
        Index("ix_attendance_records_session_id", "session_id"),
        Index("ix_attendance_records_student_id", "student_id"),
        Index("ix_attendance_records_status",     "status"),
        Index("ix_attendance_records_marked_at",  "marked_at"),
    )

    id                  = Column(Integer, primary_key=True, index=True)
    session_id          = Column(Integer, ForeignKey("attendance_sessions.id", ondelete="CASCADE"), nullable=False)
    student_id          = Column(Integer, ForeignKey("users.id",               ondelete="CASCADE"), nullable=False)
    status              = Column(SAEnum(AttendanceStatus, name="attendancestatus"), nullable=False)
    marked_at           = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    marked_by           = Column(SAEnum(MarkedBy, name="markedby"), nullable=False)
    face_verified       = Column(Boolean, default=False, nullable=False)
    gps_verified        = Column(Boolean, default=False, nullable=False)
    bluetooth_verified  = Column(Boolean, default=False, nullable=False)
    student_latitude    = Column(Float, nullable=True)
    student_longitude   = Column(Float, nullable=True)
    failure_reason      = Column(Text, nullable=True)

    # Relationships
    session = relationship("AttendanceSession", back_populates="attendance_records")
    student = relationship("User",              back_populates="attendance_records")


# ═══════════════════════════════════════════════════════════════════════
# TABLE 13 — attendance_audit
# ═══════════════════════════════════════════════════════════════════════

class AttendanceAudit(Base):
    __tablename__ = "attendance_audit"
    __table_args__ = (
        Index("ix_attendance_audit_session_id",  "session_id"),
        Index("ix_attendance_audit_student_id",  "student_id"),
        Index("ix_attendance_audit_attempt_at",  "attempt_at"),
        Index("ix_attendance_audit_result",      "result"),
    )

    id                  = Column(Integer, primary_key=True, index=True)
    session_id          = Column(Integer, ForeignKey("attendance_sessions.id", ondelete="CASCADE"), nullable=False)
    student_id          = Column(Integer, ForeignKey("users.id",               ondelete="CASCADE"), nullable=False)
    attempt_at          = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    result              = Column(SAEnum(AuditResult, name="auditresult"), nullable=False)
    failure_reason      = Column(Text, nullable=True)
    face_confidence     = Column(Float, nullable=True)
    gps_distance_meters = Column(Float, nullable=True)
    bluetooth_detected  = Column(Boolean, nullable=True)
    device_id           = Column(String(500), nullable=True)
    ip_address          = Column(String(45), nullable=True)   # IPv4 or IPv6

    # Relationships
    session = relationship("AttendanceSession", back_populates="audit_logs")
    student = relationship("User", foreign_keys=[student_id])


# ═══════════════════════════════════════════════════════════════════════
# TABLE 14 — alerts_log
# ═══════════════════════════════════════════════════════════════════════

class AlertsLog(Base):
    __tablename__ = "alerts_log"
    __table_args__ = (
        Index("ix_alerts_log_student_id", "student_id"),
        Index("ix_alerts_log_sent_at",    "sent_at"),
        Index("ix_alerts_log_status",     "status"),
    )

    id          = Column(Integer, primary_key=True, index=True)
    student_id  = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    alert_type  = Column(String(100), nullable=False)
    message     = Column(Text, nullable=False)
    sent_at     = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    status      = Column(SAEnum(AlertStatus,  name="alertstatus"),  nullable=False)
    channel     = Column(SAEnum(AlertChannel, name="alertchannel"), nullable=False)
    external_id = Column(String(255), nullable=True)

    # Relationships
    student = relationship("User", back_populates="alerts")


# ═══════════════════════════════════════════════════════════════════════
# TABLE 15 — face_change_log
# ═══════════════════════════════════════════════════════════════════════

class FaceChangeLog(Base):
    __tablename__ = "face_change_log"
    __table_args__ = (
        Index("ix_face_change_log_student_id",  "student_id"),
        Index("ix_face_change_log_changed_by",  "changed_by"),
        Index("ix_face_change_log_changed_at",  "changed_at"),
    )

    id                  = Column(Integer, primary_key=True, index=True)
    student_id          = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    changed_by          = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    old_azure_person_id = Column(String(255), nullable=True)
    new_azure_person_id = Column(String(255), nullable=True)
    reason              = Column(Text, nullable=False)
    changed_at          = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    # Relationships
    student = relationship("User", foreign_keys=[student_id], back_populates="face_change_logs")
    changer = relationship("User", foreign_keys=[changed_by])


# ═══════════════════════════════════════════════════════════════════════
# TABLE 16 — liveness_challenges (anti-spoofing challenge store)
# ═══════════════════════════════════════════════════════════════════════

class LivenessChallenge(Base):
    __tablename__ = "liveness_challenges"
    __table_args__ = (
        Index("ix_liveness_challenges_student_id", "student_id"),
        Index("ix_liveness_challenges_expires_at", "expires_at"),
        Index("ix_liveness_challenges_used",       "used"),
    )

    id         = Column(Integer, primary_key=True, index=True)
    student_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    challenge  = Column(String(50),  nullable=False)   # blink|smile|turn_left|turn_right|open_mouth
    expires_at = Column(DateTime(timezone=True), nullable=False)
    used       = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    # Relationships
    student = relationship("User", foreign_keys=[student_id])


# ═══════════════════════════════════════════════════════════════════════
# TABLE 17 — tutor_assignments
# ═══════════════════════════════════════════════════════════════════════

class TutorAssignment(Base, SoftDeleteMixin, TenantMixin):
    __tablename__ = "tutor_assignments"
    __table_args__ = (
        UniqueConstraint("student_id", "academic_year", name="uq_student_tutor_year"),
        Index("ix_tutor_assignments_tutor_id",      "tutor_id"),
        Index("ix_tutor_assignments_student_id",    "student_id"),
        Index("ix_tutor_assignments_academic_year", "academic_year"),
    )

    id            = Column(Integer, primary_key=True, index=True)
    tutor_id      = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"),  nullable=False)
    student_id    = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"),  nullable=False)
    academic_year = Column(String(20), nullable=False)          # "2024-25"
    assigned_by   = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    is_active     = Column(Boolean, default=True, nullable=False)
    note          = Column(String(255), nullable=True)
    assigned_at   = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    # Relationships
    tutor      = relationship("User", foreign_keys=[tutor_id],   backref="tutored_students")
    student    = relationship("User", foreign_keys=[student_id], backref="tutor_assignment")
    assigner   = relationship("User", foreign_keys=[assigned_by])


# ═══════════════════════════════════════════════════════════════════════
# TABLE 18 — twm_sessions
# ═══════════════════════════════════════════════════════════════════════

class TWMSession(Base, SoftDeleteMixin, TenantMixin):
    __tablename__ = "twm_sessions"
    __table_args__ = (
        Index("ix_twm_sessions_tutor_id", "tutor_id"),
        Index("ix_twm_sessions_date",     "date"),
    )

    id               = Column(Integer, primary_key=True, index=True)
    tutor_id         = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    academic_year    = Column(String(20), nullable=False)
    date             = Column(Date, nullable=False)
    start_time       = Column(Time, nullable=False)
    end_time         = Column(Time, nullable=True)
    notes            = Column(Text, nullable=True)
    status           = Column(SAEnum(SessionStatus, name="sessionstatus", create_type=False), default=SessionStatus.active)
    auto_report_sent = Column(Boolean, default=False)
    created_at       = Column(DateTime(timezone=True), server_default=func.now())

    # Relationships
    tutor      = relationship("User", foreign_keys=[tutor_id])
    attendance = relationship("TWMAttendance", back_populates="session", cascade="all, delete-orphan")


# ═══════════════════════════════════════════════════════════════════════
# TABLE 19 — twm_attendance
# ═══════════════════════════════════════════════════════════════════════

class TWMAttendance(Base, SoftDeleteMixin, TenantMixin):
    __tablename__ = "twm_attendance"
    __table_args__ = (
        UniqueConstraint("session_id", "student_id", name="uq_twm_attendance_session_student"),
        Index("ix_twm_attendance_session_id", "session_id"),
        Index("ix_twm_attendance_student_id", "student_id"),
    )

    id         = Column(Integer, primary_key=True, index=True)
    session_id = Column(Integer, ForeignKey("twm_sessions.id", ondelete="CASCADE"), nullable=False)
    student_id = Column(Integer, ForeignKey("users.id",        ondelete="CASCADE"), nullable=False)
    status     = Column(SAEnum(AttendanceStatus, name="attendancestatus", create_type=False), default=AttendanceStatus.absent)
    marked_at  = Column(DateTime(timezone=True), server_default=func.now())
    note       = Column(String(255), nullable=True)

    # Relationships
    session = relationship("TWMSession", back_populates="attendance")
    student = relationship("User", foreign_keys=[student_id])


# ═══════════════════════════════════════════════════════════════════════
# TABLE 20 — leave_requests
# ═══════════════════════════════════════════════════════════════════════

class LeaveRequest(Base, SoftDeleteMixin, TenantMixin):
    __tablename__ = "leave_requests"
    __table_args__ = (
        Index("ix_leave_requests_student_id", "student_id"),
        Index("ix_leave_requests_tutor_id",   "tutor_id"),
        Index("ix_leave_requests_status",     "status"),
    )

    id                  = Column(Integer, primary_key=True, index=True)
    student_id          = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    tutor_id            = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    leave_type          = Column(SAEnum(LeaveType, name="leavetype"), nullable=False)
    from_date           = Column(Date, nullable=False)
    to_date             = Column(Date, nullable=False)
    reason              = Column(Text, nullable=False)
    document_url        = Column(String(500), nullable=True)
    # S3 object key for supporting document (issues #45 / #116).
    # Stored as a key rather than a full URL so we can issue fresh
    # short-lived signed URLs on demand instead of leaking long-lived links.
    document_s3_key     = Column(String(500), nullable=True)
    status              = Column(SAEnum(LeaveRequestStatus, name="leaverequeststatus"), default=LeaveRequestStatus.pending)
    tutor_note          = Column(Text, nullable=True)
    reviewed_at         = Column(DateTime(timezone=True), nullable=True)
    reviewed_by         = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    attendance_updated  = Column(Boolean, default=False)
    created_at          = Column(DateTime(timezone=True), server_default=func.now())

    # Relationships
    student  = relationship("User", foreign_keys=[student_id])
    tutor    = relationship("User", foreign_keys=[tutor_id])
    reviewer = relationship("User", foreign_keys=[reviewed_by])


# ═══════════════════════════════════════════════════════════════════════
# TABLE — attendance_disputes  (PROMPT 7)
# ═══════════════════════════════════════════════════════════════════════

class DisputeStatus(str, enum.Enum):
    pending  = "pending"
    resolved = "resolved"
    rejected = "rejected"


class AttendanceDispute(Base, SoftDeleteMixin, TenantMixin):
    __tablename__ = "attendance_disputes"

    id              = Column(Integer, primary_key=True, index=True)
    student_id      = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    session_id      = Column(Integer, ForeignKey("attendance_sessions.id", ondelete="CASCADE"), nullable=False)
    reason          = Column(Text, nullable=False)
    proof_note      = Column(String(500), nullable=True)
    status          = Column(SAEnum(DisputeStatus, name="disputestatus"), default=DisputeStatus.pending, nullable=False)
    resolved_by     = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    resolved_at     = Column(DateTime(timezone=True), nullable=True)
    resolution_note = Column(Text, nullable=True)
    created_at      = Column(DateTime(timezone=True), server_default=func.now())

    # Relationships
    student  = relationship("User", foreign_keys=[student_id])
    session  = relationship("AttendanceSession")
    resolver = relationship("User", foreign_keys=[resolved_by])


# ═══════════════════════════════════════════════════════════════════════
# TABLE — career_roadmaps
# ═══════════════════════════════════════════════════════════════════════

class CareerRoadmap(Base, SoftDeleteMixin, TenantMixin):
    __tablename__ = "career_roadmaps"
    __table_args__ = (
        Index("ix_career_roadmaps_user_id", "user_id"),
    )

    id             = Column(Integer, primary_key=True, index=True)
    user_id        = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    user_role      = Column(String(20), nullable=False)
    career_goal    = Column(String(255), nullable=False)
    roadmap_data   = Column(JSONB, nullable=False)
    generated_at   = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    is_saved       = Column(Boolean, default=True, nullable=False)

    user = relationship("User")


# ═══════════════════════════════════════════════════════════════════════
# TABLE — suggestions  (Smart Suggestion Box)
# ═══════════════════════════════════════════════════════════════════════

class Suggestion(Base, SoftDeleteMixin, TenantMixin):
    __tablename__ = "suggestions"
    __table_args__ = (
        Index("ix_suggestions_user_id", "submitted_by_user_id"),
        Index("ix_suggestions_dept", "target_department_id"),
        Index("ix_suggestions_subject", "target_subject_id"),
    )

    id                    = Column(Integer, primary_key=True, index=True)
    submitted_by_user_id  = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    submitted_by_role     = Column(String(20), nullable=False)
    category              = Column(String(50), nullable=False)
    target_scope          = Column(String(30), nullable=False, default="general")
    target_subject_id     = Column(Integer, ForeignKey("subjects.id", ondelete="SET NULL"), nullable=True)
    target_department_id  = Column(Integer, ForeignKey("departments.id", ondelete="SET NULL"), nullable=True)
    message               = Column(Text, nullable=False)
    is_anonymous          = Column(Boolean, default=True, nullable=False)
    status                = Column(String(20), default="pending", nullable=False)
    priority              = Column(String(20), default="low", nullable=False)
    sentiment             = Column(String(20), nullable=True)
    submitted_at          = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    reviewed_at           = Column(DateTime(timezone=True), nullable=True)
    reviewed_by_role      = Column(String(20), nullable=True)
    admin_response        = Column(Text, nullable=True)

    submitter   = relationship("User", foreign_keys=[submitted_by_user_id])
    subject     = relationship("Subject")
    department  = relationship("Department")


# ═══════════════════════════════════════════════════════════════════════
# TABLE — suggestion_ai_reports
# ═══════════════════════════════════════════════════════════════════════

class SuggestionAIReport(Base, SoftDeleteMixin, TenantMixin):
    __tablename__ = "suggestion_ai_reports"
    __table_args__ = (
        Index("ix_suggestion_reports_scope", "scope", "scope_id"),
    )

    id                        = Column(Integer, primary_key=True, index=True)
    scope                     = Column(String(30), nullable=False)
    scope_id                  = Column(Integer, nullable=True)
    report_data               = Column(JSONB, nullable=False)
    generated_at              = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    total_suggestions_analysed = Column(Integer, nullable=False, default=0)
    ai_provider               = Column(String(20), nullable=False)


# ═══════════════════════════════════════════════════════════════════════
# ClassPulse — Session-Aware Learning Space
# ═══════════════════════════════════════════════════════════════════════

class CapsuleType(str, enum.Enum):
    notes                = "notes"
    slides               = "slides"
    reference            = "reference"
    assignment_material  = "assignment_material"
    lab_manual           = "lab_manual"
    previous_year        = "previous_year"
    formula_sheet        = "formula_sheet"


class CapsuleUnlockMode(str, enum.Enum):
    always                    = "always"
    session_active            = "session_active"
    after_attendance_marked   = "after_attendance_marked"
    attendance_gated          = "attendance_gated"


class CapsuleAccessAction(str, enum.Enum):
    view_attempt     = "view_attempt"
    view_granted     = "view_granted"
    view_denied      = "view_denied"
    download_attempt = "download_attempt"
    download_granted = "download_granted"
    download_denied  = "download_denied"
    quiz_start       = "quiz_start"
    quiz_submit      = "quiz_submit"
    quiz_pass        = "quiz_pass"
    quiz_fail        = "quiz_fail"


class WallPostStatus(str, enum.Enum):
    open      = "open"
    answered  = "answered"
    resolved  = "resolved"
    escalated = "escalated"


# ═══════════════════════════════════════════════════════════════════════
# TABLE — capsules  (ClassPulse content units)
# ═══════════════════════════════════════════════════════════════════════

class Capsule(Base, SoftDeleteMixin, TenantMixin):
    __tablename__ = "capsules"
    __table_args__ = (
        Index("ix_capsules_subject_id",  "subject_id"),
        Index("ix_capsules_teacher_id",  "teacher_id"),
        Index("ix_capsules_section_id",  "section_id"),
        Index("ix_capsules_is_active",   "is_active"),
        Index("ix_capsules_created_at",  "created_at"),
    )

    id                       = Column(Integer, primary_key=True, index=True)
    subject_id               = Column(Integer, ForeignKey("subjects.id", ondelete="CASCADE"), nullable=False)
    teacher_id               = Column(Integer, ForeignKey("users.id",    ondelete="CASCADE"), nullable=False)
    section_id               = Column(Integer, ForeignKey("sections.id", ondelete="SET NULL"), nullable=True)
    title                    = Column(String(200), nullable=False)
    description              = Column(Text, nullable=True)
    capsule_type             = Column(SAEnum(CapsuleType, name="capsuletype"), default=CapsuleType.notes, nullable=False)
    file_url                 = Column(String(500), nullable=True)
    file_name                = Column(String(255), nullable=True)
    file_size_kb             = Column(Integer, nullable=True)
    file_mime_type           = Column(String(100), nullable=True)
    voice_memo_url           = Column(String(500), nullable=True)
    voice_memo_duration_sec  = Column(Integer, nullable=True)
    ai_summary               = Column(Text, nullable=True)
    ai_quiz_json             = Column(JSONB, nullable=True)
    ai_processed             = Column(Boolean, default=False, nullable=False)
    unlock_mode              = Column(SAEnum(CapsuleUnlockMode, name="capsuleunlockmode"), default=CapsuleUnlockMode.always, nullable=False)
    min_attendance_pct       = Column(Float, default=75.0, nullable=False)
    is_active                = Column(Boolean, default=True, nullable=False)
    view_count               = Column(Integer, default=0, nullable=False)
    download_count           = Column(Integer, default=0, nullable=False)
    # ── HOD Featured (PROMPT 6) ───────────────────────────────────────
    featured                 = Column(Boolean, default=False, nullable=False)
    featured_by              = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    featured_at              = Column(DateTime(timezone=True), nullable=True)
    # ── Auto-generated capsule (PROMPT 6 — Live Sessions) ─────────────
    is_auto_generated        = Column(Boolean, default=False, nullable=False)
    source_live_session_id   = Column(Integer, ForeignKey("live_sessions.id", ondelete="SET NULL", use_alter=True, name="fk_capsules_source_live_session_id"), nullable=True)
    chapters                 = Column(JSONB, nullable=True)
    student_specific_notes   = Column(JSONB, nullable=True)
    homework_suggestion      = Column(Text, nullable=True)
    recording_url            = Column(String(500), nullable=True)
    created_at               = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at               = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    # Relationships
    subject      = relationship("Subject", backref="capsules")
    teacher      = relationship("User",    foreign_keys=[teacher_id], backref="capsules_created")
    section      = relationship("Section", foreign_keys=[section_id])
    interactions = relationship("CapsuleInteraction", back_populates="capsule", cascade="all, delete-orphan")
    wall_posts   = relationship("ClassWallPost",      back_populates="capsule")
    source_live_session = relationship("LiveSession", foreign_keys=[source_live_session_id], post_update=True)
    access_logs  = relationship("CapsuleAccessLog",   back_populates="capsule", cascade="all, delete-orphan")


# ═══════════════════════════════════════════════════════════════════════
# TABLE — capsule_interactions
# ═══════════════════════════════════════════════════════════════════════

class CapsuleInteraction(Base, SoftDeleteMixin, TenantMixin):
    __tablename__ = "capsule_interactions"
    __table_args__ = (
        UniqueConstraint("capsule_id", "student_id", name="uq_capsule_interaction_capsule_student"),
        Index("ix_capsule_interactions_capsule_id", "capsule_id"),
        Index("ix_capsule_interactions_student_id", "student_id"),
    )

    id                    = Column(Integer, primary_key=True, index=True)
    capsule_id            = Column(Integer, ForeignKey("capsules.id", ondelete="CASCADE"), nullable=False)
    student_id            = Column(Integer, ForeignKey("users.id",    ondelete="CASCADE"), nullable=False)
    first_opened_at       = Column(DateTime(timezone=True), nullable=True)
    last_opened_at        = Column(DateTime(timezone=True), nullable=True)
    total_time_spent_sec  = Column(Integer, default=0, nullable=False)
    pages_viewed          = Column(Integer, default=0, nullable=False)
    total_pages           = Column(Integer, default=0, nullable=False)
    completion_pct        = Column(Float, default=0.0, nullable=False)
    quiz_attempted        = Column(Boolean, default=False, nullable=False)
    quiz_score            = Column(Integer, default=0, nullable=False)
    quiz_answers_json     = Column(JSONB, nullable=True)
    quiz_passed           = Column(Boolean, default=False, nullable=False)
    download_attempted    = Column(Boolean, default=False, nullable=False)
    download_allowed      = Column(Boolean, default=False, nullable=False)
    watermarked_url       = Column(String(500), nullable=True)
    # ── Quiz retry support (PROMPT 6) ─────────────────────────────────
    quiz_attempts_count   = Column(Integer, default=0, nullable=False)
    last_quiz_at          = Column(DateTime(timezone=True), nullable=True)
    created_at            = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at            = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    # Relationships
    capsule = relationship("Capsule", back_populates="interactions")
    student = relationship("User",    foreign_keys=[student_id], backref="capsule_interactions")


# ═══════════════════════════════════════════════════════════════════════
# TABLE — class_wall_posts
# ═══════════════════════════════════════════════════════════════════════

class ClassWallPost(Base, SoftDeleteMixin, TenantMixin):
    __tablename__ = "class_wall_posts"
    __table_args__ = (
        Index("ix_class_wall_posts_subject_id", "subject_id"),
        Index("ix_class_wall_posts_section_id", "section_id"),
        Index("ix_class_wall_posts_student_id", "student_id"),
        Index("ix_class_wall_posts_capsule_id", "capsule_id"),
        Index("ix_class_wall_posts_status",     "status"),
        Index("ix_class_wall_posts_is_hot",     "is_hot"),
    )

    id                    = Column(Integer, primary_key=True, index=True)
    subject_id            = Column(Integer, ForeignKey("subjects.id", ondelete="CASCADE"), nullable=False)
    section_id            = Column(Integer, ForeignKey("sections.id", ondelete="SET NULL"), nullable=True)
    student_id            = Column(Integer, ForeignKey("users.id",    ondelete="CASCADE"), nullable=False)
    capsule_id            = Column(Integer, ForeignKey("capsules.id", ondelete="SET NULL"), nullable=True)
    live_session_id       = Column(Integer, ForeignKey("live_sessions.id", ondelete="SET NULL"), nullable=True)
    page_number           = Column(Integer, nullable=True)
    content               = Column(Text, nullable=False)
    ai_suggested_answer   = Column(Text, nullable=True)
    ai_answer_confidence  = Column(Float, nullable=True)
    teacher_answer        = Column(Text, nullable=True)
    teacher_answered_by   = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    teacher_answered_at   = Column(DateTime(timezone=True), nullable=True)
    resonance_count       = Column(Integer, default=0, nullable=False)
    status                = Column(SAEnum(WallPostStatus, name="wallpoststatus"), default=WallPostStatus.open, nullable=False)
    is_hot                = Column(Boolean, default=False, nullable=False)
    is_anonymous_to_peers = Column(Boolean, default=True, nullable=False)
    created_at            = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at            = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    # Relationships
    subject     = relationship("Subject")
    section     = relationship("Section", foreign_keys=[section_id])
    student     = relationship("User",    foreign_keys=[student_id], backref="wall_posts")
    capsule     = relationship("Capsule", back_populates="wall_posts")
    answerer    = relationship("User",    foreign_keys=[teacher_answered_by])
    resonances  = relationship("ClassWallResonance", back_populates="post", cascade="all, delete-orphan")


# ═══════════════════════════════════════════════════════════════════════
# TABLE — class_wall_resonances
# ═══════════════════════════════════════════════════════════════════════

class ClassWallResonance(Base, SoftDeleteMixin, TenantMixin):
    __tablename__ = "class_wall_resonances"
    __table_args__ = (
        UniqueConstraint("post_id", "student_id", name="uq_class_wall_resonance_post_student"),
        Index("ix_class_wall_resonances_post_id",    "post_id"),
        Index("ix_class_wall_resonances_student_id", "student_id"),
    )

    id         = Column(Integer, primary_key=True, index=True)
    post_id    = Column(Integer, ForeignKey("class_wall_posts.id", ondelete="CASCADE"), nullable=False)
    student_id = Column(Integer, ForeignKey("users.id",            ondelete="CASCADE"), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    # Relationships
    post    = relationship("ClassWallPost", back_populates="resonances")
    student = relationship("User", foreign_keys=[student_id])


# ═══════════════════════════════════════════════════════════════════════
# TABLE — capsule_access_logs
# ═══════════════════════════════════════════════════════════════════════

class CapsuleAccessLog(Base):
    __tablename__ = "capsule_access_logs"
    __table_args__ = (
        Index("ix_capsule_access_logs_capsule_id", "capsule_id"),
        Index("ix_capsule_access_logs_user_id",    "user_id"),
        Index("ix_capsule_access_logs_action",     "action"),
        Index("ix_capsule_access_logs_created_at", "created_at"),
    )

    id          = Column(Integer, primary_key=True, index=True)
    capsule_id  = Column(Integer, ForeignKey("capsules.id", ondelete="CASCADE"), nullable=False)
    user_id     = Column(Integer, ForeignKey("users.id",    ondelete="CASCADE"), nullable=False)
    action      = Column(SAEnum(CapsuleAccessAction, name="capsuleaccessaction"), nullable=False)
    deny_reason = Column(String(200), nullable=True)
    ip_address  = Column(String(45), nullable=True)
    user_agent  = Column(String(500), nullable=True)
    created_at  = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    # Relationships
    capsule = relationship("Capsule", back_populates="access_logs")
    user    = relationship("User",    foreign_keys=[user_id])


# ═══════════════════════════════════════════════════════════════════════
# ClassPulse Live — live_sessions
# ═══════════════════════════════════════════════════════════════════════

class LiveSession(Base, SoftDeleteMixin, TenantMixin):
    __tablename__ = "live_sessions"
    __table_args__ = (
        Index("ix_live_sessions_join_link",  "join_link"),
        Index("ix_live_sessions_teacher_id", "teacher_id"),
        Index("ix_live_sessions_subject_id", "subject_id"),
        Index("ix_live_sessions_section_id", "section_id"),
        Index("ix_live_sessions_status",     "status"),
        Index("ix_live_sessions_created_at", "created_at"),
    )

    id                       = Column(Integer, primary_key=True, index=True)
    session_type             = Column(SAEnum(LiveSessionType, name="livesessiontype"), nullable=False)
    title                    = Column(String(200), nullable=False)
    teacher_id               = Column(Integer, ForeignKey("users.id",     ondelete="CASCADE"), nullable=False)
    subject_id               = Column(Integer, ForeignKey("subjects.id",  ondelete="SET NULL"), nullable=True)
    section_id               = Column(Integer, ForeignKey("sections.id",  ondelete="SET NULL"), nullable=True)
    capsule_id               = Column(Integer, ForeignKey("capsules.id",  ondelete="SET NULL"), nullable=True)
    timetable_id             = Column(Integer, ForeignKey("timetable.id", ondelete="SET NULL"), nullable=True)
    status                   = Column(SAEnum(LiveSessionStatus, name="livesessionstatus"), default=LiveSessionStatus.waiting, nullable=False)
    join_link                = Column(String(100), unique=True, nullable=False)
    join_password            = Column(String(100), nullable=True)
    max_guests               = Column(Integer, default=50, nullable=False)
    allow_guests             = Column(Boolean, default=False, nullable=False)
    allow_guest_interaction  = Column(Boolean, default=False, nullable=False)
    recording_enabled        = Column(Boolean, default=True,  nullable=False)
    recording_url            = Column(String(500), nullable=True)
    transcript_text          = Column(Text, nullable=True)
    ai_session_log           = Column(JSONB, nullable=True)
    session_health_score     = Column(Integer, nullable=True)
    health_report_json       = Column(JSONB, nullable=True)
    auto_capsule_id          = Column(Integer, ForeignKey("capsules.id", ondelete="SET NULL"), nullable=True)
    started_at               = Column(DateTime(timezone=True), nullable=True)
    ended_at                 = Column(DateTime(timezone=True), nullable=True)
    duration_minutes         = Column(Integer, nullable=True)
    created_at               = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    teacher       = relationship("User",    foreign_keys=[teacher_id])
    subject       = relationship("Subject", foreign_keys=[subject_id])
    section       = relationship("Section", foreign_keys=[section_id])
    capsule       = relationship("Capsule", foreign_keys=[capsule_id])
    auto_capsule  = relationship("Capsule", foreign_keys=[auto_capsule_id])
    participants  = relationship("LiveSessionParticipant", back_populates="live_session", cascade="all, delete-orphan")
    events        = relationship("LiveSessionEvent",       back_populates="live_session", cascade="all, delete-orphan")
    pulse_checks  = relationship("PulseCheck",             back_populates="live_session", cascade="all, delete-orphan")
    breakout_rooms = relationship("LiveSessionBreakoutRoom", back_populates="live_session", cascade="all, delete-orphan")


# ═══════════════════════════════════════════════════════════════════════
# ClassPulse Live — live_session_participants
# ═══════════════════════════════════════════════════════════════════════

class LiveSessionParticipant(Base, SoftDeleteMixin, TenantMixin):
    __tablename__ = "live_session_participants"
    __table_args__ = (
        Index("ix_lsp_live_session_id", "live_session_id"),
        Index("ix_lsp_user_id",         "user_id"),
        Index("ix_lsp_is_active",       "is_active"),
    )

    id                      = Column(Integer, primary_key=True, index=True)
    live_session_id         = Column(Integer, ForeignKey("live_sessions.id", ondelete="CASCADE"), nullable=False)
    user_id                 = Column(Integer, ForeignKey("users.id",         ondelete="SET NULL"), nullable=True)
    participant_type        = Column(SAEnum(LiveParticipantType, name="liveparticipanttype"), nullable=False)
    guest_name              = Column(String(100), nullable=True)
    guest_email             = Column(String(200), nullable=True)
    joined_at               = Column(DateTime(timezone=True), nullable=True)
    left_at                 = Column(DateTime(timezone=True), nullable=True)
    total_duration_seconds  = Column(Integer, default=0, nullable=False)
    is_attendance_counted   = Column(Boolean, default=False, nullable=False)
    attendance_record_id    = Column(Integer, ForeignKey("attendance_records.id", ondelete="SET NULL"), nullable=True)
    last_heartbeat          = Column(DateTime(timezone=True), nullable=True)
    is_active               = Column(Boolean, default=False, nullable=False)
    camera_on               = Column(Boolean, default=False, nullable=False)
    mic_on                  = Column(Boolean, default=False, nullable=False)
    connection_quality      = Column(SAEnum(LiveConnectionQuality, name="liveconnectionquality"), default=LiveConnectionQuality.good, nullable=False)
    liveness_check_passed   = Column(Boolean, default=False, nullable=False)
    liveness_check_time     = Column(DateTime(timezone=True), nullable=True)
    agora_uid               = Column(BigInteger, nullable=True)

    live_session = relationship("LiveSession", back_populates="participants")
    user         = relationship("User", foreign_keys=[user_id])


# ═══════════════════════════════════════════════════════════════════════
# ClassPulse Live — live_session_events
# ═══════════════════════════════════════════════════════════════════════

class LiveSessionEvent(Base, SoftDeleteMixin, TenantMixin):
    __tablename__ = "live_session_events"
    __table_args__ = (
        Index("ix_lse_live_session_id", "live_session_id"),
        Index("ix_lse_event_type",      "event_type"),
        Index("ix_lse_event_timestamp", "event_timestamp"),
    )

    id                    = Column(Integer, primary_key=True, index=True)
    live_session_id       = Column(Integer, ForeignKey("live_sessions.id", ondelete="CASCADE"), nullable=False)
    event_type            = Column(SAEnum(LiveEventType, name="liveeventtype"), nullable=False)
    event_timestamp       = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    triggered_by          = Column(SAEnum(LiveEventTrigger, name="liveeventtrigger"), nullable=False)
    affected_student_ids  = Column(JSONB, nullable=True)
    ai_observation_text   = Column(Text, nullable=True)
    teacher_action_taken  = Column(String(500), nullable=True)
    metadata_json         = Column(JSONB, nullable=True)

    live_session = relationship("LiveSession", back_populates="events")


# ═══════════════════════════════════════════════════════════════════════
# ClassPulse Live — pulse_checks
# ═══════════════════════════════════════════════════════════════════════

class PulseCheck(Base, SoftDeleteMixin, TenantMixin):
    __tablename__ = "pulse_checks"
    __table_args__ = (
        Index("ix_pulse_checks_live_session_id", "live_session_id"),
        Index("ix_pulse_checks_triggered_at",    "triggered_at"),
    )

    id                    = Column(Integer, primary_key=True, index=True)
    live_session_id       = Column(Integer, ForeignKey("live_sessions.id", ondelete="CASCADE"), nullable=False)
    question_text         = Column(Text, nullable=False)
    option_a              = Column(String(300), nullable=False)
    option_b              = Column(String(300), nullable=False)
    option_c              = Column(String(300), nullable=False)
    option_d              = Column(String(300), nullable=False)
    correct_answer        = Column(SAEnum(PulseCheckAnswer, name="pulsecheckanswer"), nullable=False)
    explanation           = Column(Text, nullable=True)
    triggered_by          = Column(SAEnum(PulseCheckTrigger, name="pulsechecktrigger"), nullable=False)
    triggered_at          = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    duration_seconds      = Column(Integer, default=30, nullable=False)
    closed_at             = Column(DateTime(timezone=True), nullable=True)
    total_responses       = Column(Integer, default=0, nullable=False)
    correct_responses     = Column(Integer, default=0, nullable=False)
    response_distribution = Column(JSONB, nullable=True)
    ai_analysis           = Column(Text, nullable=True)

    live_session = relationship("LiveSession", back_populates="pulse_checks")


# ═══════════════════════════════════════════════════════════════════════
# Live Pulse Check (F04) — lightweight teacher-sent MCQ poll
# Independent of the older `pulse_checks` table; supports guests via
# participant_id and is broadcast over the live WebSocket.
# ═══════════════════════════════════════════════════════════════════════

class LivePulseCheck(Base, SoftDeleteMixin, TenantMixin):
    __tablename__ = "live_pulse_checks"
    __table_args__ = (
        Index("ix_live_pulse_checks_session_id", "live_session_id"),
    )

    id              = Column(Integer, primary_key=True, index=True)
    live_session_id = Column(Integer, ForeignKey("live_sessions.id", ondelete="CASCADE"), nullable=False)
    question        = Column(String(500), nullable=False)
    option_a        = Column(String(200), nullable=False)
    option_b        = Column(String(200), nullable=False)
    option_c        = Column(String(200), nullable=False)
    option_d        = Column(String(200), nullable=False)
    correct_option  = Column(String(1), nullable=True)        # "A"|"B"|"C"|"D" or NULL
    duration_secs   = Column(Integer, default=30, nullable=False)
    sent_at         = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    closed_at       = Column(DateTime(timezone=True), nullable=True)
    is_active       = Column(Boolean, default=True, nullable=False)
    ai_insight      = Column(Text, nullable=True)
    # cached aggregates
    total_responses = Column(Integer, default=0, nullable=False)
    correct_count   = Column(Integer, default=0, nullable=False)
    option_a_count  = Column(Integer, default=0, nullable=False)
    option_b_count  = Column(Integer, default=0, nullable=False)
    option_c_count  = Column(Integer, default=0, nullable=False)
    option_d_count  = Column(Integer, default=0, nullable=False)


class LivePulseResponse(Base, SoftDeleteMixin, TenantMixin):
    __tablename__ = "live_pulse_responses"
    __table_args__ = (
        UniqueConstraint("pulse_id", "participant_id", name="uq_live_pulse_participant"),
        Index("ix_live_pulse_responses_pulse_id", "pulse_id"),
    )

    id              = Column(Integer, primary_key=True, index=True)
    pulse_id        = Column(Integer, ForeignKey("live_pulse_checks.id", ondelete="CASCADE"), nullable=False)
    live_session_id = Column(Integer, ForeignKey("live_sessions.id", ondelete="CASCADE"), nullable=False)
    participant_id  = Column(Integer, ForeignKey("live_session_participants.id", ondelete="SET NULL"), nullable=True)
    student_id      = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    guest_name      = Column(String(100), nullable=True)
    chosen_option   = Column(String(1), nullable=False)        # "A"|"B"|"C"|"D"
    is_correct      = Column(Boolean, nullable=True)
    answered_at     = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)


# ═══════════════════════════════════════════════════════════════════════
# Live Session Observation (F01) — AI Brain panel observations
# ═══════════════════════════════════════════════════════════════════════

class LiveSessionObservation(Base, SoftDeleteMixin, TenantMixin):
    __tablename__ = "live_session_observations"
    __table_args__ = (
        Index("ix_live_session_observations_session_id", "live_session_id"),
        Index("ix_live_session_observations_created_at", "created_at"),
    )

    id              = Column(Integer, primary_key=True, index=True)
    live_session_id = Column(Integer, ForeignKey("live_sessions.id", ondelete="CASCADE"), nullable=False)
    obs_type        = Column(String(50), nullable=True)   # confusion|pace|engagement|positive|...
    message         = Column(Text, nullable=True)
    suggestion      = Column(Text, nullable=True)
    severity        = Column(String(20), nullable=True)   # low|medium|high
    created_at      = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    is_read         = Column(Boolean, default=False, nullable=False)


# ═══════════════════════════════════════════════════════════════════════
# Student Topic Mastery (F06) — per-student, per-topic mastery score.
# Updated after each live session from pulse-check accuracy + capsule topics.
# ═══════════════════════════════════════════════════════════════════════

class StudentTopicMastery(Base, SoftDeleteMixin, TenantMixin):
    __tablename__ = "student_topic_mastery"
    __table_args__ = (
        UniqueConstraint("student_id", "subject_id", "topic", name="uq_student_topic"),
        Index("ix_student_topic_mastery_student_id", "student_id"),
        Index("ix_student_topic_mastery_subject_id", "subject_id"),
    )

    id              = Column(Integer, primary_key=True, index=True)
    student_id      = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    subject_id      = Column(Integer, ForeignKey("subjects.id", ondelete="CASCADE"), nullable=False)
    topic           = Column(String(200), nullable=False)
    mastery_pct     = Column(Float, default=50.0, nullable=False)   # 0-100
    sessions_seen   = Column(Integer, default=0, nullable=False)
    last_updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


# ═══════════════════════════════════════════════════════════════════════
# Student Pre-class Warmup (F13) — personalised warmup per student per session.
# ═══════════════════════════════════════════════════════════════════════

class StudentPreclassWarmup(Base, SoftDeleteMixin, TenantMixin):
    __tablename__ = "student_preclass_warmups"
    __table_args__ = (
        UniqueConstraint("student_id", "session_id", name="uq_student_preclass_warmup"),
        Index("ix_student_preclass_warmups_student_id", "student_id"),
        Index("ix_student_preclass_warmups_session_id", "session_id"),
    )

    id           = Column(Integer, primary_key=True, index=True)
    student_id   = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    session_id   = Column(Integer, ForeignKey("live_sessions.id", ondelete="CASCADE"), nullable=False)
    subject_id   = Column(Integer, ForeignKey("subjects.id", ondelete="CASCADE"), nullable=False)
    warmup_type  = Column(String(50), nullable=True)         # "refresher" | "preview" | "catchup"
    content      = Column(Text, nullable=True)
    focus_topics = Column(JSONB, nullable=True)              # ["Recursion", "Pointers"]
    is_sent      = Column(Boolean, default=False, nullable=False)
    created_at   = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)


# ═══════════════════════════════════════════════════════════════════════
# F02 — live engagement snapshots + per-student engagement
# ═══════════════════════════════════════════════════════════════════════

class LiveEngagementSnapshot(Base, SoftDeleteMixin, TenantMixin):
    """Recorded every ~5 minutes during a live session.

    Tracks the engagement level of the whole class at that moment so the
    teacher dashboard can render a timeline bar chart (F02).
    """
    __tablename__ = "live_engagement_snapshots"
    __table_args__ = (
        Index("ix_les_session_id",  "session_id"),
        Index("ix_les_recorded_at", "recorded_at"),
    )

    id              = Column(Integer, primary_key=True, index=True)
    session_id      = Column(Integer, ForeignKey("live_sessions.id", ondelete="CASCADE"), nullable=False)
    recorded_at     = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    elapsed_mins    = Column(Integer, nullable=True)
    total_students  = Column(Integer, nullable=True)
    active_students = Column(Integer, nullable=True)
    engagement_pct  = Column(Float, nullable=True)
    event_label     = Column(String(120), nullable=True)


class LiveStudentEngagement(Base, SoftDeleteMixin, TenantMixin):
    """Per-student engagement counters during a live session (F02)."""
    __tablename__ = "live_student_engagement"
    __table_args__ = (
        UniqueConstraint("session_id", "student_id",     name="uq_session_student_engagement"),
        UniqueConstraint("session_id", "participant_id", name="uq_session_participant_engagement"),
        Index("ix_lse_session_id", "session_id"),
        Index("ix_lse_student_id", "student_id"),
    )

    id               = Column(Integer, primary_key=True, index=True)
    session_id       = Column(Integer, ForeignKey("live_sessions.id",             ondelete="CASCADE"), nullable=False)
    student_id       = Column(Integer, ForeignKey("users.id",                     ondelete="SET NULL"), nullable=True)
    participant_id   = Column(Integer, ForeignKey("live_session_participants.id", ondelete="SET NULL"), nullable=True)
    heartbeat_count  = Column(Integer, default=0, nullable=False)
    last_active_at   = Column(DateTime(timezone=True), nullable=True)
    response_count   = Column(Integer, default=0, nullable=False)
    doubt_count      = Column(Integer, default=0, nullable=False)
    engagement_label = Column(String(50), nullable=True)


# ═══════════════════════════════════════════════════════════════════════
# F03 — AI raises hand (interventions)
# ═══════════════════════════════════════════════════════════════════════

class LiveAIIntervention(Base, SoftDeleteMixin, TenantMixin):
    __tablename__ = "live_ai_interventions"
    __table_args__ = (
        Index("ix_lai_session_id",   "session_id"),
        Index("ix_lai_created_at",   "created_at"),
    )

    id           = Column(Integer, primary_key=True, index=True)
    session_id   = Column(Integer, ForeignKey("live_sessions.id", ondelete="CASCADE"), nullable=False)
    int_type     = Column(String(50), nullable=True)
    message      = Column(Text, nullable=True)
    suggestion   = Column(Text, nullable=True)
    severity     = Column(String(20), nullable=True)
    action_taken = Column(String(80), nullable=True)
    elapsed_mins = Column(Integer, nullable=True)
    created_at   = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)


# ═══════════════════════════════════════════════════════════════════════
# F09 — smart recording bookmarks / chapters
# ═══════════════════════════════════════════════════════════════════════

class LiveSessionBookmark(Base, SoftDeleteMixin, TenantMixin):
    __tablename__ = "live_session_bookmarks"
    __table_args__ = (
        Index("ix_lsb_session_id",   "session_id"),
        Index("ix_lsb_elapsed_secs", "elapsed_secs"),
    )

    id            = Column(Integer, primary_key=True, index=True)
    session_id    = Column(Integer, ForeignKey("live_sessions.id", ondelete="CASCADE"), nullable=False)
    elapsed_secs  = Column(Integer, nullable=True)
    elapsed_mins  = Column(Integer, nullable=True)
    bookmark_type = Column(String(50), nullable=True)
    title         = Column(String(200), nullable=True)
    description   = Column(Text, nullable=True)
    added_by      = Column(String(20), default="ai", nullable=False)
    recording_url = Column(String(500), nullable=True)
    created_at    = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)


# ═══════════════════════════════════════════════════════════════════════
# ClassPulse Live — student_knowledge_graphs
# ═══════════════════════════════════════════════════════════════════════

class StudentKnowledgeGraph(Base, SoftDeleteMixin, TenantMixin):
    __tablename__ = "student_knowledge_graphs"
    __table_args__ = (
        UniqueConstraint("student_id", "subject_id", "topic_name", name="uq_skg_student_subject_topic"),
        Index("ix_skg_student_id",  "student_id"),
        Index("ix_skg_subject_id",  "subject_id"),
        Index("ix_skg_topic_name",  "topic_name"),
    )

    id                        = Column(Integer, primary_key=True, index=True)
    student_id                = Column(Integer, ForeignKey("users.id",          ondelete="CASCADE"), nullable=False)
    subject_id                = Column(Integer, ForeignKey("subjects.id",       ondelete="CASCADE"), nullable=False)
    topic_name                = Column(String(200), nullable=False)
    understanding_level       = Column(SAEnum(KnowledgeLevel, name="knowledgelevel"), default=KnowledgeLevel.not_covered, nullable=False)
    confidence_score          = Column(Float, default=0.0, nullable=False)
    last_assessed_session_id  = Column(Integer, ForeignKey("live_sessions.id",  ondelete="SET NULL"), nullable=True)
    times_confused            = Column(Integer, default=0, nullable=False)
    times_understood          = Column(Integer, default=0, nullable=False)
    last_updated              = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)
    ai_notes                  = Column(Text, nullable=True)

    student            = relationship("User",    foreign_keys=[student_id])
    subject            = relationship("Subject", foreign_keys=[subject_id])
    last_session       = relationship("LiveSession", foreign_keys=[last_assessed_session_id])


# ═══════════════════════════════════════════════════════════════════════
# ClassPulse Live — live_session_breakout_rooms
# ═══════════════════════════════════════════════════════════════════════

class LiveSessionBreakoutRoom(Base, SoftDeleteMixin, TenantMixin):
    __tablename__ = "live_session_breakout_rooms"
    __table_args__ = (
        Index("ix_lsbr_live_session_id", "live_session_id"),
    )

    id                            = Column(Integer, primary_key=True, index=True)
    live_session_id               = Column(Integer, ForeignKey("live_sessions.id", ondelete="CASCADE"), nullable=False)
    room_name                     = Column(String(100), nullable=False)
    room_number                   = Column(Integer, nullable=False)
    participant_ids               = Column(JSONB, nullable=False)
    started_at                    = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    ended_at                      = Column(DateTime(timezone=True), nullable=True)
    ai_monitoring_log             = Column(JSONB, nullable=True)
    productivity_score            = Column(Integer, nullable=True)
    peer_expert_detected_user_id  = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    is_stuck                      = Column(Boolean, default=False, nullable=False)
    teacher_visited               = Column(Boolean, default=False, nullable=False)

    live_session = relationship("LiveSession", back_populates="breakout_rooms")
    peer_expert  = relationship("User", foreign_keys=[peer_expert_detected_user_id])


# ═══════════════════════════════════════════════════════════════════════
# Smart Replay — smart_replay_clips (issue #118)
# ═══════════════════════════════════════════════════════════════════════

class SmartReplayClip(Base, SoftDeleteMixin, TenantMixin):
    """A student doubt → AI-identified timeline segment for a past session.

    Created when a student submits a topic/doubt against a completed
    session. The AI (Gemini → Groq) inspects the event timeline and
    returns the offset range where the topic was covered. Records are
    retained for 30 days (a weekly scheduler job prunes older rows).
    """
    __tablename__ = "smart_replay_clips"
    __table_args__ = (
        Index("ix_src_session_id", "session_id"),
        Index("ix_src_student_id", "student_id"),
        Index("ix_src_created_at", "created_at"),
    )

    id                    = Column(Integer, primary_key=True, index=True)
    session_id            = Column(Integer, ForeignKey("live_sessions.id", ondelete="CASCADE"), nullable=False)
    student_id            = Column(Integer, ForeignKey("users.id",         ondelete="CASCADE"), nullable=False)
    topic                 = Column(String(300), nullable=False)
    doubt_text            = Column(Text, nullable=True)
    start_offset_seconds  = Column(Integer, nullable=True)
    end_offset_seconds    = Column(Integer, nullable=True)
    ai_confidence         = Column(Float, nullable=True)
    ai_explanation        = Column(Text, nullable=True)
    created_at            = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    live_session = relationship("LiveSession", foreign_keys=[session_id])
    student      = relationship("User", foreign_keys=[student_id])


# ═══════════════════════════════════════════════════════════════════════
# Security tables — login attempts, refresh tokens, GPS anti-spoof snapshots
# ═══════════════════════════════════════════════════════════════════════

class LoginAttemptLog(Base):
    """SIEM/audit trail — every login attempt regardless of outcome."""
    __tablename__ = "login_attempt_log"
    __table_args__ = (
        Index("ix_login_attempt_log_ip",          "ip_address"),
        Index("ix_login_attempt_log_identifier",  "user_identifier"),
        Index("ix_login_attempt_log_attempted",   "attempted_at"),
        Index("ix_login_attempt_log_success",     "success"),
    )

    id              = Column(Integer, primary_key=True, index=True)
    ip_address      = Column(String(64),  nullable=True)
    user_identifier = Column(String(255), nullable=True)
    success         = Column(Boolean, default=False, nullable=False)
    failure_reason  = Column(String(255), nullable=True)
    user_agent      = Column(String(500), nullable=True)
    attempted_at    = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class RefreshToken(Base, SoftDeleteMixin, TenantMixin):
    """
    Persisted refresh tokens (rotation chain).
    Only the SHA-256 hash of the raw token is stored.
    """
    __tablename__ = "refresh_tokens"
    __table_args__ = (
        Index("ix_refresh_tokens_user_id",  "user_id"),
        Index("ix_refresh_tokens_hash",     "token_hash", unique=True),
        Index("ix_refresh_tokens_expires",  "expires_at"),
    )

    id                = Column(Integer, primary_key=True, index=True)
    user_id           = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    token_hash        = Column(String(255), nullable=False)
    device_id         = Column(String(500), nullable=True)
    created_at        = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    expires_at        = Column(DateTime(timezone=True), nullable=False)
    revoked           = Column(Boolean, default=False, nullable=False)
    revoked_at        = Column(DateTime(timezone=True), nullable=True)
    replaced_by_hash  = Column(String(255), nullable=True)

    user = relationship("User")


class StudentGPSSnapshot(Base, SoftDeleteMixin, TenantMixin):
    """
    Last GPS reading a student submitted (for velocity / teleport detection).
    One row per student — upserted on every attendance attempt.
    """
    __tablename__ = "student_gps_snapshots"
    __table_args__ = (
        UniqueConstraint("user_id", name="uq_student_gps_snapshot_user"),
        Index("ix_student_gps_snapshots_user_id", "user_id"),
    )

    id          = Column(Integer, primary_key=True, index=True)
    user_id     = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    latitude    = Column(Float, nullable=False)
    longitude   = Column(Float, nullable=False)
    recorded_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class SecurityEvent(Base, SoftDeleteMixin):
    """
    Structured security audit log. WARN and CRITICAL events are persisted here
    in addition to the JSONL file written by utils.security_logger.
    """
    __tablename__ = "security_events"
    __table_args__ = (
        Index("ix_security_events_timestamp",     "timestamp_utc"),
        Index("ix_security_events_event_type",    "event_type"),
        Index("ix_security_events_severity",      "severity"),
        Index("ix_security_events_user_id",       "user_id"),
        Index("ix_security_events_request_id",    "request_id"),
        Index("ix_security_events_ts_type",       "timestamp_utc", "event_type"),
    )

    id              = Column(Integer, primary_key=True, index=True)
    event_type      = Column(String(64),  nullable=False)
    severity        = Column(String(16),  nullable=False)
    timestamp_utc   = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    user_id         = Column(Integer, ForeignKey("users.id",     ondelete="SET NULL"), nullable=True)
    college_id      = Column(Integer, ForeignKey("colleges.id",  ondelete="SET NULL"), nullable=True)
    ip_address      = Column(String(64),  nullable=True)
    user_agent      = Column(String(500), nullable=True)
    request_id      = Column(String(36),  nullable=True)
    details         = Column(JSONB, nullable=True)


# ═══════════════════════════════════════════════════════════════════════
# Utilities
# ═══════════════════════════════════════════════════════════════════════

def get_db():
    """FastAPI dependency — yields a synchronous DB session, closes on exit."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def create_all_tables() -> None:
    """Create all tables if they do not exist. Use only for testing / initial setup.
    For production, always use Alembic migrations."""
    Base.metadata.create_all(bind=engine)
