"""
AutoAttend AI v2.0 — Seed script
Creates test college, department, course, subjects, timetable, and 4 test users.
Run once:  python seed.py
"""

import sys, os
sys.path.insert(0, os.path.dirname(__file__))

from datetime import datetime, timezone
from argon2 import PasswordHasher
from database import SessionLocal, Base, engine
from database import (
    College, Department, Course, Subject, User, Timetable,
    UserRole, DayOfWeek,
)

ph = PasswordHasher(time_cost=3, memory_cost=65536, parallelism=2)
PWD_HASH = ph.hash("password123")        # all test users share this password

db = SessionLocal()

try:
    # ── 1. College ───────────────────────────────────────────────
    college = db.query(College).first()
    if not college:
        college = College(name="Sri Venkateswara Engineering College",
                          address="Tirupati, AP 517502",
                          phone="+919876543210",
                          email="admin@svec.edu.in")
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
        course = Course(department_id=dept.id, name="B.Tech Computer Science", code="BTECH-CSE", duration_years=4)
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
            "college_id": None,       # filled below
            "department_id": None,
            "course_id": None,
        },
        {
            "name": "Prof. Anitha Sharma",
            "email": "hod.cse@svec.edu.in",
            "role": UserRole.hod,
            "college_id": None,
            "department_id": None,     # filled below
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
        {"name": "Database Management Systems",  "code": "CS302", "semester": 6},
        {"name": "Computer Networks",            "code": "CS303", "semester": 6},
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
        days = [DayOfWeek.monday, DayOfWeek.tuesday, DayOfWeek.wednesday,
                DayOfWeek.thursday, DayOfWeek.friday]
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
                existing = db.query(Timetable).filter_by(
                    subject_id=subj.id,
                    day_of_week=day, start_time=slots[i][0]
                ).first()
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

    db.commit()
    print("\n🎉 Seed complete!")
    print("─" * 50)
    print("TEST CREDENTIALS (all use password: password123)")
    print("─" * 50)
    print("Principal : principal@svec.edu.in")
    print("HOD       : hod.cse@svec.edu.in")
    print("Teacher   : priya.teacher@svec.edu.in")
    print("Student 1 : 21CSE001  (or vijesh@svec.edu.in)")
    print("Student 2 : 21CSE002  (or arun@svec.edu.in)")
    print("─" * 50)

except Exception as e:
    db.rollback()
    print(f"❌ Error: {e}")
    raise
finally:
    db.close()
