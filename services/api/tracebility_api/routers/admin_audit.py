"""Per-org audit log reader. Backs the admin/audit UI (multi-tenancy spec §10).

Reads the ClickHouse ``audit_log`` table the egress events land in. The
postgres ``audit_log`` is still populated for identity events (login,
role-change, key revoke) and for backward-compat; this router unions
the two so admins see one chronologically-merged feed."""

from __future__ import annotations

import datetime as dt
import json
from typing import Any
from uuid import UUID

import asyncpg
import structlog
from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel

from ..auth import Principal, assert_org_role, require_user
from ..clickhouse_client import ClickHouseQuery

log = structlog.get_logger("tracebility.api.admin_audit")

router = APIRouter(prefix="/v1/admin", tags=["admin"])


class AuditItem(BaseModel):
    source: str  # 'pg' | 'ch'
    org_id: UUID | None
    workspace_id: UUID | None
    actor_user_id: UUID | None
    actor_api_key_id: UUID | None
    event_type: str
    target_kind: str
    target_id: UUID | None
    attributes: dict[str, Any]
    event_time: dt.datetime


class AuditListResponse(BaseModel):
    items: list[AuditItem]


@router.get("/orgs/{org_id}/audit", response_model=AuditListResponse)
async def org_audit(
    request: Request,
    org_id: UUID,
    since_seconds: int = Query(default=86400 * 7, ge=60, le=86400 * 90),
    limit: int = Query(default=200, ge=1, le=1000),
    principal: Principal = Depends(require_user),
) -> AuditListResponse:
    pool: asyncpg.Pool = request.app.state.pg
    if not principal.is_root:
        await assert_org_role(
            pool,
            user_id=principal.user_id,
            org_id=org_id,
            allowed=("owner", "admin"),
        )

    since = dt.datetime.now(dt.UTC) - dt.timedelta(seconds=since_seconds)

    # Postgres half — identity events + legacy egress writes.
    pg_rows = await pool.fetch(
        """
        select org_id, workspace_id, actor_user_id, actor_api_key_id,
               action as event_type, target_kind, target_id,
               coalesce(payload, '{}'::jsonb) as attributes,
               ts as event_time
        from audit_log
        where org_id = $1 and ts >= $2
        order by ts desc
        limit $3
        """,
        org_id,
        since,
        limit,
    )

    # ClickHouse half — egress events.
    ch: ClickHouseQuery | None = getattr(request.app.state, "clickhouse", None)
    ch_items: list[AuditItem] = []
    if ch is not None:
        try:
            sql = """
                select org_id, workspace_id,
                       actor_user_id, actor_api_key_id,
                       event_type, target_kind, target_id,
                       attributes, event_time
                from audit_log
                where org_id = {org_id:UUID}
                  and event_time >= toDateTime64({since:String}, 9, 'UTC')
                order by event_time desc
                limit {limit:UInt32}
            """
            rows = await ch.query(
                sql,
                parameters={
                    "org_id": str(org_id),
                    "since": since.isoformat(),
                    "limit": limit,
                },
            )
            ch_items = [
                AuditItem(
                    source="ch",
                    org_id=row["org_id"],
                    workspace_id=row.get("workspace_id"),
                    actor_user_id=row.get("actor_user_id"),
                    actor_api_key_id=row.get("actor_api_key_id"),
                    event_type=row["event_type"],
                    target_kind=row.get("target_kind") or "",
                    target_id=row.get("target_id"),
                    attributes=_parse_attrs(row.get("attributes")),
                    event_time=row["event_time"],
                )
                for row in rows
            ]
        except Exception as exc:  # noqa: BLE001
            log.warning("clickhouse audit read failed", error=str(exc))

    pg_items = [
        AuditItem(
            source="pg",
            org_id=row["org_id"],
            workspace_id=row.get("workspace_id"),
            actor_user_id=row.get("actor_user_id"),
            actor_api_key_id=row.get("actor_api_key_id"),
            event_type=row["event_type"],
            target_kind=row.get("target_kind") or "",
            target_id=row.get("target_id"),
            attributes=_parse_attrs(row.get("attributes")),
            event_time=row["event_time"],
        )
        for row in pg_rows
    ]

    merged = sorted(pg_items + ch_items, key=lambda i: i.event_time, reverse=True)[:limit]
    return AuditListResponse(items=merged)


def _parse_attrs(raw: Any) -> dict[str, Any]:
    if raw is None:
        return {}
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str):
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            return {"_raw": raw}
    return {"_raw": str(raw)}


@router.get("/orgs/{org_id}/audit/gaps", response_model=AuditListResponse)
async def org_audit_gaps(
    request: Request,
    org_id: UUID,
    since_seconds: int = Query(default=86400 * 30, ge=60, le=86400 * 90),
    limit: int = Query(default=100, ge=1, le=500),
    principal: Principal = Depends(require_user),
) -> AuditListResponse:
    """The reconciler-detected gaps. Auditors care that we DETECT gaps;
    this is the live view of detection_run output."""
    pool: asyncpg.Pool = request.app.state.pg
    if not principal.is_root:
        await assert_org_role(
            pool,
            user_id=principal.user_id,
            org_id=org_id,
            allowed=("owner", "admin"),
        )

    ch: ClickHouseQuery | None = getattr(request.app.state, "clickhouse", None)
    if ch is None:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "clickhouse not configured",
        )

    since = dt.datetime.now(dt.UTC) - dt.timedelta(seconds=since_seconds)
    sql = """
        select org_id, expected_event, target_kind, target_id,
               diagnostic, detected_at
        from audit_reconciliation_gap
        where org_id = {org_id:UUID}
          and detected_at >= toDateTime64({since:String}, 9, 'UTC')
        order by detected_at desc
        limit {limit:UInt32}
    """
    rows = await ch.query(
        sql,
        parameters={
            "org_id": str(org_id),
            "since": since.isoformat(),
            "limit": limit,
        },
    )
    return AuditListResponse(
        items=[
            AuditItem(
                source="ch",
                org_id=row["org_id"],
                workspace_id=None,
                actor_user_id=None,
                actor_api_key_id=None,
                event_type=f"audit_gap:{row['expected_event']}",
                target_kind=row.get("target_kind") or "",
                target_id=row.get("target_id"),
                attributes=_parse_attrs(row.get("diagnostic")),
                event_time=row["detected_at"],
            )
            for row in rows
        ]
    )
