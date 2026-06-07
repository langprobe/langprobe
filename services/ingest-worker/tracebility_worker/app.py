"""Worker entrypoint.

Wires Redis + ClickHouse + Consumer together. ``main()`` is what
``__main__`` runs.

Lifecycle:
1. Build settings from env.
2. Open Redis (decode_responses=False — we ship raw bytes through the stream).
3. Open ClickHouse via clickhouse_connect.
4. Run Consumer.run() until SIGTERM/SIGINT.
"""

from __future__ import annotations

import asyncio
import logging
import signal

import redis.asyncio as redis_async
import structlog

from .config import Settings, load
from .consumer import Consumer
from .writer import ClickHouseWriter


def _configure_logging(level: str) -> None:
    logging.basicConfig(level=level)
    structlog.configure(
        processors=[
            structlog.processors.TimeStamper(fmt="iso", utc=True),
            structlog.processors.add_log_level,
            structlog.processors.JSONRenderer(),
        ]
    )


async def _serve(settings: Settings) -> None:
    log = structlog.get_logger("tracebility.worker")
    redis_client = redis_async.from_url(settings.redis_url, decode_responses=False)
    writer = ClickHouseWriter(settings.clickhouse_url)
    consumer = Consumer(settings, redis_client, writer)

    loop = asyncio.get_running_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(sig, consumer.stop)

    log.info(
        "worker starting",
        streams=settings.stream_keys(),
        group=settings.consumer_group,
        consumer=settings.consumer_name,
        shard_count=settings.shard_count,
        dual_read_legacy=settings.dual_read_legacy,
    )
    try:
        await consumer.run()
    finally:
        log.info("worker stopping")
        writer.close()
        await redis_client.aclose()


def main() -> None:
    settings = load()
    _configure_logging(settings.log_level)
    asyncio.run(_serve(settings))


if __name__ == "__main__":
    main()
