"""
sync_prod_schema.py — ensure production Render DB schema exactly matches the ORM.

Strategy:
  1. Query production for the list of existing tables.
  2. For each missing table, run CREATE TABLE IF NOT EXISTS using the full DDL
     extracted from SQLAlchemy metadata (Base.metadata).
  3. For tables that exist, ensure all columns are present (ADD COLUMN IF NOT EXISTS).
  4. Print a clear ✅ / ➕ / ⚠️ report.

Safe to re-run: everything is idempotent.

Usage:
    DATABASE_URL_SYNC="postgresql+psycopg2://..." python sync_prod_schema.py
"""
import os, sys
sys.path.insert(0, os.path.dirname(__file__))

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.schema import CreateTable
from database import Base  # imports all ORM models via __tablename__ declarations
from config import settings

DB_URL = settings.DATABASE_URL_SYNC
engine = create_engine(DB_URL, echo=False)

# ── Step 1: introspect production ──────────────────────────────────────────────
insp = inspect(engine)
existing_tables = set(insp.get_table_names())
print(f"\n{'─'*60}")
print(f"  Production DB has {len(existing_tables)} tables.")
print(f"  ORM defines     {len(Base.metadata.tables)} tables.")
print(f"{'─'*60}\n")

missing_tables = []
present_tables = []

for tname in sorted(Base.metadata.tables):
    if tname not in existing_tables:
        missing_tables.append(tname)
    else:
        present_tables.append(tname)

if missing_tables:
    print(f"⚠️  Missing tables ({len(missing_tables)}):")
    for t in missing_tables:
        print(f"   • {t}")
    print()
else:
    print("✅ All ORM tables already exist in production.\n")

# ── Step 2: create missing tables ─────────────────────────────────────────────
with engine.connect() as conn:
    # Ensure enums exist first (PostgreSQL needs them before table DDL)
    ENUMS = [
        ("userrole",            "'student','teacher','hod','principal','superadmin'"),
        ("otppurpose",          "'login','password_reset','email_verification'"),
        ("otpchannel",          "'sms','email','whatsapp'"),
        ("dayofweek",           "'Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'"),
        ("sessionstatus",       "'scheduled','active','ended','cancelled'"),
        ("attendancestatus",    "'present','absent','late','excused'"),
        ("markedby",            "'qr','face','manual','bluetooth','gps'"),
        ("auditresult",         "'verified','rejected','pending'"),
        ("alertstatus",         "'pending','sent','failed','suppressed'"),
        ("alertchannel",        "'push','sms','whatsapp','email'"),
        ("leavetype",           "'medical','personal','academic','emergency','other'"),
        ("leaverequeststatus",  "'pending','approved','rejected','cancelled'"),
        ("livesessiontype",     "'lecture','lab','seminar','tutorial','exam'"),
        ("livesessionstatus",   "'scheduled','live','ended','cancelled'"),
        ("liveparticipanttype", "'student','teacher','observer'"),
        ("liveconnectionquality","'excellent','good','fair','poor','disconnected'"),
        ("liveeventtype",       "'join','leave','reconnect','heartbeat','engagement','liveness_check','liveness_pass','liveness_fail','pulse_response','breakout_assign','breakout_end','ai_intervention'"),
        ("liveventtrigger",     "'auto','manual','threshold'"),
        ("pulsechecktrigger",   "'scheduled','manual','ai_triggered','engagement_drop'"),
        ("pulsecheckanswer",    "'A','B','C','D'"),
        ("knowledgelevel",      "'beginner','developing','proficient','advanced','expert'"),
        ("disputestatus",       "'pending','under_review','resolved','rejected'"),
        ("capsuletype",         "'video','pdf','quiz','article','assignment','link'"),
        ("capsuleunlockmode",   "'always','after_class','scheduled','manual'"),
        ("capsuleaccessaction", "'view','download','complete'"),
        ("wallpoststatus",      "'published','draft','archived'"),
    ]
    for ename, vals in ENUMS:
        try:
            conn.execute(text(
                f"DO $$ BEGIN "
                f"  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = '{ename}') THEN "
                f"    CREATE TYPE {ename} AS ENUM ({vals}); "
                f"  END IF; "
                f"END $$;"
            ))
        except Exception as e:
            print(f"  ⚠️  Enum {ename}: {e.__class__.__name__}: {e}")

    for tname in missing_tables:
        table = Base.metadata.tables[tname]
        try:
            ddl = str(CreateTable(table).compile(engine))
            conn.execute(text(ddl))
            print(f"  ➕ Created table: {tname}")
        except Exception as e:
            print(f"  ⚠️  Could not create {tname}: {e.__class__.__name__}: {e}")

    # ── Step 3: check columns for existing tables ──────────────────────────────
    print("\n── Column check on existing tables ──────────────────────────────")
    col_issues = 0
    for tname in present_tables:
        db_cols = {c["name"] for c in insp.get_columns(tname)}
        orm_table = Base.metadata.tables[tname]
        for col in orm_table.columns:
            if col.name not in db_cols:
                col_issues += 1
                # Build a safe ADD COLUMN statement
                col_type = col.type.compile(engine.dialect)
                nullable = "" if col.nullable else " NOT NULL DEFAULT 0" if "INT" in col_type.upper() else " NOT NULL DEFAULT ''" if "VARCHAR" in col_type.upper() or "TEXT" in col_type.upper() else " NOT NULL DEFAULT FALSE" if "BOOL" in col_type.upper() else ""
                try:
                    conn.execute(text(
                        f"ALTER TABLE {tname} ADD COLUMN IF NOT EXISTS {col.name} {col_type}{nullable}"
                    ))
                    print(f"  ➕ {tname}.{col.name}  ({col_type})")
                except Exception as e:
                    print(f"  ⚠️  {tname}.{col.name}: {e.__class__.__name__}: {e}")

    if col_issues == 0:
        print("  ✅ All columns match — no gaps found.")

    conn.commit()

# ── Step 4: final summary ──────────────────────────────────────────────────────
print(f"\n{'═'*60}")
print(f"  ✅ sync_prod_schema complete.")
print(f"  Tables created : {len(missing_tables)}")
print(f"  Column fixes   : {col_issues}")
print(f"{'═'*60}\n")
