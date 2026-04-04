"""
AutoAttend v2 — Simulate all 5 test flows via API and direct DB.
This script acts as an integration test that exercises the backend APIs.

Run:  python test_flows.py
"""

import sys, os, requests, json
sys.path.insert(0, os.path.dirname(__file__))

from datetime import datetime, date, time, timezone, timedelta
from database import SessionLocal, Base, engine
from database import (
    User, Subject, Section, AttendanceSession, AttendanceRecord,
    TutorAssignment, UserRole, SessionStatus, AttendanceStatus, MarkedBy,
)

# Suppress SQLAlchemy SQL echo
import logging
logging.getLogger("sqlalchemy.engine").setLevel(logging.WARNING)

BASE = "http://localhost:8000/api"

db = SessionLocal()

# ── Helper: login and get JWT ────────────────────────────────────
def login(email, password="password123"):
    r = requests.post(f"{BASE}/auth/login", json={
        "identifier": email,
        "password": password,
    }, headers={"X-Device-Id": "test-device-001"})
    if r.status_code != 200:
        print(f"❌ Login failed for {email}: {r.status_code} {r.text[:200]}")
        return None
    data = r.json()
    token = data.get("access_token")
    if not token:
        # TOTP required
        print(f"⚠️  Login for {email} requires TOTP (totp_enabled=True)")
        return None
    return token


def auth(token):
    return {"Authorization": f"Bearer {token}", "X-Device-Id": "test-device-001"}


# ── Lookups ──────────────────────────────────────────────────────
priya   = db.query(User).filter_by(email="priya.teacher@svec.edu.in").first()
section = db.query(Section).filter_by(semester=6, name="A").first()
ds_subj = db.query(Subject).filter_by(code="CS301").first()

students = (
    db.query(User)
    .filter(User.role == UserRole.student, User.semester == 6)
    .order_by(User.roll_number)
    .all()
)
print(f"ℹ️  Found {len(students)} students, subject={ds_subj.code}, section={section.name}")

# ══════════════════════════════════════════════════════════════════
# FLOW 1: Attendance Session
# ══════════════════════════════════════════════════════════════════
print("\n" + "=" * 60)
print("FLOW 1: Attendance Session (DS&A)")
print("=" * 60)

# Login as teacher
teacher_token = login("priya.teacher@svec.edu.in")
if not teacher_token:
    sys.exit(1)
print("✅ Teacher logged in")

# Start session via API
today = date.today().isoformat()
r = requests.post(f"{BASE}/attendance/start-session", json={
    "subject_id": ds_subj.id,
    "section_id": section.id,
    "date": today,
    "teacher_latitude": 13.6288,
    "teacher_longitude": 79.4192,
}, headers=auth(teacher_token))

if r.status_code != 200:
    print(f"❌ Start session failed: {r.status_code} {r.text}")
    sys.exit(1)

session_data = r.json()
session_id = session_data["session_id"]
total = session_data["total_students"]
print(f"✅ Session started: id={session_id}, total_students={total}")

# Simulate QR scan for students CS001-CS015 (15 out of 40 present)
# Since the multi-factor mark endpoint requires face_token, device_id, GPS, etc.,
# we'll directly update attendance records in DB (simulating what the endpoint does)
present_students = students[:15]  # CS001-CS015 present
for s in present_students:
    record = (
        db.query(AttendanceRecord)
        .filter_by(session_id=session_id, student_id=s.id)
        .first()
    )
    if record:
        record.status = AttendanceStatus.present
        record.marked_by = MarkedBy.qr_scan
        record.marked_at = datetime.now(tz=timezone.utc)

db.commit()
print(f"✅ Marked {len(present_students)} students present (CS001-CS015)")

# End session via API
r = requests.post(
    f"{BASE}/attendance/end-session/{session_id}",
    headers=auth(teacher_token),
)
if r.status_code != 200:
    print(f"❌ End session failed: {r.status_code} {r.text}")
else:
    end_data = r.json()
    print(f"✅ Session ended: present={end_data['present']}, absent={end_data['absent']}, "
          f"percentage={end_data['percentage']}%")

# Check via history API
r = requests.get(f"{BASE}/faculty/my-sessions", headers=auth(teacher_token))
if r.status_code == 200:
    sessions = r.json()
    print(f"✅ History shows {len(sessions)} session(s)")
    for sess in sessions:
        print(f"   {sess['subject_code']} | {sess['date']} | present={sess['present_count']}/{sess['total_students']}")

# ══════════════════════════════════════════════════════════════════
# FLOW 2: Ward Students
# ══════════════════════════════════════════════════════════════════
print("\n" + "=" * 60)
print("FLOW 2: Ward Students")
print("=" * 60)

r = requests.get(f"{BASE}/twm/dashboard", params={"academic_year": "2025-26"},
                 headers=auth(teacher_token))
if r.status_code == 200:
    dash = r.json()
    ward = dash.get("ward_students", [])
    print(f"✅ TWM Dashboard: {len(ward)} ward students")
    # Show a few
    for w in ward[:5]:
        pct = w.get("overall_pct", 0)
        status = w.get("attendance_status", "?")
        print(f"   {w.get('roll_number','?')} {w.get('name','?')}: {pct}% ({status})")
    if len(ward) > 5:
        print(f"   ... and {len(ward)-5} more")
else:
    print(f"⚠️  TWM Dashboard: {r.status_code} {r.text[:200]}")

# ══════════════════════════════════════════════════════════════════
# FLOW 3: Leave Request
# ══════════════════════════════════════════════════════════════════
print("\n" + "=" * 60)
print("FLOW 3: Leave Request (CS001)")
print("=" * 60)

# Login as student CS001
student_token = login("student01@svec.edu.in")
if student_token:
    print("✅ Student CS001 logged in")

    # Apply personal leave (medical requires document)
    leave_from = (date.today() + timedelta(days=1)).isoformat()
    leave_to   = (date.today() + timedelta(days=3)).isoformat()
    r = requests.post(f"{BASE}/leave/apply", json={
        "leave_type": "personal",
        "from_date": leave_from,
        "to_date": leave_to,
        "reason": "Family function — need to travel home for 3 days. Will submit all pending assignments on return.",
    }, headers=auth(student_token))

    if r.status_code == 200:
        leave_data = r.json()
        leave_id = leave_data.get("leave_id") or leave_data.get("id")
        print(f"✅ Leave applied: id={leave_id}, type=personal, {leave_from} to {leave_to}")
    else:
        print(f"❌ Leave apply failed: {r.status_code} {r.text[:200]}")
        leave_id = None

    # Teacher checks pending leaves
    r = requests.get(f"{BASE}/leave/pending", headers=auth(teacher_token))
    if r.status_code == 200:
        pending = r.json()
        print(f"✅ Teacher sees {len(pending)} pending leave(s)")
    else:
        print(f"⚠️  Pending leaves: {r.status_code}")

    # Teacher approves
    if leave_id:
        r = requests.post(f"{BASE}/leave/{leave_id}/approve", json={
            "note": "Approved. Get well soon. Submit medical certificate when you return.",
        }, headers=auth(teacher_token))
        if r.status_code == 200:
            print(f"✅ Leave approved by teacher")
        else:
            print(f"❌ Approve failed: {r.status_code} {r.text[:200]}")

    # Check leave summary
    r = requests.get(f"{BASE}/leave/summary", headers=auth(teacher_token))
    if r.status_code == 200:
        summary = r.json()
        print(f"✅ Leave summary: {summary}")
else:
    print("❌ Student login failed, skipping Flow 3")

# ══════════════════════════════════════════════════════════════════
# FLOW 4: TWM Meeting
# ══════════════════════════════════════════════════════════════════
print("\n" + "=" * 60)
print("FLOW 4: TWM Meeting")
print("=" * 60)

r = requests.post(f"{BASE}/twm/start", json={
    "date": today,
    "academic_year": "2025-26",
    "notes": "Mid-semester review: discussing attendance status and academic performance of ward students.",
}, headers=auth(teacher_token))

if r.status_code == 200:
    twm_data = r.json()
    twm_session_id = twm_data["session_id"]
    twm_total = twm_data["total"]
    print(f"✅ TWM session started: id={twm_session_id}, ward_students={twm_total}")

    # Mark 15 of 20 students as present (CS001-CS015)
    ward_students = twm_data.get("ward_students", [])
    records = []
    for i, ws in enumerate(ward_students):
        status = "present" if i < 15 else "absent"
        records.append({
            "student_id": ws["student_id"],
            "status": status,
            "note": "Present in TWM" if status == "present" else "",
        })

    r2 = requests.post(
        f"{BASE}/twm/{twm_session_id}/mark-bulk",
        json={"records": records},
        headers=auth(teacher_token),
    )
    if r2.status_code == 200:
        print(f"✅ Bulk marked: 15 present, 5 absent")
    else:
        print(f"❌ Bulk mark failed: {r2.status_code} {r2.text[:200]}")

    # End TWM session
    r3 = requests.post(f"{BASE}/twm/{twm_session_id}/end", headers=auth(teacher_token))
    if r3.status_code == 200:
        twm_end = r3.json()
        print(f"✅ TWM ended: present={twm_end.get('present')}, absent={twm_end.get('absent')}")
    else:
        print(f"❌ TWM end failed: {r3.status_code} {r3.text[:200]}")

    # Check ward report
    r4 = requests.get(f"{BASE}/twm/ward-combined-report",
                      params={"academic_year": "2025-26"},
                      headers=auth(teacher_token))
    if r4.status_code == 200:
        report = r4.json()
        print(f"✅ Ward combined report: {len(report)} students")
        for wr in report[:5]:
            print(f"   {wr.get('roll_number','?')}: overall={wr.get('overall_pct',0)}%, "
                  f"status={wr.get('attendance_status','?')}")
    else:
        print(f"⚠️  Ward report: {r4.status_code}")
else:
    print(f"❌ TWM start failed: {r.status_code} {r.text[:200]}")
    twm_session_id = None

# ══════════════════════════════════════════════════════════════════
# FLOW 5: Dispute (CS005 was absent, disputes it)
# ══════════════════════════════════════════════════════════════════
print("\n" + "=" * 60)
print("FLOW 5: Dispute (CS005)")
print("=" * 60)

# CS005 = students[4] (0-indexed). They were marked present in Flow 1.
# Let's use CS020 who was absent (students[19])
dispute_student = students[19]  # CS020 - was absent
print(f"ℹ️  Using {dispute_student.roll_number} ({dispute_student.name}) who was absent")

student5_token = login(f"student{20:02d}@svec.edu.in")
if student5_token:
    print(f"✅ {dispute_student.roll_number} logged in")

    # Check dashboard first
    r = requests.get(f"{BASE}/student/portal/dashboard", headers=auth(student5_token))
    if r.status_code == 200:
        dash = r.json()
        print(f"✅ Student dashboard loaded")
        recent = dash.get("recent_records", [])
        for rec in recent:
            print(f"   {rec.get('subject_name','?')} | {rec.get('date','?')} | "
                  f"status={rec.get('status','?')} | can_dispute={rec.get('can_dispute',False)}")

    # File dispute
    r = requests.post(f"{BASE}/student/portal/dispute-attendance", json={
        "session_id": session_id,
        "reason": "My phone battery died during the class so I could not scan the QR code. "
                  "I was physically present in the classroom. My classmates can verify.",
        "proof_note": "Seat number 15, can be verified by classmates CS018 and CS019.",
    }, headers=auth(student5_token))

    if r.status_code in (200, 201):
        dispute_data = r.json()
        dispute_id = dispute_data.get("dispute_id") or dispute_data.get("id")
        print(f"✅ Dispute filed: id={dispute_id}")
    else:
        print(f"❌ Dispute failed: {r.status_code} {r.text[:200]}")
        dispute_id = None

    # Teacher checks disputes
    r = requests.get(f"{BASE}/teacher/disputes/pending", headers=auth(teacher_token))
    if r.status_code == 200:
        disputes = r.json()
        print(f"✅ Teacher sees {len(disputes)} pending dispute(s)")
        for d in disputes:
            print(f"   Dispute #{d.get('id','?')}: {d.get('student_name','?')} | "
                  f"{d.get('reason','')[:60]}...")
    else:
        print(f"⚠️  Pending disputes: {r.status_code} {r.text[:200]}")

    # Teacher approves dispute
    if dispute_id:
        r = requests.post(f"{BASE}/teacher/disputes/{dispute_id}/resolve", json={
            "action": "approve",
            "note": "Verified with other students. Marking present.",
        }, headers=auth(teacher_token))
        if r.status_code == 200:
            print(f"✅ Dispute approved → student marked present")
        else:
            print(f"❌ Resolve failed: {r.status_code} {r.text[:200]}")

    # Verify attendance count updated
    db.expire_all()
    sess = db.query(AttendanceSession).filter_by(id=session_id).first()
    print(f"✅ Session present_count now: {sess.present_count}/{sess.total_students}")
else:
    print("❌ Student login failed, skipping Flow 5")

# ══════════════════════════════════════════════════════════════════
# FINAL VERIFICATION
# ══════════════════════════════════════════════════════════════════
print("\n" + "=" * 60)
print("FINAL VERIFICATION")
print("=" * 60)

# Teacher dashboard
r = requests.get(f"{BASE}/faculty/my-dashboard", headers=auth(teacher_token))
if r.status_code == 200:
    dash = r.json()
    print(f"✅ Teacher dashboard:")
    subjects = dash.get("subjects", [])
    for s in subjects:
        print(f"   {s.get('name','?')} ({s.get('code','?')}): "
              f"sessions={s.get('total_sessions',0)}, avg_pct={s.get('avg_attendance',0)}%")
    print(f"   Total sessions: {dash.get('total_sessions', 0)}")
else:
    print(f"⚠️  Dashboard: {r.status_code}")

# Check reports
r = requests.get(f"{BASE}/faculty/my-sessions", headers=auth(teacher_token))
if r.status_code == 200:
    sessions = r.json()
    print(f"✅ My sessions: {len(sessions)}")
    for sess in sessions:
        pct = round(sess['present_count'] / sess['total_students'] * 100) if sess['total_students'] else 0
        print(f"   {sess['subject_code']} | {sess['date']} | {sess['present_count']}/{sess['total_students']} ({pct}%)")

print("\n🎉 All flows completed! Refresh the browser to test the UI.")

db.close()
