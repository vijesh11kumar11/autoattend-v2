"""Reset DeviceRegistry bindings for friends' test student accounts.

Run this whenever a friend needs to re-bind to a new device/browser, OR after
any earlier login (probe, seed-time) bound a device that's now stale. This
deletes ONLY the DeviceRegistry rows for the 4 seeded test student rolls —
the next login from each account will bind whatever device hits it first.

Usage:
    cd backend && python reset_test_devices.py
"""
from __future__ import annotations

from sqlalchemy.orm import Session

from database import SessionLocal, User, DeviceRegistry

# 4 student rolls created by seed_friends_test.py
TEST_ROLLS = [
    "KCT23ECE001",   # Vijesh
    "KCT25ME001",    # Rashidh
    "KPR23CSE001",   # Fadil
    "KCT23ECE002",   # Rahim
]


def main() -> None:
    db: Session = SessionLocal()
    try:
        total_deleted = 0
        for roll in TEST_ROLLS:
            user = db.query(User).filter(User.roll_number == roll).first()
            if not user:
                print(f"  ⚠️  no user for roll={roll} (skip)")
                continue
            deleted = (
                db.query(DeviceRegistry)
                .filter(DeviceRegistry.user_id == user.id)
                .delete(synchronize_session=False)
            )
            total_deleted += deleted
            print(f"  ✅ {roll:<14} user_id={user.id:<4} cleared {deleted} device row(s)")
        db.commit()
        print(f"\nDone. Total DeviceRegistry rows deleted: {total_deleted}")
        print("Each friend can now log in from their own phone/browser.")
        print("First login per account binds THAT device permanently — pick one student per friend.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
