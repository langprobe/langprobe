"""Read path: query the control-plane API.

Each surface (`runs`, `threads`, `datasets`, `prompts`, `evals`,
`comparisons`, `poll`, `playground`) is a thin namespace on
``ControlClient``. Methods return raw dicts (the server's pydantic
JSON shape) — we don't impose a parallel typed model here; the wire
shape evolves and forcing a generated client would slow that down.

Configuration env vars:

  TRACEBILITY_API_URL → control-plane API base URL
  TRACEBILITY_SESSION → session cookie value (for cookie-auth)
  TRACEBILITY_API_KEY → workspace API key (for header auth)

Either auth mechanism is accepted. The control-plane API expects
session cookies for browser-driven calls and workspace API keys
for SDK calls; this client uses bearer-token semantics so the same
token works as both.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

import httpx

from ._http import HTTP, env_first


class _Surface:
    """Base namespace; holds the shared HTTP transport."""

    def __init__(self, http: HTTP, project_id: UUID | str) -> None:
        self._http = http
        self._project_id = str(project_id)


class _Runs(_Surface):
    def list(
        self,
        *,
        status: str | None = None,
        kind: str | None = None,
        search: str | None = None,
        window_seconds: int | None = None,
        limit: int = 100,
        offset: int = 0,
    ) -> list[dict[str, Any]]:
        params: dict[str, Any] = {
            "project_id": self._project_id,
            "limit": limit,
            "offset": offset,
        }
        if status is not None:
            params["status"] = status
        if kind is not None:
            params["kind"] = kind
        if search is not None:
            params["search"] = search
        if window_seconds is not None:
            params["window_seconds"] = window_seconds
        data = self._http.get("/v1/runs", params=params)
        return list((data or {}).get("items") or [])

    def get(self, run_id: UUID | str) -> dict[str, Any]:
        return self._http.get(
            f"/v1/runs/{run_id}",
            params={"project_id": self._project_id},
        )

    def spans(self, run_id: UUID | str) -> list[dict[str, Any]]:
        data = self._http.get(
            f"/v1/runs/{run_id}/spans",
            params={"project_id": self._project_id},
        )
        return list((data or {}).get("items") or [])

    def replay_captures(
        self, run_id: UUID | str, *, limit: int = 500
    ) -> dict[str, Any]:
        return self._http.get(
            f"/v1/runs/{run_id}/replay-captures",
            params={"project_id": self._project_id, "limit": limit},
        )


class _Threads(_Surface):
    def list(self) -> list[dict[str, Any]]:
        return list(
            self._http.get(
                "/v1/threads", params={"project_id": self._project_id}
            )
            or []
        )

    def get(self, session_id: str) -> dict[str, Any]:
        return self._http.get(
            f"/v1/threads/{session_id}",
            params={"project_id": self._project_id},
        )


class _Datasets(_Surface):
    def list(self) -> list[dict[str, Any]]:
        return list(
            self._http.get(
                "/v1/datasets", params={"project_id": self._project_id}
            )
            or []
        )

    def get(self, dataset_id: UUID | str) -> dict[str, Any]:
        return self._http.get(f"/v1/datasets/{dataset_id}")

    def items(
        self, dataset_id: UUID | str, *, limit: int = 200
    ) -> list[dict[str, Any]]:
        data = self._http.get(
            f"/v1/datasets/{dataset_id}/items",
            params={"limit": limit},
        )
        return list((data or {}).get("items") or [])

    def add_item(
        self,
        dataset_id: UUID | str,
        *,
        input: str,
        expected: str,
        metadata: dict[str, Any] | None = None,
        source_run_id: UUID | str | None = None,
        source_span_id: UUID | str | None = None,
    ) -> dict[str, Any]:
        body: dict[str, Any] = {
            "input": input,
            "expected": expected,
        }
        if metadata is not None:
            body["metadata"] = metadata
        if source_run_id is not None:
            body["source_run_id"] = str(source_run_id)
        if source_span_id is not None:
            body["source_span_id"] = str(source_span_id)
        return self._http.post(f"/v1/datasets/{dataset_id}/items", body)


class _Prompts(_Surface):
    def list(self) -> list[dict[str, Any]]:
        return list(
            self._http.get(
                "/v1/prompts", params={"project_id": self._project_id}
            )
            or []
        )

    def get(self, prompt_id: UUID | str) -> dict[str, Any]:
        return self._http.get(f"/v1/prompts/{prompt_id}")

    def versions(self, prompt_id: UUID | str) -> list[dict[str, Any]]:
        data = self._http.get(f"/v1/prompts/{prompt_id}/versions")
        return list((data or {}).get("versions") or [])

    def create_version(
        self,
        prompt_id: UUID | str,
        *,
        template: str,
        input_schema: dict[str, Any] | None = None,
        model_params: dict[str, Any] | None = None,
        aliases: list[str] | None = None,
        commit_message: str | None = None,
    ) -> dict[str, Any]:
        body: dict[str, Any] = {"template": template}
        if input_schema is not None:
            body["input_schema"] = input_schema
        if model_params is not None:
            body["model_params"] = model_params
        if aliases is not None:
            body["aliases"] = aliases
        if commit_message is not None:
            body["commit_message"] = commit_message
        return self._http.post(f"/v1/prompts/{prompt_id}/versions", body)


class _Evals(_Surface):
    def list(self) -> list[dict[str, Any]]:
        return list(
            self._http.get(
                "/v1/eval-runs", params={"project_id": self._project_id}
            )
            or []
        )

    def get(self, run_id: UUID | str) -> dict[str, Any]:
        return self._http.get(f"/v1/eval-runs/{run_id}")

    def scores(self, run_id: UUID | str, *, limit: int = 200) -> list[dict[str, Any]]:
        data = self._http.get(
            f"/v1/eval-runs/{run_id}/scores", params={"limit": limit}
        )
        return list((data or {}).get("scores") or [])

    def create(
        self,
        *,
        dataset_id: UUID | str,
        judge_kind: str,
        name: str | None = None,
        prompt_id: UUID | str | None = None,
        prompt_version_id: UUID | str | None = None,
    ) -> dict[str, Any]:
        body: dict[str, Any] = {
            "project_id": self._project_id,
            "dataset_id": str(dataset_id),
            "judge_kind": judge_kind,
        }
        if name is not None:
            body["name"] = name
        if prompt_id is not None:
            body["prompt_id"] = str(prompt_id)
        if prompt_version_id is not None:
            body["prompt_version_id"] = str(prompt_version_id)
        return self._http.post("/v1/eval-runs", body)


class _Poll(_Surface):
    def list(self) -> list[dict[str, Any]]:
        return list(
            self._http.get(
                "/v1/poll-runs", params={"project_id": self._project_id}
            )
            or []
        )

    def get(self, poll_id: UUID | str) -> dict[str, Any]:
        return self._http.get(f"/v1/poll-runs/{poll_id}")

    def items(self, poll_id: UUID | str, *, limit: int = 500) -> list[dict[str, Any]]:
        data = self._http.get(
            f"/v1/poll-runs/{poll_id}/items", params={"limit": limit}
        )
        return list((data or {}).get("items") or [])

    def create(
        self,
        *,
        dataset_id: UUID | str,
        judges: list[str],
        aggregation: str = "mean",
        name: str | None = None,
    ) -> dict[str, Any]:
        body: dict[str, Any] = {
            "project_id": self._project_id,
            "dataset_id": str(dataset_id),
            "judges": list(judges),
            "aggregation": aggregation,
        }
        if name is not None:
            body["name"] = name
        return self._http.post("/v1/poll-runs", body)


class _Comparisons(_Surface):
    def list(self) -> list[dict[str, Any]]:
        return list(
            self._http.get(
                "/v1/comparisons", params={"project_id": self._project_id}
            )
            or []
        )

    def get(self, comparison_id: UUID | str) -> dict[str, Any]:
        return self._http.get(f"/v1/comparisons/{comparison_id}")

    def items(
        self, comparison_id: UUID | str, *, limit: int = 500
    ) -> list[dict[str, Any]]:
        data = self._http.get(
            f"/v1/comparisons/{comparison_id}/items", params={"limit": limit}
        )
        return list((data or {}).get("items") or [])


class _Playground(_Surface):
    def list(self, *, limit: int = 50) -> list[dict[str, Any]]:
        data = self._http.get(
            "/v1/playground/runs",
            params={"project_id": self._project_id, "limit": limit},
        )
        return list((data or {}).get("items") or [])

    def get(self, session_id: UUID | str) -> dict[str, Any]:
        return self._http.get(f"/v1/playground/runs/{session_id}")

    def run(
        self,
        *,
        model: str,
        prompt_version_id: UUID | str | None = None,
        raw_template: str | None = None,
        variables: dict[str, Any] | None = None,
        temperature: float | None = None,
        max_tokens: int | None = None,
    ) -> dict[str, Any]:
        body: dict[str, Any] = {
            "project_id": self._project_id,
            "model": model,
            "variables": variables or {},
        }
        if prompt_version_id is not None:
            body["prompt_version_id"] = str(prompt_version_id)
        if raw_template is not None:
            body["raw_template"] = raw_template
        if temperature is not None:
            body["temperature"] = temperature
        if max_tokens is not None:
            body["max_tokens"] = max_tokens
        return self._http.post("/v1/playground/runs", body)


class ControlClient:
    """Read + write client for the tracebility control-plane API."""

    def __init__(
        self,
        *,
        project_id: UUID | str,
        api_url: str | None = None,
        api_key: str | None = None,
        timeout: float = 10.0,
        http_client: httpx.Client | None = None,
    ) -> None:
        url = (
            api_url
            or env_first("TRACEBILITY_API_URL")
            or "http://localhost:7081"
        )
        key = api_key or env_first("TRACEBILITY_API_KEY")
        self._http = HTTP(
            base_url=url, api_key=key, timeout=timeout, client=http_client
        )
        pid = str(project_id)
        self.runs = _Runs(self._http, pid)
        self.threads = _Threads(self._http, pid)
        self.datasets = _Datasets(self._http, pid)
        self.prompts = _Prompts(self._http, pid)
        self.evals = _Evals(self._http, pid)
        self.poll = _Poll(self._http, pid)
        self.comparisons = _Comparisons(self._http, pid)
        self.playground = _Playground(self._http, pid)

    @property
    def base_url(self) -> str:
        return self._http.base_url

    def close(self) -> None:
        self._http.close()

    def __enter__(self) -> "ControlClient":
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()
