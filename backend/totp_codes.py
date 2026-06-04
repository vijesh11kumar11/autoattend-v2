"""
totp_codes.py — print current 6-digit TOTP codes for all staff test accounts.

Usage (local .env):
    python totp_codes.py

Usage (production DB):
    DATABASE_URL_SYNC="postgresql+psycopg2://..." python totp_codes.py
"""
import os, sys
sys.path.insert(0, os.path.dirname(__file__))

import pyotp
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from config import settings
from database import User, UserRole
from utils.auth_utils import decrypt_totp_secret

engine = create_engine(settings.DATABASE_URL_SYNC, echo=False)
Session = sessionmaker(bind=engine)

STAFF_EMAILS = [
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

with Session() as db:
    print(f"\n{'═'*56}")
    print(f"  TRACELN — Live TOTP Codes  (refresh every 30 s)")
    print(f"{'═'*56}\n")
    for email in STAFF_EMAILS:
        u = db.query(User).filter(User.email == email, User.is_deleted == False).first()
        if not u or not u.totp_secret:
            print(f"  ⚠️  {email}: not found / no TOTP")
            continue
        secret = decrypt_totp_secret(u.totp_secret)
        code   = pyotp.TOTP(secret).now()
        remaining = 30 - (__import__('time').time() % 30)
        print(f"  {code}  ({int(remaining):2d}s)  {email}")
    print()
