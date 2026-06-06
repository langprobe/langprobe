"""Verify migration 0024 creates dispatch_cost with the expected shape."""

from __future__ import annotations

import asyncpg
import pytest

pytestmark = pytest.mark.asyncio


async def test_dispatch_cost_columns(integration_dsn: str) -> None:
    pool = await asyncpg.create_pool(integration_dsn, min_size=1, max_size=2)
    try:
        cols = await pool.fetch(
            """
            select column_name from information_schema.columns
             where table_name = 'dispatch_cost'
             order by ordinal_position
            """,
        )
        names = [r["column_name"] for r in cols]
        assert names == [
            "id", "project_id", "workspace_id", "surface", "surface_ref_id",
            "provider", "model", "prompt_tokens", "completion_tokens",
            "cost_usd", "cost_calculated_via", "dispatched_at",
            "error_code", "error_detail",
        ]
    finally:
        await pool.close()


async def test_surface_check_constraint_rejects_unknown(integration_dsn: str) -> None:
    pool = await asyncpg.create_pool(integration_dsn, min_size=1, max_size=2)
    try:
        async with pool.acquire() as conn:
            ws = await conn.fetchval("select id from workspace limit 1")
            proj = await conn.fetchval("select id from project where workspace_id = $1 limit 1", ws)
            if proj is None:
                pytest.skip("test DB lacks a seeded project; integration scaffolding required")
            with pytest.raises(asyncpg.exceptions.CheckViolationError):
                await conn.execute(
                    """
                    insert into dispatch_cost (
                        project_id, workspace_id, surface, surface_ref_id,
                        provider, model
                    ) values ($1, $2, 'banana', $3, 'openai', 'gpt-4o')
                    """,
                    proj, ws, proj,
                )
    finally:
        await pool.close()
