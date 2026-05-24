"""Worker configuration.

Stream key + group must match what ingest-api writes (``tracebility:ingest:v1``).
Consumer name should be unique per worker pod so XPENDING attribution works;
defaults to the host name.
"""

from __future__ import annotations

import os
import socket
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    redis_url: str
    clickhouse_url: str
    stream_key: str = "tracebility:ingest:v1"
    consumer_group: str = "ingest"
    consumer_name: str = "worker-1"
    dead_letter_stream: str = "tracebility:ingest:v1:dlq"
    batch_size: int = 500
    block_ms: int = 2000
    max_deliveries: int = 5
    log_level: str = "INFO"


def load() -> Settings:
    redis_url = os.environ.get("TRACEBILITY_REDIS_URL")
    clickhouse_url = os.environ.get("TRACEBILITY_CLICKHOUSE_URL")
    if not redis_url:
        raise RuntimeError("TRACEBILITY_REDIS_URL is required")
    if not clickhouse_url:
        raise RuntimeError("TRACEBILITY_CLICKHOUSE_URL is required")
    return Settings(
        redis_url=redis_url,
        clickhouse_url=clickhouse_url,
        consumer_name=os.environ.get(
            "TRACEBILITY_WORKER_CONSUMER_NAME", socket.gethostname() or "worker-1"
        ),
        batch_size=int(os.environ.get("TRACEBILITY_WORKER_BATCH_SIZE", "500")),
        block_ms=int(os.environ.get("TRACEBILITY_WORKER_BLOCK_MS", "2000")),
        max_deliveries=int(os.environ.get("TRACEBILITY_WORKER_MAX_DELIVERIES", "5")),
        log_level=os.environ.get("TRACEBILITY_LOG_LEVEL", "INFO"),
    )
