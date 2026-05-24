"""Read-side runs list.

Backs the web overview table. Filters: project_id (required, comes from
the URL because we don't have an active-project picker yet), optional
status, limit + offset cursor. Tenancy is enforced by re-checking the
caller has any role in the workspace owning that project.

Why a thin endpoint: we want the SDK quickstart loop to close as fast
as possible. The web shell currently renders SAMPLE_RUNS fixtures —
this is the swap-in. We deliberately don't paginate-by-time yet; offset
is fine until the dataset is large enough to make scans painful.

Failure modes:
- ClickHouse not configured (TRACEBILITY_CLICKHOUSE_URL unset): 503,
  not "empty list". Empty list would lie to the operator.
- ClickHouse unreachable: 503 with the underlying error class in logs.
"""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

import asyncpg
import structlog
from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel

from ..auth import Principal, assert_workspace_role, require_user
from ..clickhouse_client import ClickHouseQuery

log = structlog.get_logger("tracebility.api.runs_query")

router = APIRouter(prefix="/v1/runs", tags=["runs"])


class RunListItem(BaseModel):
    run_id: UUID
    name: str
    kind: str
    status: str
    start_time: datetime
    latency_ms: float | None
    total_tokens: int
    cost_usd: float
    sdk: str


class RunListResponse(BaseModel):
    items: list[RunListItem]


@router.get("", response_model=RunListResponse)
async def list_runs(
    request: Request,
    project_id: UUID = Query(...),
    status_filter: str | None = Query(default=None, alias="status"),
    limit: int = Query(default=100, ge=1, le=1000),
    offset: int = Query(default=0, ge=0),
    principal: Principal = Depends(require_user),
) -> RunListResponse:
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
        select run_id, name, kind, status, start_time, duration_ns,
               total_tokens, cost_usd, sdk
        from run final
        where project_id = {project_id:UUID}
    """
    params: dict[str, object] = {
        "project_id": str(project_id),
        "limit": limit,
        "offset": offset,
    }
    if status_filter is not None:
        sql += " and status = {status_filter:String}"
        params["status_filter"] = status_filter
    sql += " order by start_time desc limit {limit:UInt32} offset {offset:UInt32}"

    try:
        rows = await ch.query(sql, parameters=params)
    except Exception as exc:  # noqa: BLE001
        log.warning("clickhouse query failed", error=str(exc))
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE, "data plane unavailable"
        ) from exc

    items = [
        RunListItem(
            run_id=row["run_id"],
            name=row["name"],
            kind=row["kind"],
            status=row["status"],
            start_time=row["start_time"],
            latency_ms=(
                round(row["duration_ns"] / 1_000_000, 3)
                if row.get("duration_ns") is not None
                else None
            ),
            total_tokens=int(row["total_tokens"] or 0),
            cost_usd=float(row["cost_usd"] or 0),
            sdk=row["sdk"],
        )
        for row in rows
    ]
    return RunListResponse(items=items)
