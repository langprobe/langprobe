"""Quota reconciler.

Spec §5.5: every 60s, SUM the authoritative ClickHouse ``billing_meter``
into postgres ``quota_period.used_amount``, then reset the Redis hot
counter to that value.

This module exposes a single async loop the operator service runs
forever. Failures are logged and retried on the next tick — we never
crash the loop because a missed tick stretches the optimistic-cap
window from 60s to 120s, which is the documented worst case.

Outputs:
- postgres ``quota_period.used_amount`` updated to ClickHouse SUM.
- Redis ``quota:<org>:<period>:<meter>`` set to the same value.
- Redis ``quota:over:<org>:<period>`` set when ``used >= limit`` so
  ingest-worker can drop in-flight envelopes for that org without
  whole-shard stalls (consume-time filter — multi-tenancy spec
  §7.2 with the cutover refinement).
"""

from __future__ import annotations

import asyncio
import datetime as dt
from collections.abc import Iterable
from dataclasses import dataclass

import asyncpg
import clickhouse_connect
import redis.asyncio as redis_async
import structlog
from clickhouse_connect.driver import AsyncClient

from .quota import QuotaMeter, current_period

log = structlog.get_logger("tracebility.tenant.reconciler.quota")

_OVER_KEY_TTL_S = 40 * 86400  # match the QuotaMeter counter TTL


@dataclass(frozen=True, slots=True)
class _MeterRow:
    org_id: str
    meter: str
    used: int


def _period_to_dates(period: str) -> tuple[dt.date, dt.date]:
    """``YYYYMM`` -> (first-of-month, first-of-next-month)."""
    year = int(period[:4])
    month = int(period[4:6])
    start = dt.date(year, month, 1)
    end = dt.date(year + (1 if month == 12 else 0), 1 if month == 12 else month + 1, 1)
    return start, end


async def _sum_billing_meter(
    client: AsyncClient, period: str, meters: Iterable[str]
) -> list[_MeterRow]:
    """Return per-org per-meter usage for the given period."""
    start, end = _period_to_dates(period)
    meters_list = list(meters)
    if not meters_list:
        return []
    sql = """
        select org_id, meter, sum(amount) as used
        from billing_meter
        where event_time >= toDateTime64({start:String}, 9, 'UTC')
          and event_time <  toDateTime64({end:String}, 9, 'UTC')
          and meter in ({meters:Array(String)})
        group by org_id, meter
    """
    params = {
        "start": start.isoformat(),
        "end": end.isoformat(),
        "meters": meters_list,
    }
    result = await client.query(sql, parameters=params)
    return [
        _MeterRow(org_id=str(row[0]), meter=str(row[1]), used=int(row[2]))
        for row in result.result_rows
    ]


async def reconcile_once(
    *,
    pg: asyncpg.Pool,
    ch: AsyncClient,
    redis: redis_async.Redis,
    period: str | None = None,
) -> int:
    """One reconciliation pass. Returns the number of (org, meter) rows
    updated."""
    period = period or current_period()
    period_start, _ = _period_to_dates(period)

    # The plan says exactly which meters we care about for gating.
    plans = await pg.fetch("select code from plan")
    plan_codes = [row["code"] for row in plans]
    if not plan_codes:
        return 0
    meter_rows = await pg.fetch(
        "select distinct meter from plan_meter_limit where plan_code = any($1)",
        plan_codes,
    )
    meters = [row["meter"] for row in meter_rows]
    if not meters:
        return 0

    sums = await _sum_billing_meter(ch, period, meters)
    if not sums:
        return 0

    qm = QuotaMeter(redis)
    updated = 0
    for row in sums:
        # Resolve the org's plan so we know the cap for the over-flag.
        org_row = await pg.fetchrow(
            "select plan from org where id = $1",
            row.org_id,
        )
        plan_code = (org_row["plan"] if org_row else None) or "free"
        limit_row = await pg.fetchrow(
            "select monthly_limit from plan_meter_limit where plan_code = $1 and meter = $2",
            plan_code,
            row.meter,
        )
        limit = int(limit_row["monthly_limit"]) if limit_row else -1

        # Persist authoritative usage to postgres.
        await pg.execute(
            """
            insert into quota_period (org_id, period_start, meter, limit_amount, used_amount)
            values ($1, $2, $3, $4, $5)
            on conflict (org_id, period_start, meter)
            do update set used_amount = excluded.used_amount,
                          limit_amount = excluded.limit_amount,
                          last_reconciled = now()
            """,
            row.org_id,
            period_start,
            row.meter,
            limit,
            row.used,
        )
        # Reset the Redis counter to authoritative.
        await qm.reset(
            org_id=row.org_id,  # type: ignore[arg-type]
            meter=row.meter,
            authoritative=row.used,
            period=period,
        )
        # Maintain the over-flag the worker checks (§7.2 refinement).
        over_key = f"quota:over:{row.org_id}:{period}"
        if 0 <= limit < row.used:
            await redis.set(over_key, b"1", ex=_OVER_KEY_TTL_S)
        else:
            await redis.delete(over_key)
        updated += 1
    return updated


async def reconciler_loop(
    *,
    pg: asyncpg.Pool,
    redis: redis_async.Redis,
    clickhouse_url: str,
    interval_s: float = 60.0,
) -> None:
    """Run forever. Operator service spawns this as a background task.

    ``clickhouse_url`` is a full DSN with embedded credentials and database
    (http(s)://user:pass@host:port/db). The helm chart ships it as a single
    secret value; splitting credentials into separate kwargs caused
    AUTHENTICATION_FAILED in production.
    """
    ch = await clickhouse_connect.get_async_client(dsn=clickhouse_url)
    try:
        while True:
            try:
                updated = await reconcile_once(pg=pg, ch=ch, redis=redis)
                log.info("quota reconciliation tick", updated_rows=updated)
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # noqa: BLE001 — must survive for the next tick
                log.warning("quota reconciliation failed", error=str(exc))
            await asyncio.sleep(interval_s)
    finally:
        await ch.close()
