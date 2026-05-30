"""
test_auth.py — Authentication & JWT (issue #77)

Covers:
* Valid login returns a JWT (staff + student flows).
* Wrong password is rejected with 401.
* The JWT carries the correct role and college_id.
* Expired tokens are rejected on protected endpoints.
* Super-admin login works and the token has no college_id.
"""

from datetime import UTC, datetime, timedelta

from jose import jwt

from config import settings
from tests.conftest import TEST_DEVICE_ID, TEST_PASSWORD
from utils.auth_utils import decode_access_token


def _teacher(seed, get_user):
    tid = seed.colleges[0]["departments"][0]["teacher_ids"][0]
    return get_user(tid)


def _student(seed, get_user):
    sid = seed.colleges[0]["departments"][0]["sections"][0]["student_ids"][0]
    return get_user(sid)


def test_staff_login_returns_access_token(client, seed, get_user):
    teacher = _teacher(seed, get_user)
    resp = client.post(
        "/api/auth/login",
        json={"identifier": teacher.email, "password": TEST_PASSWORD},
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["access_token"]
    assert data["role"] == "teacher"
    assert data["name"] == teacher.name


def test_student_login_returns_access_token(client, seed, get_user):
    student = _student(seed, get_user)
    resp = client.post(
        "/api/auth/login",
        json={"identifier": student.roll_number, "password": TEST_PASSWORD},
        headers={"X-Device-ID": TEST_DEVICE_ID, "X-Client-Type": "mobile"},
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["access_token"]
    assert data["role"] == "student"


def test_wrong_password_is_rejected(client, seed, get_user):
    teacher = _teacher(seed, get_user)
    resp = client.post(
        "/api/auth/login",
        json={"identifier": teacher.email, "password": "definitely-wrong"},
    )
    assert resp.status_code == 401, resp.text


def test_unknown_identifier_is_rejected(client, seed):
    resp = client.post(
        "/api/auth/login",
        json={"identifier": "nobody@nowhere.test", "password": TEST_PASSWORD},
    )
    assert resp.status_code == 401, resp.text


def test_jwt_contains_role_and_college_id(client, seed, get_user):
    teacher = _teacher(seed, get_user)
    resp = client.post(
        "/api/auth/login",
        json={"identifier": teacher.email, "password": TEST_PASSWORD},
    )
    token = resp.json()["access_token"]
    payload = decode_access_token(token)
    assert payload["role"] == "teacher"
    assert payload["college_id"] == teacher.college_id
    assert payload["id"] == teacher.id


def test_expired_token_is_rejected(client, seed, get_user):
    teacher = _teacher(seed, get_user)
    now = datetime.now(tz=UTC)
    expired = jwt.encode(
        {
            "sub": teacher.email,
            "id": teacher.id,
            "role": "teacher",
            "college_id": teacher.college_id,
            "department_id": teacher.department_id,
            "face_enrolled": True,
            "device_id": TEST_DEVICE_ID,
            "iat": now - timedelta(hours=2),
            "exp": now - timedelta(hours=1),
            "jti": "expired-token-test",
        },
        settings.SECRET_KEY,
        algorithm=settings.ALGORITHM,
    )
    resp = client.get(
        "/api/auth/me",
        headers={"Authorization": f"Bearer {expired}", "X-Device-ID": TEST_DEVICE_ID},
    )
    assert resp.status_code == 401, resp.text


def test_super_admin_login_has_no_college_id(client, seed, get_user):
    sa = get_user(seed.super_admin_id)
    resp = client.post(
        "/api/auth/login",
        json={"identifier": sa.email, "password": TEST_PASSWORD},
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["access_token"]
    assert data["role"] == "super_admin"
    payload = decode_access_token(data["access_token"])
    assert payload["college_id"] is None
