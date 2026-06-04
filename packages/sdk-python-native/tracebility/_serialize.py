"""Internal: dataclass → JSON-serializable dict conversion.

We don't depend on pydantic. The serializer here is purpose-built
for our model shape — datetimes → ISO 8601, UUIDs → str, optional
None drops via ``include_none=False`` so the wire payload stays tight.
"""

from __future__ import annotations

from dataclasses import is_dataclass, asdict
from datetime import datetime
from typing import Any
from uuid import UUID


def to_jsonable(value: Any) -> Any:
    """Recursively convert datetimes / UUIDs / dataclasses to JSON types."""
    if is_dataclass(value):
        # asdict already recurses into nested dataclasses + lists/dicts.
        return _strip_nones(_normalize(asdict(value)))
    return _normalize(value)


def _normalize(value: Any) -> Any:
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, UUID):
        return str(value)
    if isinstance(value, dict):
        return {k: _normalize(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_normalize(v) for v in value]
    if isinstance(value, tuple):
        return [_normalize(v) for v in value]
    return value


def _strip_nones(obj: Any) -> Any:
    """Drop keys whose value is None — keeps the wire payload tight."""
    if isinstance(obj, dict):
        return {
            k: _strip_nones(v)
            for k, v in obj.items()
            if v is not None
        }
    if isinstance(obj, list):
        return [_strip_nones(v) for v in obj]
    return obj
