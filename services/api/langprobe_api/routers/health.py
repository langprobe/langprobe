"""Liveness + readiness probes for the control-plane API."""

from __future__ import annotations

from typing import Any

import asyncpg
from fastapi import APIRouter, Request, status
from fastapi.responses import JSONResponse

router = APIRouter(tags=["health"])


@router.get("/healthz")
async def healthz() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/readyz")
async def readyz(request: Request) -> JSONResponse:
    pg: asyncpg.Pool = request.app.state.pg
    try:
        async with pg.acquire() as conn:
            await conn.execute("select 1")
        return JSONResponse(status_code=status.HTTP_200_OK, content={"postgres": "ok"})
    except (asyncpg.PostgresError, OSError) as exc:
        return JSONResponse(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            content={"postgres": f"fail: {exc.__class__.__name__}"},
        )


@router.get("/health/dispatch-cost-drift")
async def dispatch_cost_drift(request: Request) -> dict[str, Any]:
    """Warn when LiteLLM's price table has fallen behind a model release.

    Compares the share of last-24h dispatches that recorded cost_usd=0
    despite producing non-zero tokens. >5% means the model→price map in
    the pinned LiteLLM version is stale and the cost ceiling is being
    miscounted; bump the pin or accept the drift consciously.
    """
    pool: asyncpg.Pool = request.app.state.pg
    row = await pool.fetchrow(
        """
        select count(*)::float as total,
               count(*) filter (
                   where cost_usd = 0
                     and (prompt_tokens > 0 or completion_tokens > 0)
                     and error_code is null
               )::float as zero_cost_with_tokens
          from dispatch_cost
         where dispatched_at > now() - interval '24 hours'
        """,
    )
    total = float((row or {}).get("total") or 0)
    zero = float((row or {}).get("zero_cost_with_tokens") or 0)
    pct = (zero / total) if total > 0 else 0.0
    healthy = pct < 0.05
    return {
        "status": "ok" if healthy else "degraded",
        "window": "24h",
        "total": int(total),
        "zero_cost_with_tokens": int(zero),
        "drift_pct": round(pct, 4),
        "threshold_pct": 0.05,
    }
