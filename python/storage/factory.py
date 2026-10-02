"""Storage factory and current instance."""
from __future__ import annotations

import os
from typing import Optional

from python import config
from python.storage.base import Storage
from python.storage.json_store import JsonStorage


_BACKEND: Optional[str] = None
_INSTANCE: Optional[Storage] = None


def get_storage() -> Storage:
    global _INSTANCE, _BACKEND
    if _INSTANCE is not None:
        return _INSTANCE
    backend = os.environ.get("LEFOREM_STORAGE", "json").lower()
    _BACKEND = backend
    if backend == "sqlite":
        from python.storage.sqlite_store import SqliteStorage

        _INSTANCE = SqliteStorage()
    else:
        _INSTANCE = JsonStorage()
    return _INSTANCE


def set_storage(storage: Storage) -> None:
    global _INSTANCE
    _INSTANCE = storage


def reset_storage() -> None:
    global _INSTANCE, _BACKEND
    _INSTANCE = None
    _BACKEND = None
