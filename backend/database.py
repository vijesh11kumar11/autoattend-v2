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
    func,
)
from sqlalchemy.orm import DeclarativeBase, relationship, sessionmaker

from config import settings


# ═══════════════════════════════════════════════════════════════════════
# Python Enums  (names must match PostgreSQL type names below)
# ═══════════════════════════════════════════════════════════════════════

class UserRole(str, enum.Enum):
    principal = "principal"
    hod       = "hod"
    teacher   = "teacher"
    student   = "student"


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


# ═══════════════════════════════════════════════════════════════════════
# SQLAlchemy Base
# ═══════════════════════════════════════════════════════════════════════

class Base(DeclarativeBase):
    pass


# ═══════════════════════════════════════════════════════════════════════
# Engine & Session
# ═══════════════════════════════════════════════════════════════════════

engine = create_engine(
    settings.DATABASE_URL_SYNC,
    pool_pre_ping=True,
    pool_size=10,
    max_overflow=20,
    echo=settings.DEBUG,
)

SessionLocal = sessionmaker(
    bind=engine,
    autocommit=False,
    autoflush=False,
)


# ═══════════════════════════════════════════════════════════════════════
# TABLE 1 — colleges
# ═══════════════════════════════════════════════════════════════════════

class College(Base):
    __tablename__ = "colleges"

    id         = Column(Integer, primary_key=True, index=True)
    name       = Column(String(255), nullable=False)
    address    = Column(Text, nullable=True)
    phone      = Column(String(20), nullable=True)
    email      = Column(String(255), nullable=True)
    logo_url   = Column(String(500), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    # Relationships
    departments = relationship("Department", back_populates="college", cascade="all, delete-orphan")
    users       = relationship("User", back_populates="college")


# ═══════════════════════════════════════════════════════════════════════
# TABLE 2 — departments
# ═══════════════════════════════════════════════════════════════════════

class Department(Base):
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

class Course(Base):
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

class Section(Base):
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

class User(Base):
    __tablename__ = "users"
    __table_args__ = (
        Index("ix_users_college_id",    "college_id"),
        Index("ix_users_department_id", "department_id"),
        Index("ix_users_role",          "role"),
        Index("ix_users_is_active",     "is_active"),
    )

    id               = Column(Integer, primary_key=True, index=True)
    college_id       = Column(Integer, ForeignKey("colleges.id",    ondelete="CASCADE"),   nullable=False)
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
    timetable_entries  = relationship("Timetable", back_populates="teacher")
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

class Subject(Base):
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

class DeviceRegistry(Base):
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

class Timetable(Base):
    __tablename__ = "timetable"
    __table_args__ = (
        UniqueConstraint("subject_id", "day_of_week", "start_time", name="uq_timetable_subject_day_start"),
        Index("ix_timetable_subject_id",  "subject_id"),
        Index("ix_timetable_teacher_id",  "teacher_id"),
        Index("ix_timetable_day_of_week", "day_of_week"),
    )

    id          = Column(Integer, primary_key=True, index=True)
    subject_id  = Column(Integer, ForeignKey("subjects.id", ondelete="CASCADE"), nullable=False)
    teacher_id  = Column(Integer, ForeignKey("users.id",    ondelete="CASCADE"), nullable=False)
    day_of_week = Column(SAEnum(DayOfWeek, name="dayofweek"), nullable=False)
    start_time  = Column(String(10), nullable=False)   # HH:MM
    end_time    = Column(String(10), nullable=False)   # HH:MM
    room        = Column(String(50), nullable=True)

    # Relationships
    subject = relationship("Subject", back_populates="timetable_entries")
    teacher = relationship("User",    back_populates="timetable_entries")


# ═══════════════════════════════════════════════════════════════════════
# TABLE 9 — attendance_sessions
# ═══════════════════════════════════════════════════════════════════════

class AttendanceSession(Base):
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

class QRToken(Base):
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

class FaceVerifyToken(Base):
    __tablename__ = "face_verify_tokens"
    __table_args__ = (
        Index("ix_face_verify_tokens_user_id",    "user_id"),
        Index("ix_face_verify_tokens_session_id", "session_id"),
        Index("ix_face_verify_tokens_expires_at", "expires_at"),
        Index("ix_face_verify_tokens_used",       "used"),
    )

    id         = Column(Integer, primary_key=True, index=True)
    user_id    = Column(Integer, ForeignKey("users.id",               ondelete="CASCADE"), nullable=False)
    token      = Column(String(255), nullable=False, unique=True)
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

class AttendanceRecord(Base):
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

class TutorAssignment(Base):
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
