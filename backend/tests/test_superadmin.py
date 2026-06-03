"""
test_superadmin.py — Super-admin platform operations (issue #77)

Covers:
* Super-admin can create a college.
* Creating a principal triggers the (mocked) welcome email.
* A non-super-admin is denied access to /api/admin/* (403).
* Super-admin can reset any user's password.
"""

from unittest.mock import MagicMock, patch

from tests.conftest import TEST_PASSWORD, auth_headers


def _super_admin(seed, get_user):
    return get_user(seed.super_admin_id)


def _teacher(seed, get_user):
    return get_user(seed.colleges[0]["departments"][0]["teacher_ids"][0])


def test_super_admin_creates_college(client, seed, get_user):
    sa = _super_admin(seed, get_user)
    resp = client.post(
        "/api/admin/colleges",
        json={"name": "Freshly Minted College", "domain": "fresh.test.edu", "plan": "active"},
        headers=auth_headers(sa),
    )
    assert resp.status_code == 201, resp.text
    data = resp.json()
    assert data["id"]
    assert data["name"] == "Freshly Minted College"


def test_create_principal_sends_welcome_email(client, seed, get_user):
    sa = _super_admin(seed, get_user)
    create = client.post(
        "/api/admin/colleges",
        json={"name": "Email College", "domain": "email.test.edu", "plan": "trial"},
        headers=auth_headers(sa),
    )
    college_id = create.json()["id"]

    mock_email = MagicMock(return_value=True)
    with patch("routes.superadmin._send_welcome_email_safe", mock_email):
        resp = client.post(
            f"/api/admin/colleges/{college_id}/principal",
            json={
                "name": "New Principal",
                "email": "new.principal@test.edu",
                "password": TEST_PASSWORD,
            },
            headers=auth_headers(sa),
        )
    assert resp.status_code == 201, resp.text
    assert mock_email.called


def test_regular_user_denied_admin_routes(client, seed, get_user):
    teacher = _teacher(seed, get_user)
    resp = client.get("/api/admin/colleges", headers=auth_headers(teacher))
    assert resp.status_code == 403, resp.text


def test_super_admin_resets_any_password(client, seed, get_user):
    sa = _super_admin(seed, get_user)
    teacher = _teacher(seed, get_user)
    new_password = "ResetPass789!"

    resp = client.post(
        f"/api/admin/users/{teacher.id}/reset-password",
        json={"new_password": new_password},
        headers=auth_headers(sa),
    )
    assert resp.status_code == 200, resp.text

    # The new password now works.
    login = client.post(
        "/api/auth/login",
        json={"identifier": teacher.email, "password": new_password},
    )
    assert login.status_code == 200, login.text
    assert login.json()["access_token"]
