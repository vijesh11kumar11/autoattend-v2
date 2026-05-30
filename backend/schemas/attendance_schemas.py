"""
AutoAttend AI v2.0 — Attendance Pydantic Schemas
"""

from datetime import date, datetime, time
from typing import Optional

from pydantic import BaseModel, Field

# ═══════════════════════════════════════════════════════════════════════
# Session Management
# ═══════════════════════════════════════════════════════════════════════


class StartSessionRequest(BaseModel):
    subject_id: int
    section_id: Optional[int] = None
    date: date
    teacher_latitude: float = Field(..., ge=-90, le=90)
    teacher_longitude: float = Field(..., ge=-180, le=180)


class StartSessionResponse(BaseModel):
    session_id: int
    subject_name: str
    subject_code: str
    # The CURRENT 30-second BLE window token to broadcast.
    # The teacher app must re-fetch via GET /session/{id}/ble-token every
    # ~30 s and re-advertise.
    bluetooth_token: str
    bluetooth_window_seconds: int = 30  # seconds until the next rotation
    qr_secret_hint: str  # first 8 chars of qr_secret (for debug/display)
    total_students: int
    started_at: datetime


class EndSessionSummary(BaseModel):
    session_id: int
    total: int
    present: int
    absent: int
    percentage: float
    ended_at: datetime


# ═══════════════════════════════════════════════════════════════════════
# Attendance Marking
# ═══════════════════════════════════════════════════════════════════════


class MarkAttendanceRequest(BaseModel):
    session_id: int
    face_token: str
    qr_data: str  # "session_id:time_slot:hmac"
    student_latitude: float = Field(..., ge=-90, le=90)
    student_longitude: float = Field(..., ge=-180, le=180)
    student_gps_accuracy: float = Field(..., ge=0)
    bluetooth_token_detected: Optional[str] = None
    device_id: str
    # Client-supplied anti-spoof flag (Android only; expo-location's
    # Location.mocked). iOS always reports False — this is a hint, not a
    # guarantee. Defense-in-depth alongside accuracy + velocity checks.
    mock_location_detected: Optional[bool] = False
    # Mobile root/jailbreak heuristic (best-effort; principal reviews flagged events).
    is_rooted: Optional[bool] = False


class AttendanceChecks(BaseModel):
    face_verified: bool
    qr_valid: bool
    gps_verified: bool
    bluetooth_verified: bool
    device_matched: bool
    already_marked: bool


class AttendanceResultResponse(BaseModel):
    success: bool
    status: str  # "present" | "failed"
    message: str
    subject_name: Optional[str] = None
    marked_at: Optional[datetime] = None
    checks: AttendanceChecks


# ═══════════════════════════════════════════════════════════════════════
# Session Status (teacher view)
# ═══════════════════════════════════════════════════════════════════════


class StudentAttendanceEntry(BaseModel):
    student_id: int
    name: str
    roll_number: Optional[str]
    status: str
    marked_at: Optional[datetime]
    face_verified: bool
    gps_verified: bool
    bluetooth_verified: bool
    flagged: bool = False  # suspicious GPS or other flag


class SessionStatusResponse(BaseModel):
    session_id: int
    subject_name: str
    subject_code: str
    date: date
    start_time: time
    status: str
    total_students: int
    present_count: int
    absent_count: int
    present_pct: float
    students: list[StudentAttendanceEntry]


# ═══════════════════════════════════════════════════════════════════════
# Student Attendance Summary
# ═══════════════════════════════════════════════════════════════════════


class SubjectAttendanceSummary(BaseModel):
    subject_id: int
    subject_name: str
    subject_code: str
    semester: int
    total_sessions: int
    present: int
    absent: int
    percentage: float
    attendance_status: str  # "safe" | "warning" | "critical" | "detained"


class StudentAttendanceSummaryResponse(BaseModel):
    student_id: int
    student_name: str
    roll_number: Optional[str]
    subjects: list[SubjectAttendanceSummary]


# ═══════════════════════════════════════════════════════════════════════
# Manual Override
# ═══════════════════════════════════════════════════════════════════════


class ManualOverrideRequest(BaseModel):
    session_id: int
    student_id: int
    status: str = Field(..., pattern=r"^(present|absent|late|medical_leave|duty_leave)$")
    reason: str = Field(..., min_length=5, max_length=500)


# ═══════════════════════════════════════════════════════════════════════
# Recent records  (GET /student/{id}/recent)
# ═══════════════════════════════════════════════════════════════════════


class RecentAttendanceRecord(BaseModel):
    session_id: int
    subject_name: str
    subject_code: str
    date: str  # ISO date string YYYY-MM-DD
    status: str
    marked_via: str  # "qr_scan" | "manual" | "auto_absent"
    face_verified: bool


class StudentRecentResponse(BaseModel):
    student_id: int
    records: list[RecentAttendanceRecord]


# ═══════════════════════════════════════════════════════════════════════
# Calendar  (GET /student/{id}/calendar)
# ═══════════════════════════════════════════════════════════════════════


class CalendarSubjectEntry(BaseModel):
    subject_name: str
    subject_code: str
    status: str  # "present" | "absent" | "late" | ...


class CalendarDay(BaseModel):
    date: str  # ISO date YYYY-MM-DD
    day_code: str  # "P" | "A" | "L" | "M" | "D" | "" (no class)
    subjects: list[CalendarSubjectEntry]


class StudentCalendarResponse(BaseModel):
    student_id: int
    days: list[CalendarDay]
