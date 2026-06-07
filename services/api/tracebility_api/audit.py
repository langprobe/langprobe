"""Append-only audit log writer.

The Postgres trigger on ``audit_log`` (ER-10) blocks any UPDATE/DELETE, so we
just INSERT and trust the database to enforce the invariant. If the INSERT
fails we raise — never swallow. A request that should have been audited but
wasn't is a security incident.

Multi-tenancy spec §5.7-§5.8: data-egress events (exports, share-link
creation, webhook fan-out, read API inputs/outputs returns) ALSO land in the
ClickHouse ``audit_log`` table. Identity events stay on the legacy postgres
``audit_log`` for now; the daily reconciler (services/_shared/audit/
reconciler.py) flags any divergence between postgres state changes and
ClickHouse audit rows.
"""

from __future__ import annotations

import json
from typing import Any
from uuid import UUID

import asyncpg
import structlog
from fastapi import Request

from tracebility_tenant.audit import AuditEvent, AuditWriter

from .auth import Principal

log = structlog.get_logger("tracebility.api.audit")


async def record(
    pool: asyncpg.Pool,
    *,
    principal: Principal | None,
    action: str,
    target_kind: str,
    target_id: UUID | None,
    payload: dict[str, Any] | None = None,
    request: Request | None = None,
    org_id: UUID | None = None,
    workspace_id: UUID | None = None,
    project_id: UUID | None = None,
    actor_api_key_id: UUID | None = None,
) -> None:
    request_ip: str | None = None
    user_agent: str | None = None
    if request is not None:
        client = request.client
        request_ip = client.host if client else None
        user_agent = request.headers.get("user-agent")

    await pool.execute(
        """
        insert into audit_log (
            org_id, workspace_id, project_id,
            actor_user_id, actor_api_key_id,
            action, target_kind, target_id,
            payload, request_ip, user_agent
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::inet, $11)
        """,
        org_id,
        workspace_id,
        project_id,
        principal.user_id if principal else None,
        actor_api_key_id,
        action,
        target_kind,
        target_id,
        json.dumps(payload or {}),
        request_ip,
        user_agent,
    )


# ---------------------------------------------------------------------------
# Egress events also write to the ClickHouse audit_log.
# ---------------------------------------------------------------------------


async def record_egress(
    request: Request,
    *,
    principal: Principal | None,
    event_type: str,
    target_kind: str,
    target_id: UUID | None,
    org_id: UUID,
    workspace_id: UUID | None = None,
    payload: dict[str, Any] | None = None,
    actor_api_key_id: UUID | None = None,
) -> None:
    """Write a data-egress event to BOTH stores.

    The postgres write keeps the legacy admin UI populated and gives us
    referential integrity to the actor; the ClickHouse write feeds the
    long-term audit pack and the per-org admin/audit endpoint.

    A failure on the ClickHouse side is logged but doesn't block the
    request — the daily reconciler will catch the gap. A failure on the
    postgres side raises (ER-10)."""
    pool: asyncpg.Pool = request.app.state.pg
    request_ip: str | None = None
    user_agent: str | None = None
    client = request.client
    request_ip = client.host if client else None
    user_agent = request.headers.get("user-agent")

    full_payload: dict[str, Any] = dict(payload or {})
    full_payload.setdefault("request_ip", request_ip)
    full_payload.setdefault("user_agent", user_agent)

    # Postgres (referential, identity-event-shaped)
    await record(
        pool,
        principal=principal,
        action=event_type,
        target_kind=target_kind,
        target_id=target_id,
        payload=full_payload,
        request=request,
        org_id=org_id,
        workspace_id=workspace_id,
        actor_api_key_id=actor_api_key_id,
    )

    # ClickHouse (long-term, partitioned, queryable by org)
    writer: AuditWriter | None = getattr(request.app.state, "audit_writer", None)
    if writer is None:
        return
    try:
        await writer.write(
            AuditEvent(
                org_id=org_id,
                workspace_id=workspace_id,
                actor_user_id=principal.user_id if principal else None,
                actor_api_key_id=actor_api_key_id,
                event_type=event_type,
                target_kind=target_kind,
                target_id=target_id,
                attributes=full_payload,
            )
        )
    except Exception as exc:  # noqa: BLE001 — audit-trail write is best-effort to CH
        log.warning(
            "clickhouse audit_log write failed (reconciler will catch gap)",
            event_type=event_type,
            org_id=str(org_id),
            error=str(exc),
        )
