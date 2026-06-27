"""Post-migration invariants for prompt_version.template_messages.

Boots an asyncpg pool against the live local docker postgres and pins:
  1. The column exists, is jsonb, and is NOT NULL.
  2. Existing rows have the [{role: human, content: <old template>}]
     wrap shape from migration 0026's backfill.
  3. The non-empty-array CHECK constraint refuses an empty array insert.

Skips cleanly when postgres is unreachable, when prompt_version is
empty, or when there are no project rows to FK against. The end-to-end
HTTP-level check (request body shape, etc.) lands in Plan B.
"""

from __future__ import annotations

import json
import os
import socket

import asyncpg
import pytest


def _reachable(host: str, port: int) -> bool:
    try:
        with socket.create_connection((host, port), timeout=0.25):
            return True
    except OSError:
        return False


_DEFAULT_LOCAL_DSN = "postgres://langprobe:langprobe@localhost:5432/langprobe"
# `services/api/tests/conftest.py` setdefaults LANGPROBE_PG_DSN to a unit-test
# sentinel ("postgres://test/test") so config.load() doesn't raise at import.
# Treat that sentinel as "unset" for integration purposes and fall back to the
# local docker default; an explicit LANGPROBE_TEST_DSN still wins.
PG_DSN = (
    os.environ.get("LANGPROBE_TEST_DSN")
    or (
        os.environ.get("LANGPROBE_PG_DSN")
        if os.environ.get("LANGPROBE_PG_DSN") not in (None, "postgres://test/test")
        else None
    )
    or _DEFAULT_LOCAL_DSN
)


pytestmark = pytest.mark.asyncio


@pytest.fixture
async def pg_pool():
    if not _reachable("localhost", 5432):
        pytest.skip("postgres not reachable")
    pool = await asyncpg.create_pool(PG_DSN, min_size=1, max_size=2)
    try:
        yield pool
    finally:
        await pool.close()


async def test_template_messages_column_exists_and_is_not_null(pg_pool):
    """Direct schema check; the migration runner ran in setup."""
    row = await pg_pool.fetchrow(
        """
        select column_name, data_type, is_nullable
          from information_schema.columns
         where table_name = 'prompt_version'
           and column_name = 'template_messages'
        """
    )
    assert row is not None
    assert row["data_type"] == "jsonb"
    assert row["is_nullable"] == "NO"


async def test_existing_rows_have_human_wrapped_messages(pg_pool):
    """If there are existing prompt_version rows in the local db, every
    one has the wrap shape from the backfill. Skip cleanly if empty."""
    rows = await pg_pool.fetch("select template, template_messages from prompt_version limit 5")
    if not rows:
        pytest.skip("prompt_version is empty on this db; backfill is a no-op")
    for r in rows:
        msgs = r["template_messages"]
        # asyncpg may decode jsonb to dict/list directly or to str; handle both.
        if isinstance(msgs, str):
            msgs = json.loads(msgs)
        assert isinstance(msgs, list) and len(msgs) >= 1
        assert msgs[0]["role"] == "human"
        assert msgs[0]["content"] == r["template"]


async def test_constraint_blocks_empty_array(pg_pool):
    """The check constraint refuses an empty list (every prompt has at
    least one message). Wrapped in a transaction we always roll back so
    nothing leaks if the worker is killed mid-test."""
    project_row = await pg_pool.fetchrow("select id from project where deleted_at is null limit 1")
    if project_row is None:
        pytest.skip("no project rows on this db; cannot insert prompt")
    project_id = project_row["id"]

    async with pg_pool.acquire() as conn:
        tx = conn.transaction()
        await tx.start()
        try:
            prompt_id = await conn.fetchval(
                """
                insert into prompt (project_id, slug, name)
                values ($1, 'test-' || md5(random()::text), 'test')
                returning id
                """,
                project_id,
            )
            with pytest.raises(asyncpg.CheckViolationError):
                await conn.execute(
                    """
                    insert into prompt_version
                      (prompt_id, version, template, template_messages)
                    values ($1, 1, '', '[]'::jsonb)
                    """,
                    prompt_id,
                )
        finally:
            await tx.rollback()
