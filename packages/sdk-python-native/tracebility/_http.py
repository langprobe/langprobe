"""HTTP plumbing shared between Ingest and Control clients.

Thin wrapper over ``httpx.Client`` so test injection is one
``http_client=...`` constructor arg. We never swallow non-2xx
responses — they raise ``TracebilityHTTPError`` so callers can
react.
"""

from __future__ import annotations

import os
from typing import Any, Mapping

import httpx

from .errors import TracebilityHTTPError


def env_first(*names: str) -> str | None:
    for n in names:
        v = os.environ.get(n)
        if v:
            return v
    return None


def normalize_host(host: str) -> str:
    return host.rstrip("/")


class HTTP:
    """Shared HTTP transport.

    Reuses an httpx.Client across calls so connection pooling kicks in.
    Owned clients are closed via ``close()`` / context-manager exit;
    injected clients are left alone.
    """

    def __init__(
        self,
        *,
        base_url: str,
        api_key: str | None,
        timeout: float = 10.0,
        client: httpx.Client | None = None,
        user_agent: str = "tracebility-py/0.0.1",
    ) -> None:
        self._base_url = normalize_host(base_url)
        self._api_key = api_key
        self._timeout = timeout
        self._owned = client is None
        self._client = client or httpx.Client(
            base_url=self._base_url,
            timeout=timeout,
            headers=self._default_headers(user_agent),
        )

    @property
    def base_url(self) -> str:
        return self._base_url

    def _default_headers(self, user_agent: str) -> dict[str, str]:
        h = {"content-type": "application/json", "user-agent": user_agent}
        if self._api_key:
            h["authorization"] = f"Bearer {self._api_key}"
            h["x-api-key"] = self._api_key
        return h

    def get(self, path: str, params: Mapping[str, Any] | None = None) -> Any:
        return self._unwrap(self._client.get(path, params=params))

    def post(self, path: str, body: Any) -> Any:
        return self._unwrap(self._client.post(path, json=body))

    def patch(self, path: str, body: Any) -> Any:
        return self._unwrap(self._client.patch(path, json=body))

    def delete(self, path: str) -> None:
        resp = self._client.delete(path)
        if resp.status_code >= 400 and resp.status_code != 404:
            raise TracebilityHTTPError(resp.status_code, resp.text, str(resp.request.url))

    def _unwrap(self, resp: httpx.Response) -> Any:
        if resp.status_code >= 400:
            raise TracebilityHTTPError(resp.status_code, resp.text, str(resp.request.url))
        if resp.status_code == 204 or not resp.content:
            return None
        try:
            return resp.json()
        except ValueError:
            # Server responded 2xx with non-JSON; surface the text.
            return resp.text

    def close(self) -> None:
        if self._owned:
            self._client.close()

    def __enter__(self) -> "HTTP":
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()
