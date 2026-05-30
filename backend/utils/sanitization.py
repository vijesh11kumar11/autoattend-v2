"""
HTML/text sanitization helpers built on bleach.

Use `clean_text(s)` for plain-text-only fields (no markup allowed).
Use `clean_richtext(s)` if a field genuinely accepts a small whitelist.
"""

from __future__ import annotations

import bleach  # type: ignore[import-untyped]

_RICH_TAGS = [
    "b",
    "i",
    "em",
    "strong",
    "p",
    "br",
    "ul",
    "ol",
    "li",
    "a",
    "code",
    "pre",
    "blockquote",
]
_RICH_ATTRS = {"a": ["href", "title", "rel"]}


def clean_text(value: str | None) -> str | None:
    """Strip ALL HTML tags. Returns plain text."""
    if value is None:
        return None
    return bleach.clean(value, tags=[], attributes={}, strip=True)


def clean_richtext(value: str | None) -> str | None:
    """Allow a minimal safe subset of formatting tags."""
    if value is None:
        return None
    return bleach.clean(value, tags=_RICH_TAGS, attributes=_RICH_ATTRS, strip=True)
