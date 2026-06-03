# AutoAttend AI v2.0 — Backend developer tasks
.PHONY: test test-fast install install-dev lint format format-check

# Install runtime + test dependencies.
install:
	pip install -r requirements.txt

# Install runtime + linting/formatting tooling (for local dev & CI).
install-dev:
	pip install -r requirements.txt -r requirements-dev.txt

# Lint with ruff (configuration in pyproject.toml).
lint:
	ruff check .

# Auto-format with black.
format:
	black .

# Verify formatting + linting without modifying files (used in CI).
format-check:
	ruff check .
	black --check .

# Run the full, isolated test suite (issue #77).
# Uses a dedicated PostgreSQL database (TEST_DATABASE_URL, or DATABASE_URL
# with a `_test` suffix). The production database is never touched.
test:
	pytest tests/ -v --timeout=300

# Stop on first failure — handy while iterating locally.
test-fast:
	pytest tests/ -x -q --timeout=300
