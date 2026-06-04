"""Mark friends' test student accounts as face-enrolled so they can bypass
the face-enrollment camera flow and access the dashboard directly.

This sets `face_enrolled = True` for the 4 seeded test rolls only. They get
no `azure_person_id` (so they can't mark face-based attendance), but every
other feature is testable. Real student accounts are not touched.

Usage:
    DATABASE_URL_SYNC=<prod url> python mark_test_face_enrolled.py
"""
from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy.orm import Session

from database import SessionLocal, User

TEST_ROLLS = [
    "KCT23ECE001",
    "KCT25ME001",
    "KPR23CSE001",
    "KCT23ECE002",
]


def main() -> None:
    db: Session = SessionLocal()
    try:
        now = datetime.now(tz=UTC)
        for roll in TEST_ROLLS:
            user = db.query(User).filter(User.roll_number == roll).first()
            if not user:
                print(f"  skip  {roll}: no user")
                continue
            user.face_enrolled = True
            user.face_enrolled_at = user.face_enrolled_at or now
            print(f"  OK    {roll:<14} user_id={user.id} face_enrolled=True")
        db.commit()
        print("\nDone.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
