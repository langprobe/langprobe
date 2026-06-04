"""FastAPI application factory.

Lifespan owns long-lived clients (pg pool, redis, ingest enqueue) and the
disk-buffer drain task. Routers are registered after state is wired so the
``Depends(require_ingest_key)`` chain can rely on ``request.app.state.pg``.
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import asyncpg
import redis.asyncio as redis_async
import structlog
from fastapi import FastAPI

from . import config
from .enqueue import IngestEnqueue
from .redactor import redactor_from_env
from .routers import health, langsmith_shim, otel, runs

log = structlog.get_logger("tracebility.ingest.app")

_DRAIN_INTERVAL_SECONDS = 30.0


def _configure_logging(level: str) -> None:
    logging.basicConfig(level=level.upper())
    structlog.configure(
        processors=[
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso", utc=True),
            structlog.processors.JSONRenderer(),
        ],
    )


async def _drain_loop(enqueue: IngestEnqueue) -> None:
    while True:
        try:
            drained = await enqueue.drain_disk_buffer()
            if drained:
                log.info("drained disk buffer", drained=drained)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            log.warning("drain loop error", error=str(exc))
        await asyncio.sleep(_DRAIN_INTERVAL_SECONDS)


def create_app() -> FastAPI:
    settings = config.load()
    _configure_logging(settings.log_level)

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        app.state.pg = await asyncpg.create_pool(
            dsn=settings.postgres_dsn,
            min_size=2,
            max_size=10,
            command_timeout=10,
        )
        app.state.redis = redis_async.from_url(settings.redis_url, decode_responses=False)
        app.state.enqueue = IngestEnqueue(
            redis_url=settings.redis_url,
            disk_buffer_path=settings.disk_buffer_path,
        )
        app.state.redactor = redactor_from_env(settings.redact_pii)
        drain_task = asyncio.create_task(_drain_loop(app.state.enqueue))
        log.info(
            "ingest-api started",
            bind=f"{settings.bind_host}:{settings.bind_port}",
            redact_pii=settings.redact_pii,
        )
        try:
            yield
        finally:
            drain_task.cancel()
            try:
                await drain_task
            except asyncio.CancelledError:
                pass
            await app.state.redis.aclose()
            await app.state.pg.close()
            log.info("ingest-api stopped")

    app = FastAPI(
        title="tracebility ingest",
        version="0.0.0",
        lifespan=lifespan,
    )
    app.include_router(health.router)
    app.include_router(runs.router)
    app.include_router(langsmith_shim.router)
    app.include_router(otel.router)
    return app


app = create_app()
