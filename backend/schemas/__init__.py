"""schemas package — Pydantic request/response DTOs.

Each module groups the schemas for one domain (``auth_schemas``,
``attendance_schemas``, …) and is imported explicitly at its call site.
This ``__init__`` intentionally exposes nothing to avoid import-time
side effects and circular imports.
"""

