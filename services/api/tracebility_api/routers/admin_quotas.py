"""Per-org quota usage. Backs the admin UI meter bars (multi-tenancy spec §10).

The reconciler keeps ``quota_period`` authoritative; this router just
joins it against ``plan_meter_limit`` for the limit display. We don't
read from Redis here — the Redis hot counter can be ahead of postgres
by up to 60s, and the admin UI prefers the postgres truth so the
displayed values are reproducible across pageloads."""

from __future__ import annotations

import datetime as dt
from uuid import UUID

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel

from ..auth import Principal, assert_org_role, require_user

router = APIRouter(prefix="/v1/admin", tags=["admin"])


class MeterUsage(BaseModel):
    meter: str
    used: int
    limit: int  # -1 = unlimited
    pct: float | None
    last_reconciled: dt.datetime | None


class QuotaSummary(BaseModel):
    org_id: UUID
    period: str  # YYYYMM
    plan: str
    meters: list[MeterUsage]


def _current_period() -> tuple[str, dt.date]:
    today = dt.date.today()
    period = f"{today.year:04d}{today.month:02d}"
    period_start = dt.date(today.year, today.month, 1)
    return period, period_start


@router.get("/orgs/{org_id}/quotas", response_model=QuotaSummary)
async def org_quota_summary(
    request: Request,
    org_id: UUID,
    principal: Principal = Depends(require_user),
) -> QuotaSummary:
    pool: asyncpg.Pool = request.app.state.pg
    if not principal.is_root:
        await assert_org_role(
            pool,
            user_id=principal.user_id,
            org_id=org_id,
            allowed=("owner", "admin"),
        )

    org_row = await pool.fetchrow(
        "select plan from org where id = $1 and deleted_at is null",
        org_id,
    )
    if org_row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "org not found")
    plan = org_row["plan"]

    period, period_start = _current_period()

    rows = await pool.fetch(
        """
        select plan_meter_limit.meter   as meter,
               plan_meter_limit.monthly_limit as limit_amount,
               coalesce(quota_period.used_amount, 0) as used_amount,
               quota_period.last_reconciled as last_reconciled
        from plan_meter_limit
        left join quota_period
               on quota_period.org_id = $1
              and quota_period.period_start = $2
              and quota_period.meter = plan_meter_limit.meter
        where plan_meter_limit.plan_code = $3
        order by plan_meter_limit.meter
        """,
        org_id,
        period_start,
        plan,
    )

    return QuotaSummary(
        org_id=org_id,
        period=period,
        plan=plan,
        meters=[
            MeterUsage(
                meter=row["meter"],
                used=int(row["used_amount"]),
                limit=int(row["limit_amount"]),
                pct=(
                    None
                    if row["limit_amount"] < 0
                    else round(100.0 * row["used_amount"] / max(1, row["limit_amount"]), 2)
                ),
                last_reconciled=row["last_reconciled"],
            )
            for row in rows
        ],
    )
