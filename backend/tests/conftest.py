"""
AutoAttend AI v2.0 — pytest fixtures (issue #77)
================================================

Design goals
------------
* **Total isolation from production.** Every test runs against a dedicated
  PostgreSQL database whose URL comes from ``TEST_DATABASE_URL`` (or, if that
  is unset, the production ``DATABASE_URL_SYNC`` with a ``_test`` suffix). The
  database is dropped and recreated at the start of the session, so a stale
  schema can never poison a run. The production database is **never** opened.

* **No production code is modified to make tests pass.** We only *re-point*
  the existing ``database.SessionLocal`` at the test engine so the global
  ``do_orm_execute`` listener (soft-delete + tenant filtering) keeps working.

* **Deterministic.** No randomness — every college / department / user is
  generated from fixed indices. Re-running the suite yields identical data.

* **Fast.** Argon2 hashing is expensive, so the shared test password is hashed
  exactly once and reused for every seeded user. The full org tree
  (≈ 370 rows) seeds in well under 30 s.

* **Independent tests.** The org tree is committed once per session, then every
  test runs inside a SAVEPOINT-backed transaction that is rolled back on
  teardown — so a test that creates / deletes / mutates rows cannot leak state
  into any other test.

Org tree
--------
3 colleges × 3 departments (9 depts). Per department: 1 course, 1 HOD,
5 teachers, 3 sections, 2 teacher-owned subjects. 270 students total
(10 per section). 3 principals (one per college), 1 super-admin
(``college_id = NULL``). All staff have ``totp_enabled = False`` so a plain
email + password login returns an access token directly.

.. note::
   The product spec also mentions "30 students per section". Honouring the
   authoritative headline totals (270 students, 45 teachers, 9 HODs,
   3 principals) together with "3 sections per department" forces 10 students
   per section (27 × 10 = 270). The headline totals win.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

# Disable Sentry telemetry for the whole test run. `main` reads SENTRY_DSN
# straight from os.environ, and python-dotenv's load_dotenv() does not override
# an already-set variable — so pinning it empty here keeps test events off the
# real Sentry project. Must run before any backend module is imported.
os.environ["SENTRY_DSN"] = ""

# ── Make the backend package importable regardless of CWD ───────────────
BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

import sqlalchemy as sa
from sqlalchemy.engine import make_url
from starlette.testclient import TestClient

import database as db_module
from config import settings
from database import (
    Base,
    College,
    Course,
    Department,
    Section,
    Subject,
    User,
    UserRole,
)
from utils.auth_utils import create_access_token, hash_password

# Never ship test-run telemetry to the real Sentry project. Must happen before
# `main` is imported (which initialises Sentry from this setting).
try:
    settings.SENTRY_DSN = ""
except Exception:
    pass


# Shared password for every seeded account.
TEST_PASSWORD = "TestPass123!"
# Stable device id used for student requests (no DeviceRegistry row is created
# for seeded students, so get_current_user's device check simply passes).
TEST_DEVICE_ID = "pytest-device-0001"


# ═══════════════════════════════════════════════════════════════════════
# Test database engine
# ═══════════════════════════════════════════════════════════════════════


def _test_database_url():
    """Resolve the isolated test database URL.

    Priority: ``TEST_DATABASE_URL`` env var → production sync URL + ``_test``.
    """
    env = os.environ.get("TEST_DATABASE_URL")
    if env:
        return make_url(env)
    base = make_url(settings.DATABASE_URL_SYNC)
    return base.set(database=f"{base.database}_test")


@pytest.fixture(scope="session")
def test_engine():
    """Create a pristine test database and bind the app's session to it."""
    url = _test_database_url()

    # Connect to the maintenance database to (re)create the test database.
    admin_url = url.set(database="postgres")
    admin_engine = sa.create_engine(admin_url, isolation_level="AUTOCOMMIT")
    with admin_engine.connect() as conn:
        # Terminate any lingering connections so DROP DATABASE succeeds.
        conn.execute(
            sa.text(
                "SELECT pg_terminate_backend(pid) FROM pg_stat_activity "
                "WHERE datname = :n AND pid <> pg_backend_pid()"
            ),
            {"n": url.database},
        )
        conn.execute(sa.text(f'DROP DATABASE IF EXISTS "{url.database}"'))
        conn.execute(sa.text(f'CREATE DATABASE "{url.database}"'))
    admin_engine.dispose()

    engine = sa.create_engine(url, pool_pre_ping=True, future=True)

    # Re-point the production SessionLocal + module engine at the test DB so
    # the global ORM event listener (soft-delete / tenant filter) still fires
    # for every session the application opens via get_db().
    db_module.engine = engine
    db_module.SessionLocal.configure(bind=engine)

    Base.metadata.create_all(bind=engine)

    yield engine

    engine.dispose()


# ═══════════════════════════════════════════════════════════════════════
# Seed the organisation tree exactly once per session
# ═══════════════════════════════════════════════════════════════════════


def _build_org_tree(session) -> SimpleNamespace:
    """Create the deterministic multi-tenant fixture data.

    Returns a SimpleNamespace of primary-key ids (objects detach once the
    seeding session closes, so tests re-query by id inside their own session).
    """
    # Hash the shared password ONCE — argon2 is deliberately slow.
    pw_hash = hash_password(TEST_PASSWORD)

    super_admin = User(
        name="Platform Super Admin",
        email="superadmin@test.edu",
        role=UserRole.super_admin,
        password_hash=pw_hash,
        college_id=None,
        is_active=True,
        totp_enabled=False,
    )
    session.add(super_admin)
    session.flush()

    colleges = []
    for c in range(3):
        college = College(
            name=f"Test College {c}",
            domain=f"college{c}.test.edu",
            college_code=f"TC{c}",
            plan="active",
            status="active",
        )
        session.add(college)
        session.flush()

        principal = User(
            name=f"Principal C{c}",
            email=f"principal.{c}@test.edu",
            role=UserRole.principal,
            password_hash=pw_hash,
            college_id=college.id,
            is_active=True,
            totp_enabled=False,
        )
        session.add(principal)
        session.flush()

        departments = []
        for d in range(3):
            dept = Department(
                college_id=college.id,
                name=f"Department C{c}D{d}",
                code=f"D{c}{d}",
            )
            session.add(dept)
            session.flush()

            course = Course(
                department_id=dept.id,
                college_id=college.id,
                name=f"Course C{c}D{d}",
                code=f"CR{c}{d}",
                duration_years=4,
            )
            session.add(course)
            session.flush()

            hod = User(
                name=f"HOD C{c}D{d}",
                email=f"hod.{c}.{d}@test.edu",
                role=UserRole.hod,
                password_hash=pw_hash,
                college_id=college.id,
                department_id=dept.id,
                is_active=True,
                totp_enabled=False,
            )
            session.add(hod)
            session.flush()

            teachers = []
            for t in range(5):
                teacher = User(
                    name=f"Teacher C{c}D{d}T{t}",
                    email=f"teacher.{c}.{d}.{t}@test.edu",
                    role=UserRole.teacher,
                    password_hash=pw_hash,
                    college_id=college.id,
                    department_id=dept.id,
                    is_active=True,
                    totp_enabled=False,
                )
                session.add(teacher)
                session.flush()
                teachers.append(teacher.id)

            # Two teacher-owned subjects for this course (semester 1).
            subjects = []
            for s in range(2):
                subject = Subject(
                    course_id=course.id,
                    college_id=college.id,
                    teacher_id=teachers[s],
                    name=f"Subject C{c}D{d}S{s}",
                    code=f"SB{c}{d}{s}",
                    semester=1,
                )
                session.add(subject)
                session.flush()
                subjects.append({"id": subject.id, "teacher_id": teachers[s]})

            sections = []
            for sec in range(3):
                section = Section(
                    department_id=dept.id,
                    course_id=course.id,
                    college_id=college.id,
                    semester=1,
                    name=chr(ord("A") + sec),
                    max_strength=60,
                )
                session.add(section)
                session.flush()

                student_ids = []
                for n in range(10):  # 10 students per section → 270 total
                    student = User(
                        name=f"Student C{c}D{d}{section.name}{n:02d}",
                        email=f"stu.{c}.{d}.{sec}.{n}@test.edu",
                        roll_number=f"R{c}{d}{sec}{n:02d}",
                        role=UserRole.student,
                        password_hash=pw_hash,
                        college_id=college.id,
                        department_id=dept.id,
                        course_id=course.id,
                        section_id=section.id,
                        semester=1,
                        is_active=True,
                        face_enrolled=True,
                    )
                    session.add(student)
                    session.flush()
                    student_ids.append(student.id)

                sections.append(
                    {"id": section.id, "name": section.name, "student_ids": student_ids}
                )

            departments.append(
                {
                    "id": dept.id,
                    "course_id": course.id,
                    "hod_id": hod.id,
                    "teacher_ids": teachers,
                    "subjects": subjects,
                    "sections": sections,
                }
            )

        colleges.append(
            {
                "id": college.id,
                "name": college.name,
                "principal_id": principal.id,
                "departments": departments,
            }
        )

    session.commit()
    return SimpleNamespace(super_admin_id=super_admin.id, colleges=colleges)


@pytest.fixture(scope="session")
def seed(test_engine):
    """Seed the org tree once and expose primary-key references to all tests."""
    session = db_module.SessionLocal()
    try:
        tree = _build_org_tree(session)
    finally:
        session.close()
    return tree


# ═══════════════════════════════════════════════════════════════════════
# Per-test transactional session (rolled back after each test)
# ═══════════════════════════════════════════════════════════════════════


@pytest.fixture()
def db_session(test_engine, seed):
    """A SAVEPOINT-backed session shared with the app via dependency override.

    Everything the test (or the app under test) writes happens inside an outer
    transaction that is rolled back on teardown, so the committed org tree is
    preserved and no test leaks state into another.
    """
    connection = test_engine.connect()
    trans = connection.begin()
    session = db_module.SessionLocal(
        bind=connection,
        join_transaction_mode="create_savepoint",
    )

    def _override_get_db():
        try:
            yield session
        finally:
            # The outer fixture owns the session lifecycle.
            pass

    # Import lazily so app import errors surface as fixture errors.
    from main import app

    app.dependency_overrides[db_module.get_db] = _override_get_db

    yield session

    app.dependency_overrides.pop(db_module.get_db, None)
    session.close()
    trans.rollback()
    connection.close()


@pytest.fixture()
def client(db_session):
    """Starlette TestClient bound to the app with the test session override.

    Instantiated WITHOUT the context-manager form on purpose so the production
    lifespan (schedulers, migration checks, etc.) does not run during tests.
    """
    from main import app

    return TestClient(app, raise_server_exceptions=True)


# ═══════════════════════════════════════════════════════════════════════
# External-service mocks — nothing leaves the test process
# ═══════════════════════════════════════════════════════════════════════


@pytest.fixture(autouse=True)
def _mock_external_services(monkeypatch):
    """Stub every outbound integration (SMS, WhatsApp, push, email, OTP, face).

    Patches are best-effort (``raising=False``) so the suite keeps working even
    if a module is refactored or an optional dependency is absent.
    """
    # Push notifications (leave approve/reject fan-out).
    try:
        import routes.leave as leave_mod

        monkeypatch.setattr(leave_mod, "send_push_to_many", lambda *a, **k: None, raising=False)
    except Exception:
        pass

    # Super-admin welcome email (MSG91).
    try:
        import routes.superadmin as sa_mod

        monkeypatch.setattr(sa_mod, "_send_welcome_email_safe", lambda *a, **k: True, raising=False)
    except Exception:
        pass

    # Generic transports — patched at the source module so any importer is covered.
    for mod_name, attr in [
        ("utils.sms", "send_sms"),
        ("utils.whatsapp", "send_whatsapp_message"),
        ("utils.otp_utils", "send_dual_otp"),
        ("utils.notification_utils", "send_push_to_many"),
        ("utils.notification_utils", "send_push_notification"),
    ]:
        try:
            mod = __import__(mod_name, fromlist=[attr])
            if hasattr(mod, attr):
                monkeypatch.setattr(mod, attr, lambda *a, **k: None, raising=False)
        except Exception:
            pass

    yield


# ═══════════════════════════════════════════════════════════════════════
# Auth helpers
# ═══════════════════════════════════════════════════════════════════════


def make_token(user: User, device_id: str = TEST_DEVICE_ID) -> str:
    """Mint a valid access token for ``user`` with the same claims login uses."""
    subject = user.roll_number if user.role == UserRole.student else user.email
    return create_access_token(
        {
            "sub": subject,
            "id": user.id,
            "name": user.name,
            "role": user.role.value,
            "college_id": user.college_id,
            "department_id": user.department_id,
            "face_enrolled": bool(user.face_enrolled),
            "device_id": device_id,
        }
    )


def auth_headers(user: User, device_id: str = TEST_DEVICE_ID) -> dict:
    """Authorization + device headers for an authenticated request."""
    return {
        "Authorization": f"Bearer {make_token(user, device_id)}",
        "X-Device-ID": device_id,
        "X-Client-Type": "mobile",
    }


@pytest.fixture()
def tokens():
    """Expose the token/header helpers to tests as a fixture."""
    return SimpleNamespace(make_token=make_token, auth_headers=auth_headers)


# ── Convenience accessors for the seeded tree ───────────────────────────


@pytest.fixture()
def get_user(db_session):
    """Return a callable that fetches a fresh ``User`` by id in this session."""

    def _get(user_id: int) -> User:
        return db_session.query(User).filter(User.id == user_id).first()

    return _get


@pytest.fixture()
def college_a(seed):
    return seed.colleges[0]


@pytest.fixture()
def college_b(seed):
    return seed.colleges[1]
