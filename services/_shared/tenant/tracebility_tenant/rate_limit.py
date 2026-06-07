"""GCRA rate limiter in Redis Lua. One round-trip per check, atomic.

Why GCRA over a vanilla token bucket: the algorithm produces both the
``allow`` decision and the ``retry_after`` hint in a single arithmetic step,
which lets us emit ``Retry-After`` headers without extra state.

Per spec §5.4, plan-driven limits live on the ``plan`` row; we read the rps
+ burst from there at startup and cache them in-process. Re-fetching per
request would defeat the point.

Plans that should never see a 429 (e.g. ``self_hosted`` at 50k rps,
``internal:*`` scope) get their bypass at the call site, not here — this
module just enforces the bucket.
"""

from __future__ import annotations

from dataclasses import dataclass

import redis.asyncio as redis_async
import structlog

log = structlog.get_logger("tracebility.tenant.rate_limit")

# GCRA reference: github.com/throttled/throttled. The script returns
#   {allow (0|1), retry_after_ms, reset_after_ms}
_GCRA_LUA = """
local key = KEYS[1]
local burst = tonumber(ARGV[1])
local rate_per_s = tonumber(ARGV[2])
local now_ms = tonumber(ARGV[3])
local cost = tonumber(ARGV[4])

if rate_per_s <= 0 then
    return {1, 0, 0}
end
local emission_interval_ms = 1000.0 / rate_per_s
local burst_offset_ms = burst * emission_interval_ms

local tat = tonumber(redis.call('GET', key))
if tat == nil then tat = now_ms end
local increment_ms = cost * emission_interval_ms
local new_tat = math.max(tat, now_ms) + increment_ms
local allow_at_ms = new_tat - burst_offset_ms

if allow_at_ms > now_ms then
    local retry_after = allow_at_ms - now_ms
    return {0, retry_after, new_tat - now_ms}
end

redis.call('SET', key, new_tat, 'PX', math.ceil(burst_offset_ms + increment_ms))
return {1, 0, new_tat - now_ms}
"""


@dataclass(frozen=True, slots=True)
class RateLimitResult:
    allowed: bool
    # Milliseconds until the next request would be allowed (0 if allowed=True).
    retry_after_ms: int
    # Milliseconds until the bucket fully refills.
    reset_after_ms: int


class RateLimiter:
    def __init__(self, redis: redis_async.Redis) -> None:
        self._redis = redis
        self._sha: str | None = None

    async def _ensure_loaded(self) -> str:
        if self._sha is not None:
            return self._sha
        self._sha = await self._redis.script_load(_GCRA_LUA)
        return self._sha

    async def check(
        self,
        *,
        bucket_key: str,
        rate_per_s: int,
        burst: int,
        cost: int = 1,
        now_ms: int | None = None,
    ) -> RateLimitResult:
        """Atomically test+increment. ``cost`` is the bucket charge per call."""
        from time import time

        if now_ms is None:
            now_ms = int(time() * 1000)

        sha = await self._ensure_loaded()
        try:
            allow, retry_ms, reset_ms = await self._redis.evalsha(
                sha, 1, bucket_key, burst, rate_per_s, now_ms, cost
            )
        except redis_async.NoScriptError:
            # Redis was flushed underneath us; reload and retry once.
            self._sha = None
            sha = await self._ensure_loaded()
            allow, retry_ms, reset_ms = await self._redis.evalsha(
                sha, 1, bucket_key, burst, rate_per_s, now_ms, cost
            )
        return RateLimitResult(
            allowed=bool(allow),
            retry_after_ms=int(retry_ms),
            reset_after_ms=int(reset_ms),
        )


def ingest_bucket_key(public_id: str) -> str:
    return f"rl:ingest:{public_id}"
