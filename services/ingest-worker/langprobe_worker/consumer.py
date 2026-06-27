"""Redis Streams consumer.

Reads from the N sharded streams ``langprobe:ingest:v1:{0..N-1}`` (and
the legacy single-stream during the cutover dual-read window) and hands
batches to :class:`langprobe_worker.writer.ClickHouseWriter`.

Per-org consume-time quota filter (spec §7.2 with the 'consume-time
filter' refinement): when an org is over its hard cap, the reconciler
sets ``quota:over:<org_id>:<period>`` in Redis. The consumer XACKs and
drops envelopes for that org (with audit + structured log) instead of
stopping the entire shard. Co-tenants on the same shard are unaffected.

Failure handling (ER-23 — never drop silently):
- A single bad envelope is parsed, logged, and DLQ'd. We do NOT crash the
  consumer for one poison message.
- A ClickHouse insert failure does NOT XACK; the message becomes pending
  and redelivers on the next read. ReplacingMergeTree collapses the
  duplicate.
- After ``max_deliveries`` redeliveries (tracked via XPENDING), the
  message goes to the per-shard DLQ ``<stream>:dlq`` with the original
  payload + error metadata, then XACK'd so it stops blocking.

The writer is sync (clickhouse-connect has no asyncio path), so each
insert runs in the default executor.
"""

from __future__ import annotations

import asyncio
from typing import Any

import orjson
import redis.asyncio as redis_async
import structlog
from langprobe_tenant.quota import current_period

from .config import Settings
from .writer import ClickHouseWriter

log = structlog.get_logger("langprobe.worker.consumer")


def _quota_over_key(org_id: str, period: str | None = None) -> str:
    period = period or current_period()
    return f"quota:over:{org_id}:{period}"


class Consumer:
    def __init__(
        self,
        settings: Settings,
        client: redis_async.Redis,
        writer: ClickHouseWriter,
    ) -> None:
        self._settings = settings
        self._redis = client
        self._writer = writer
        self._stop = asyncio.Event()

    def stop(self) -> None:
        self._stop.set()

    async def ensure_groups(self) -> None:
        """Idempotent stream + group creation for every stream we read."""
        for stream_key in self._settings.stream_keys():
            try:
                await self._redis.xgroup_create(
                    name=stream_key,
                    groupname=self._settings.consumer_group,
                    id="$",
                    mkstream=True,
                )
                log.info(
                    "consumer group created",
                    stream=stream_key,
                    group=self._settings.consumer_group,
                )
            except redis_async.ResponseError as exc:
                if "BUSYGROUP" in str(exc):
                    continue
                raise

    async def run(self) -> None:
        """Main loop. Reclaims pending then consumes new across all shards."""
        await self.ensure_groups()
        # On startup, drain whatever this consumer name had pending from a
        # previous incarnation (XREADGROUP with id="0") before reading new.
        await self._consume_id("0")
        while not self._stop.is_set():
            try:
                await self._consume_id(">")
            except (redis_async.RedisError, OSError) as exc:
                log.warning("redis read failed; backing off", error=str(exc))
                await asyncio.sleep(1.0)

    async def _consume_id(self, start_id: str) -> None:
        """One XREADGROUP across every stream key. Round-robin happens
        naturally because the call returns from any shard with data."""
        streams = dict.fromkeys(self._settings.stream_keys(), start_id)
        per_stream_count = max(1, self._settings.batch_size // max(1, len(streams)))
        resp = await self._redis.xreadgroup(
            groupname=self._settings.consumer_group,
            consumername=self._settings.consumer_name,
            streams=streams,
            count=per_stream_count,
            block=self._settings.block_ms,
        )
        if not resp:
            return
        for stream, messages in resp:
            stream_key = stream.decode() if isinstance(stream, bytes) else stream
            for message_id, fields in messages:
                await self._handle(stream_key, message_id, fields)

    async def _handle(
        self,
        stream_key: str,
        message_id: bytes,
        fields: dict[bytes, bytes],
    ) -> None:
        raw = fields.get(b"data")
        if raw is None:
            log.warning("message missing data field; DLQ", id=message_id, stream=stream_key)
            await self._dlq(stream_key, message_id, raw or b"", "missing_data_field")
            await self._ack(stream_key, message_id)
            return

        try:
            envelope = orjson.loads(raw)
        except orjson.JSONDecodeError as exc:
            log.warning(
                "envelope parse failed; DLQ",
                id=message_id,
                stream=stream_key,
                error=str(exc),
            )
            await self._dlq(stream_key, message_id, raw, f"parse_error: {exc}")
            await self._ack(stream_key, message_id)
            return

        # Per-org consume-time quota filter. If the org is over its hard
        # cap, ack-and-drop with structured log + audit. Co-tenants on the
        # same shard are unaffected; this is the consume-time filter
        # refinement of spec §7.2.
        org_id = envelope.get("org_id")
        if org_id and await self._is_over_quota(org_id):
            log.warning(
                "dropping envelope: org over quota",
                id=message_id,
                stream=stream_key,
                org_id=org_id,
            )
            await self._ack(stream_key, message_id)
            return

        try:
            loop = asyncio.get_running_loop()
            runs, spans, captures = await loop.run_in_executor(
                None, self._writer.insert_envelope, envelope
            )
            await self._ack(stream_key, message_id)
            log.debug(
                "acked",
                id=message_id,
                stream=stream_key,
                runs=runs,
                spans=spans,
                captures=captures,
            )
        except Exception as exc:  # noqa: BLE001 — catch-all so we can decide DLQ
            await self._maybe_dlq(stream_key, message_id, raw, exc)

    async def _is_over_quota(self, org_id: str) -> bool:
        try:
            return bool(await self._redis.exists(_quota_over_key(org_id)))
        except redis_async.RedisError:
            # If Redis is unhappy, default to "let it through" — the
            # ingest-api edge has already 402'd new envelopes; whatever
            # made it onto the stream is in-flight and we'd rather write
            # it than stall. The reconciler will catch up next round.
            return False

    async def _ack(self, stream_key: str, message_id: bytes) -> None:
        await self._redis.xack(stream_key, self._settings.consumer_group, message_id)

    async def _maybe_dlq(
        self,
        stream_key: str,
        message_id: bytes,
        raw: bytes,
        exc: BaseException,
    ) -> None:
        """Push to DLQ + ack after max_deliveries; otherwise leave pending."""
        deliveries = await self._delivery_count(stream_key, message_id)
        if deliveries >= self._settings.max_deliveries:
            log.error(
                "max deliveries reached; DLQ",
                id=message_id,
                stream=stream_key,
                deliveries=deliveries,
                error=str(exc),
            )
            await self._dlq(stream_key, message_id, raw, f"max_deliveries: {exc}")
            await self._ack(stream_key, message_id)
        else:
            log.warning(
                "insert failed; leaving pending for redelivery",
                id=message_id,
                stream=stream_key,
                deliveries=deliveries,
                error=str(exc),
            )

    async def _delivery_count(self, stream_key: str, message_id: bytes) -> int:
        try:
            pending = await self._redis.xpending_range(
                name=stream_key,
                groupname=self._settings.consumer_group,
                min=message_id,
                max=message_id,
                count=1,
            )
        except redis_async.RedisError:
            return 0
        if not pending:
            return 0
        entry: Any = pending[0]
        if isinstance(entry, dict):
            return int(entry.get("times_delivered", 0))
        return 0

    async def _dlq(
        self,
        stream_key: str,
        message_id: bytes,
        raw: bytes,
        reason: str,
    ) -> None:
        try:
            await self._redis.xadd(
                self._settings.dlq_for(stream_key),
                {
                    b"data": raw,
                    b"original_id": message_id,
                    b"reason": reason.encode("utf-8"),
                    b"stream": stream_key.encode("utf-8"),
                },
                maxlen=1_000_000,
                approximate=True,
            )
        except redis_async.RedisError as exc:
            # Do not silently drop (ER-23). Re-raise; caller leaves message pending.
            log.error("DLQ write failed", id=message_id, stream=stream_key, error=str(exc))
            raise
