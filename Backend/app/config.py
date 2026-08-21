"""Compatibility exports. New code should import settings from app.core.config."""

from app.core.config import DEFAULT_DATABASE_URL, TOOLS_DIR, Settings, settings

__all__ = ["DEFAULT_DATABASE_URL", "TOOLS_DIR", "Settings", "settings"]
