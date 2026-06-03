"""
test_management_flows.py — End-to-end management flows (HOD / Principal).

These exercise the real route handlers that were broken by the
`Column is True` SQLAlchemy antipattern (which collapsed WHERE clauses to
`false`, making tutor assignment, section student listing, etc. silently
return nothing / 404). They are regression tests for that class of bug.

Covered:
* HOD adds a teacher, then assigns students to that teacher as their tutor.
* The tutor assignment is actually persisted and queryable.
* HOD lists students in a section (sections route uses the same pattern).
* Re-assigning the same student reports a conflict (force=False).
"""

from database import TutorAssignment, User, UserRole
from tests.conftest import auth_headers

ACADEMIC_YEAR = "2025-2026"


def _hod(seed, get_user):
    return get_user(seed.colleges[0]["departments"][0]["hod_id"])


def test_hod_add_teacher_then_assign_tutor(client, seed, get_user, db_session):
    hod = _hod(seed, get_user)
    dept = seed.colleges[0]["departments"][0]
    student_ids = dept["sections"][0]["student_ids"][:3]

    # 1. HOD creates a new teacher.
    resp = client.post(
        "/api/hod/add-teacher",
        json={"name": "Tutor Teacher", "email": "tutor.teacher@test.edu", "phone": "9876543210"},
        headers=auth_headers(hod),
    )
    assert resp.status_code == 201, resp.text
    tutor_id = resp.json()["id"]

    # 2. HOD assigns 3 students to that teacher as their tutor.
    resp = client.post(
        "/api/tutor/assign",
        json={
            "tutor_id": tutor_id,
            "student_ids": student_ids,
            "academic_year": ACADEMIC_YEAR,
        },
        headers=auth_headers(hod),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    # This is the assertion that FAILED before the is-True fix (assigned was 0
    # because the tutor lookup `User.is_active is True` collapsed to false → 404).
    assert body["assigned"] == 3, body
    assert body["tutor_name"] == "Tutor Teacher"

    # 3. The assignments are really persisted.
    persisted = (
        db_session.query(TutorAssignment)
        .filter(
            TutorAssignment.tutor_id == tutor_id,
            TutorAssignment.academic_year == ACADEMIC_YEAR,
        )
        .all()
    )
    assert len(persisted) == 3
    assert {a.student_id for a in persisted} == set(student_ids)


def test_reassign_same_student_reports_conflict(client, seed, get_user):
    hod = _hod(seed, get_user)
    dept = seed.colleges[0]["departments"][0]
    student_ids = dept["sections"][1]["student_ids"][:1]

    # Create two teachers.
    t1 = client.post(
        "/api/hod/add-teacher",
        json={"name": "Tutor One", "email": "tutor.one@test.edu"},
        headers=auth_headers(hod),
    ).json()["id"]
    t2 = client.post(
        "/api/hod/add-teacher",
        json={"name": "Tutor Two", "email": "tutor.two@test.edu"},
        headers=auth_headers(hod),
    ).json()["id"]

    first = client.post(
        "/api/tutor/assign",
        json={"tutor_id": t1, "student_ids": student_ids, "academic_year": ACADEMIC_YEAR},
        headers=auth_headers(hod),
    )
    assert first.status_code == 200, first.text
    assert first.json()["assigned"] == 1

    # Second assignment without force → conflict, not a silent overwrite.
    second = client.post(
        "/api/tutor/assign",
        json={"tutor_id": t2, "student_ids": student_ids, "academic_year": ACADEMIC_YEAR},
        headers=auth_headers(hod),
    )
    assert second.status_code == 200, second.text
    body = second.json()
    assert body["assigned"] == 0
    assert len(body["conflicts"]) == 1
    assert body["conflicts"][0]["existing_tutor"] == "Tutor One"


def test_hod_lists_section_students(client, seed, get_user):
    hod = _hod(seed, get_user)
    section_id = seed.colleges[0]["departments"][0]["sections"][0]["id"]

    resp = client.get(f"/api/sections/{section_id}/students", headers=auth_headers(hod))
    assert resp.status_code == 200, resp.text
    students = resp.json()
    payload = students["items"] if isinstance(students, dict) else students
    # Sections route filters with `User.is_active is True` — before the fix this
    # returned an empty list. Seed gives 10 students per section.
    assert len(payload) >= 1
