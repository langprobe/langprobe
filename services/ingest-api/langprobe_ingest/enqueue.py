"""Redis enqueue with disk-buffer fallback.

Per ER-01: if Redis is down, the enqueue MUST not silently drop ingest. We
write to a local disk buffer; a recovery loop drains the buffer when Redis
returns. This keeps the API surface 'accept and 202' even during Redis
outages, which is what SDKs expect.

Multi-tenancy (spec §5.6): one stream per shard, ``hash(org_id) % N``. The
worker round-robins across shards so one runaway tenant fills its shard, not
the whole stream. Disk-spilled batches carry the shard key in the filename
so recovery routes back to the right shard after a Redis outage.
"""

from __future__ import annotations

import asyncio
import os
import time
import uuid
from pathlib import Path
from uuid import UUID

import orjson
import redis.asyncio as redis_async
import structlog
from langprobe_tenant import ShardRouter

log = structlog.get_logger("langprobe.ingest.enqueue")

# Legacy single-stream key, retained only for the dual-read window during
# the cutover. Once the cutover is complete and the legacy stream is empty,
# this constant is unused.
LEGACY_STREAM_KEY = ShardRouter.legacy_stream_key()

# Disk-buffer filename schema: ``<time_ns>-<uuid>.<shard>.bin``. The shard
# index travels with the file so recovery doesn't have to guess.
_SPILL_SUFFIX = ".bin"


class IngestEnqueue:
    def __init__(
        self,
        redis_url: str,
        disk_buffer_path: str,
        *,
        shard_router: ShardRouter | None = None,
    ) -> None:
        self._redis_url = redis_url
        self._buffer_dir = Path(disk_buffer_path)
        self._buffer_dir.mkdir(parents=True, exist_ok=True)
        self._client: redis_async.Redis | None = None
        self._lock = asyncio.Lock()
        self._shards = shard_router or ShardRouter()

    async def _get_client(self) -> redis_async.Redis:
        if self._client is None:
            self._client = redis_async.from_url(self._redis_url, decode_responses=False)
        return self._client

    async def enqueue(self, batch: bytes, *, org_id: UUID) -> None:
        """Enqueue a serialized batch into the org's shard.

        Best-effort to redis; spill to disk on failure.
        """
        shard = self._shards.shard_for(org_id)
        stream_key = f"{ShardRouter.legacy_stream_key()}:{shard}"
        try:
            client = await self._get_client()
            await client.xadd(stream_key, {b"data": batch}, maxlen=10_000_000, approximate=True)
            return
        except (redis_async.RedisError, OSError) as exc:
            log.warning("redis enqueue failed; spilling to disk", error=str(exc))
            await self._spill(batch, shard=shard)

    async def _spill(self, batch: bytes, *, shard: int) -> None:
        # filenames are time-ordered to make drain a cheap glob+sort; the
        # shard index is encoded in the suffix so recovery can route to the
        # right stream.
        fname = f"{time.time_ns():020d}-{uuid.uuid4().hex}.{shard}{_SPILL_SUFFIX}"
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
        for path in sorted(self._buffer_dir.glob(f"*{_SPILL_SUFFIX}")):
            try:
                shard = _shard_from_filename(path.name)
                stream_key = f"{ShardRouter.legacy_stream_key()}:{shard}"
                batch = path.read_bytes()
                await client.xadd(stream_key, {b"data": batch}, maxlen=10_000_000, approximate=True)
                path.unlink()
                drained += 1
            except (redis_async.RedisError, OSError) as exc:
                log.warning("drain failed; will retry", error=str(exc))
                break
            except ValueError:
                # Pre-shard spill (no shard suffix). Push to legacy stream and
                # let the worker's dual-read window pick it up.
                batch = path.read_bytes()
                await client.xadd(
                    LEGACY_STREAM_KEY,
                    {b"data": batch},
                    maxlen=10_000_000,
                    approximate=True,
                )
                path.unlink()
                drained += 1
        return drained


def _shard_from_filename(name: str) -> int:
    """Parse the shard index out of ``<ts>-<uuid>.<shard>.bin``.

    Pre-shard spills (filename ``<ts>-<uuid>.bin``) raise ValueError so the
    caller can route them to the legacy stream.
    """
    stem = name[: -len(_SPILL_SUFFIX)]  # strip ".bin"
    parts = stem.rsplit(".", 1)
    if len(parts) != 2:
        raise ValueError(name)
    return int(parts[1])


def serialize_batch(payload: object) -> bytes:
    """Use orjson for speed; SDK payloads are small dicts."""
    return orjson.dumps(payload, option=orjson.OPT_NON_STR_KEYS)
