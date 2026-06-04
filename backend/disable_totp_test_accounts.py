"""
disable_totp_test_accounts.py — disables TOTP on all 14 test staff accounts
so friends can log in with just email + password (no Google Authenticator).

Run against production:
    DATABASE_URL_SYNC="postgresql+psycopg2://..." python disable_totp_test_accounts.py
"""
import os, sys
sys.path.insert(0, os.path.dirname(__file__))

from sqlalchemy import create_engine, text
from config import settings

TEST_EMAILS = [
    # VijeshKumar
    "vijesh.principal@cit.edu.in",
    "vijesh.teacher@kpr.edu.in",
    # Mohammed Rashidh
    "rashidh.principal@kpr.edu.in",
    "rashidh.hod@cit.edu.in",
    # Gokul Kannan
    "gokul.principal@kct.edu.in",
    "gokul.hod@kpr.edu.in",
    "gokul.teacher@cit.edu.in",
    # Kavin
    "kavin.hod@kpr.edu.in",
    "kavin.hod@kct.edu.in",
    "kavin.teacher@cit.edu.in",
    # Fadil
    "fadil.hod@cit.edu.in",
    "fadil.hod@kct.edu.in",
    # Rahim
    "rahim.hod@cit.edu.in",
    "rahim.hod@kpr.edu.in",
]

engine = create_engine(settings.DATABASE_URL_SYNC, echo=False)

with engine.connect() as conn:
    print("\n── Disabling TOTP for test accounts ───────────────────────\n")
    for email in TEST_EMAILS:
        r = conn.execute(
            text("UPDATE users SET totp_enabled = false WHERE email = :e AND is_deleted = false"),
            {"e": email},
        )
        status = "✅" if r.rowcount else "⚠️  not found"
        print(f"  {status}  {email}")
    conn.commit()

print("\n✅ Done — all test accounts now login with email + password only.\n")
