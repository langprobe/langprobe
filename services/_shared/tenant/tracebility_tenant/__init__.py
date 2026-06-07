"""Multi-tenancy primitives shared across services.

Public surface (everything else is implementation detail):

- ``TenantContext``: the (org, workspace, project, plan, scopes) tuple
  that flows through every authenticated request.
- ``Resolver``: cached lookup api_key -> TenantContext.
- ``RateLimiter``: GCRA per ingest key.
- ``QuotaMeter``: increment + check against the per-org Redis counter.
- ``ShardRouter``: hash(org_id) -> stream shard.
- ``AuditWriter``: append-only writer to ClickHouse ``audit_log``.

Cloud-only for v1: there is no ``DeploymentMode`` switch. When on-prem /
self-hosted comes back as a focused project, additive changes here will
introduce branching.
"""

from .audit import AuditWriter, EventType
from .context import TenantContext
from .eval_concurrency import EvalConcurrency, EvalConcurrencyExhausted
from .quota import QuotaMeter, QuotaResult
from .rate_limit import RateLimiter, RateLimitResult
from .resolver import Resolver, ResolverConfig
from .shard import ShardRouter

__all__ = [
    "AuditWriter",
    "EvalConcurrency",
    "EvalConcurrencyExhausted",
    "EventType",
    "QuotaMeter",
    "QuotaResult",
    "RateLimitResult",
    "RateLimiter",
    "Resolver",
    "ResolverConfig",
    "ShardRouter",
    "TenantContext",
]
