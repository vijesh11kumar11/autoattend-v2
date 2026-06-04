"""
Reset face enrollment for the 4 test student accounts.

Sets face_enrolled=False and azure_person_id=NULL so they MUST go through
the (now fixed) FaceEnrollmentPage on next login. The new page properly
calls /students/{id}/enroll-face after liveness, storing azure_person_id
so attendance face/verify works end-to-end.

Run on prod:
  DATABASE_URL_SYNC="<prod url>" PYTHONIOENCODING=utf-8 python reset_test_face_enrollment.py
"""

import os
import sys
from sqlalchemy import create_engine, text

TEST_ROLLS = ("KCT23ECE001", "KCT25ME001", "KPR23CSE001", "KCT23ECE002")

db_url = os.environ.get("DATABASE_URL_SYNC")
if not db_url:
    print("ERROR: DATABASE_URL_SYNC env var is required.")
    sys.exit(1)

engine = create_engine(db_url, future=True)

with engine.begin() as conn:
    rows = conn.execute(
        text(
            """
            SELECT id, roll_number, face_enrolled, azure_person_id
            FROM users
            WHERE roll_number = ANY(:rolls)
            """
        ),
        {"rolls": list(TEST_ROLLS)},
    ).fetchall()

    print("\n=== Before ===")
    for r in rows:
        print(
            f"  {r.roll_number:<14} id={r.id:<4} face_enrolled={r.face_enrolled} "
            f"azure_person_id={r.azure_person_id}"
        )

    res = conn.execute(
        text(
            """
            UPDATE users
            SET face_enrolled = false,
                azure_person_id = NULL,
                face_enrolled_at = NULL
            WHERE roll_number = ANY(:rolls)
            """
        ),
        {"rolls": list(TEST_ROLLS)},
    )
    print(f"\nUpdated {res.rowcount} rows.")

    rows = conn.execute(
        text(
            """
            SELECT id, roll_number, face_enrolled, azure_person_id
            FROM users
            WHERE roll_number = ANY(:rolls)
            """
        ),
        {"rolls": list(TEST_ROLLS)},
    ).fetchall()

    print("\n=== After ===")
    for r in rows:
        print(
            f"  {r.roll_number:<14} id={r.id:<4} face_enrolled={r.face_enrolled} "
            f"azure_person_id={r.azure_person_id}"
        )

print(
    "\nDone. On next login each test student will be prompted to enroll their face. "
    "The new flow does liveness + Azure enrollment + saves azure_person_id."
)
