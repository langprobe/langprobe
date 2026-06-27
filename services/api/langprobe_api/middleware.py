"""Audit-aware fail-closed middleware (ER-09, ER-10).

Two jobs, both narrow:

1. Fail closed if Postgres is unreachable on a state-changing request.
   Authenticated routes already 503 via :func:`auth.require_user`, but a
   route like ``POST /v1/auth/login`` runs *before* auth — so we explicitly
   ping the pool for any non-GET/HEAD/OPTIONS request. ``select 1`` with
   a tight timeout is cheap and proves the pool can accept a checkout.

2. Catch missing audit records. Every state-changing handler is supposed
   to call :func:`audit.record`. We patch :func:`audit.record` once at
   startup so it sets ``request.state.audit_recorded`` whenever called,
   and after the response we log a structured warning if a 2xx write
   never did. Loud in dev, never breaks prod traffic.

We do *not* try to retroactively insert an audit row from middleware —
that's the kind of "helpful" magic that masks bugs. Surface it instead.
"""

from __future__ import annotations

import asyncpg
import structlog
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response

from . import audit

log = structlog.get_logger("langprobe.api.middleware")

_WRITE_METHODS = frozenset({"POST", "PUT", "PATCH", "DELETE"})
_PG_PING_TIMEOUT_SECONDS = 2.0


class AuditFailClosedMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):  # type: ignore[override]
        request.state.audit_recorded = False
        is_write = request.method in _WRITE_METHODS

        if is_write:
            pool: asyncpg.Pool | None = getattr(request.app.state, "pg", None)
            if pool is None:
                return JSONResponse(
                    {"detail": "database not initialized"},
                    status_code=503,
                )
            try:
                async with pool.acquire(timeout=_PG_PING_TIMEOUT_SECONDS) as conn:
                    await conn.fetchval("select 1")
            except (TimeoutError, asyncpg.PostgresError, OSError) as exc:
                log.warning(
                    "pg unreachable on write request",
                    method=request.method,
                    path=request.url.path,
                    error=str(exc),
                )
                return JSONResponse(
                    {"detail": "database unavailable"},
                    status_code=503,
                )

        response: Response = await call_next(request)

        if (
            is_write
            and 200 <= response.status_code < 300
            and not getattr(request.state, "audit_recorded", False)
        ):
            log.warning(
                "state-changing request returned 2xx without audit record",
                method=request.method,
                path=request.url.path,
                status_code=response.status_code,
            )

        return response


def install(app: FastAPI) -> None:
    """Register the middleware and patch :func:`audit.record`.

    Patching is one-shot and idempotent: we wrap the original function so
    every call sets the request-scoped sentinel. Routes that already pass
    ``request=`` to ``audit.record`` get sentinel tracking for free; the
    handful that don't (e.g. background sweeps) silently skip it.
    """
    app.add_middleware(AuditFailClosedMiddleware)

    if getattr(audit.record, "_langprobe_audit_patched", False):
        return

    original = audit.record

    async def tracked(*args, **kwargs):  # type: ignore[no-untyped-def]
        result = await original(*args, **kwargs)
        request = kwargs.get("request")
        if request is not None:
            request.state.audit_recorded = True
        return result

    tracked._langprobe_audit_patched = True  # type: ignore[attr-defined]
    audit.record = tracked  # type: ignore[assignment]
