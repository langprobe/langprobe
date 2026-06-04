"""Write path: post traces to the ingest-api.

This is the lower-level surface. For the common case ("decorate a
function and capture inputs/outputs"), use ``trace`` / ``span`` from
``tracebility.trace``.

Configuration env vars:

  TRACEBILITY_INGEST_URL  → e.g. https://traces.example.com
  TRACEBILITY_INGEST_KEY  → bearer token (the ingest API key)
"""

from __future__ import annotations

import json as _json
import uuid
from datetime import datetime, timezone
from typing import Any, Mapping

import httpx

from ._http import HTTP, env_first
from ._serialize import to_jsonable
from .models import IngestBatch, IngestRun, IngestSpan


class IngestClient:
    """Native ingest client.

    The wire contract is the same envelope ingest-api accepts on the
    LangSmith parity path; we just speak it natively. Calls are
    synchronous + non-buffering — flush behavior lives on top of this
    in ``trace`` if you want per-process batching.
    """

    def __init__(
        self,
        *,
        api_url: str | None = None,
        api_key: str | None = None,
        timeout: float = 10.0,
        http_client: httpx.Client | None = None,
    ) -> None:
        url = (
            api_url
            or env_first("TRACEBILITY_INGEST_URL", "LANGSMITH_ENDPOINT")
            or "http://localhost:7080"
        )
        key = api_key or env_first(
            "TRACEBILITY_INGEST_KEY", "LANGSMITH_API_KEY"
        )
        self._http = HTTP(
            base_url=url, api_key=key, timeout=timeout, client=http_client
        )

    @property
    def base_url(self) -> str:
        return self._http.base_url

    def submit_batch(self, batch: IngestBatch) -> dict[str, Any]:
        """POST /v1/runs — submit one batch envelope.

        Returns the IngestAck the server emits. Raises
        ``TracebilityHTTPError`` on non-2xx.
        """
        body = to_jsonable(batch)
        return self._http.post("/v1/runs", body)

    def submit_run(
        self,
        run: IngestRun,
        spans: list[IngestSpan] | None = None,
    ) -> dict[str, Any]:
        """Convenience: submit one run with its spans in a fresh batch."""
        if spans is not None:
            run.spans = list(spans)
        batch = IngestBatch(runs=[run])
        return self.submit_batch(batch)

    def submit_run_dict(self, run: Mapping[str, Any]) -> dict[str, Any]:
        """Submit a raw dict that already matches the IngestRun shape.

        Useful when the calling code is constructing the payload by
        hand (e.g. a different language pipeline writing JSON).
        """
        batch = {
            "runs": [_normalize_dict(run)],
            "spans": [],
            "sdk": "tracebility-py",
            "sdk_version": "0.0.1",
            "schema_version": 1,
        }
        return self._http.post("/v1/runs", batch)

    def close(self) -> None:
        self._http.close()

    def __enter__(self) -> "IngestClient":
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()


def _normalize_dict(d: Mapping[str, Any]) -> dict[str, Any]:
    """Convert datetimes / UUIDs that might appear in user-built dicts."""
    out: dict[str, Any] = {}
    for k, v in d.items():
        if isinstance(v, datetime):
            out[k] = v.isoformat()
        elif hasattr(v, "hex") and not isinstance(v, (bytes, bytearray)):
            # uuid.UUID quacks like this; str() is the safe path.
            out[k] = str(v)
        elif isinstance(v, dict):
            out[k] = _normalize_dict(v)
        elif isinstance(v, list):
            out[k] = [
                _normalize_dict(x) if isinstance(x, dict) else x
                for x in v
            ]
        else:
            out[k] = v
    return out


def new_run_id() -> str:
    return str(uuid.uuid4())


def new_span_id() -> str:
    return str(uuid.uuid4())
