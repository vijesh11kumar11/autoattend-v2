"""
AutoAttend v2 — Comprehensive test data seed
Creates 40 students, a second tutor, section, tutor assignments,
and links everything together for full testing.

Run:  python seed_test_data.py
"""

import os
import sys

sys.path.insert(0, os.path.dirname(__file__))

from argon2 import PasswordHasher

from database import (
    AttendanceAudit,
    AttendanceRecord,
    AttendanceSession,
    College,
    Course,
    Department,
    Section,
    SessionLocal,
    Timetable,
    TutorAssignment,
    User,
    UserRole,
)

ph = PasswordHasher(time_cost=3, memory_cost=65536, parallelism=2)
PWD_HASH = ph.hash("password123")

db = SessionLocal()

try:
    # ── Lookup existing entities ─────────────────────────────────
    college = db.query(College).first()
    dept = db.query(Department).filter_by(code="CSE").first()
    course = db.query(Course).filter_by(code="BTECH-CSE").first()
    priya = db.query(User).filter_by(email="priya.teacher@svec.edu.in").first()

    if not all([college, dept, course, priya]):
        print("❌ Run seed.py first! Missing base data.")
        sys.exit(1)

    print(f"ℹ️  College: {college.name} (id={college.id})")
    print(f"ℹ️  Department: {dept.name} (id={dept.id})")
    print(f"ℹ️  Course: {course.name} (id={course.id})")
    print(f"ℹ️  Teacher: {priya.name} (id={priya.id})")

    # ── 1. Create Section A ──────────────────────────────────────
    section = db.query(Section).filter_by(course_id=course.id, semester=6, name="A").first()
    if not section:
        section = Section(
            department_id=dept.id,
            course_id=course.id,
            semester=6,
            name="A",
            max_strength=60,
        )
        db.add(section)
        db.flush()
        print(f"✅ Section created: 6-A (id={section.id})")
    else:
        print(f"ℹ️  Section already exists: 6-A (id={section.id})")

    # ── 2. Update timetable entries to use this section ──────────
    updated = (
        db.query(Timetable)
        .filter(Timetable.teacher_id == priya.id, Timetable.section_id.is_(None))
        .update({"section_id": section.id}, synchronize_session=False)
    )
    if updated:
        print(f"✅ Updated {updated} timetable entries with section_id={section.id}")

    # ── 3. Update existing students with section_id ──────────────
    for email in ["vijesh@svec.edu.in", "arun@svec.edu.in"]:
        u = db.query(User).filter_by(email=email).first()
        if u and not u.section_id:
            u.section_id = section.id
            print(f"✅ Updated {u.name} section_id={section.id}")

    # ── 4. Create second tutor (Mr. Ravi Kumar) ──────────────────
    tutor2 = db.query(User).filter_by(email="ravi.teacher@svec.edu.in").first()
    if not tutor2:
        tutor2 = User(
            college_id=college.id,
            department_id=dept.id,
            name="Mr. Ravi Kumar",
            email="ravi.teacher@svec.edu.in",
            role=UserRole.teacher,
            password_hash=PWD_HASH,
            is_active=True,
            totp_enabled=False,
        )
        db.add(tutor2)
        db.flush()
        print(f"✅ Second tutor created: {tutor2.name} (id={tutor2.id})")
    else:
        print(f"ℹ️  Second tutor already exists: {tutor2.name} (id={tutor2.id})")

    # ── 5. Create 40 students ────────────────────────────────────
    # First two already exist (21CSE001, 21CSE002 → roll CS001, CS002)
    # We'll rename/update them and create the rest

    FIRST_NAMES = [
        "Vijesh",
        "Arun",
        "Sneha",
        "Deepak",
        "Kavya",
        "Rahul",
        "Meera",
        "Suresh",
        "Divya",
        "Karthik",
        "Preethi",
        "Naveen",
        "Lakshmi",
        "Manoj",
        "Swathi",
        "Ganesh",
        "Pooja",
        "Srinivas",
        "Anjali",
        "Venkat",
        "Rajesh",
        "Nandini",
        "Prasad",
        "Bhavya",
        "Harish",
        "Ramya",
        "Chandra",
        "Sahithi",
        "Vikram",
        "Madhavi",
        "Raju",
        "Keerthi",
        "Sunil",
        "Lavanya",
        "Pavan",
        "Sirisha",
        "Tarun",
        "Mounika",
        "Akhil",
        "Revathi",
    ]

    LAST_NAMES = [
        "Kumar",
        "Patel",
        "Reddy",
        "Sharma",
        "Nair",
        "Verma",
        "Iyer",
        "Rao",
        "Gupta",
        "Pillai",
        "Menon",
        "Saxena",
        "Das",
        "Choudhury",
        "Joshi",
        "Naidu",
        "Mishra",
        "Shetty",
        "Kapoor",
        "Rajan",
        "Babu",
        "Devi",
        "Yadav",
        "Singh",
        "Gowda",
        "Patil",
        "Sekhar",
        "Kumari",
        "Malhotra",
        "Hegde",
        "Chowdary",
        "Priya",
        "Prasad",
        "Kaur",
        "Tiwari",
        "Mohan",
        "Raj",
        "Rani",
        "Varma",
        "Sundaram",
    ]

    students = []
    for i in range(1, 41):
        roll = f"CS{i:03d}"
        email = f"student{i:02d}@svec.edu.in"
        name = f"{FIRST_NAMES[i-1]} {LAST_NAMES[i-1]}"
        phone = f"+9199{i:08d}"

        existing = db.query(User).filter_by(roll_number=roll).first()
        if existing:
            students.append(existing)
            # Make sure section_id is set
            if not existing.section_id:
                existing.section_id = section.id
            continue

        # Check if old roll numbers exist (21CSE001 → CS001, 21CSE002 → CS002)
        old_roll = f"21CSE{i:03d}"
        old_user = db.query(User).filter_by(roll_number=old_roll).first()
        if old_user:
            old_user.roll_number = roll
            old_user.name = name
            old_user.email = email
            old_user.section_id = section.id
            old_user.parent_phone = phone
            students.append(old_user)
            print(f"✅ Updated {old_roll} → {roll} ({name})")
            continue

        student = User(
            college_id=college.id,
            department_id=dept.id,
            course_id=course.id,
            section_id=section.id,
            name=name,
            email=email,
            roll_number=roll,
            semester=6,
            role=UserRole.student,
            password_hash=PWD_HASH,
            parent_phone=phone,
            is_active=True,
            totp_enabled=False,
        )
        db.add(student)
        students.append(student)

    db.flush()
    print(f"✅ {len(students)} students ready (CS001–CS040)")

    # Print student IDs for reference
    for s in students:
        print(f"   {s.roll_number}: {s.name} (id={s.id})")

    # ── 6. Tutor assignments ─────────────────────────────────────
    academic_year = "2025-26"

    # CS001-CS020 → Priya Reddy
    for s in students[:20]:
        existing = (
            db.query(TutorAssignment)
            .filter_by(student_id=s.id, academic_year=academic_year)
            .first()
        )
        if existing:
            continue
        db.add(
            TutorAssignment(
                tutor_id=priya.id,
                student_id=s.id,
                academic_year=academic_year,
                is_active=True,
                note="Seed assignment",
            )
        )
    print(f"✅ Tutor assignments: CS001-CS020 → {priya.name}")

    # CS021-CS040 → Ravi Kumar
    for s in students[20:]:
        existing = (
            db.query(TutorAssignment)
            .filter_by(student_id=s.id, academic_year=academic_year)
            .first()
        )
        if existing:
            continue
        db.add(
            TutorAssignment(
                tutor_id=tutor2.id,
                student_id=s.id,
                academic_year=academic_year,
                is_active=True,
                note="Seed assignment",
            )
        )
    print(f"✅ Tutor assignments: CS021-CS040 → {tutor2.name}")

    # ── 7. Clean up old test attendance data ─────────────────────
    old_sessions = db.query(AttendanceSession).all()
    for sess in old_sessions:
        db.query(AttendanceAudit).filter_by(session_id=sess.id).delete()
        db.query(AttendanceRecord).filter_by(session_id=sess.id).delete()
        db.delete(sess)
    if old_sessions:
        print(f"🧹 Cleaned {len(old_sessions)} old attendance session(s)")

    db.commit()
    print("\n🎉 Test data seeded successfully!")
    print("\n📋 Summary:")
    print(f"   Section: 6-A (id={section.id})")
    print("   Students: 40 (CS001–CS040)")
    print("   Ward students under Priya: CS001–CS020")
    print("   Ward students under Ravi: CS021–CS040")
    print("   All passwords: password123")
    print("   Student email pattern: student01@svec.edu.in ... student40@svec.edu.in")

except Exception as e:
    db.rollback()
    print(f"❌ Error: {e}")
    import traceback

    traceback.print_exc()
finally:
    db.close()
