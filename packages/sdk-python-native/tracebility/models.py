"""Lightweight dataclass-style models for the SDK.

These mirror the ingest-api's pydantic schemas without depending on
pydantic. The shapes are stable — they're the wire contract — so
string field names are the source of truth.

We use ``dataclass`` instead of ``pydantic.BaseModel`` to keep this
package's runtime footprint tiny (httpx is the only third-party
dep). Validation lives at the receive boundary on the server side.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any
from uuid import UUID


def _now() -> datetime:
    return datetime.now(timezone.utc)


@dataclass
class IngestSpan:
    """One span. Mirrors the worker's `span` columns."""

    span_id: UUID | str
    run_id: UUID | str
    name: str
    kind: str
    parent_span_id: UUID | str | None = None
    status: str = "ok"
    start_time: datetime = field(default_factory=_now)
    end_time: datetime | None = None
    model: str | None = None
    temperature: float | None = None
    inputs: str | None = None
    outputs: str | None = None
    prompt_tokens: int | None = None
    completion_tokens: int | None = None
    total_tokens: int | None = None
    cost_usd: float | None = None
    error_kind: str | None = None
    error_message: str | None = None
    attributes: dict[str, Any] = field(default_factory=dict)


@dataclass
class IngestRun:
    """One run (root or child)."""

    run_id: UUID | str
    name: str
    kind: str
    parent_run_id: UUID | str | None = None
    status: str = "ok"
    sdk: str = "tracebility-py"
    start_time: datetime = field(default_factory=_now)
    end_time: datetime | None = None
    inputs: str | None = None
    outputs: str | None = None
    prompt_tokens: int | None = None
    completion_tokens: int | None = None
    total_tokens: int | None = None
    cost_usd: float | None = None
    session_id: str | None = None
    user_id: str | None = None
    tags: list[str] = field(default_factory=list)
    metadata: dict[str, Any] = field(default_factory=dict)
    error_kind: str | None = None
    error_message: str | None = None
    spans: list[IngestSpan] = field(default_factory=list)


@dataclass
class IngestBatch:
    """Top-level ingest envelope."""

    runs: list[IngestRun] = field(default_factory=list)
    spans: list[IngestSpan] = field(default_factory=list)
    sdk: str = "tracebility-py"
    sdk_version: str = "0.0.1"
    schema_version: int = 1
