"""Liveness + readiness probes for the control-plane API."""

from __future__ import annotations

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
