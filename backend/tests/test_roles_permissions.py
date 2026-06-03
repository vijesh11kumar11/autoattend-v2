"""
test_roles_permissions.py — Role-based access control (issue #77)

Verifies the privilege ladder is enforced: each role is denied access to the
endpoints reserved for the tier above it.

* student  → teacher-only endpoint      → 403
* teacher  → HOD-only endpoint          → 403
* HOD      → principal-only endpoint    → 403
* principal→ super-admin-only endpoint  → 403
"""

from tests.conftest import auth_headers


def _user(seed, get_user, role):
    dept = seed.colleges[0]["departments"][0]
    if role == "student":
        return get_user(dept["sections"][0]["student_ids"][0])
    if role == "teacher":
        return get_user(dept["teacher_ids"][0])
    if role == "hod":
        return get_user(dept["hod_id"])
    if role == "principal":
        return get_user(seed.colleges[0]["principal_id"])
    raise ValueError(role)


def test_student_denied_teacher_endpoint(client, seed, get_user):
    student = _user(seed, get_user, "student")
    resp = client.get("/api/faculty/my-sessions", headers=auth_headers(student))
    assert resp.status_code == 403, resp.text


def test_teacher_denied_hod_endpoint(client, seed, get_user):
    teacher = _user(seed, get_user, "teacher")
    resp = client.get("/api/sections", headers=auth_headers(teacher))
    assert resp.status_code == 403, resp.text


def test_hod_denied_principal_endpoint(client, seed, get_user):
    hod = _user(seed, get_user, "hod")
    resp = client.get("/api/principal/stats", headers=auth_headers(hod))
    assert resp.status_code == 403, resp.text


def test_principal_denied_super_admin_endpoint(client, seed, get_user):
    principal = _user(seed, get_user, "principal")
    resp = client.get("/api/admin/colleges", headers=auth_headers(principal))
    assert resp.status_code == 403, resp.text
