"""api_key public_id -> TenantContext, with Redis cache + pubsub invalidation.

Hot path: ingest-api gets ~thousands of envelopes per second. Hitting postgres
on every one would melt the database, so we cache the resolved tuple in Redis.

The cache contract:

- Positive cache key:  ``apikey:<public_id>``
- Negative cache key:  ``apikey:neg:<public_id>``  (prevents auth-failure storms)
- TTL: 60s positive, 30s negative.
- Invalidation: any writer of the ``api_key`` table (revoke, rotate, scope
  edit) MUST publish the public_id on Redis pubsub channel
  ``apikey:invalidate``. The resolver subscribes and deletes the cache entry.

If postgres is unreachable on a cache miss, we fail closed (raise
``ResolverUnavailable``); the caller turns that into a 401. We never serve
stale-but-valid auth from a healthy cache during a postgres outage either —
the cache is sized for the working set, not for outage survival, and the
ingest path is required to be auth-correct above all else.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from typing import Final
from uuid import UUID

import asyncpg
import orjson
import redis.asyncio as redis_async
import structlog

from .context import TenantContext

log = structlog.get_logger("langprobe.tenant.resolver")

_POS_TTL_S: Final = 60
_NEG_TTL_S: Final = 30
_PUBSUB_CHANNEL: Final = "apikey:invalidate"


class ResolverUnavailable(Exception):
    """Raised when both cache and origin (postgres) are unavailable."""


class ResolverInvalidKey(Exception):
    """Raised when the public_id does not resolve to an active api_key."""


@dataclass(frozen=True, slots=True)
class ResolverConfig:
    pg_pool: asyncpg.Pool
    redis: redis_async.Redis
    # Optional override for unit tests; production leaves these alone.
    positive_ttl_s: int = _POS_TTL_S
    negative_ttl_s: int = _NEG_TTL_S


class Resolver:
    def __init__(self, cfg: ResolverConfig) -> None:
        self._cfg = cfg
        self._invalidator_task: asyncio.Task[None] | None = None

    async def start_invalidator(self) -> None:
        """Spawn the background pubsub listener. Call once at app startup."""
        if self._invalidator_task is not None:
            return
        self._invalidator_task = asyncio.create_task(self._run_invalidator())

    async def stop_invalidator(self) -> None:
        if self._invalidator_task is None:
            return
        self._invalidator_task.cancel()
        try:
            await self._invalidator_task
        except asyncio.CancelledError:
            pass
        self._invalidator_task = None

    async def resolve(self, public_id: str) -> TenantContext:
        """Return the TenantContext for an active api_key.

        Raises ``ResolverInvalidKey`` for unknown / revoked / expired keys
        and ``ResolverUnavailable`` when both cache and origin fail.
        """
        # 1. positive cache
        try:
            cached = await self._cfg.redis.get(f"apikey:{public_id}")
        except redis_async.RedisError as exc:
            log.warning("redis get failed; falling through to origin", error=str(exc))
            cached = None
        if cached is not None:
            return _decode(cached)

        # 2. negative cache (don't hammer postgres for known-bad keys)
        try:
            neg = await self._cfg.redis.get(f"apikey:neg:{public_id}")
        except redis_async.RedisError:
            neg = None
        if neg is not None:
            raise ResolverInvalidKey(public_id)

        # 3. origin
        try:
            row = await self._cfg.pg_pool.fetchrow(
                """
                select api_key.id          as api_key_id,
                       api_key.project_id  as project_id,
                       project.workspace_id as workspace_id,
                       workspace.org_id    as org_id,
                       coalesce(org.plan, 'free') as plan,
                       api_key.scopes      as scopes,
                       api_key.revoked_at  as revoked_at,
                       api_key.expires_at  as expires_at
                from api_key
                join project   on project.id = api_key.project_id
                join workspace on workspace.id = project.workspace_id
                join org       on org.id = workspace.org_id
                where api_key.public_id = $1
                """,
                public_id,
            )
        except (asyncpg.PostgresError, OSError) as exc:
            log.error("postgres unreachable in resolver", error=str(exc))
            raise ResolverUnavailable(str(exc)) from exc

        if row is None or row["revoked_at"] is not None:
            await self._set_negative(public_id)
            raise ResolverInvalidKey(public_id)

        # expires_at honored (per spec implicit; we mirror the existing auth.py
        # behavior).
        if row["expires_at"] is not None:
            from datetime import UTC, datetime

            if row["expires_at"] < datetime.now(UTC):
                await self._set_negative(public_id)
                raise ResolverInvalidKey(public_id)

        ctx = TenantContext(
            org_id=row["org_id"],
            workspace_id=row["workspace_id"],
            project_id=row["project_id"],
            api_key_id=row["api_key_id"],
            plan=row["plan"],
            scopes=frozenset(row["scopes"] or ()),
        )
        await self._set_positive(public_id, ctx)
        return ctx

    async def _set_positive(self, public_id: str, ctx: TenantContext) -> None:
        try:
            await self._cfg.redis.set(
                f"apikey:{public_id}",
                _encode(ctx),
                ex=self._cfg.positive_ttl_s,
            )
        except redis_async.RedisError as exc:
            # Cache failures are non-fatal; we just take the postgres hit
            # again next time.
            log.warning("redis set failed (positive)", error=str(exc))

    async def _set_negative(self, public_id: str) -> None:
        try:
            await self._cfg.redis.set(
                f"apikey:neg:{public_id}",
                b"1",
                ex=self._cfg.negative_ttl_s,
            )
        except redis_async.RedisError as exc:
            log.warning("redis set failed (negative)", error=str(exc))

    async def _run_invalidator(self) -> None:
        """Subscribe to pubsub and bust cache entries as they're announced."""
        backoff_s = 0.5
        while True:
            try:
                pubsub = self._cfg.redis.pubsub()
                await pubsub.subscribe(_PUBSUB_CHANNEL)
                async for msg in pubsub.listen():
                    if msg.get("type") != "message":
                        continue
                    raw = msg.get("data")
                    if not raw:
                        continue
                    public_id = raw.decode() if isinstance(raw, bytes) else str(raw)
                    await self._cfg.redis.delete(
                        f"apikey:{public_id}",
                        f"apikey:neg:{public_id}",
                    )
                    log.info("invalidated api_key cache", public_id=public_id)
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # noqa: BLE001 — defensive; loop must survive
                log.warning("invalidator loop crashed; restarting", error=str(exc))
                await asyncio.sleep(backoff_s)
                backoff_s = min(backoff_s * 2, 30.0)


# ---------------------------------------------------------------------------
# Cache wire format. Compact JSON; the Redis hop is the bottleneck, not the
# encoder.
# ---------------------------------------------------------------------------
def _encode(ctx: TenantContext) -> bytes:
    return orjson.dumps(
        {
            "o": str(ctx.org_id),
            "w": str(ctx.workspace_id),
            "p": str(ctx.project_id),
            "k": str(ctx.api_key_id),
            "pl": ctx.plan,
            "s": sorted(ctx.scopes),
        }
    )


def _decode(raw: bytes) -> TenantContext:
    obj = orjson.loads(raw)
    return TenantContext(
        org_id=UUID(obj["o"]),
        workspace_id=UUID(obj["w"]),
        project_id=UUID(obj["p"]),
        api_key_id=UUID(obj["k"]),
        plan=obj["pl"],
        scopes=frozenset(obj["s"]),
    )


async def announce_invalidation(redis: redis_async.Redis, public_id: str) -> None:
    """Helper for the api service: when an api_key row changes, call this."""
    await redis.publish(_PUBSUB_CHANNEL, public_id)
