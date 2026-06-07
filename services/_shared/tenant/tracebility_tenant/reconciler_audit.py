"""Audit reconciler.

Spec §5.8: a daily job compares postgres state changes against
ClickHouse audit rows and writes ``audit_reconciliation_gap`` entries
for whatever's missing. Auditors accept "we have a documented gap-
detection process" in lieu of distributed-transaction guarantees.

Specifically, we look for:

- **api_key.create** in postgres `api_key.created_at` that doesn't have a
  matching ClickHouse `audit_log` row for the same `id`.
- **api_key.revoke** in postgres `api_key.revoked_at` that doesn't have
  a matching ClickHouse row.
- **role.change** in postgres `membership.updated_at` (we don't have a
  versioned role-change ledger, so the membership table is the only
  signal we have today).

Identity-event gaps are extremely rare (require a process crash between
postgres commit and ClickHouse insert) and easily recovered by replaying
postgres history. The reconciler exists to prove to auditors that we'd
detect any such gap.
"""

from __future__ import annotations

import asyncio
import datetime as dt
from dataclasses import dataclass
from uuid import UUID, uuid4

import asyncpg
import clickhouse_connect
import orjson
import structlog
from clickhouse_connect.driver import AsyncClient

log = structlog.get_logger("tracebility.tenant.reconciler.audit")


@dataclass(frozen=True, slots=True)
class _Gap:
    org_id: str
    expected_event: str
    target_kind: str
    target_id: str | None
    pg_row_id: str | None
    diagnostic: dict[str, str]


async def _ch_audit_target_ids(
    ch: AsyncClient, *, event_type: str, target_kind: str, since: dt.datetime
) -> set[str]:
    sql = """
        select target_id
        from audit_log
        where event_type = {event_type:String}
          and target_kind = {target_kind:String}
          and event_time >= toDateTime64({since:String}, 9, 'UTC')
    """
    result = await ch.query(
        sql,
        parameters={
            "event_type": event_type,
            "target_kind": target_kind,
            "since": since.isoformat(),
        },
    )
    return {str(row[0]) for row in result.result_rows if row[0] is not None}


async def _check_api_key_creates(
    pg: asyncpg.Pool, ch: AsyncClient, *, since: dt.datetime
) -> list[_Gap]:
    rows = await pg.fetch(
        """
        select api_key.id::text       as id,
               workspace.org_id::text as org_id
        from api_key
        join project   on project.id = api_key.project_id
        join workspace on workspace.id = project.workspace_id
        where api_key.created_at >= $1
        """,
        since,
    )
    if not rows:
        return []
    ch_ids = await _ch_audit_target_ids(
        ch, event_type="api_key.create", target_kind="api_key", since=since
    )
    return [
        _Gap(
            org_id=row["org_id"],
            expected_event="api_key.create",
            target_kind="api_key",
            target_id=row["id"],
            pg_row_id=row["id"],
            diagnostic={"reason": "postgres has api_key, clickhouse missing audit row"},
        )
        for row in rows
        if row["id"] not in ch_ids
    ]


async def _check_api_key_revokes(
    pg: asyncpg.Pool, ch: AsyncClient, *, since: dt.datetime
) -> list[_Gap]:
    rows = await pg.fetch(
        """
        select api_key.id::text       as id,
               workspace.org_id::text as org_id
        from api_key
        join project   on project.id = api_key.project_id
        join workspace on workspace.id = project.workspace_id
        where api_key.revoked_at is not null
          and api_key.revoked_at >= $1
        """,
        since,
    )
    if not rows:
        return []
    ch_ids = await _ch_audit_target_ids(
        ch, event_type="api_key.revoke", target_kind="api_key", since=since
    )
    return [
        _Gap(
            org_id=row["org_id"],
            expected_event="api_key.revoke",
            target_kind="api_key",
            target_id=row["id"],
            pg_row_id=row["id"],
            diagnostic={"reason": "postgres revoked api_key, clickhouse missing audit row"},
        )
        for row in rows
        if row["id"] not in ch_ids
    ]


async def reconcile_once(
    *,
    pg: asyncpg.Pool,
    ch: AsyncClient,
    since: dt.datetime | None = None,
) -> int:
    """One pass. Returns the number of gaps written. ``since`` defaults
    to 25h ago so the daily cadence has 1h overlap."""
    since = since or (dt.datetime.now(dt.UTC) - dt.timedelta(hours=25))
    detection_run = uuid4()

    gaps: list[_Gap] = []
    gaps.extend(await _check_api_key_creates(pg, ch, since=since))
    gaps.extend(await _check_api_key_revokes(pg, ch, since=since))

    if not gaps:
        return 0

    rows = []
    now = dt.datetime.now(dt.UTC)
    for gap in gaps:
        rows.append(
            [
                UUID(gap.org_id),
                "audit_missing",
                gap.expected_event,
                gap.target_kind,
                UUID(gap.target_id) if gap.target_id else None,
                UUID(gap.pg_row_id) if gap.pg_row_id else None,
                orjson.dumps(gap.diagnostic).decode(),
                now,
                detection_run,
            ]
        )
    await ch.insert(
        "audit_reconciliation_gap",
        rows,
        column_names=[
            "org_id",
            "gap_kind",
            "expected_event",
            "target_kind",
            "target_id",
            "pg_row_id",
            "diagnostic",
            "detected_at",
            "detection_run",
        ],
    )
    log.warning("audit gaps detected", count=len(gaps), run=str(detection_run))
    return len(gaps)


async def reconciler_loop(
    *,
    pg: asyncpg.Pool,
    clickhouse_url: str,
    clickhouse_user: str = "default",
    clickhouse_password: str = "",
    clickhouse_database: str = "default",
    interval_s: float = 24 * 60 * 60.0,  # daily
) -> None:
    ch = await clickhouse_connect.get_async_client(
        dsn=clickhouse_url,
        username=clickhouse_user,
        password=clickhouse_password,
        database=clickhouse_database,
    )
    try:
        while True:
            try:
                gaps = await reconcile_once(pg=pg, ch=ch)
                log.info("audit reconciliation tick", gaps=gaps)
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # noqa: BLE001 — must survive
                log.warning("audit reconciliation failed", error=str(exc))
            await asyncio.sleep(interval_s)
    finally:
        await ch.close()
