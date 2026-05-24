"""Redis enqueue with disk-buffer fallback.

Per ER-01: if Redis is down, the enqueue MUST not silently drop ingest. We
write to a local disk buffer; a recovery loop drains the buffer when Redis
returns. This keeps the API surface 'accept and 202' even during Redis
outages, which is what SDKs expect.
"""

from __future__ import annotations

import asyncio
import os
import time
import uuid
from pathlib import Path

import orjson
import redis.asyncio as redis_async
import structlog

log = structlog.get_logger("tracebility.ingest.enqueue")

# Single Redis stream key for ingest. The worker xreadgroup-consumes from here.
STREAM_KEY = "tracebility:ingest:v1"


class IngestEnqueue:
    def __init__(self, redis_url: str, disk_buffer_path: str) -> None:
        self._redis_url = redis_url
        self._buffer_dir = Path(disk_buffer_path)
        self._buffer_dir.mkdir(parents=True, exist_ok=True)
        self._client: redis_async.Redis | None = None
        self._lock = asyncio.Lock()

    async def _get_client(self) -> redis_async.Redis:
        if self._client is None:
            self._client = redis_async.from_url(self._redis_url, decode_responses=False)
        return self._client

    async def enqueue(self, batch: bytes) -> None:
        """Enqueue a serialized batch. Best-effort to redis; spill to disk on failure."""
        try:
            client = await self._get_client()
            await client.xadd(STREAM_KEY, {b"data": batch}, maxlen=10_000_000, approximate=True)
            return
        except (redis_async.RedisError, OSError) as exc:
            log.warning("redis enqueue failed; spilling to disk", error=str(exc))
            await self._spill(batch)

    async def _spill(self, batch: bytes) -> None:
        # filenames are time-ordered to make drain a cheap glob+sort
        fname = f"{time.time_ns():020d}-{uuid.uuid4().hex}.bin"
        path = self._buffer_dir / fname
        async with self._lock:
            tmp = path.with_suffix(".tmp")
            tmp.write_bytes(batch)
            os.replace(tmp, path)

    async def drain_disk_buffer(self) -> int:
        """Background task: push spilled batches back to redis. Returns drained count."""
        try:
            client = await self._get_client()
            await client.ping()
        except (redis_async.RedisError, OSError):
            return 0
        drained = 0
        for path in sorted(self._buffer_dir.glob("*.bin")):
            try:
                batch = path.read_bytes()
                await client.xadd(STREAM_KEY, {b"data": batch}, maxlen=10_000_000, approximate=True)
                path.unlink()
                drained += 1
            except (redis_async.RedisError, OSError) as exc:
                log.warning("drain failed; will retry", error=str(exc))
                break
        return drained


def serialize_batch(payload: object) -> bytes:
    """Use orjson for speed; SDK payloads are small dicts."""
    return orjson.dumps(payload, option=orjson.OPT_NON_STR_KEYS)
