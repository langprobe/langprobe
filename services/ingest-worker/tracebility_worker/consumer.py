"""Redis Streams consumer.

Reads from ``tracebility:ingest:v1`` (consumer group ``ingest``) and hands
batches to :class:`tracebility_worker.writer.ClickHouseWriter`.

Failure handling (ER-23 — never drop silently):
- A single bad envelope is parsed, logged, and DLQ'd. We do NOT crash the
  consumer for one poison message.
- A ClickHouse insert failure does NOT XACK; the message becomes pending and
  redelivers on the next read. ReplacingMergeTree collapses the duplicate.
- After ``max_deliveries`` redeliveries (tracked via XPENDING), the message
  goes to ``tracebility:ingest:v1:dlq`` with the original payload + error
  metadata, then XACK'd so it stops blocking.

The writer is sync (clickhouse-connect has no asyncio path), so each insert
runs in the default executor.
"""

from __future__ import annotations

import asyncio
from typing import Any

import orjson
import redis.asyncio as redis_async
import structlog

from .config import Settings
from .writer import ClickHouseWriter

log = structlog.get_logger("tracebility.worker.consumer")


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

    async def ensure_group(self) -> None:
        """Idempotent stream + group creation."""
        try:
            await self._redis.xgroup_create(
                name=self._settings.stream_key,
                groupname=self._settings.consumer_group,
                id="$",
                mkstream=True,
            )
            log.info(
                "consumer group created",
                stream=self._settings.stream_key,
                group=self._settings.consumer_group,
            )
        except redis_async.ResponseError as exc:
            if "BUSYGROUP" in str(exc):
                return
            raise

    async def run(self) -> None:
        """Main loop. Reclaims pending then consumes new."""
        await self.ensure_group()
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
        resp = await self._redis.xreadgroup(
            groupname=self._settings.consumer_group,
            consumername=self._settings.consumer_name,
            streams={self._settings.stream_key: start_id},
            count=self._settings.batch_size,
            block=self._settings.block_ms,
        )
        if not resp:
            return
        for _stream, messages in resp:
            for message_id, fields in messages:
                await self._handle(message_id, fields)

    async def _handle(self, message_id: bytes, fields: dict[bytes, bytes]) -> None:
        raw = fields.get(b"data")
        if raw is None:
            log.warning("message missing data field; DLQ", id=message_id)
            await self._dlq(message_id, raw or b"", "missing_data_field")
            await self._redis.xack(
                self._settings.stream_key,
                self._settings.consumer_group,
                message_id,
            )
            return

        try:
            envelope = orjson.loads(raw)
        except orjson.JSONDecodeError as exc:
            log.warning("envelope parse failed; DLQ", id=message_id, error=str(exc))
            await self._dlq(message_id, raw, f"parse_error: {exc}")
            await self._redis.xack(
                self._settings.stream_key,
                self._settings.consumer_group,
                message_id,
            )
            return

        try:
            loop = asyncio.get_running_loop()
            runs, spans = await loop.run_in_executor(
                None, self._writer.insert_envelope, envelope
            )
            await self._redis.xack(
                self._settings.stream_key,
                self._settings.consumer_group,
                message_id,
            )
            log.debug("acked", id=message_id, runs=runs, spans=spans)
        except Exception as exc:  # noqa: BLE001 — catch-all so we can decide DLQ
            await self._maybe_dlq(message_id, raw, exc)

    async def _maybe_dlq(
        self, message_id: bytes, raw: bytes, exc: BaseException
    ) -> None:
        """Push to DLQ + ack after max_deliveries; otherwise leave pending."""
        deliveries = await self._delivery_count(message_id)
        if deliveries >= self._settings.max_deliveries:
            log.error(
                "max deliveries reached; DLQ",
                id=message_id,
                deliveries=deliveries,
                error=str(exc),
            )
            await self._dlq(message_id, raw, f"max_deliveries: {exc}")
            await self._redis.xack(
                self._settings.stream_key,
                self._settings.consumer_group,
                message_id,
            )
        else:
            log.warning(
                "insert failed; leaving pending for redelivery",
                id=message_id,
                deliveries=deliveries,
                error=str(exc),
            )

    async def _delivery_count(self, message_id: bytes) -> int:
        try:
            pending = await self._redis.xpending_range(
                name=self._settings.stream_key,
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

    async def _dlq(self, message_id: bytes, raw: bytes, reason: str) -> None:
        try:
            await self._redis.xadd(
                self._settings.dead_letter_stream,
                {
                    b"data": raw,
                    b"original_id": message_id,
                    b"reason": reason.encode("utf-8"),
                },
                maxlen=1_000_000,
                approximate=True,
            )
        except redis_async.RedisError as exc:
            # Do not silently drop (ER-23). Re-raise; caller leaves message pending.
            log.error("DLQ write failed", id=message_id, error=str(exc))
            raise
