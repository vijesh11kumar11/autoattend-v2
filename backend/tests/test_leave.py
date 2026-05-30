"""
test_leave.py — Leave workflow (issue #77)

Covers:
* Student submits a leave request → pending.
* The reviewing HOD can approve → approved.
* The reviewing HOD can reject → rejected.
* A student cannot approve their own request (403).
* A leave with a supporting document (S3 key) is accepted.
"""

from datetime import date, timedelta

from database import LeaveRequest, LeaveRequestStatus
from tests.conftest import auth_headers


def _student(seed, get_user):
    sid = seed.colleges[0]["departments"][0]["sections"][0]["student_ids"][0]
    return get_user(sid)


def _hod(seed, get_user):
    return get_user(seed.colleges[0]["departments"][0]["hod_id"])


def _apply(client, student, *, leave_type="personal", document_url=None, document_s3_key=None):
    payload = {
        "leave_type": leave_type,
        "from_date": (date.today() + timedelta(days=1)).isoformat(),
        "to_date": (date.today() + timedelta(days=2)).isoformat(),
        "reason": "Out of station for a family event.",
    }
    if document_url:
        payload["document_url"] = document_url
    if document_s3_key:
        payload["document_s3_key"] = document_s3_key
    return client.post("/api/leave/apply", json=payload, headers=auth_headers(student))


def test_student_apply_creates_pending(client, seed, get_user):
    student = _student(seed, get_user)
    resp = _apply(client, student)
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["status"] == "pending"
    assert data["id"]


def test_hod_can_approve_leave(client, seed, get_user, db_session):
    student = _student(seed, get_user)
    hod = _hod(seed, get_user)

    apply_resp = _apply(client, student)
    leave_id = apply_resp.json()["id"]

    resp = client.post(
        f"/api/leave/{leave_id}/approve",
        json={"note": "Approved — take care."},
        headers=auth_headers(hod),
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "approved"

    lr = db_session.query(LeaveRequest).filter(LeaveRequest.id == leave_id).first()
    assert lr.status == LeaveRequestStatus.approved


def test_hod_can_reject_leave(client, seed, get_user, db_session):
    student = _student(seed, get_user)
    hod = _hod(seed, get_user)

    apply_resp = _apply(client, student)
    leave_id = apply_resp.json()["id"]

    resp = client.post(
        f"/api/leave/{leave_id}/reject",
        json={"note": "Insufficient justification."},
        headers=auth_headers(hod),
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "rejected"

    lr = db_session.query(LeaveRequest).filter(LeaveRequest.id == leave_id).first()
    assert lr.status == LeaveRequestStatus.rejected


def test_student_cannot_approve_own_leave(client, seed, get_user):
    student = _student(seed, get_user)
    apply_resp = _apply(client, student)
    leave_id = apply_resp.json()["id"]

    resp = client.post(
        f"/api/leave/{leave_id}/approve",
        json={"note": "self-approve attempt"},
        headers=auth_headers(student),
    )
    assert resp.status_code == 403, resp.text


def test_leave_with_document_is_accepted(client, seed, get_user):
    student = _student(seed, get_user)
    resp = _apply(
        client,
        student,
        leave_type="medical",
        document_url="https://example.test/doc.pdf",
        document_s3_key="leave-docs/medical-123.pdf",
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["status"] == "pending"
    assert data["document_s3_key"] == "leave-docs/medical-123.pdf"
