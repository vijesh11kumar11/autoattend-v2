"""
test_multitenancy.py — Tenant isolation (issue #77)

Multi-tenancy in this codebase is enforced at the *route* layer: handlers
filter by the caller's college_id / department_id rather than relying on the
(default-off) global ORM tenant filter. These tests exercise that real
behaviour.

Covers:
* A College-A HOD cannot list or read College-B sections / students.
* A College-A HOD cannot act on a College-B student's leave request.
* The super-admin can see every college.
* Creating a record auto-assigns the caller's college_id.
"""

from datetime import date, timedelta

from database import LeaveRequest, LeaveRequestStatus, LeaveType, User
from tests.conftest import auth_headers


def _hod(seed, college_idx, get_user):
    return get_user(seed.colleges[college_idx]["departments"][0]["hod_id"])


def test_hod_sections_list_excludes_other_college(client, seed, get_user):
    hod_a = _hod(seed, 0, get_user)
    b_section_id = seed.colleges[1]["departments"][0]["sections"][0]["id"]

    resp = client.get("/api/sections", headers=auth_headers(hod_a))
    assert resp.status_code == 200, resp.text
    returned_ids = {s["id"] for s in resp.json()}

    a_section_ids = {sec["id"] for sec in seed.colleges[0]["departments"][0]["sections"]}
    assert returned_ids == a_section_ids
    assert b_section_id not in returned_ids


def test_hod_cannot_read_other_college_section_students(client, seed, get_user):
    hod_a = _hod(seed, 0, get_user)
    b_section_id = seed.colleges[1]["departments"][0]["sections"][0]["id"]

    resp = client.get(
        f"/api/sections/{b_section_id}/students",
        headers=auth_headers(hod_a),
    )
    assert resp.status_code in (403, 404), resp.text


def test_hod_cannot_approve_other_college_leave(client, seed, get_user, db_session):
    hod_a = _hod(seed, 0, get_user)
    b_dept = seed.colleges[1]["departments"][0]
    b_student_id = b_dept["sections"][0]["student_ids"][0]
    b_hod_id = b_dept["hod_id"]

    leave = LeaveRequest(
        student_id=b_student_id,
        tutor_id=b_hod_id,
        leave_type=LeaveType.personal,
        from_date=date.today() + timedelta(days=1),
        to_date=date.today() + timedelta(days=1),
        reason="Family function",
        status=LeaveRequestStatus.pending,
    )
    db_session.add(leave)
    db_session.flush()

    resp = client.post(
        f"/api/leave/{leave.id}/approve",
        json={"note": "ok"},
        headers=auth_headers(hod_a),
    )
    assert resp.status_code == 403, resp.text


def test_super_admin_sees_all_colleges(client, seed, get_user):
    sa = get_user(seed.super_admin_id)
    resp = client.get("/api/admin/colleges", headers=auth_headers(sa))
    assert resp.status_code == 200, resp.text
    payload = resp.json()
    items = payload["items"] if isinstance(payload, dict) else payload
    names = {c["name"] for c in items}
    for college in seed.colleges:
        assert college["name"] in names


def test_added_teacher_inherits_hod_college(client, seed, get_user, db_session):
    hod_a = _hod(seed, 0, get_user)
    resp = client.post(
        "/api/hod/add-teacher",
        json={"name": "Brand New Teacher", "email": "brand.new.teacher@test.edu"},
        headers=auth_headers(hod_a),
    )
    assert resp.status_code == 201, resp.text
    new_id = resp.json()["id"]

    created = db_session.query(User).filter(User.id == new_id).first()
    assert created is not None
    assert created.college_id == hod_a.college_id
    assert created.department_id == hod_a.department_id
