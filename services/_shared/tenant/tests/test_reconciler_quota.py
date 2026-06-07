"""Quota reconciler — live postgres + clickhouse round-trip.

Skipped in CI without docker-compose; runs locally against the real
stack so we catch SQL/CH-driver issues that mocks would hide."""

from __future__ import annotations

import datetime as dt
import os
import socket
from uuid import uuid4

import asyncpg
import clickhouse_connect
import pytest
import pytest_asyncio
import redis.asyncio as redis_async
from tracebility_tenant.quota import current_period
from tracebility_tenant.reconciler_quota import reconcile_once


def _reachable(host: str, port: int) -> bool:
    try:
        with socket.create_connection((host, port), timeout=0.25):
            return True
    except OSError:
        return False


PG_DSN = os.environ.get(
    "TRACEBILITY_PG_DSN",
    "postgres://tracebility:tracebility@localhost:5432/tracebility",
)
CH_URL = os.environ.get(
    "TRACEBILITY_CLICKHOUSE_URL",
    "http://tracebility:tracebility@localhost:8123/tracebility",
)


pytestmark = pytest.mark.asyncio


@pytest_asyncio.fixture
async def pg_pool():
    if not _reachable("localhost", 5432):
        pytest.skip("postgres not reachable")
    pool = await asyncpg.create_pool(PG_DSN, min_size=1, max_size=2)
    try:
        yield pool
    finally:
        await pool.close()


@pytest_asyncio.fixture
async def ch_client():
    if not _reachable("localhost", 8123):
        pytest.skip("clickhouse not reachable")
    client = await clickhouse_connect.get_async_client(dsn=CH_URL)
    try:
        yield client
    finally:
        await client.close()


@pytest_asyncio.fixture
async def redis_client_db15():
    if not _reachable("localhost", 6379):
        pytest.skip("redis not reachable")
    c = redis_async.from_url("redis://localhost:6379/15", decode_responses=False)
    await c.flushdb()
    try:
        yield c
    finally:
        await c.aclose()


async def test_reconcile_writes_postgres_and_redis(pg_pool, ch_client, redis_client_db15):
    """Insert one billing_meter row, run reconciler, verify the
    quota_period row + redis counter + over-flag all line up."""
    # Pick a real org from the live db so FKs are satisfied.
    org_row = await pg_pool.fetchrow("select id from org where deleted_at is null limit 1")
    if org_row is None:
        pytest.skip("no orgs in postgres")
    org_id = org_row["id"]
    project_row = await pg_pool.fetchrow(
        """
        select project.id as project_id
        from project
        join workspace on workspace.id = project.workspace_id
        where workspace.org_id = $1 and project.deleted_at is null
        limit 1
        """,
        org_id,
    )
    if project_row is None:
        pytest.skip("org has no projects")

    period = current_period()

    # Drop any existing quota_period rows for the test org so we measure
    # only what the reconciler writes.
    await pg_pool.execute(
        "delete from quota_period where org_id = $1",
        org_id,
    )

    # Force the org onto plan='free' so the limit is finite (1M spans).
    await pg_pool.execute(
        "update org set plan = 'free' where id = $1",
        org_id,
    )

    # Insert a billing_meter row that exceeds the free plan's
    # span_ingested cap (1_000_000) so we can check the over-flag too.
    now = dt.datetime.now(dt.UTC)
    await ch_client.insert(
        "billing_meter",
        [
            [
                org_id,
                project_row["project_id"],
                project_row["project_id"],  # workspace placeholder
                "span_ingested",
                2_000_000,
                "test",
                uuid4(),
                "{}",
                now,
                now,
                1,
            ]
        ],
        column_names=[
            "org_id",
            "workspace_id",
            "project_id",
            "meter",
            "amount",
            "source_kind",
            "source_id",
            "attributes",
            "event_time",
            "received_at",
            "schema_version",
        ],
    )

    updated = await reconcile_once(pg=pg_pool, ch=ch_client, redis=redis_client_db15)
    assert updated >= 1

    # Postgres: quota_period row should reflect the SUM.
    period_start = dt.date(int(period[:4]), int(period[4:6]), 1)
    row = await pg_pool.fetchrow(
        """
        select used_amount, limit_amount
        from quota_period
        where org_id = $1 and meter = 'span_ingested' and period_start = $2
        """,
        org_id,
        period_start,
    )
    assert row is not None
    assert row["used_amount"] >= 2_000_000
    assert row["limit_amount"] == 1_000_000

    # Redis over-flag should be set.
    over = await redis_client_db15.get(f"quota:over:{org_id}:{period}")
    assert over == b"1"

    # Cleanup: clear the over-flag and the quota_period row so other
    # local runs don't see surprising state.
    await redis_client_db15.delete(f"quota:over:{org_id}:{period}")
    await pg_pool.execute(
        "delete from quota_period where org_id = $1",
        org_id,
    )
