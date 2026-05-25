"""Read-side roll-ups for the Overview page.

Single ClickHouse query backs the six tiles: runs, p50/p95/p99 latency,
error rate, cost. Time window defaults to last hour to match the
Overview header label. Tenancy enforced by re-checking the caller's
workspace role for the project, same pattern as runs_query.

We intentionally compute on the fly rather than maintaining a
materialized aggregate: at MVP scale a single quantilesTDigest pass
over the partition is fast enough, and freshness matters more than
microseconds when you're chasing a regression.
"""

from __future__ import annotations

from uuid import UUID

import asyncpg
import structlog
from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel

from ..auth import Principal, assert_workspace_role, require_user
from ..clickhouse_client import ClickHouseQuery

log = structlog.get_logger("tracebility.api.metrics")

router = APIRouter(prefix="/v1/metrics", tags=["metrics"])


class MetricsResponse(BaseModel):
    window_seconds: int
    runs: int
    p50_ms: float | None
    p95_ms: float | None
    p99_ms: float | None
    error_count: int
    error_rate: float
    total_tokens: int
    total_cost_usd: float


@router.get("", response_model=MetricsResponse)
async def get_metrics(
    request: Request,
    project_id: UUID = Query(...),
    window_seconds: int = Query(default=3600, ge=60, le=7 * 24 * 3600),
    principal: Principal = Depends(require_user),
) -> MetricsResponse:
    pool: asyncpg.Pool = request.app.state.pg
    workspace_id = await pool.fetchval(
        "select workspace_id from project where id = $1 and deleted_at is null",
        project_id,
    )
    if workspace_id is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "project not found")
    await assert_workspace_role(
        pool,
        user_id=principal.user_id,
        workspace_id=workspace_id,
        allowed=("owner", "admin", "member", "viewer"),
    )

    ch: ClickHouseQuery | None = getattr(request.app.state, "clickhouse", None)
    if ch is None:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "clickhouse not configured (set TRACEBILITY_CLICKHOUSE_URL)",
        )

    sql = """
        select
            count() as runs,
            countIf(status = 'error') as error_count,
            quantileTDigest(0.50)(toFloat64(duration_ns) / 1e6) as p50_ms,
            quantileTDigest(0.95)(toFloat64(duration_ns) / 1e6) as p95_ms,
            quantileTDigest(0.99)(toFloat64(duration_ns) / 1e6) as p99_ms,
            sum(total_tokens) as total_tokens,
            toFloat64(sum(cost_usd)) as total_cost_usd
        from run final
        where project_id = {project_id:UUID}
          and start_time >= now64(9) - toIntervalSecond({window:UInt32})
    """
    params = {"project_id": str(project_id), "window": window_seconds}
    try:
        rows = await ch.query(sql, parameters=params)
    except Exception as exc:  # noqa: BLE001
        log.warning("metrics query failed", error=str(exc))
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE, "data plane unavailable"
        ) from exc

    row = rows[0] if rows else {}
    runs = int(row.get("runs", 0) or 0)
    error_count = int(row.get("error_count", 0) or 0)
    return MetricsResponse(
        window_seconds=window_seconds,
        runs=runs,
        p50_ms=_optional_float(row.get("p50_ms")),
        p95_ms=_optional_float(row.get("p95_ms")),
        p99_ms=_optional_float(row.get("p99_ms")),
        error_count=error_count,
        error_rate=(error_count / runs) if runs else 0.0,
        total_tokens=int(row.get("total_tokens", 0) or 0),
        total_cost_usd=float(row.get("total_cost_usd", 0) or 0),
    )


def _optional_float(value: object) -> float | None:
    if value is None:
        return None
    try:
        f = float(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None
    # ClickHouse returns NaN for empty quantile sets; coerce to None.
    if f != f:  # noqa: PLR0124
        return None
    return round(f, 3)
