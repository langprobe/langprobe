"""Thin ClickHouse client used by read-side routers.

clickhouse-connect is sync, so we wrap calls in ``run_in_executor``. One
HTTP client per process (it manages its own pool internally). The
control-plane API only reads here — writes go through the ingest path.
Failure surfaces as an exception so routers can translate to 503; we
prefer that to a 200 with stale or empty data.
"""

from __future__ import annotations

import asyncio
from typing import Any

import clickhouse_connect
from clickhouse_connect.driver.client import Client


class ClickHouseQuery:
    def __init__(self, url: str) -> None:
        self._client: Client = clickhouse_connect.get_client(dsn=url)

    async def query(
        self, sql: str, parameters: dict[str, Any] | None = None
    ) -> list[dict[str, Any]]:
        loop = asyncio.get_running_loop()
        result = await loop.run_in_executor(
            None, lambda: self._client.query(sql, parameters=parameters)
        )
        column_names = result.column_names
        return [dict(zip(column_names, row, strict=True)) for row in result.result_rows]

    def close(self) -> None:
        self._client.close()
