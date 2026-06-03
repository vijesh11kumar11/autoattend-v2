"""
test_crud_lifecycle.py — Full create/read/update/delete lifecycles per role.

Exercises the real route handlers end-to-end for the management surfaces the
product depends on, across HOD / teacher / principal / super-admin. Several of
these paths were silently broken by the `Column is True` SQLAlchemy antipattern
fixed alongside these tests — they are regression coverage for that whole class
of "always returns nothing" bug.
"""

from database import Capsule, Section, TutorAssignment, User, UserRole
from tests.conftest import auth_headers

ACADEMIC_YEAR = "2025-2026"


def _hod(seed, get_user):
    return get_user(seed.colleges[0]["departments"][0]["hod_id"])


def _principal(seed, get_user):
    return get_user(seed.colleges[0]["principal_id"])


def _super_admin(seed, get_user):
    return get_user(seed.super_admin_id)


# ═══════════════════════════════════════════════════════════════════════
# SECTION (class) lifecycle — HOD
# ═══════════════════════════════════════════════════════════════════════


def test_section_full_lifecycle(client, seed, get_user, db_session):
    hod = _hod(seed, get_user)
    dept = seed.colleges[0]["departments"][0]
    course_id = dept["course_id"]

    # CREATE
    resp = client.post(
        "/api/sections",
        json={"course_id": course_id, "semester": 2, "name": "Z", "max_strength": 40},
        headers=auth_headers(hod),
    )
    assert resp.status_code == 201, resp.text
    section_id = resp.json()["id"]
    assert resp.json()["name"] == "Z"

    # READ (list)
    resp = client.get("/api/sections", headers=auth_headers(hod))
    assert resp.status_code == 200
    assert section_id in {s["id"] for s in resp.json()}

    # UPDATE
    resp = client.put(
        f"/api/sections/{section_id}",
        json={"name": "Y", "max_strength": 55},
        headers=auth_headers(hod),
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["name"] == "Y"
    assert resp.json()["max_strength"] == 55

    # DELETE
    resp = client.delete(f"/api/sections/{section_id}", headers=auth_headers(hod))
    assert resp.status_code == 204, resp.text
    assert db_session.query(Section).filter(Section.id == section_id).first() is None


def test_section_assign_and_remove_student(client, seed, get_user, db_session):
    hod = _hod(seed, get_user)
    dept = seed.colleges[0]["departments"][0]
    course_id = dept["course_id"]
    student_id = dept["sections"][0]["student_ids"][0]

    # New empty section.
    section_id = client.post(
        "/api/sections",
        json={"course_id": course_id, "semester": 3, "name": "W"},
        headers=auth_headers(hod),
    ).json()["id"]

    # Assign student into it.
    resp = client.post(
        "/api/sections/assign-students",
        json={"section_id": section_id, "student_ids": [student_id]},
        headers=auth_headers(hod),
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["assigned"] == 1

    # Listing the section shows the student (this path used `is_active is True`).
    resp = client.get(f"/api/sections/{section_id}/students", headers=auth_headers(hod))
    assert resp.status_code == 200, resp.text
    assert student_id in {s["id"] for s in resp.json()}

    # Remove the student.
    resp = client.post(
        "/api/sections/remove-student",
        json={"student_id": student_id},
        headers=auth_headers(hod),
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["removed"] is True

    db_session.expire_all()
    moved = db_session.query(User).filter(User.id == student_id).first()
    assert moved.section_id is None


# ═══════════════════════════════════════════════════════════════════════
# CAPSULE (ClassPulse) lifecycle — teacher
# ═══════════════════════════════════════════════════════════════════════


def test_capsule_create_list_delete(client, seed, get_user, db_session):
    dept = seed.colleges[0]["departments"][0]
    subject = dept["subjects"][0]
    teacher = get_user(subject["teacher_id"])
    subject_id = subject["id"]

    # CREATE (text-only capsule → no file, AI runs in background best-effort).
    resp = client.post(
        "/api/classpulse/capsule",
        data={
            "subject_id": str(subject_id),
            "title": "Intro to Trees",
            "description": "A binary tree is a hierarchical data structure.",
            "capsule_type": "notes",
            "unlock_mode": "always",
        },
        headers=auth_headers(teacher),
    )
    assert resp.status_code == 200, resp.text
    capsule_id = resp.json()["id"]

    # READ (teacher lists capsules for the subject).
    resp = client.get(
        f"/api/classpulse/teacher/subject/{subject_id}/capsules",
        headers=auth_headers(teacher),
    )
    assert resp.status_code == 200, resp.text
    items = resp.json()["capsules"]
    assert any(c["id"] == capsule_id for c in items)

    # DELETE (soft delete).
    resp = client.delete(
        f"/api/classpulse/capsule/{capsule_id}",
        headers=auth_headers(teacher),
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["is_active"] is False

    db_session.expire_all()
    cap = db_session.query(Capsule).filter(Capsule.id == capsule_id).first()
    assert cap is not None and cap.is_active is False


def test_capsule_other_teacher_cannot_delete(client, seed, get_user):
    dept = seed.colleges[0]["departments"][0]
    subject = dept["subjects"][0]
    owner = get_user(subject["teacher_id"])
    other = get_user(dept["subjects"][1]["teacher_id"])

    capsule_id = client.post(
        "/api/classpulse/capsule",
        data={
            "subject_id": str(subject["id"]),
            "title": "Owned Capsule",
            "description": "Some content here.",
        },
        headers=auth_headers(owner),
    ).json()["id"]

    resp = client.delete(
        f"/api/classpulse/capsule/{capsule_id}",
        headers=auth_headers(other),
    )
    assert resp.status_code == 403, resp.text


# ═══════════════════════════════════════════════════════════════════════
# TUTOR assign → remove — HOD
# ═══════════════════════════════════════════════════════════════════════


def test_tutor_assign_then_remove(client, seed, get_user, db_session):
    hod = _hod(seed, get_user)
    dept = seed.colleges[0]["departments"][0]
    tutor_id = dept["teacher_ids"][0]
    student_id = dept["sections"][2]["student_ids"][0]

    assign = client.post(
        "/api/tutor/assign",
        json={"tutor_id": tutor_id, "student_ids": [student_id], "academic_year": ACADEMIC_YEAR},
        headers=auth_headers(hod),
    )
    assert assign.status_code == 200, assign.text
    assert assign.json()["assigned"] == 1

    row = (
        db_session.query(TutorAssignment)
        .filter(
            TutorAssignment.tutor_id == tutor_id,
            TutorAssignment.student_id == student_id,
            TutorAssignment.academic_year == ACADEMIC_YEAR,
        )
        .first()
    )
    assert row is not None

    # REMOVE
    resp = client.delete(f"/api/tutor/remove/{row.id}", headers=auth_headers(hod))
    assert resp.status_code == 204, resp.text

    db_session.expire_all()
    assert (
        db_session.query(TutorAssignment).filter(TutorAssignment.id == row.id).first() is None
    )


# ═══════════════════════════════════════════════════════════════════════
# SUBJECT total-lectures — HOD
# ═══════════════════════════════════════════════════════════════════════


def test_hod_set_subject_total_lectures(client, seed, get_user):
    hod = _hod(seed, get_user)
    subject_id = seed.colleges[0]["departments"][0]["subjects"][0]["id"]

    resp = client.patch(
        f"/api/hod/subjects/{subject_id}/total-lectures?total_lectures=42",
        headers=auth_headers(hod),
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["total_lectures"] == 42


# ═══════════════════════════════════════════════════════════════════════
# SUPER-ADMIN college create/update/list
# ═══════════════════════════════════════════════════════════════════════


def test_superadmin_college_lifecycle(client, seed, get_user):
    sa = _super_admin(seed, get_user)

    created = client.post(
        "/api/admin/colleges",
        json={"name": "Lifecycle College", "domain": "lifecycle.test.edu", "plan": "active"},
        headers=auth_headers(sa),
    )
    assert created.status_code == 201, created.text
    college_id = created.json()["id"]

    updated = client.patch(
        f"/api/admin/colleges/{college_id}",
        json={"name": "Lifecycle College Renamed"},
        headers=auth_headers(sa),
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["name"] == "Lifecycle College Renamed"

    listing = client.get("/api/admin/colleges", headers=auth_headers(sa))
    assert listing.status_code == 200
    payload = listing.json()
    items = payload["items"] if isinstance(payload, dict) else payload
    assert any(c["id"] == college_id for c in items)


# ═══════════════════════════════════════════════════════════════════════
# Cross-role permission negatives
# ═══════════════════════════════════════════════════════════════════════


def test_teacher_cannot_create_section(client, seed, get_user):
    teacher = get_user(seed.colleges[0]["departments"][0]["teacher_ids"][0])
    course_id = seed.colleges[0]["departments"][0]["course_id"]
    resp = client.post(
        "/api/sections",
        json={"course_id": course_id, "semester": 1, "name": "Q"},
        headers=auth_headers(teacher),
    )
    assert resp.status_code == 403, resp.text


def test_student_cannot_add_teacher(client, seed, get_user):
    student_id = seed.colleges[0]["departments"][0]["sections"][0]["student_ids"][0]
    student = get_user(student_id)
    resp = client.post(
        "/api/hod/add-teacher",
        json={"name": "Hacker", "email": "hacker@test.edu"},
        headers=auth_headers(student),
    )
    assert resp.status_code == 403, resp.text
