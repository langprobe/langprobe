"""Runtime configuration for the ingest API.

Read once at import time from environment variables. Fail loud on missing
required values rather than silently defaulting.
"""

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    redis_url: str
    postgres_dsn: str
    # spans larger than this are spilled to object storage (per ER-06)
    inline_blob_max_bytes: int = 1_000_000
    # disk buffer for ingest enqueue when redis is unavailable (ER-01)
    disk_buffer_path: str = "/var/lib/tracebility/ingest-buffer"
    # ingest auth: 'lt_' prefix on the public_id half of api keys
    api_key_prefix: str = "lt_"
    log_level: str = "INFO"
    bind_host: str = "0.0.0.0"
    bind_port: int = 7080


def load() -> Settings:
    redis_url = os.environ.get("TRACEBILITY_REDIS_URL")
    postgres_dsn = os.environ.get("TRACEBILITY_PG_DSN")
    if not redis_url:
        raise RuntimeError("TRACEBILITY_REDIS_URL is required")
    if not postgres_dsn:
        raise RuntimeError("TRACEBILITY_PG_DSN is required")
    return Settings(
        redis_url=redis_url,
        postgres_dsn=postgres_dsn,
        inline_blob_max_bytes=int(
            os.environ.get("TRACEBILITY_INLINE_BLOB_MAX_BYTES", "1000000")
        ),
        disk_buffer_path=os.environ.get(
            "TRACEBILITY_DISK_BUFFER_PATH", "/var/lib/tracebility/ingest-buffer"
        ),
        log_level=os.environ.get("TRACEBILITY_LOG_LEVEL", "INFO"),
        bind_host=os.environ.get("TRACEBILITY_BIND_HOST", "0.0.0.0"),
        bind_port=int(os.environ.get("TRACEBILITY_BIND_PORT", "7080")),
    )
