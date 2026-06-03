# Manual integration / smoke scripts

These scripts are **not** part of the automated `pytest` suite (which lives in
[`backend/tests/`](../../tests) and is the source of truth for CI). They are
manual, end-to-end smoke checks that talk to a **running** server over HTTP and,
in some cases, the live database. They require seeded data and external services
to be configured, so they are intentionally excluded from `pytest` collection
(`testpaths = tests` in `pytest.ini`) and were renamed to drop the `test_`
prefix.

## Scripts

| Script                  | What it exercises                                            |
| ----------------------- | ------------------------------------------------------------ |
| `flows.py`              | Simulates the 5 core attendance flows via the API + direct DB |
| `live_session_flow.py`  | ClassPulse Live (F02–F10) smoke test against a live server   |

## Running

Start the backend first (and seed the database), then run a script directly:

```bash
# 1. Start the API (in another terminal)
uvicorn main:app --reload            # serves http://localhost:8000

# 2. Seed demo data if needed
python seed.py                       # or seed_live.py / seed_test_data.py

# 3. Run a manual script
python scripts/manual_tests/flows.py
python scripts/manual_tests/live_session_flow.py
```

Prerequisites (e.g. seeded users such as `teacher01@svec.edu.in / password123`
and a subject owned by that teacher) are documented at the top of each script.

> For deterministic, isolated, CI-friendly tests use the `pytest` suite instead:
> `make test` or `pytest tests/ -v`.
