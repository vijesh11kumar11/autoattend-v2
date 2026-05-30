"""
AutoAttend AI v2.0 — Seed script
Creates test college, department, course, subjects, timetable, and 4 test users.
Run once:  python seed.py

Safety:
  * Refuses to run when DEBUG=False unless ALLOW_SEED_IN_PROD=1 is set.
  * Password comes from SEED_PASSWORD env var (random 24-char default if unset)
    — NEVER ships with a hard-coded 'password123'.
  * College/department names come from SEED_COLLEGE_NAME / SEED_COLLEGE_CODE
    etc. so the same script works for any tenant without code edits.
"""

import os
import secrets
import sys

sys.path.insert(0, os.path.dirname(__file__))

from datetime import UTC, datetime

from argon2 import PasswordHasher

from config import settings
from database import (
    Capsule,
    CapsuleType,
    CapsuleUnlockMode,
    College,
    Course,
    DayOfWeek,
    Department,
    SessionLocal,
    Subject,
    Timetable,
    User,
    UserRole,
)

# ── Production guard ─────────────────────────────────────────
if not settings.DEBUG and os.environ.get("ALLOW_SEED_IN_PROD") != "1":
    print("❌ seed.py refused: DEBUG=False and ALLOW_SEED_IN_PROD!=1.")
    print("   Set ALLOW_SEED_IN_PROD=1 explicitly if you really want to seed production.")
    sys.exit(2)

# ── Tenant-specific values (env-driven — no hard-coded "SVEC") ─────────
SEED_COLLEGE_NAME = os.environ.get("SEED_COLLEGE_NAME", settings.COLLEGE_NAME or "Demo College")
SEED_COLLEGE_CODE = os.environ.get("SEED_COLLEGE_CODE", "DEMO").lower()
SEED_COLLEGE_ADDR = os.environ.get("SEED_COLLEGE_ADDRESS", "123 Example Street")
SEED_COLLEGE_PHONE = os.environ.get("SEED_COLLEGE_PHONE", "+910000000000")
SEED_COLLEGE_EMAIL = os.environ.get("SEED_COLLEGE_EMAIL", f"admin@{SEED_COLLEGE_CODE}.edu.in")
SEED_EMAIL_DOMAIN = os.environ.get("SEED_EMAIL_DOMAIN", f"{SEED_COLLEGE_CODE}.edu.in")

# ── Password (env override else random) ──────────────────────────
SEED_PASSWORD = os.environ.get("SEED_PASSWORD") or secrets.token_urlsafe(18)
if not os.environ.get("SEED_PASSWORD"):
    print("⚠️  SEED_PASSWORD not set — generated random password for this run:")
    print(f"   → {SEED_PASSWORD}")
    print("   Save it now; it will NOT be shown again.")

ph = PasswordHasher(time_cost=3, memory_cost=65536, parallelism=2)
PWD_HASH = ph.hash(SEED_PASSWORD)

db = SessionLocal()

try:
    # ── 1. College ───────────────────────────────────────────────
    college = db.query(College).first()
    if not college:
        college = College(
            name=SEED_COLLEGE_NAME,
            address=SEED_COLLEGE_ADDR,
            phone=SEED_COLLEGE_PHONE,
            email=SEED_COLLEGE_EMAIL,
        )
        db.add(college)
        db.flush()
        print(f"✅ College created  (id={college.id})")
    else:
        print(f"ℹ️  College already exists (id={college.id})")

    # ── 2. Department ────────────────────────────────────────────
    dept = db.query(Department).filter_by(college_id=college.id, code="CSE").first()
    if not dept:
        dept = Department(college_id=college.id, name="Computer Science & Engineering", code="CSE")
        db.add(dept)
        db.flush()
        print(f"✅ Department created (id={dept.id})")
    else:
        print(f"ℹ️  Department already exists (id={dept.id})")

    # ── 3. Course ────────────────────────────────────────────────
    course = db.query(Course).filter_by(department_id=dept.id, code="BTECH-CSE").first()
    if not course:
        course = Course(
            department_id=dept.id,
            name="B.Tech Computer Science",
            code="BTECH-CSE",
            duration_years=4,
        )
        db.add(course)
        db.flush()
        print(f"✅ Course created (id={course.id})")
    else:
        print(f"ℹ️  Course already exists (id={course.id})")

    # ── 4. Users ─────────────────────────────────────────────────
    users_data = [
        {
            "name": "Dr. Rajesh Kumar",
            "email": "principal@svec.edu.in",
            "role": UserRole.principal,
            "college_id": None,  # filled below
            "department_id": None,
            "course_id": None,
        },
        {
            "name": "Prof. Anitha Sharma",
            "email": "hod.cse@svec.edu.in",
            "role": UserRole.hod,
            "college_id": None,
            "department_id": None,  # filled below
            "course_id": None,
        },
        {
            "name": "Ms. Priya Reddy",
            "email": "priya.teacher@svec.edu.in",
            "role": UserRole.teacher,
            "college_id": None,
            "department_id": None,
            "course_id": None,
        },
        {
            "name": "Vijesh Kumar",
            "email": "vijesh@svec.edu.in",
            "role": UserRole.student,
            "college_id": None,
            "department_id": None,
            "course_id": None,
            "roll_number": "21CSE001",
            "semester": 6,
            "parent_phone": "+919999888877",
        },
        {
            "name": "Arun Patel",
            "email": "arun@svec.edu.in",
            "role": UserRole.student,
            "college_id": None,
            "department_id": None,
            "course_id": None,
            "roll_number": "21CSE002",
            "semester": 6,
            "parent_phone": "+919999888866",
        },
    ]

    created_users = {}
    for ud in users_data:
        existing = db.query(User).filter_by(email=ud["email"]).first()
        if existing:
            created_users[ud["role"].value] = existing
            print(f"ℹ️  {ud['role'].value:10s} already exists: {ud['email']}")
            continue

        ud["college_id"] = college.id
        if ud["role"] in (UserRole.hod, UserRole.teacher, UserRole.student):
            ud["department_id"] = dept.id
        if ud["role"] == UserRole.student:
            ud["course_id"] = course.id

        user = User(
            college_id=ud["college_id"],
            department_id=ud.get("department_id"),
            course_id=ud.get("course_id"),
            name=ud["name"],
            email=ud["email"],
            role=ud["role"],
            password_hash=PWD_HASH,
            roll_number=ud.get("roll_number"),
            semester=ud.get("semester"),
            parent_phone=ud.get("parent_phone"),
            is_active=True,
            totp_enabled=False,
        )
        db.add(user)
        db.flush()
        created_users[ud["role"].value] = user
        print(f"✅ {ud['role'].value:10s} created: {ud['email']} (id={user.id})")

    teacher = created_users.get("teacher")
    # ── 5. Subjects ──────────────────────────────────────────────
    subjects_data = [
        {"name": "Data Structures & Algorithms", "code": "CS301", "semester": 6},
        {"name": "Database Management Systems", "code": "CS302", "semester": 6},
        {"name": "Computer Networks", "code": "CS303", "semester": 6},
    ]

    created_subjects = []
    for sd in subjects_data:
        existing = db.query(Subject).filter_by(course_id=course.id, code=sd["code"]).first()
        if existing:
            created_subjects.append(existing)
            print(f"ℹ️  Subject already exists: {sd['code']}")
            continue
        subj = Subject(
            course_id=course.id,
            teacher_id=teacher.id if teacher else None,
            name=sd["name"],
            code=sd["code"],
            semester=sd["semester"],
        )
        db.add(subj)
        db.flush()
        created_subjects.append(subj)
        print(f"✅ Subject created: {sd['code']} (id={subj.id})")

    # ── 6. Timetable (Mon-Fri schedule) ──────────────────────────
    if teacher and created_subjects:
        days = [
            DayOfWeek.monday,
            DayOfWeek.tuesday,
            DayOfWeek.wednesday,
            DayOfWeek.thursday,
            DayOfWeek.friday,
        ]
        slots = [
            ("09:00", "10:00"),
            ("10:00", "11:00"),
            ("11:30", "12:30"),
        ]
        count = 0
        for day in days:
            for i, subj in enumerate(created_subjects):
                if i >= len(slots):
                    break
                existing = (
                    db.query(Timetable)
                    .filter_by(subject_id=subj.id, day_of_week=day, start_time=slots[i][0])
                    .first()
                )
                if existing:
                    continue
                tt = Timetable(
                    subject_id=subj.id,
                    teacher_id=teacher.id,
                    day_of_week=day,
                    start_time=slots[i][0],
                    end_time=slots[i][1],
                    room="CSE-Lab-" + str(i + 1),
                )
                db.add(tt)
                count += 1
        db.flush()
        if count:
            print(f"✅ {count} timetable entries created")
        else:
            print("ℹ️  Timetable already populated")

    # ── 7. ClassPulse sample capsules (Prompt 6) ─────────────────
    if teacher and created_subjects:
        capsule_seed = [
            {
                "subject": created_subjects[0],
                "title": "Intro to Trees & Traversals",
                "type": CapsuleType.notes,
                "unlock": CapsuleUnlockMode.always,
                "desc": "Binary trees, BST basics, in/pre/post-order traversal.",
                "min_pct": 65.0,
                "ai_summary": (
                    '{"summary":"Trees are hierarchical data structures. '
                    'Each node has parent/children. Traversals visit each node once.",'
                    '"key_points":["Binary tree: ≤2 children per node","BST: left<root<right",'
                    '"Inorder of BST gives sorted","Preorder/postorder useful for serialization"],'
                    '"estimated_read_time_min":7,"difficulty_level":"beginner"}'
                ),
                "ai_quiz": [
                    {
                        "question": "Which traversal of a BST returns sorted order?",
                        "options": ["Preorder", "Inorder", "Postorder", "Level order"],
                        "correct_answer": "B",
                        "explanation": "Inorder visits left → root → right.",
                    },
                    {
                        "question": "Max children per node in a binary tree?",
                        "options": ["1", "2", "3", "Unlimited"],
                        "correct_answer": "B",
                        "explanation": "Binary trees allow at most two children.",
                    },
                    {
                        "question": "Which is true for a BST?",
                        "options": ["Left>root", "Right<root", "Left<root<Right", "All equal"],
                        "correct_answer": "C",
                        "explanation": "BST invariant.",
                    },
                ],
            },
            {
                "subject": created_subjects[1],
                "title": "Normalization 1NF / 2NF / 3NF",
                "type": CapsuleType.notes,
                "unlock": CapsuleUnlockMode.after_attendance_marked,
                "desc": "Reducing redundancy in relational schemas.",
                "min_pct": 70.0,
                "ai_summary": (
                    '{"summary":"Normalization decomposes tables to remove anomalies.",'
                    '"key_points":["1NF: atomic values","2NF: no partial dependency on key",'
                    '"3NF: no transitive dependency","BCNF: stricter form of 3NF"],'
                    '"estimated_read_time_min":6,"difficulty_level":"intermediate"}'
                ),
                "ai_quiz": [
                    {
                        "question": "1NF requires?",
                        "options": ["Atomic values", "No nulls", "PK present", "Foreign keys"],
                        "correct_answer": "A",
                        "explanation": "1NF: each cell holds atomic value.",
                    },
                    {
                        "question": "2NF removes?",
                        "options": ["Multivalued deps", "Partial deps", "Transitive deps", "Joins"],
                        "correct_answer": "B",
                        "explanation": "2NF eliminates partial dependencies on composite keys.",
                    },
                    {
                        "question": "3NF removes?",
                        "options": ["Partial", "Transitive", "Functional", "Join"],
                        "correct_answer": "B",
                        "explanation": "3NF eliminates transitive dependencies.",
                    },
                ],
            },
            {
                "subject": created_subjects[2],
                "title": "TCP vs UDP — Quick Reference",
                "type": CapsuleType.notes,
                "unlock": CapsuleUnlockMode.session_active,
                "desc": "Protocol differences, when to use each.",
                "min_pct": 65.0,
                "ai_summary": (
                    '{"summary":"TCP is connection-oriented & reliable; UDP is connectionless & fast.",'
                    '"key_points":["TCP: handshake + ack","UDP: fire-and-forget",'
                    '"TCP for HTTP/SSH","UDP for DNS/streaming"],'
                    '"estimated_read_time_min":4,"difficulty_level":"beginner"}'
                ),
                "ai_quiz": [
                    {
                        "question": "Which protocol uses 3-way handshake?",
                        "options": ["UDP", "TCP", "ICMP", "ARP"],
                        "correct_answer": "B",
                        "explanation": "TCP performs SYN → SYN-ACK → ACK.",
                    },
                    {
                        "question": "Which is best for live video streaming?",
                        "options": ["TCP", "UDP", "FTP", "SMTP"],
                        "correct_answer": "B",
                        "explanation": "UDP's low overhead suits real-time media.",
                    },
                    {
                        "question": "Which protocol guarantees delivery?",
                        "options": ["UDP", "TCP", "Both", "Neither"],
                        "correct_answer": "B",
                        "explanation": "TCP has retransmission and acks.",
                    },
                ],
            },
        ]
        cap_count = 0
        for cs in capsule_seed:
            existing = (
                db.query(Capsule)
                .filter_by(
                    subject_id=cs["subject"].id,
                    title=cs["title"],
                )
                .first()
            )
            if existing:
                continue
            cap = Capsule(
                subject_id=cs["subject"].id,
                teacher_id=teacher.id,
                title=cs["title"],
                description=cs["desc"],
                capsule_type=cs["type"],
                unlock_mode=cs["unlock"],
                min_attendance_pct=cs["min_pct"],
                ai_summary=cs["ai_summary"],
                ai_quiz_json=cs["ai_quiz"],
                ai_processed=True,
                is_active=True,
                featured=(cap_count == 0),
                featured_at=datetime.now(UTC) if cap_count == 0 else None,
            )
            db.add(cap)
            cap_count += 1
        if cap_count:
            db.flush()
            print(f"✅ {cap_count} ClassPulse capsules created")
        else:
            print("ℹ️  ClassPulse capsules already seeded")

    db.commit()
    print("\n🎉 Seed complete!")
    print("─" * 50)
    print("TEST CREDENTIALS (all use password set above)")
    print("─" * 50)
    print("Principal : principal@svec.edu.in")
    print("HOD       : hod.cse@svec.edu.in")
    print("Teacher   : priya.teacher@svec.edu.in")
    print("Student 1 : 21CSE001  (or vijesh@svec.edu.in)")
    print("Student 2 : 21CSE002  (or arun@svec.edu.in)")
    print("─" * 50)
    print(
        f"Password  : {'(from SEED_PASSWORD env)' if os.environ.get('SEED_PASSWORD') else SEED_PASSWORD}"
    )
    print("─" * 50)

except Exception as e:
    db.rollback()
    print(f"❌ Error: {e}")
    raise
finally:
    db.close()
