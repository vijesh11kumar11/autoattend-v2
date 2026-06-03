"""
TRACELN v2.0 — Friends Test Seed Script
Creates 3 colleges × 4 departments × 18 accounts for 6 testers.

Run against LOCAL:
    python seed_friends_test.py

Run against PRODUCTION (Render DB):
    ALLOW_SEED_IN_PROD=1 \\
    DATABASE_URL_SYNC=postgresql+psycopg2://user:pass@host/db \\
    python seed_friends_test.py

Safety: refuses to run unless DEBUG=True OR ALLOW_SEED_IN_PROD=1 is set.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(__file__))

import pyotp
from argon2 import PasswordHasher

from config import settings
from database import (
    College,
    Course,
    Department,
    DayOfWeek,
    Section,
    SessionLocal,
    Subject,
    Timetable,
    User,
    UserRole,
)
from utils.auth_utils import encrypt_totp_secret

# ── Production guard ──────────────────────────────────────────────────
if not settings.DEBUG and os.environ.get("ALLOW_SEED_IN_PROD") != "1":
    print("❌ Refused: DEBUG=False and ALLOW_SEED_IN_PROD!=1.")
    print("   Set ALLOW_SEED_IN_PROD=1 explicitly to seed production.")
    sys.exit(2)

# ── Config ────────────────────────────────────────────────────────────
PASSWORD = "Traceln@123"
ph = PasswordHasher(time_cost=3, memory_cost=65536, parallelism=2)
PWD_HASH = ph.hash(PASSWORD)
TOTP_ISSUER = getattr(settings, "TOTP_ISSUER", "TRACELN")

db = SessionLocal()

# ── Helpers ───────────────────────────────────────────────────────────

def get_or_create_college(name, code, address, phone, email):
    c = db.query(College).filter(College.college_code == code).first()
    if c:
        print(f"  ℹ️  College exists: {name}")
        return c
    c = College(name=name, college_code=code, address=address, phone=phone, email=email)
    db.add(c)
    db.flush()
    print(f"  ✅ College: {name} (id={c.id})")
    return c


def get_or_create_dept(college, name, code):
    d = db.query(Department).filter(
        Department.college_id == college.id, Department.code == code
    ).first()
    if d:
        return d
    d = Department(college_id=college.id, name=name, code=code)
    db.add(d)
    db.flush()
    return d


def get_or_create_course(dept, name, code):
    c = db.query(Course).filter(Course.department_id == dept.id, Course.code == code).first()
    if c:
        return c
    c = Course(
        department_id=dept.id,
        college_id=dept.college_id,
        name=name,
        code=code,
        duration_years=4,
    )
    db.add(c)
    db.flush()
    return c


def get_or_create_section(dept, course, semester, name):
    s = db.query(Section).filter(
        Section.course_id == course.id, Section.semester == semester, Section.name == name
    ).first()
    if s:
        return s
    s = Section(
        department_id=dept.id,
        course_id=course.id,
        college_id=dept.college_id,
        semester=semester,
        name=name,
        max_strength=60,
    )
    db.add(s)
    db.flush()
    return s


def get_or_create_subject(course, name, code, semester, teacher_id=None):
    s = db.query(Subject).filter(
        Subject.course_id == course.id, Subject.code == code, Subject.semester == semester
    ).first()
    if s:
        return s
    s = Subject(
        course_id=course.id,
        college_id=course.college_id,
        name=name,
        code=code,
        semester=semester,
        teacher_id=teacher_id,
        total_lectures=40,
    )
    db.add(s)
    db.flush()
    return s


def make_staff(email, phone, name, role, college_id, dept_id=None):
    """Create a staff user (principal/HOD/teacher) with TOTP. Returns (user, plain_secret)."""
    u = db.query(User).filter(User.email == email).first()
    if u:
        print(f"  ℹ️  {role.value:10s} exists: {email}")
        return u, None
    secret = pyotp.random_base32()
    u = User(
        college_id=college_id,
        department_id=dept_id,
        name=name,
        email=email,
        phone=phone,
        role=role,
        password_hash=PWD_HASH,
        totp_secret=encrypt_totp_secret(secret),
        totp_enabled=True,
        is_active=True,
    )
    db.add(u)
    db.flush()
    print(f"  ✅ {role.value:10s}: {email} (id={u.id})")
    return u, secret


def make_student(email, phone, name, college_id, dept_id, course_id, section_id, semester, roll):
    """Create a student user. Login identifier = roll_number."""
    existing_by_roll = db.query(User).filter(User.roll_number == roll).first()
    if existing_by_roll:
        print(f"  ℹ️  student    exists: roll={roll}")
        return existing_by_roll
    u = db.query(User).filter(User.email == email).first()
    if u:
        print(f"  ℹ️  student    exists: {email}")
        return u
    u = User(
        college_id=college_id,
        department_id=dept_id,
        course_id=course_id,
        section_id=section_id,
        name=name,
        email=email,
        phone=phone,
        roll_number=roll,
        role=UserRole.student,
        password_hash=PWD_HASH,
        totp_enabled=False,
        is_active=True,
        semester=semester,
    )
    db.add(u)
    db.flush()
    print(f"  ✅ student    : roll={roll} | {email} (id={u.id})")
    return u


# ══════════════════════════════════════════════════════════════════════
# 1. COLLEGES
# ══════════════════════════════════════════════════════════════════════
print("\n── Colleges ──────────────────────────────────────────────────")

cit = get_or_create_college(
    "Coimbatore Institute Of Technology", "cit",
    "Avinashi Road, Coimbatore, Tamil Nadu 641014",
    "+914222575251", "admin@cit.edu.in",
)
kpr = get_or_create_college(
    "KPR Institute of Technology", "kpr",
    "Arasur, Coimbatore, Tamil Nadu 641407",
    "+914222573800", "admin@kpr.edu.in",
)
kct = get_or_create_college(
    "Krishna College Of Technology", "kct",
    "Kovaipudur, Coimbatore, Tamil Nadu 641042",
    "+914222404000", "admin@kct.edu.in",
)

# ══════════════════════════════════════════════════════════════════════
# 2. DEPARTMENTS — 4 per college
# ══════════════════════════════════════════════════════════════════════
print("\n── Departments ───────────────────────────────────────────────")

DEPT_DEFS = [
    ("Computer Science & Engineering",          "CSE"),
    ("Electronics & Communication Engineering", "ECE"),
    ("Mechanical Engineering",                  "ME"),
    ("Civil Engineering",                       "Civil"),
]

depts = {}
for key, college in [("cit", cit), ("kpr", kpr), ("kct", kct)]:
    depts[key] = {}
    for dname, dcode in DEPT_DEFS:
        depts[key][dcode] = get_or_create_dept(college, dname, dcode)
        print(f"  ✅ {key.upper()} / {dcode}")

# ══════════════════════════════════════════════════════════════════════
# 3. COURSES — B.Tech per department per college
# ══════════════════════════════════════════════════════════════════════
print("\n── Courses ───────────────────────────────────────────────────")

COURSE_MAP = {
    "CSE":   ("B.Tech Computer Science & Engineering", "BTECH-CSE"),
    "ECE":   ("B.Tech Electronics & Communication",    "BTECH-ECE"),
    "ME":    ("B.Tech Mechanical Engineering",          "BTECH-ME"),
    "Civil": ("B.Tech Civil Engineering",               "BTECH-CIVIL"),
}

courses = {}
for key in ("cit", "kpr", "kct"):
    courses[key] = {}
    for dcode, (cname, ccode) in COURSE_MAP.items():
        courses[key][dcode] = get_or_create_course(depts[key][dcode], cname, ccode)
        print(f"  ✅ {key.upper()} / {ccode}")

# ══════════════════════════════════════════════════════════════════════
# 4. SECTIONS for enrolled students
# ══════════════════════════════════════════════════════════════════════
print("\n── Sections ──────────────────────────────────────────────────")

kct_ece_s3 = get_or_create_section(depts["kct"]["ECE"], courses["kct"]["ECE"], 3, "A")
print(f"  ✅ KCT ECE Sem-3 Sec-A  (id={kct_ece_s3.id})  ← Vijesh + Rahim")

kct_me_s1 = get_or_create_section(depts["kct"]["ME"], courses["kct"]["ME"], 1, "A")
print(f"  ✅ KCT ME  Sem-1 Sec-A  (id={kct_me_s1.id})   ← Rashidh")

kpr_cse_s5 = get_or_create_section(depts["kpr"]["CSE"], courses["kpr"]["CSE"], 5, "A")
print(f"  ✅ KPR CSE Sem-5 Sec-A  (id={kpr_cse_s5.id})  ← Fadil")

# ══════════════════════════════════════════════════════════════════════
# 5. USERS — 18 accounts (6 people × 3 roles each)
# ══════════════════════════════════════════════════════════════════════
print("\n── Users ─────────────────────────────────────────────────────")
totp_secrets: dict[str, str] = {}

# ── VijeshKumar ───────────────────────────────────────────────────────
u_vp, s = make_staff("vijesh.principal@cit.edu.in",  "9100000001", "VijeshKumar", UserRole.principal, cit.id)
if s: totp_secrets["vijesh.principal@cit.edu.in"] = s

u_vt, s = make_staff("vijesh.teacher@kpr.edu.in",    "9100000002", "VijeshKumar", UserRole.teacher,   kpr.id, depts["kpr"]["CSE"].id)
if s: totp_secrets["vijesh.teacher@kpr.edu.in"] = s

u_vs = make_student("vijesh.student@kct.edu.in", "9100000003", "VijeshKumar",
                    kct.id, depts["kct"]["ECE"].id, courses["kct"]["ECE"].id,
                    kct_ece_s3.id, 3, "KCT23ECE001")

# ── Mohammed Rashidh ──────────────────────────────────────────────────
u_rp, s = make_staff("rashidh.principal@kpr.edu.in", "9100000011", "Mohammed Rashidh", UserRole.principal, kpr.id)
if s: totp_secrets["rashidh.principal@kpr.edu.in"] = s

u_rh, s = make_staff("rashidh.hod@cit.edu.in",       "9100000012", "Mohammed Rashidh", UserRole.hod,       cit.id, depts["cit"]["CSE"].id)
if s: totp_secrets["rashidh.hod@cit.edu.in"] = s

u_rs = make_student("rashidh.student@kct.edu.in", "9100000013", "Mohammed Rashidh",
                    kct.id, depts["kct"]["ME"].id, courses["kct"]["ME"].id,
                    kct_me_s1.id, 1, "KCT25ME001")

# ── Gokul Kannan ──────────────────────────────────────────────────────
u_gp, s = make_staff("gokul.principal@kct.edu.in",   "9100000021", "Gokul Kannan", UserRole.principal, kct.id)
if s: totp_secrets["gokul.principal@kct.edu.in"] = s

u_gh, s = make_staff("gokul.hod@kpr.edu.in",         "9100000022", "Gokul Kannan", UserRole.hod,       kpr.id, depts["kpr"]["ECE"].id)
if s: totp_secrets["gokul.hod@kpr.edu.in"] = s

u_gt, s = make_staff("gokul.teacher@cit.edu.in",     "9100000023", "Gokul Kannan", UserRole.teacher,   cit.id, depts["cit"]["ME"].id)
if s: totp_secrets["gokul.teacher@cit.edu.in"] = s

# ── Kavin ─────────────────────────────────────────────────────────────
u_kh1, s = make_staff("kavin.hod@kpr.edu.in",        "9100000031", "Kavin", UserRole.hod,     kpr.id, depts["kpr"]["CSE"].id)
if s: totp_secrets["kavin.hod@kpr.edu.in"] = s

u_kh2, s = make_staff("kavin.hod@kct.edu.in",        "9100000032", "Kavin", UserRole.hod,     kct.id, depts["kct"]["ECE"].id)
if s: totp_secrets["kavin.hod@kct.edu.in"] = s

u_kt,  s = make_staff("kavin.teacher@cit.edu.in",    "9100000033", "Kavin", UserRole.teacher, cit.id, depts["cit"]["CSE"].id)
if s: totp_secrets["kavin.teacher@cit.edu.in"] = s

# ── Fadil ─────────────────────────────────────────────────────────────
u_fh1, s = make_staff("fadil.hod@cit.edu.in",        "9100000041", "Fadil", UserRole.hod, cit.id, depts["cit"]["ECE"].id)
if s: totp_secrets["fadil.hod@cit.edu.in"] = s

u_fh2, s = make_staff("fadil.hod@kct.edu.in",        "9100000042", "Fadil", UserRole.hod, kct.id, depts["kct"]["ME"].id)
if s: totp_secrets["fadil.hod@kct.edu.in"] = s

u_fs = make_student("fadil.student@kpr.edu.in", "9100000043", "Fadil",
                    kpr.id, depts["kpr"]["CSE"].id, courses["kpr"]["CSE"].id,
                    kpr_cse_s5.id, 5, "KPR23CSE001")

# ── Rahim ─────────────────────────────────────────────────────────────
u_rh1, s = make_staff("rahim.hod@cit.edu.in",        "9100000051", "Rahim", UserRole.hod, cit.id, depts["cit"]["ME"].id)
if s: totp_secrets["rahim.hod@cit.edu.in"] = s

u_rh2, s = make_staff("rahim.hod@kpr.edu.in",        "9100000052", "Rahim", UserRole.hod, kpr.id, depts["kpr"]["ME"].id)
if s: totp_secrets["rahim.hod@kpr.edu.in"] = s

u_rhs = make_student("rahim.student@kct.edu.in", "9100000053", "Rahim",
                     kct.id, depts["kct"]["ECE"].id, courses["kct"]["ECE"].id,
                     kct_ece_s3.id, 3, "KCT23ECE002")

# ══════════════════════════════════════════════════════════════════════
# 6. SUBJECTS
# ══════════════════════════════════════════════════════════════════════
print("\n── Subjects ──────────────────────────────────────────────────")

# KPR CSE Sem-5 — teacher: Vijesh  (student Fadil is here)
get_or_create_subject(courses["kpr"]["CSE"], "Operating Systems",         "CS501", 5, u_vt.id)
get_or_create_subject(courses["kpr"]["CSE"], "Machine Learning",          "CS502", 5, u_vt.id)
print("  ✅ KPR CSE Sem-5: Operating Systems, Machine Learning (Vijesh)")

# CIT CSE Sem-5 — teacher: Kavin
get_or_create_subject(courses["cit"]["CSE"], "Data Structures & Algorithms", "CS301", 5, u_kt.id)
get_or_create_subject(courses["cit"]["CSE"], "Database Management Systems",  "CS302", 5, u_kt.id)
print("  ✅ CIT CSE Sem-5: DSA, DBMS (Kavin)")

# CIT ME Sem-3 — teacher: Gokul
get_or_create_subject(courses["cit"]["ME"], "Thermodynamics",        "ME301", 3, u_gt.id)
get_or_create_subject(courses["cit"]["ME"], "Engineering Mechanics",  "ME302", 3, u_gt.id)
print("  ✅ CIT ME  Sem-3: Thermodynamics, Engineering Mechanics (Gokul)")

# KCT ECE Sem-3 — no teacher yet (students Vijesh + Rahim)
get_or_create_subject(courses["kct"]["ECE"], "Signals & Systems",  "EC301", 3)
get_or_create_subject(courses["kct"]["ECE"], "Digital Electronics", "EC302", 3)
print("  ✅ KCT ECE Sem-3: Signals & Systems, Digital Electronics (no teacher)")

# KCT ME Sem-1 — no teacher yet (student Rashidh)
get_or_create_subject(courses["kct"]["ME"], "Engineering Mathematics I", "MA101", 1)
get_or_create_subject(courses["kct"]["ME"], "Engineering Physics",       "PH101", 1)
print("  ✅ KCT ME  Sem-1: Engg Maths I, Engg Physics (no teacher)")

# ══════════════════════════════════════════════════════════════════════
# 7. COMMIT
# ══════════════════════════════════════════════════════════════════════
db.commit()
print("\n✅ All data committed to database.\n")

# ══════════════════════════════════════════════════════════════════════
# 8. CREDENTIALS SHEET
# ══════════════════════════════════════════════════════════════════════
W = 72

def totp_uri(email: str, secret: str) -> str:
    return pyotp.TOTP(secret).provisioning_uri(name=email, issuer_name=TOTP_ISSUER)

ACCOUNTS = [
    # (person,             email,                            phone,        role_label,           is_staff, roll)
    ("VijeshKumar",        "vijesh.principal@cit.edu.in",   "9100000001", "Principal @ CIT",    True,  None),
    ("VijeshKumar",        "vijesh.teacher@kpr.edu.in",     "9100000002", "Teacher CSE @ KPR",  True,  None),
    ("VijeshKumar",        "vijesh.student@kct.edu.in",     "9100000003", "Student ECE Y2 @ KCT", False, "KCT23ECE001"),
    ("Mohammed Rashidh",   "rashidh.principal@kpr.edu.in",  "9100000011", "Principal @ KPR",    True,  None),
    ("Mohammed Rashidh",   "rashidh.hod@cit.edu.in",        "9100000012", "HOD CSE @ CIT",      True,  None),
    ("Mohammed Rashidh",   "rashidh.student@kct.edu.in",    "9100000013", "Student ME Y1 @ KCT",  False, "KCT25ME001"),
    ("Gokul Kannan",       "gokul.principal@kct.edu.in",    "9100000021", "Principal @ KCT",    True,  None),
    ("Gokul Kannan",       "gokul.hod@kpr.edu.in",          "9100000022", "HOD ECE @ KPR",      True,  None),
    ("Gokul Kannan",       "gokul.teacher@cit.edu.in",      "9100000023", "Teacher ME @ CIT",   True,  None),
    ("Kavin",              "kavin.hod@kpr.edu.in",          "9100000031", "HOD CSE @ KPR",      True,  None),
    ("Kavin",              "kavin.hod@kct.edu.in",          "9100000032", "HOD ECE @ KCT",      True,  None),
    ("Kavin",              "kavin.teacher@cit.edu.in",      "9100000033", "Teacher CSE @ CIT",  True,  None),
    ("Fadil",              "fadil.hod@cit.edu.in",          "9100000041", "HOD ECE @ CIT",      True,  None),
    ("Fadil",              "fadil.hod@kct.edu.in",          "9100000042", "HOD ME @ KCT",       True,  None),
    ("Fadil",              "fadil.student@kpr.edu.in",      "9100000043", "Student CSE Y3 @ KPR", False, "KPR23CSE001"),
    ("Rahim",              "rahim.hod@cit.edu.in",          "9100000051", "HOD ME @ CIT",       True,  None),
    ("Rahim",              "rahim.hod@kpr.edu.in",          "9100000052", "HOD ME @ KPR",       True,  None),
    ("Rahim",              "rahim.student@kct.edu.in",      "9100000053", "Student ECE Y2 @ KCT", False, "KCT23ECE002"),
]

print("=" * W)
print("  TRACELN — FRIENDS TEST CREDENTIALS")
print(f"  Password (all accounts): {PASSWORD}")
print("=" * W)

current_person = None
for person, email, phone, role_label, is_staff, roll in ACCOUNTS:
    if person != current_person:
        print(f"\n{'─' * W}")
        print(f"  {person}")
        current_person = person
    print(f"\n  [{role_label}]")
    if is_staff:
        print(f"    Identifier : {email}  (use email to login)")
        print(f"    Password   : {PASSWORD}")
        if email in totp_secrets:
            secret = totp_secrets[email]
            print(f"    TOTP Secret: {secret}")
            print(f"    TOTP QR    : {totp_uri(email, secret)}")
        else:
            print(f"    TOTP       : account already existed — secret unchanged")
    else:
        print(f"    Identifier : {roll}  (use roll number to login)")
        print(f"    Password   : {PASSWORD}")
        print(f"    Email      : {email}")
        print(f"    Phone      : {phone}")

print(f"\n{'=' * W}")
print("  STAFF LOGIN  → URL: https://traceln.vercel.app/login")
print("    Step 1: enter email + password")
print("    Step 2: enter 6-digit TOTP code from Google Authenticator")
print("    (Scan the TOTP QR link above once with Google Authenticator)")
print()
print("  STUDENT LOGIN → URL: https://traceln.vercel.app/login")
print("    Enter roll number + password  (no TOTP needed)")
print(f"{'=' * W}\n")
