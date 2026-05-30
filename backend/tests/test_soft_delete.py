"""
test_soft_delete.py — Soft-delete semantics (issue #77)

Covers:
* Suspending a college soft-deletes it (is_deleted = True).
* A soft-deleted college disappears from ordinary (active) queries.
* The college's users are deactivated.
* The super-admin listing still includes the soft-deleted college.
"""

from database import College, User
from tests.conftest import auth_headers, TEST_PASSWORD


def _super_admin(seed, get_user):
    return get_user(seed.super_admin_id)


def _create_college_with_principal(client, sa):
    create = client.post(
        "/api/admin/colleges",
        json={"name": "Soft Delete College", "domain": "softdelete.test.edu", "plan": "trial"},
        headers=auth_headers(sa),
    )
    assert create.status_code == 201, create.text
    college_id = create.json()["id"]

    principal = client.post(
        f"/api/admin/colleges/{college_id}/principal",
        json={
            "name": "SD Principal",
            "email": "sd.principal@test.edu",
            "password": TEST_PASSWORD,
        },
        headers=auth_headers(sa),
    )
    assert principal.status_code == 201, principal.text
    return college_id, principal.json()["id"]


def test_suspend_soft_deletes_college(client, seed, get_user, db_session):
    sa = _super_admin(seed, get_user)
    college_id, principal_id = _create_college_with_principal(client, sa)

    patch = client.patch(
        f"/api/admin/colleges/{college_id}",
        json={"plan": "suspended"},
        headers=auth_headers(sa),
    )
    assert patch.status_code == 200, patch.text

    # Visible only with include_deleted → is_deleted flag set.
    raw = (
        db_session.query(College)
        .execution_options(include_deleted=True)
        .filter(College.id == college_id)
        .first()
    )
    assert raw is not None
    assert raw.is_deleted is True


def test_soft_deleted_college_absent_from_active_queries(client, seed, get_user, db_session):
    sa = _super_admin(seed, get_user)
    college_id, _ = _create_college_with_principal(client, sa)

    client.patch(
        f"/api/admin/colleges/{college_id}",
        json={"plan": "cancelled"},
        headers=auth_headers(sa),
    )

    active = db_session.query(College).filter(College.id == college_id).first()
    assert active is None


def test_soft_deleted_college_users_deactivated(client, seed, get_user, db_session):
    sa = _super_admin(seed, get_user)
    college_id, principal_id = _create_college_with_principal(client, sa)

    client.patch(
        f"/api/admin/colleges/{college_id}",
        json={"plan": "suspended"},
        headers=auth_headers(sa),
    )

    principal = db_session.query(User).filter(User.id == principal_id).first()
    assert principal is not None
    assert principal.is_active is False


def test_super_admin_still_sees_soft_deleted_college(client, seed, get_user):
    sa = _super_admin(seed, get_user)
    college_id, _ = _create_college_with_principal(client, sa)

    client.patch(
        f"/api/admin/colleges/{college_id}",
        json={"plan": "suspended"},
        headers=auth_headers(sa),
    )

    listing = client.get("/api/admin/colleges", headers=auth_headers(sa))
    assert listing.status_code == 200, listing.text
    payload = listing.json()
    items = payload["items"] if isinstance(payload, dict) else payload
    ids = {c["id"] for c in items}
    assert college_id in ids
