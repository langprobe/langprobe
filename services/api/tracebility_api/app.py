"""FastAPI application factory for the control-plane API."""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import asyncpg
import structlog
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import config
from .middleware import install as install_middleware
from .routers import api_keys, auth as auth_router, health, projects, setup as setup_router

log = structlog.get_logger("tracebility.api.app")


def _configure_logging(level: str) -> None:
    logging.basicConfig(level=level.upper())
    structlog.configure(
        processors=[
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso", utc=True),
            structlog.processors.JSONRenderer(),
        ],
    )


def create_app() -> FastAPI:
    settings = config.load()
    _configure_logging(settings.log_level)

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        app.state.settings = settings
        app.state.pg = await asyncpg.create_pool(
            dsn=settings.postgres_dsn,
            min_size=2,
            max_size=10,
            command_timeout=10,
        )
        log.info("api started", bind=f"{settings.bind_host}:{settings.bind_port}")
        try:
            yield
        finally:
            await app.state.pg.close()
            log.info("api stopped")

    app = FastAPI(
        title="tracebility api",
        version="0.0.0",
        lifespan=lifespan,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[settings.cors_allow_origin],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    install_middleware(app)
    app.include_router(health.router)
    app.include_router(setup_router.router)
    app.include_router(auth_router.router)
    app.include_router(projects.router)
    app.include_router(api_keys.router)
    return app


app = create_app()
