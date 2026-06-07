"""Per-request rate-limit + quota gate.

These are FastAPI dependencies (not middleware) on purpose: they need the
authenticated ``TenantContext`` to choose a bucket / counter, so they have to
chain after ``require_ingest_key``. The router declares both as
``Depends(...)`` and FastAPI threads the context through.

Behavior:

- Rate limit: GCRA bucket per ingest key, plan-driven rps + burst.
  ``internal:*`` scopes bypass (used by migrate-langsmith bulk imports).
- Quota: Redis counter per org / month / meter. We DO NOT increment here —
  that's the ingest path's own job once the spans are counted (the router
  knows the actual count). We just hard-reject if the most recent value is
  already over the cap.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Final

from fastapi import Depends, HTTPException, Request, status
from tracebility_tenant import (
    QuotaMeter,
    RateLimiter,
    TenantContext,
)
from tracebility_tenant.audit import AuditEvent, AuditWriter, EventType
from tracebility_tenant.rate_limit import ingest_bucket_key

from .auth import require_ingest_key

# The single "spans / month" meter that gates ingest at the API edge. The
# byte-count and judge-call meters are checked by other services.
INGEST_GATING_METER: Final = "span_ingested"


@dataclass(frozen=True, slots=True)
class _PlanBuckets:
    rate_per_s: int
    burst: int
    monthly_limits: dict[str, int]


async def _plan_buckets(request: Request, plan: str) -> _PlanBuckets:
    """Fetch (and cache in app.state) the rps/burst/limits for a plan code."""
    cache: dict[str, _PlanBuckets] = getattr(request.app.state, "_plan_buckets", {})
    if plan in cache:
        return cache[plan]

    pool = request.app.state.pg
    plan_row = await pool.fetchrow(
        "select rate_limit_rps, rate_limit_burst from plan where code = $1",
        plan,
    )
    if plan_row is None:
        # Unknown plan: belt-and-braces fall back to the most restrictive cap
        # rather than letting a misconfigured org bypass limits.
        plan_row = {"rate_limit_rps": 50, "rate_limit_burst": 200}

    limit_rows = await pool.fetch(
        "select meter, monthly_limit from plan_meter_limit where plan_code = $1",
        plan,
    )
    monthly = {row["meter"]: row["monthly_limit"] for row in limit_rows}

    buckets = _PlanBuckets(
        rate_per_s=plan_row["rate_limit_rps"],
        burst=plan_row["rate_limit_burst"],
        monthly_limits=monthly,
    )
    cache[plan] = buckets
    request.app.state._plan_buckets = cache
    return buckets


async def enforce_rate_limit(
    request: Request,
    ctx: TenantContext = Depends(require_ingest_key),
) -> TenantContext:
    """Rate-limit gate. Returns the same ctx so the router can chain
    ``Depends(enforce_rate_limit)`` instead of ``Depends(require_ingest_key)``."""
    if ctx.has_scope("internal:*"):
        return ctx

    rl: RateLimiter = request.app.state.rate_limiter
    buckets = await _plan_buckets(request, ctx.plan)
    # Bucket is keyed on the api_key, not the org — one tenant with many keys
    # gets parallel buckets, which is the existing per-key fairness contract.
    result = await rl.check(
        bucket_key=ingest_bucket_key(str(ctx.api_key_id)),
        rate_per_s=buckets.rate_per_s,
        burst=buckets.burst,
    )
    if not result.allowed:
        retry_after_s = max(1, result.retry_after_ms // 1000)
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            "rate limit exceeded",
            headers={
                "Retry-After": str(retry_after_s),
                "X-RateLimit-Reset": str(result.reset_after_ms),
            },
        )
    return ctx


async def enforce_quota(
    request: Request,
    ctx: TenantContext = Depends(enforce_rate_limit),
) -> TenantContext:
    """Quota gate. Hard-rejects with 402 when the org is already over.

    We use ``peek`` (read without increment); the router increments after the
    span count is known. This means in-flight overshoot is bounded by the
    request-in-flight window, not by full reconciliation latency.
    """
    qm: QuotaMeter = request.app.state.quota_meter
    buckets = await _plan_buckets(request, ctx.plan)
    limit = buckets.monthly_limits.get(INGEST_GATING_METER, -1)
    state = await qm.peek(org_id=ctx.org_id, meter=INGEST_GATING_METER, limit=limit)
    if state.over:
        # Audit the block so the org admin can see why ingest is failing.
        writer: AuditWriter = request.app.state.audit_writer
        try:
            await writer.write(
                AuditEvent(
                    org_id=ctx.org_id,
                    workspace_id=ctx.workspace_id,
                    actor_api_key_id=ctx.api_key_id,
                    event_type=EventType.QUOTA_BLOCK,
                    target_kind="org",
                    target_id=ctx.org_id,
                    attributes={
                        "meter": INGEST_GATING_METER,
                        "used": state.used,
                        "limit": state.limit,
                    },
                )
            )
        except Exception:  # noqa: BLE001 — audit failure shouldn't mask quota
            pass
        raise HTTPException(
            status.HTTP_402_PAYMENT_REQUIRED,
            "quota exceeded for the current period",
            headers={"X-Quota-Meter": INGEST_GATING_METER},
        )
    return ctx