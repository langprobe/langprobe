"""RateLimiter — exercises the GCRA Lua script against a real Redis."""

from __future__ import annotations

import pytest
from tracebility_tenant.rate_limit import RateLimiter, ingest_bucket_key

pytestmark = pytest.mark.asyncio


async def test_burst_allows_then_throttles(redis_client) -> None:
    """rate=10/s, burst=5 -> first 5 immediate calls allowed, the 6th 429s.

    We pin ``now_ms`` so the test isn't flaky on slow CI."""
    rl = RateLimiter(redis_client)
    key = ingest_bucket_key("k1")
    now = 1_000_000

    for i in range(5):
        r = await rl.check(bucket_key=key, rate_per_s=10, burst=5, now_ms=now)
        assert r.allowed, f"call #{i} should pass"

    r = await rl.check(bucket_key=key, rate_per_s=10, burst=5, now_ms=now)
    assert not r.allowed
    assert r.retry_after_ms > 0


async def test_refill_after_emission_interval(redis_client) -> None:
    """At 10 req/s the bucket refills 1 token per 100ms."""
    rl = RateLimiter(redis_client)
    key = ingest_bucket_key("k2")

    # exhaust burst at t=0
    for _ in range(3):
        await rl.check(bucket_key=key, rate_per_s=10, burst=3, now_ms=0)
    blocked = await rl.check(bucket_key=key, rate_per_s=10, burst=3, now_ms=0)
    assert not blocked.allowed

    # 100ms later one slot is available
    allowed = await rl.check(bucket_key=key, rate_per_s=10, burst=3, now_ms=100)
    assert allowed.allowed


async def test_zero_rate_is_unlimited(redis_client) -> None:
    """rate_per_s=0 is the convention for 'effectively off' (used by the
    bypass scope path in ingest-api)."""
    rl = RateLimiter(redis_client)
    key = ingest_bucket_key("k3")
    for _ in range(50):
        r = await rl.check(bucket_key=key, rate_per_s=0, burst=1, now_ms=0)
        assert r.allowed


async def test_independent_keys(redis_client) -> None:
    """Two keys don't share a bucket."""
    rl = RateLimiter(redis_client)
    for _ in range(5):
        await rl.check(bucket_key=ingest_bucket_key("a"), rate_per_s=10, burst=5, now_ms=0)

    blocked = await rl.check(bucket_key=ingest_bucket_key("a"), rate_per_s=10, burst=5, now_ms=0)
    assert not blocked.allowed

    other = await rl.check(bucket_key=ingest_bucket_key("b"), rate_per_s=10, burst=5, now_ms=0)
    assert other.allowed
