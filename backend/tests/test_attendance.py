"""
test_attendance.py — Attendance sessions & marking (issue #77)

Covers:
* A teacher can start a session (records are created).
* A student can mark attendance in an open session (security checks mocked).
* Marking in a closed session returns HTTP 409 (session_closed).
* The session report reflects the present count / percentage.
* The student's GPS coordinates are persisted with the record.

The cryptographic / proximity checks (face token, QR, GPS, Bluetooth) are
mocked at the route boundary — we are testing the attendance *workflow*, not
the individual verifiers, which have their own units elsewhere.
"""

from contextlib import ExitStack, contextmanager
from datetime import date, time
from unittest.mock import patch

import pytest

from database import (
    AttendanceRecord,
    AttendanceSession,
    AttendanceStatus,
    SessionStatus,
)
from tests.conftest import auth_headers, TEST_DEVICE_ID


TEACHER_LAT, TEACHER_LON = 12.9716, 77.5946


def _subject_and_teacher(seed, get_user):
    subj = seed.colleges[0]["departments"][0]["subjects"][0]
    teacher = get_user(subj["teacher_id"])
    return subj, teacher


def _enrolled_student(seed, get_user):
    sid = seed.colleges[0]["departments"][0]["sections"][0]["student_ids"][0]
    return get_user(sid)


def _start_session(client, teacher, subject_id):
    return client.post(
        "/api/attendance/start-session",
        json={
            "subject_id": subject_id,
            "date": date.today().isoformat(),
            "teacher_latitude": TEACHER_LAT,
            "teacher_longitude": TEACHER_LON,
        },
        headers=auth_headers(teacher),
    )


def test_teacher_can_start_session(client, seed, get_user):
    subj, teacher = _subject_and_teacher(seed, get_user)
    resp = _start_session(client, teacher, subj["id"])
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["session_id"]
    assert data["total_students"] >= 1


@contextmanager
def _all_checks_pass():
    """Make every attendance security check pass for the duration of the block."""
    with ExitStack() as stack:
        stack.enter_context(patch("routes.attendance.validate_face_verify_token", return_value=True))
        stack.enter_context(patch("routes.attendance.validate_qr_token", return_value={"valid": True}))
        stack.enter_context(patch(
            "routes.attendance.verify_gps_proximity",
            return_value={"verified": True, "distance_meters": 10.0, "flagged_suspicious": False},
        ))
        stack.enter_context(patch("routes.attendance.verify_bluetooth_proximity", return_value={"verified": True}))
        yield


def test_student_marks_attendance_records_present_and_gps(client, seed, get_user, db_session):
    subj, teacher = _subject_and_teacher(seed, get_user)
    student = _enrolled_student(seed, get_user)

    start = _start_session(client, teacher, subj["id"])
    assert start.status_code == 200, start.text
    session_id = start.json()["session_id"]

    student_lat, student_lon = 12.9717, 77.5947
    with _all_checks_pass():
        resp = client.post(
            "/api/attendance/mark",
            json={
                "session_id": session_id,
                "face_token": "mock-face-token",
                "qr_data": "mock-qr-data",
                "student_latitude": student_lat,
                "student_longitude": student_lon,
                "student_gps_accuracy": 5.0,
                "bluetooth_token_detected": "mock-bt",
                "device_id": TEST_DEVICE_ID,
            },
            headers=auth_headers(student),
        )

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["success"] is True
    assert body["status"] == "present"

    # GPS coordinates persisted with the record.
    record = (
        db_session.query(AttendanceRecord)
        .filter(
            AttendanceRecord.session_id == session_id,
            AttendanceRecord.student_id == student.id,
        )
        .first()
    )
    assert record is not None
    assert record.status == AttendanceStatus.present
    assert record.student_latitude == pytest.approx(student_lat)
    assert record.student_longitude == pytest.approx(student_lon)


def test_marking_in_closed_session_returns_409(client, seed, get_user, db_session):
    subj, teacher = _subject_and_teacher(seed, get_user)
    student = _enrolled_student(seed, get_user)

    closed = AttendanceSession(
        subject_id=subj["id"],
        teacher_id=teacher.id,
        date=date.today(),
        start_time=time(9, 0),
        status=SessionStatus.ended,
        qr_secret="dummy-secret",
        teacher_latitude=TEACHER_LAT,
        teacher_longitude=TEACHER_LON,
    )
    db_session.add(closed)
    db_session.flush()

    resp = client.post(
        "/api/attendance/mark",
        json={
            "session_id": closed.id,
            "face_token": "x",
            "qr_data": "x",
            "student_latitude": 12.9717,
            "student_longitude": 77.5947,
            "student_gps_accuracy": 5.0,
            "device_id": TEST_DEVICE_ID,
        },
        headers=auth_headers(student),
    )
    assert resp.status_code == 409, resp.text
    assert resp.json()["detail"] == "session_closed"


def test_session_report_reflects_present_count(client, seed, get_user):
    subj, teacher = _subject_and_teacher(seed, get_user)
    student = _enrolled_student(seed, get_user)

    start = _start_session(client, teacher, subj["id"])
    session_id = start.json()["session_id"]
    total = start.json()["total_students"]

    with _all_checks_pass():
        mark = client.post(
            "/api/attendance/mark",
            json={
                "session_id": session_id,
                "face_token": "mock",
                "qr_data": "mock",
                "student_latitude": 12.9717,
                "student_longitude": 77.5947,
                "student_gps_accuracy": 5.0,
                "bluetooth_token_detected": "mock-bt",
                "device_id": TEST_DEVICE_ID,
            },
            headers=auth_headers(student),
        )
    assert mark.status_code == 200, mark.text

    report = client.get(
        f"/api/attendance/session/{session_id}",
        headers=auth_headers(teacher),
    )
    assert report.status_code == 200, report.text
    data = report.json()
    assert data["present_count"] == 1
    assert data["total_students"] == total
    expected_pct = round(100.0 / total, 2) if total else 0.0
    assert data["present_pct"] == pytest.approx(expected_pct, abs=0.5)
