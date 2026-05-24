"""Liveness + readiness probes.

``/healthz`` only checks the process is up. ``/readyz`` actively pings Redis
and Postgres so K8s pulls the pod out of the load-balancer if either backing
store goes down. Per ER-09 we still fail closed on auth even if /readyz says ok.
"""

from __future__ import annotations

import asyncpg
import redis.asyncio as redis_async
from fastapi import APIRouter, Request, status
from fastapi.responses import JSONResponse

router = APIRouter(tags=["health"])


@router.get("/healthz")
async def healthz() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/readyz")
async def readyz(request: Request) -> JSONResponse:
    pg: asyncpg.Pool = request.app.state.pg
    redis_client: redis_async.Redis = request.app.state.redis
    checks: dict[str, str] = {}
    code = status.HTTP_200_OK
    try:
        async with pg.acquire() as conn:
            await conn.execute("select 1")
        checks["postgres"] = "ok"
    except (asyncpg.PostgresError, OSError) as exc:
        checks["postgres"] = f"fail: {exc.__class__.__name__}"
        code = status.HTTP_503_SERVICE_UNAVAILABLE
    try:
        await redis_client.ping()
        checks["redis"] = "ok"
    except (redis_async.RedisError, OSError) as exc:
        checks["redis"] = f"fail: {exc.__class__.__name__}"
        code = status.HTTP_503_SERVICE_UNAVAILABLE
    return JSONResponse(status_code=code, content=checks)
