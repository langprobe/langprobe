"""Enqueue routes envelopes to ``hash(org_id) % N`` shard, not the legacy stream."""

from __future__ import annotations

import socket
from pathlib import Path
from uuid import UUID

import pytest
import pytest_asyncio
import redis.asyncio as redis_async
from tracebility_ingest.enqueue import IngestEnqueue
from tracebility_tenant import ShardRouter


def _redis_reachable() -> bool:
    try:
        with socket.create_connection(("localhost", 6379), timeout=0.25):
            return True
    except OSError:
        return False


pytestmark = pytest.mark.asyncio


@pytest_asyncio.fixture
async def enqueue(tmp_path: Path):  # type: ignore[no-untyped-def]
    if not _redis_reachable():
        pytest.skip("redis not reachable")
    # Use db 14 so we don't collide with the shared module's db 15.
    url = "redis://localhost:6379/14"
    client = redis_async.from_url(url, decode_responses=False)
    await client.flushdb()
    eq = IngestEnqueue(redis_url=url, disk_buffer_path=str(tmp_path / "buf"))
    yield eq, client
    await client.aclose()


async def test_enqueue_routes_to_org_shard(enqueue) -> None:  # type: ignore[no-untyped-def]
    eq, client = enqueue
    org = UUID("11111111-1111-1111-1111-111111111111")
    expected_shard = ShardRouter().shard_for(org)

    await eq.enqueue(b"payload-1", org_id=org)

    target = f"tracebility:ingest:v1:{expected_shard}"
    n = await client.xlen(target)
    assert n == 1

    legacy = await client.xlen(ShardRouter.legacy_stream_key())
    assert legacy == 0


async def test_two_orgs_route_independently(enqueue) -> None:  # type: ignore[no-untyped-def]
    eq, client = enqueue
    a = UUID("11111111-1111-1111-1111-111111111111")
    b = UUID("22222222-2222-2222-2222-222222222222")
    sa = ShardRouter().shard_for(a)
    sb = ShardRouter().shard_for(b)
    await eq.enqueue(b"a", org_id=a)
    await eq.enqueue(b"b", org_id=b)
    if sa == sb:
        assert await client.xlen(f"tracebility:ingest:v1:{sa}") == 2
    else:
        assert await client.xlen(f"tracebility:ingest:v1:{sa}") == 1
        assert await client.xlen(f"tracebility:ingest:v1:{sb}") == 1
