"""ClickHouse bulk writer.

Each batch is one INSERT per table — ClickHouse loves big inserts, hates
small ones.

Idempotency: ``run`` and ``span`` are ReplacingMergeTree on
``(project_id, run_id, span_id)`` ordered by ``received_at``. So a redelivery
from the Redis stream produces a second row that the merge collapses. We
don't need to dedupe at write time.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime
from typing import Any

import clickhouse_connect
import structlog
from clickhouse_connect.driver import Client

log = structlog.get_logger("tracebility.worker.writer")

_RUN_COLUMNS: tuple[str, ...] = (
    "project_id",
    "run_id",
    "parent_run_id",
    "name",
    "kind",
    "status",
    "sdk",
    "start_time",
    "end_time",
    "received_at",
    "inputs",
    "outputs",
    "inputs_obj_ref",
    "outputs_obj_ref",
    "prompt_tokens",
    "completion_tokens",
    "total_tokens",
    "cost_usd",
    "session_id",
    "user_id",
    "tags",
    "metadata",
    "error_kind",
    "error_message",
    "schema_version",
)

_SPAN_COLUMNS: tuple[str, ...] = (
    "project_id",
    "run_id",
    "span_id",
    "parent_span_id",
    "name",
    "kind",
    "status",
    "start_time",
    "end_time",
    "received_at",
    "model",
    "temperature",
    "inputs",
    "outputs",
    "inputs_obj_ref",
    "outputs_obj_ref",
    "prompt_tokens",
    "completion_tokens",
    "total_tokens",
    "cost_usd",
    "attributes",
    "error_kind",
    "error_message",
    "schema_version",
)


def _parse_dt(value: Any) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value
    if isinstance(value, str):
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None
    return None


def _epoch(value: Any) -> datetime:
    """ClickHouse columns are NOT NULL DateTime64; fall back to epoch."""
    parsed = _parse_dt(value)
    return parsed if parsed is not None else datetime.fromtimestamp(0, tz=UTC)


def _row_for_run(envelope: dict[str, Any], run: dict[str, Any]) -> tuple[Any, ...]:
    received_at = _epoch(run.get("received_at") or envelope.get("received_at"))
    return (
        envelope["project_id"],
        run["run_id"],
        run.get("parent_run_id"),
        run.get("name") or "",
        run.get("kind") or "chain",
        run.get("status") or "ok",
        run.get("sdk") or envelope.get("source") or "",
        _epoch(run.get("start_time")),
        _parse_dt(run.get("end_time")),
        received_at,
        run.get("inputs") or "",
        run.get("outputs") or "",
        run.get("inputs_obj_ref"),
        run.get("outputs_obj_ref"),
        run.get("prompt_tokens") or 0,
        run.get("completion_tokens") or 0,
        run.get("total_tokens") or 0,
        run.get("cost_usd") or 0,
        run.get("session_id"),
        run.get("user_id"),
        list(run.get("tags") or []),
        json.dumps(run.get("metadata") or {}),
        run.get("error_kind"),
        run.get("error_message"),
        run.get("schema_version") or 1,
    )


def _row_for_span(
    envelope: dict[str, Any],
    span: dict[str, Any],
    *,
    parent_run_id: str | None = None,
) -> tuple[Any, ...]:
    received_at = _epoch(envelope.get("received_at"))
    run_id = span.get("run_id") or parent_run_id
    return (
        envelope["project_id"],
        run_id,
        span["span_id"],
        span.get("parent_span_id"),
        span.get("name") or "",
        span.get("kind") or "chain",
        span.get("status") or "ok",
        _epoch(span.get("start_time")),
        _parse_dt(span.get("end_time")),
        received_at,
        span.get("model"),
        span.get("temperature"),
        span.get("inputs") or "",
        span.get("outputs") or "",
        span.get("inputs_obj_ref"),
        span.get("outputs_obj_ref"),
        span.get("prompt_tokens") or 0,
        span.get("completion_tokens") or 0,
        span.get("total_tokens") or 0,
        span.get("cost_usd") or 0,
        json.dumps(span.get("attributes") or {}),
        span.get("error_kind"),
        span.get("error_message"),
        span.get("schema_version") or 1,
    )


class ClickHouseWriter:
    def __init__(self, url: str) -> None:
        self._client: Client = clickhouse_connect.get_client(dsn=url)

    def insert_envelope(self, envelope: dict[str, Any]) -> tuple[int, int]:
        """Translate one envelope into row inserts. Returns (runs, spans) counts."""
        payload = envelope.get("payload") or {}
        runs = payload.get("runs") or []
        loose_spans = payload.get("spans") or []

        run_rows: list[tuple[Any, ...]] = []
        span_rows: list[tuple[Any, ...]] = []
        for r in runs:
            run_rows.append(_row_for_run(envelope, r))
            for s in r.get("spans") or []:
                span_rows.append(
                    _row_for_span(envelope, s, parent_run_id=r["run_id"])
                )
        for s in loose_spans:
            span_rows.append(_row_for_span(envelope, s))

        if run_rows:
            self._client.insert("run", run_rows, column_names=_RUN_COLUMNS)
        if span_rows:
            self._client.insert("span", span_rows, column_names=_SPAN_COLUMNS)
        return (len(run_rows), len(span_rows))

    def close(self) -> None:
        self._client.close()
