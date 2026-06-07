"""Per-org monthly meter quotas. Optimistic — Redis hot path, postgres truth.

Spec §5.5:

- Live counter:        ``quota:<org_id>:<YYYYMM>:<meter>``  (Redis INCRBY)
- Soft warn at 80%:    one ClickHouse audit_log row per period+meter+org.
- Hard block at 100%:  in-flight envelopes 402'd at the ingest edge.
- Reconciler every 60s pulls SUM from ClickHouse ``billing_meter`` into
  postgres ``quota_period.used_amount`` and resets the Redis counter to the
  authoritative value.

The reconciler lives in ``services/_shared/quota/reconciler.py`` (Phase 11).
This module only handles the hot-path INCRBY + check.

The ``-1`` sentinel for unlimited matches ``plan_meter_limit.monthly_limit``.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from uuid import UUID

import redis.asyncio as redis_async


@dataclass(frozen=True, slots=True)
class QuotaResult:
    used: int
    limit: int  # -1 = unlimited
    over: bool  # used > limit (hard cap; ingest 402)
    warn: bool  # used >= 0.8 * limit (soft warn; audit row)


def _bucket_key(org_id: UUID, period: str, meter: str) -> str:
    return f"quota:{org_id}:{period}:{meter}"


def current_period() -> str:
    """YYYYMM in UTC. The period rolls at midnight UTC on the 1st."""
    now = datetime.now(UTC)
    return f"{now.year:04d}{now.month:02d}"


class QuotaMeter:
    """Hot-path meter. The caller passes the per-period limit because the
    plan resolution lives one layer up (see Resolver / TenantContext.plan)."""

    def __init__(self, redis: redis_async.Redis) -> None:
        self._redis = redis

    async def record(
        self,
        *,
        org_id: UUID,
        meter: str,
        amount: int,
        limit: int,
        period: str | None = None,
    ) -> QuotaResult:
        """INCRBY then read back. Returns the post-increment state.

        ``limit < 0`` is the unlimited sentinel; we still INCRBY so usage UI
        can render real numbers, but ``over`` and ``warn`` are False.
        """
        period = period or current_period()
        key = _bucket_key(org_id, period, meter)
        used = int(await self._redis.incrby(key, amount))
        # Refresh TTL on every write so abandoned periods eventually evict.
        # 40 days is enough overlap for the daily reconciler to cross a
        # month boundary safely.
        await self._redis.expire(key, 40 * 86400)

        if limit < 0:
            return QuotaResult(used=used, limit=limit, over=False, warn=False)

        return QuotaResult(
            used=used,
            limit=limit,
            over=used > limit,
            warn=used >= int(limit * 0.8),
        )

    async def peek(
        self,
        *,
        org_id: UUID,
        meter: str,
        limit: int,
        period: str | None = None,
    ) -> QuotaResult:
        """Read-only: same semantics as ``record`` but doesn't increment."""
        period = period or current_period()
        key = _bucket_key(org_id, period, meter)
        raw = await self._redis.get(key)
        used = int(raw) if raw is not None else 0
        if limit < 0:
            return QuotaResult(used=used, limit=limit, over=False, warn=False)
        return QuotaResult(
            used=used,
            limit=limit,
            over=used > limit,
            warn=used >= int(limit * 0.8),
        )

    async def reset(
        self,
        *,
        org_id: UUID,
        meter: str,
        authoritative: int,
        period: str | None = None,
    ) -> None:
        """Reconciler hook: replace the live counter with the post-SUM value."""
        period = period or current_period()
        key = _bucket_key(org_id, period, meter)
        await self._redis.set(key, authoritative, ex=40 * 86400)
