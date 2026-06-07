"""Per-org eval concurrency semaphore.

Spec §5.6: the eval orchestrator can't be starved by one tenant. We use a
plan-driven Redis semaphore — each org has at most ``concurrency_cap``
in-flight judge invocations. Jobs above the cap stay queued; the dispatcher
backs off and retries.

The implementation is a simple INCR/DECR pair guarded by a per-org key with
a TTL. The TTL is the safety net: if a worker crashes mid-eval the count
self-heals within ``stuck_after_s`` seconds.

The eval-orchestrator service doesn't exist on this branch; this module is
the seam the spec calls for. When the orchestrator lands, the dispatcher
imports ``EvalConcurrency`` and calls ``acquire`` / ``release`` around
each judge invocation.
"""

from __future__ import annotations

from contextlib import asynccontextmanager
from typing import Final
from uuid import UUID

import redis.asyncio as redis_async

_DEFAULT_STUCK_AFTER_S: Final = 600  # 10 min — well past p99 judge latency

_ACQUIRE_LUA = """
local key = KEYS[1]
local cap = tonumber(ARGV[1])
local ttl = tonumber(ARGV[2])
local current = tonumber(redis.call('GET', key) or '0')
if current >= cap then
    return 0
end
redis.call('INCR', key)
redis.call('EXPIRE', key, ttl)
return 1
"""

_RELEASE_LUA = """
local key = KEYS[1]
local current = tonumber(redis.call('GET', key) or '0')
if current <= 0 then
    redis.call('DEL', key)
    return 0
end
local new_val = redis.call('DECR', key)
if new_val <= 0 then
    redis.call('DEL', key)
end
return new_val
"""


def _key(org_id: UUID) -> str:
    return f"eval:concurrency:{org_id}"


class EvalConcurrencyExhausted(Exception):
    """Raised by ``acquire`` when the org is at its cap. The dispatcher
    catches this and requeues the job with a backoff."""


class EvalConcurrency:
    def __init__(
        self,
        redis: redis_async.Redis,
        *,
        stuck_after_s: int = _DEFAULT_STUCK_AFTER_S,
    ) -> None:
        self._redis = redis
        self._stuck_after_s = stuck_after_s
        self._acq_sha: str | None = None
        self._rel_sha: str | None = None

    async def _ensure_loaded(self) -> tuple[str, str]:
        if self._acq_sha is None:
            self._acq_sha = await self._redis.script_load(_ACQUIRE_LUA)
        if self._rel_sha is None:
            self._rel_sha = await self._redis.script_load(_RELEASE_LUA)
        return self._acq_sha, self._rel_sha

    async def acquire(self, *, org_id: UUID, cap: int) -> bool:
        """Try to take a slot. Returns True if acquired, False if at cap.

        Caller MUST call :meth:`release` after the eval completes (or on
        any failure path) — otherwise the slot stays held until TTL.
        """
        if cap <= 0:
            return False
        acq_sha, _ = await self._ensure_loaded()
        try:
            granted = await self._redis.evalsha(
                acq_sha, 1, _key(org_id), cap, self._stuck_after_s
            )
        except redis_async.NoScriptError:
            self._acq_sha = None
            acq_sha, _ = await self._ensure_loaded()
            granted = await self._redis.evalsha(
                acq_sha, 1, _key(org_id), cap, self._stuck_after_s
            )
        return bool(int(granted))

    async def release(self, *, org_id: UUID) -> int:
        """Return the slot. Returns the new in-flight count."""
        _, rel_sha = await self._ensure_loaded()
        try:
            new_val = await self._redis.evalsha(rel_sha, 1, _key(org_id))
        except redis_async.NoScriptError:
            self._rel_sha = None
            _, rel_sha = await self._ensure_loaded()
            new_val = await self._redis.evalsha(rel_sha, 1, _key(org_id))
        return int(new_val)

    async def in_flight(self, org_id: UUID) -> int:
        """Diagnostic: the current in-flight count. Used by /admin/quotas."""
        raw = await self._redis.get(_key(org_id))
        return int(raw) if raw is not None else 0

    @asynccontextmanager
    async def slot(self, *, org_id: UUID, cap: int):
        """Async context manager: acquire on enter, release on exit. Raises
        ``EvalConcurrencyExhausted`` if the org is at its cap so the
        dispatcher can requeue."""
        if not await self.acquire(org_id=org_id, cap=cap):
            raise EvalConcurrencyExhausted(str(org_id))
        try:
            yield
        finally:
            await self.release(org_id=org_id)
