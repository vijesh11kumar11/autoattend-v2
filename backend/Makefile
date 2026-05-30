# AutoAttend AI v2.0 — Backend developer tasks
.PHONY: test test-fast install

# Install runtime + test dependencies.
install:
	pip install -r requirements.txt

# Run the full, isolated test suite (issue #77).
# Uses a dedicated PostgreSQL database (TEST_DATABASE_URL, or DATABASE_URL
# with a `_test` suffix). The production database is never touched.
test:
	pytest tests/ -v --timeout=300

# Stop on first failure — handy while iterating locally.
test-fast:
	pytest tests/ -x -q --timeout=300
