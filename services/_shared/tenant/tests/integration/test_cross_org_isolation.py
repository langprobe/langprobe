"""Cross-org isolation: rows from org A must never be visible to a query
filtered by org B. Spec §8 integration check.

This test writes two run rows (different orgs) directly through the
ClickHouseWriter and then issues per-org SELECTs to confirm:
  - SELECT WHERE org_id=A returns only A's row
  - SELECT WHERE org_id=B returns only B's row
"""

from __future__ import annotations

import os
import socket
from uuid import UUID, uuid4

import asyncpg
import clickhouse_connect
import pytest
import pytest_asyncio


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


@pytest.fixture
def ch_client():
    if not _reachable("localhost", 8123):
        pytest.skip("clickhouse not reachable")
    client = clickhouse_connect.get_client(dsn=CH_URL)
    try:
        yield client
    finally:
        client.close()


async def _create_test_tenant(pg: asyncpg.Pool, slug_seed: str) -> tuple[UUID, UUID, UUID]:
    """Create org/workspace/project on the live DB. Returns (org, workspace, project)."""
    org_id = await pg.fetchval(
        "insert into org (slug, name, plan) values ($1, $1, 'pro') returning id",
        f"isolation-test-{slug_seed}",
    )
    workspace_id = await pg.fetchval(
        "insert into workspace (org_id, slug, name) values ($1, $2, $2) returning id",
        org_id,
        f"main-{slug_seed}",
    )
    project_id = await pg.fetchval(
        "insert into project (workspace_id, slug, name) values ($1, $2, $2) returning id",
        workspace_id,
        f"app-{slug_seed}",
    )
    return org_id, workspace_id, project_id


async def _delete_tenant(pg: asyncpg.Pool, org_id: UUID) -> None:
    """Hard delete the test org so re-runs don't accumulate."""
    await pg.execute(
        """
        delete from project where workspace_id in (
            select id from workspace where org_id = $1
        )
        """,
        org_id,
    )
    await pg.execute("delete from workspace where org_id = $1", org_id)
    await pg.execute("delete from org where id = $1", org_id)


def _insert_run(
    ch,
    *,
    org_id: UUID,
    workspace_id: UUID,
    project_id: UUID,
    name: str,
) -> UUID:
    run_id = uuid4()
    from datetime import UTC, datetime

    now = datetime.now(UTC)
    ch.insert(
        "run",
        [
            [
                org_id,
                workspace_id,
                project_id,
                run_id,
                None,  # parent_run_id
                name,
                "chain",
                "ok",
                "isolation-test",  # sdk
                now,
                now,
                now,
                "in",
                "out",
                None,
                None,
                0,
                0,
                0,
                0,
                None,
                None,
                [],
                "{}",
                "",
                "",
                1,
            ]
        ],
        column_names=[
            "org_id",
            "workspace_id",
            "project_id",
            "run_id",
            "parent_run_id",
            "name",
            "kind",
            "status",
            "sdk",
            "start_time",
            "end_time",
            "received_at",
            "inputs",
            "outputs",
            "inputs_obj_ref",
            "outputs_obj_ref",
            "prompt_tokens",
            "completion_tokens",
            "total_tokens",
            "cost_usd",
            "session_id",
            "user_id",
            "tags",
            "metadata",
            "error_kind",
            "error_message",
            "schema_version",
        ],
    )
    return run_id


async def test_two_orgs_cannot_see_each_others_runs(pg_pool, ch_client):
    """Write one run per org, query both ways, confirm zero crossover."""
    org_a, ws_a, proj_a = await _create_test_tenant(pg_pool, "a")
    org_b, ws_b, proj_b = await _create_test_tenant(pg_pool, "b")
    try:
        run_a = _insert_run(
            ch_client, org_id=org_a, workspace_id=ws_a, project_id=proj_a, name="run-a"
        )
        run_b = _insert_run(
            ch_client, org_id=org_b, workspace_id=ws_b, project_id=proj_b, name="run-b"
        )

        # Org A's view: should see run_a, never run_b.
        res_a = ch_client.query(
            "select run_id, name from run where org_id = %(org_id)s",
            parameters={"org_id": str(org_a)},
        )
        names_a = {row[1] for row in res_a.result_rows}
        ids_a = {row[0] for row in res_a.result_rows}
        assert "run-a" in names_a
        assert "run-b" not in names_a
        assert run_a in ids_a
        assert run_b not in ids_a

        # Org B's view: mirror image.
        res_b = ch_client.query(
            "select run_id, name from run where org_id = %(org_id)s",
            parameters={"org_id": str(org_b)},
        )
        names_b = {row[1] for row in res_b.result_rows}
        ids_b = {row[0] for row in res_b.result_rows}
        assert "run-b" in names_b
        assert "run-a" not in names_b
        assert run_b in ids_b
        assert run_a not in ids_b

        # Cross-check: a query without org_id filter returns BOTH (which is
        # exactly what makes the org_id filter load-bearing — without it,
        # tenants leak).
        res_unfiltered = ch_client.query(
            "select count() from run where name in ('run-a', 'run-b')",
        )
        assert int(res_unfiltered.result_rows[0][0]) == 2
    finally:
        # Cleanup — CH rows live until TTL; postgres tenant rows we own.
        ch_client.command(
            "alter table run delete where org_id in (%(a)s, %(b)s)",
            parameters={"a": str(org_a), "b": str(org_b)},
        )
        await _delete_tenant(pg_pool, org_a)
        await _delete_tenant(pg_pool, org_b)


async def test_two_workspaces_in_one_org_isolate(pg_pool, ch_client):
    """Inside one org, queries scoped to workspace A must not see workspace B's
    rows. The org_id filter is necessary but not sufficient — the workspace_id
    filter must also be honored when a workspace-scoped role is in play."""
    org_id = await pg_pool.fetchval(
        "insert into org (slug, name, plan) values ($1, $1, 'pro') returning id",
        "isolation-test-ws",
    )
    ws_a = await pg_pool.fetchval(
        "insert into workspace (org_id, slug, name) values ($1, 'wa', 'wa') returning id",
        org_id,
    )
    ws_b = await pg_pool.fetchval(
        "insert into workspace (org_id, slug, name) values ($1, 'wb', 'wb') returning id",
        org_id,
    )
    proj_a = await pg_pool.fetchval(
        "insert into project (workspace_id, slug, name) values ($1, 'a', 'a') returning id",
        ws_a,
    )
    proj_b = await pg_pool.fetchval(
        "insert into project (workspace_id, slug, name) values ($1, 'b', 'b') returning id",
        ws_b,
    )
    try:
        _insert_run(
            ch_client, org_id=org_id, workspace_id=ws_a, project_id=proj_a, name="run-ws-a"
        )
        _insert_run(
            ch_client, org_id=org_id, workspace_id=ws_b, project_id=proj_b, name="run-ws-b"
        )

        res_a = ch_client.query(
            "select name from run where org_id = %(org)s and workspace_id = %(ws)s",
            parameters={"org": str(org_id), "ws": str(ws_a)},
        )
        names_a = {row[0] for row in res_a.result_rows}
        assert "run-ws-a" in names_a
        assert "run-ws-b" not in names_a
    finally:
        ch_client.command(
            "alter table run delete where org_id = %(o)s",
            parameters={"o": str(org_id)},
        )
        await pg_pool.execute(
            "delete from project where workspace_id in ($1, $2)",
            ws_a,
            ws_b,
        )
        await pg_pool.execute(
            "delete from workspace where id in ($1, $2)",
            ws_a,
            ws_b,
        )
        await pg_pool.execute("delete from org where id = $1", org_id)
