"""Verify migration 0023 widens providers, adds default flag, and creates link table."""

from __future__ import annotations

import asyncpg
import pytest

pytestmark = pytest.mark.asyncio


async def test_provider_check_accepts_six_providers(integration_dsn: str) -> None:
    pool = await asyncpg.create_pool(integration_dsn, min_size=1, max_size=2)
    try:
        async with pool.acquire() as conn:
            for provider in ("anthropic", "openai", "gemini", "mistral", "deepseek", "groq"):
                row = await conn.fetchval(
                    """
                    select count(*) from pg_constraint
                     where conname = 'workspace_llm_credential_provider_check'
                       and pg_get_constraintdef(oid) like $1
                    """,
                    f"%{provider}%",
                )
                assert row == 1, f"{provider} missing from provider check"
    finally:
        await pool.close()


async def test_default_enabled_column_exists(integration_dsn: str) -> None:
    pool = await asyncpg.create_pool(integration_dsn, min_size=1, max_size=2)
    try:
        col = await pool.fetchval(
            """
            select column_name from information_schema.columns
             where table_name = 'workspace_llm_credential'
               and column_name = 'default_enabled'
            """,
        )
        assert col == "default_enabled"
    finally:
        await pool.close()


async def test_project_llm_credential_table_exists(integration_dsn: str) -> None:
    pool = await asyncpg.create_pool(integration_dsn, min_size=1, max_size=2)
    try:
        cols = await pool.fetch(
            """
            select column_name from information_schema.columns
             where table_name = 'project_llm_credential'
             order by ordinal_position
            """,
        )
        names = [r["column_name"] for r in cols]
        assert names == ["project_id", "credential_id", "enabled_at", "enabled_by"]
    finally:
        await pool.close()
