"""Shared fixtures: Redis + ClickHouse against the docker-compose stack.

These are integration tests by nature — the redis and clickhouse modules
need a real server to exercise meaningfully. We default to the local
docker-compose endpoints; CI should expose the same env vars."""

from __future__ import annotations

import os
import socket
from collections.abc import AsyncIterator

import pytest
import pytest_asyncio
import redis.asyncio as redis_async


def _service_reachable(host: str, port: int) -> bool:
    try:
        with socket.create_connection((host, port), timeout=0.25):
            return True
    except OSError:
        return False


REDIS_URL = os.environ.get("LANGPROBE_REDIS_URL", "redis://localhost:6379/15")
CLICKHOUSE_HOST = os.environ.get("LANGPROBE_CH_HOST", "localhost")
CLICKHOUSE_PORT = int(os.environ.get("LANGPROBE_CH_PORT", "8123"))


@pytest.fixture(scope="session")
def redis_url() -> str:
    if not _service_reachable("localhost", 6379):
        pytest.skip("redis not reachable on localhost:6379")
    return REDIS_URL


@pytest.fixture(scope="session")
def clickhouse_endpoint() -> tuple[str, int]:
    if not _service_reachable(CLICKHOUSE_HOST, CLICKHOUSE_PORT):
        pytest.skip(f"clickhouse not reachable on {CLICKHOUSE_HOST}:{CLICKHOUSE_PORT}")
    return CLICKHOUSE_HOST, CLICKHOUSE_PORT


@pytest_asyncio.fixture
async def redis_client(redis_url: str) -> AsyncIterator[redis_async.Redis]:
    """Per-test Redis client on db 15 (the test DB). FLUSHDB on entry to
    isolate from prior runs."""
    client = redis_async.from_url(redis_url, decode_responses=False)
    await client.flushdb()
    try:
        yield client
    finally:
        await client.aclose()
