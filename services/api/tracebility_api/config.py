"""Runtime configuration for the control-plane API.

Read once at import time from environment variables. Fail loud on missing
required values rather than silently defaulting. Session secret has no
default by design: a default would make sessions trivially forgeable.
"""

from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    postgres_dsn: str
    session_secret: str
    clickhouse_url: str | None = None
    session_cookie_name: str = "tracebility_session"
    session_max_age_seconds: int = 60 * 60 * 24 * 7
    bind_host: str = "0.0.0.0"
    bind_port: int = 7081
    log_level: str = "INFO"
    cors_allow_origin: str = "http://localhost:7090"


def load() -> Settings:
    postgres_dsn = os.environ.get("TRACEBILITY_PG_DSN")
    session_secret = os.environ.get("TRACEBILITY_SESSION_SECRET")
    if not postgres_dsn:
        raise RuntimeError("TRACEBILITY_PG_DSN is required")
    if not session_secret or len(session_secret) < 32:
        raise RuntimeError(
            "TRACEBILITY_SESSION_SECRET is required and must be >= 32 chars"
        )
    return Settings(
        postgres_dsn=postgres_dsn,
        session_secret=session_secret,
        clickhouse_url=os.environ.get("TRACEBILITY_CLICKHOUSE_URL"),
        session_cookie_name=os.environ.get(
            "TRACEBILITY_SESSION_COOKIE", "tracebility_session"
        ),
        session_max_age_seconds=int(
            os.environ.get("TRACEBILITY_SESSION_MAX_AGE_SECONDS", str(60 * 60 * 24 * 7))
        ),
        bind_host=os.environ.get("TRACEBILITY_BIND_HOST", "0.0.0.0"),
        bind_port=int(os.environ.get("TRACEBILITY_API_BIND_PORT", "7081")),
        log_level=os.environ.get("TRACEBILITY_LOG_LEVEL", "INFO"),
        cors_allow_origin=os.environ.get(
            "TRACEBILITY_CORS_ALLOW_ORIGIN", "http://localhost:7090"
        ),
    )
