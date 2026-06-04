"""HTTP client mirroring the LangSmith ``Client`` surface.

We implement the methods LangSmith users actually call from
application code (the write path):
  - ``create_run`` — POST one run (called at trace start)
  - ``update_run`` — PATCH a run by id (called at trace end)
  - ``batch_ingest_runs`` — POST many runs+patches in one go

The read-side (``read_run``, ``list_runs``, ``read_project``) lives in the
native tracebility client — the LangSmith read API has a different
shape than tracebility's and we don't want to silently misrepresent
results.

Configuration honors LangSmith env vars so an existing setup migrates
without code changes:

  LANGSMITH_ENDPOINT  → host (alias: LANGCHAIN_ENDPOINT)
  LANGSMITH_API_KEY   → bearer token (alias: LANGCHAIN_API_KEY)
  LANGSMITH_PROJECT   → carried as ``session_name`` on every run

Constructor args override env. Trailing slashes are tolerated.
"""

from __future__ import annotations

import os
import uuid
from datetime import datetime, timezone
from typing import Any, Iterable, Mapping

import httpx


def _env_first(*names: str) -> str | None:
    for n in names:
        v = os.environ.get(n)
        if v:
            return v
    return None


def _normalize_host(host: str) -> str:
    return host.rstrip("/")


def _iso(value: Any) -> Any:
    if isinstance(value, datetime):
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return value.isoformat()
    return value


def _coerce_id(value: Any) -> str:
    if isinstance(value, uuid.UUID):
        return str(value)
    return str(value)


class Client:
    """LangSmith-compat client.

    Args:
        api_url: tracebility ingest-api base URL. Falls back to
            ``LANGSMITH_ENDPOINT`` / ``LANGCHAIN_ENDPOINT`` and finally
            ``http://localhost:7080``.
        api_key: Bearer token; LangSmith's per-org / per-project key.
            Falls back to ``LANGSMITH_API_KEY`` / ``LANGCHAIN_API_KEY``.
        project_name: default project (LangSmith terminology); carried
            on each run as ``session_name``. Falls back to
            ``LANGSMITH_PROJECT`` / ``LANGCHAIN_PROJECT`` and finally
            ``"default"``.
        timeout: per-request HTTP timeout in seconds.
        sync_client: optional pre-built httpx.Client (test injection).
    """

    def __init__(
        self,
        api_url: str | None = None,
        api_key: str | None = None,
        project_name: str | None = None,
        *,
        timeout: float = 10.0,
        sync_client: httpx.Client | None = None,
    ) -> None:
        self._api_url = _normalize_host(
            api_url
            or _env_first("LANGSMITH_ENDPOINT", "LANGCHAIN_ENDPOINT")
            or "http://localhost:7080"
        )
        self._api_key = api_key or _env_first(
            "LANGSMITH_API_KEY", "LANGCHAIN_API_KEY"
        )
        self._project_name = project_name or _env_first(
            "LANGSMITH_PROJECT", "LANGCHAIN_PROJECT"
        ) or "default"
        self._timeout = timeout
        self._owned_client = sync_client is None
        self._http = sync_client or httpx.Client(
            base_url=self._api_url,
            timeout=timeout,
            headers=self._default_headers(),
        )

    # ------------------------------------------------------------------
    # context manager / cleanup
    # ------------------------------------------------------------------

    def __enter__(self) -> "Client":
        return self

    def __exit__(self, *exc_info: object) -> None:
        self.close()

    def close(self) -> None:
        if self._owned_client:
            self._http.close()

    # ------------------------------------------------------------------
    # write-path
    # ------------------------------------------------------------------

    def create_run(
        self,
        name: str,
        inputs: Mapping[str, Any] | None = None,
        run_type: str = "chain",
        *,
        id: str | uuid.UUID | None = None,  # noqa: A002 — matches LangSmith arg name
        parent_run_id: str | uuid.UUID | None = None,
        project_name: str | None = None,
        revision_id: str | None = None,
        start_time: datetime | None = None,
        end_time: datetime | None = None,
        extra: Mapping[str, Any] | None = None,
        tags: Iterable[str] | None = None,
        error: str | None = None,
        outputs: Mapping[str, Any] | None = None,
        **kwargs: Any,
    ) -> dict[str, Any]:
        """POST /runs — create one run.

        Mirrors the LangSmith signature closely. Unknown kwargs land
        in ``extra`` so callers don't have to know our internal shape.
        """
        run_id = _coerce_id(id) if id is not None else str(uuid.uuid4())
        payload: dict[str, Any] = {
            "id": run_id,
            "name": name,
            "run_type": run_type,
            "inputs": dict(inputs or {}),
            "start_time": _iso(start_time or datetime.now(timezone.utc)),
            "session_name": project_name or self._project_name,
        }
        if parent_run_id is not None:
            payload["parent_run_id"] = _coerce_id(parent_run_id)
        if end_time is not None:
            payload["end_time"] = _iso(end_time)
        if outputs is not None:
            payload["outputs"] = dict(outputs)
        if error is not None:
            payload["error"] = error
        if tags is not None:
            payload["tags"] = list(tags)
        merged_extra: dict[str, Any] = dict(extra or {})
        if revision_id is not None:
            merged_extra.setdefault("metadata", {})["revision_id"] = revision_id
        if kwargs:
            merged_extra.setdefault("metadata", {}).update(kwargs)
        if merged_extra:
            payload["extra"] = merged_extra

        self._post("/runs", payload)
        return payload

    def update_run(
        self,
        run_id: str | uuid.UUID,
        *,
        end_time: datetime | None = None,
        outputs: Mapping[str, Any] | None = None,
        error: str | None = None,
        events: Iterable[Mapping[str, Any]] | None = None,
        extra: Mapping[str, Any] | None = None,
        **kwargs: Any,
    ) -> None:
        """PATCH /runs/{id} — update by id."""
        payload: dict[str, Any] = {}
        if end_time is not None:
            payload["end_time"] = _iso(end_time)
        if outputs is not None:
            payload["outputs"] = dict(outputs)
        if error is not None:
            payload["error"] = error
        if events is not None:
            payload["events"] = [dict(e) for e in events]
        if extra is not None:
            payload["extra"] = dict(extra)
        if kwargs:
            payload.setdefault("extra", {}).setdefault("metadata", {}).update(kwargs)

        self._patch(f"/runs/{_coerce_id(run_id)}", payload)

    def batch_ingest_runs(
        self,
        create: Iterable[Mapping[str, Any]] | None = None,
        update: Iterable[Mapping[str, Any]] | None = None,
        *,
        pre_sampled: bool = False,
    ) -> None:
        """POST /runs/batch — bulk create + update.

        ``pre_sampled`` is accepted for signature compatibility but
        ignored: tracebility's sampling lives on the server-side
        workspace settings, not the SDK.
        """
        del pre_sampled  # honored on the server, not the client
        body = {
            "post": [self._normalize_run(r) for r in (create or [])],
            "patch": [self._normalize_run(r, partial=True) for r in (update or [])],
        }
        if not body["post"] and not body["patch"]:
            return
        self._post("/runs/batch", body)

    # ------------------------------------------------------------------
    # introspection helpers (no-op friendly so existing code doesn't break)
    # ------------------------------------------------------------------

    @property
    def api_url(self) -> str:
        return self._api_url

    @property
    def project_name(self) -> str:
        return self._project_name

    # ------------------------------------------------------------------
    # internals
    # ------------------------------------------------------------------

    def _default_headers(self) -> dict[str, str]:
        headers = {
            "content-type": "application/json",
            "user-agent": "tracebility-langsmith-shim/0.0.1",
        }
        if self._api_key:
            headers["authorization"] = f"Bearer {self._api_key}"
            # LangSmith historically also reads x-api-key — set both so
            # whichever the server is wired for picks it up.
            headers["x-api-key"] = self._api_key
        return headers

    def _post(self, path: str, json_body: Any) -> httpx.Response:
        return self._raise_for_status(self._http.post(path, json=json_body))

    def _patch(self, path: str, json_body: Any) -> httpx.Response:
        return self._raise_for_status(self._http.patch(path, json=json_body))

    @staticmethod
    def _raise_for_status(resp: httpx.Response) -> httpx.Response:
        if resp.status_code >= 400:
            # We keep this simple — production users typically wrap
            # the client in a retry. LangSmith's own client raises a
            # ``LangSmithError``; we use ``httpx.HTTPStatusError`` so
            # callers don't have to import a vendor exception type.
            raise httpx.HTTPStatusError(
                f"tracebility ingest returned {resp.status_code}: {resp.text[:200]}",
                request=resp.request,
                response=resp,
            )
        return resp

    def _normalize_run(
        self, run: Mapping[str, Any], *, partial: bool = False
    ) -> dict[str, Any]:
        out: dict[str, Any] = {}
        for k, v in run.items():
            if isinstance(v, datetime):
                out[k] = _iso(v)
            elif isinstance(v, uuid.UUID):
                out[k] = str(v)
            else:
                out[k] = v
        if not partial and "id" not in out:
            out["id"] = str(uuid.uuid4())
        if not partial and "session_name" not in out:
            out["session_name"] = self._project_name
        return out
