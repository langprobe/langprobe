"""Throttle audit emission for high-frequency dispatch failures.

A misconfigured eval loop firing 10k/min with no_credential would
otherwise insert 10k identical audit rows per minute. We emit at most
one row per (project, provider, action) per hour by reading the
audit_log table itself — no external state, no Redis, no in-process
cache that wouldn't survive a restart.
"""

from __future__ import annotations

from uuid import UUID

import asyncpg


async def should_emit_audit(
    pool: asyncpg.Pool,
    *,
    project_id: UUID,
    provider: str,
    action: str,
) -> bool:
    """Return True if no audit row matching (project, provider, action)
    has been written in the last hour."""
    found = await pool.fetchval(
        """
        select 1 from audit_log
         where project_id = $1
           and action = $3
           and payload ->> 'provider' = $2
           and ts > now() - interval '1 hour'
         limit 1
        """,
        project_id,
        provider,
        action,
    )
    return found is None
