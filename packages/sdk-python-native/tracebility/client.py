"""``TracebilityClient`` — bundles ingest + control under one object.

Use this when you want both write and read access from the same
process (typical for a backend service).

Configuration:

  TRACEBILITY_INGEST_URL / TRACEBILITY_INGEST_KEY  → write path
  TRACEBILITY_API_URL    / TRACEBILITY_API_KEY     → read path

Constructor args override env. The two paths use different hosts
in production (ingest on a public host with API-key auth, control on
an internal/admin host with cookie + workspace key auth) so we keep
them as two separate transports rather than one shared httpx.Client.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

import httpx

from .control import ControlClient
from .ingest import IngestClient


class TracebilityClient:
    def __init__(
        self,
        *,
        project_id: UUID | str,
        ingest_url: str | None = None,
        ingest_key: str | None = None,
        api_url: str | None = None,
        api_key: str | None = None,
        timeout: float = 10.0,
        ingest_http: httpx.Client | None = None,
        api_http: httpx.Client | None = None,
    ) -> None:
        self.project_id = str(project_id)
        self.ingest = IngestClient(
            api_url=ingest_url,
            api_key=ingest_key,
            timeout=timeout,
            http_client=ingest_http,
        )
        self.control = ControlClient(
            project_id=self.project_id,
            api_url=api_url,
            api_key=api_key,
            timeout=timeout,
            http_client=api_http,
        )
        # Convenience aliases — let callers do `client.runs.list(...)`
        # without going through `.control.runs`.
        self.runs = self.control.runs
        self.threads = self.control.threads
        self.datasets = self.control.datasets
        self.prompts = self.control.prompts
        self.evals = self.control.evals
        self.poll = self.control.poll
        self.comparisons = self.control.comparisons
        self.playground = self.control.playground

    def submit_batch(self, batch: Any) -> dict[str, Any]:
        return self.ingest.submit_batch(batch)

    def submit_run(self, run: Any, spans: Any | None = None) -> dict[str, Any]:
        return self.ingest.submit_run(run, spans=spans)

    def close(self) -> None:
        self.ingest.close()
        self.control.close()

    def __enter__(self) -> "TracebilityClient":
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()
