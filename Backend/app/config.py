"""Compatibility exports. New code should import settings from app.core.config."""

from app.core.config import DATA_DIR, DEFAULT_DATABASE_URL, TOOLS_DIR, Settings, settings

__all__ = ["DATA_DIR", "DEFAULT_DATABASE_URL", "TOOLS_DIR", "Settings", "settings"]
