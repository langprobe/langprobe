"""Worker configuration.

The worker reads from N sharded streams ``langprobe:ingest:v1:{0..N-1}``
and from the legacy single-stream ``langprobe:ingest:v1`` during the
dual-read window of the cutover (spec §9 step 9). Consumer name should be
unique per worker pod so XPENDING attribution works; defaults to the host
name.
"""

from __future__ import annotations

import os
import socket
from dataclasses import dataclass

from langprobe_tenant import ShardRouter


@dataclass(frozen=True)
class Settings:
    redis_url: str
    clickhouse_url: str
    shard_count: int = ShardRouter().shard_count
    # Read the legacy single-stream alongside the shards. Set to false once
    # the cutover is complete and the legacy stream is empty.
    dual_read_legacy: bool = True
    consumer_group: str = "ingest"
    consumer_name: str = "worker-1"
    # Per-shard DLQ: ``langprobe:ingest:v1:<shard>:dlq``
    dlq_prefix: str = "langprobe:ingest:v1"
    batch_size: int = 500
    block_ms: int = 2000
    max_deliveries: int = 5
    log_level: str = "INFO"

    def stream_keys(self) -> list[str]:
        keys = [f"{self.dlq_prefix}:{i}" for i in range(self.shard_count)]
        if self.dual_read_legacy:
            keys.append(self.dlq_prefix)
        return keys

    def dlq_for(self, stream_key: str) -> str:
        return f"{stream_key}:dlq"


def load() -> Settings:
    redis_url = os.environ.get("LANGPROBE_REDIS_URL")
    clickhouse_url = os.environ.get("LANGPROBE_CLICKHOUSE_URL")
    if not redis_url:
        raise RuntimeError("LANGPROBE_REDIS_URL is required")
    if not clickhouse_url:
        raise RuntimeError("LANGPROBE_CLICKHOUSE_URL is required")
    return Settings(
        redis_url=redis_url,
        clickhouse_url=clickhouse_url,
        shard_count=int(
            os.environ.get("LANGPROBE_INGEST_SHARD_COUNT", str(ShardRouter().shard_count))
        ),
        dual_read_legacy=os.environ.get("LANGPROBE_INGEST_DUAL_READ_LEGACY", "true").lower()
        not in {"0", "false", "no", "off"},
        consumer_name=os.environ.get(
            "LANGPROBE_WORKER_CONSUMER_NAME", socket.gethostname() or "worker-1"
        ),
        batch_size=int(os.environ.get("LANGPROBE_WORKER_BATCH_SIZE", "500")),
        block_ms=int(os.environ.get("LANGPROBE_WORKER_BLOCK_MS", "2000")),
        max_deliveries=int(os.environ.get("LANGPROBE_WORKER_MAX_DELIVERIES", "5")),
        log_level=os.environ.get("LANGPROBE_LOG_LEVEL", "INFO"),
    )
