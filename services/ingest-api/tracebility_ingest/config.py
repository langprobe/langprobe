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
    # ClickHouse used by AuditWriter (egress + quota.block events)
    clickhouse_url: str
    clickhouse_user: str
    clickhouse_password: str
    clickhouse_database: str = "default"
    # spans larger than this are spilled to object storage (per ER-06)
    inline_blob_max_bytes: int = 1_000_000
    # disk buffer for ingest enqueue when redis is unavailable (ER-01)
    disk_buffer_path: str = "/var/lib/tracebility/ingest-buffer"
    # ingest auth: 'lt_' prefix on the public_id half of api keys
    api_key_prefix: str = "lt_"
    log_level: str = "INFO"
    bind_host: str = "0.0.0.0"
    bind_port: int = 7080
    # PII redaction at ingest (Phase 8 stub). On by default — operators
    # who need raw inputs for replay-as-production must opt out per project
    # once policy work lands.
    redact_pii: bool = True


def load() -> Settings:
    redis_url = os.environ.get("TRACEBILITY_REDIS_URL")
    postgres_dsn = os.environ.get("TRACEBILITY_PG_DSN")
    clickhouse_url = os.environ.get("TRACEBILITY_CLICKHOUSE_URL")
    if not redis_url:
        raise RuntimeError("TRACEBILITY_REDIS_URL is required")
    if not postgres_dsn:
        raise RuntimeError("TRACEBILITY_PG_DSN is required")
    if not clickhouse_url:
        raise RuntimeError("TRACEBILITY_CLICKHOUSE_URL is required")
    return Settings(
        redis_url=redis_url,
        postgres_dsn=postgres_dsn,
        clickhouse_url=clickhouse_url,
        clickhouse_user=os.environ.get("TRACEBILITY_CLICKHOUSE_USER", "default"),
        clickhouse_password=os.environ.get("TRACEBILITY_CLICKHOUSE_PASSWORD", ""),
        clickhouse_database=os.environ.get("TRACEBILITY_CLICKHOUSE_DATABASE", "default"),
        inline_blob_max_bytes=int(
            os.environ.get("TRACEBILITY_INLINE_BLOB_MAX_BYTES", "1000000")
        ),
        disk_buffer_path=os.environ.get(
            "TRACEBILITY_DISK_BUFFER_PATH", "/var/lib/tracebility/ingest-buffer"
        ),
        log_level=os.environ.get("TRACEBILITY_LOG_LEVEL", "INFO"),
        bind_host=os.environ.get("TRACEBILITY_BIND_HOST", "0.0.0.0"),
        bind_port=int(os.environ.get("TRACEBILITY_BIND_PORT", "7080")),
        redact_pii=os.environ.get("TRACEBILITY_REDACT_PII", "true").lower()
        not in {"0", "false", "no", "off"},
    )
