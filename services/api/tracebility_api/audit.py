"""Append-only audit log writer.

The Postgres trigger on ``audit_log`` (ER-10) blocks any UPDATE/DELETE, so we
just INSERT and trust the database to enforce the invariant. If the INSERT
fails we raise — never swallow. A request that should have been audited but
wasn't is a security incident.

Phase 9 will add middleware-driven automation. This helper is the explicit
form routers call directly.
"""

from __future__ import annotations

import json
from typing import Any
from uuid import UUID

import asyncpg
from fastapi import Request

from .auth import Principal


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
