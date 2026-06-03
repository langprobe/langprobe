"""Thin ClickHouse client used by read-side routers.

clickhouse-connect is sync, so we wrap calls in ``run_in_executor``. One
HTTP client per process (it manages its own pool internally). Reads via
``query``; control-plane writes (dataset items, etc.) via ``insert`` /
``command``. The hot trace ingest path stays on the dedicated ingest
service — these helpers are for low-volume CRUD only.
Failure surfaces as an exception so routers can translate to 503; we
prefer that to a 200 with stale or empty data.
"""

from __future__ import annotations

import asyncio
from collections.abc import Sequence
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

    async def insert(
        self,
        table: str,
        rows: Sequence[Sequence[Any]],
        column_names: Sequence[str],
    ) -> None:
        """Low-volume row insert for control-plane writes.

        Hot path traces still go through the ingest worker; this is for
        things like dataset_item where the API directly writes a handful
        of rows on user action.
        """
        if not rows:
            return
        loop = asyncio.get_running_loop()
        await loop.run_in_executor(
            None,
            lambda: self._client.insert(
                table, list(rows), column_names=list(column_names)
            ),
        )

    async def command(
        self, sql: str, parameters: dict[str, Any] | None = None
    ) -> None:
        """Run a DDL/DML command (ALTER ... DELETE, etc.) without a result set."""
        loop = asyncio.get_running_loop()
        await loop.run_in_executor(
            None, lambda: self._client.command(sql, parameters=parameters)
        )

    def close(self) -> None:
        self._client.close()
