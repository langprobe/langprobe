"""Replay capture index — read-side surface.

The ingest worker derives a ``replay_capture`` row for every span of
kind tool/llm/retriever; this router exposes that index per run so the
UI can show "this run is replayable, here are the boundary I/Os we
captured" and a future replay-runner can fetch the artifact references.

The actual capture artifacts (tool I/O, LLM responses, retrieval docs)
are content-addressed by sha256. Today the bytes live inline on the
span row itself and ``object_ref`` reads ``inline:sha256:<hash>``;
when the object-store backend lands, the worker will flip the ref to
``s3://...`` without changing this read path.

Determinism note (ER-18): a model endpoint version diff is warned, not
silent-substituted. The replay-runner that consumes this index is the
right place to enforce that. Here we just surface the captures.
"""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

import asyncpg
import structlog
from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel

from ..auth import Principal, assert_workspace_role, require_user
from ..clickhouse_client import ClickHouseQuery

log = structlog.get_logger("tracebility.api.replays")

router = APIRouter(prefix="/v1/runs", tags=["replays"])


class ReplayCaptureItem(BaseModel):
    span_id: UUID
    kind: str
    content_hash: str
    object_ref: str
    size_bytes: int
    attributes: str
    captured_at: datetime


class ReplayCaptureSummary(BaseModel):
    total: int
    by_kind: dict[str, int]
    bytes_total: int
    unique_hashes: int


class ReplayCaptureList(BaseModel):
    summary: ReplayCaptureSummary
    items: list[ReplayCaptureItem]


@router.get("/{run_id}/replay-captures", response_model=ReplayCaptureList)
async def list_replay_captures(
    request: Request,
    run_id: UUID,
    project_id: UUID = Query(...),
    limit: int = Query(default=500, ge=1, le=5000),
    principal: Principal = Depends(require_user),
) -> ReplayCaptureList:
    pool: asyncpg.Pool = request.app.state.pg
    workspace_id = await pool.fetchval(
        "select workspace_id from project where id = $1 and deleted_at is null",
        project_id,
    )
    if workspace_id is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "project not found")
    await assert_workspace_role(
        pool,
        user_id=principal.user_id,
        workspace_id=workspace_id,
        allowed=("owner", "admin", "member", "viewer"),
    )

    ch: ClickHouseQuery | None = getattr(request.app.state, "clickhouse", None)
    if ch is None:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "clickhouse not configured (set TRACEBILITY_CLICKHOUSE_URL)",
        )

    sql = """
        select span_id, kind, content_hash, object_ref, size_bytes,
               attributes, captured_at
          from replay_capture final
         where project_id = {project_id:UUID}
           and run_id = {run_id:UUID}
         order by captured_at asc
         limit {limit:UInt32}
    """
    params = {
        "project_id": str(project_id),
        "run_id": str(run_id),
        "limit": limit,
    }
    try:
        rows = await ch.query(sql, parameters=params)
    except Exception as exc:  # noqa: BLE001
        log.warning("replay_capture query failed", error=str(exc))
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE, "data plane unavailable"
        ) from exc

    items: list[ReplayCaptureItem] = []
    by_kind: dict[str, int] = {}
    bytes_total = 0
    hashes: set[str] = set()
    for row in rows:
        kind = str(row.get("kind") or "")
        size = int(row.get("size_bytes") or 0)
        content_hash = str(row.get("content_hash") or "")
        items.append(
            ReplayCaptureItem(
                span_id=row["span_id"],
                kind=kind,
                content_hash=content_hash,
                object_ref=str(row.get("object_ref") or ""),
                size_bytes=size,
                attributes=str(row.get("attributes") or ""),
                captured_at=row["captured_at"],
            )
        )
        by_kind[kind] = by_kind.get(kind, 0) + 1
        bytes_total += size
        if content_hash:
            hashes.add(content_hash)

    return ReplayCaptureList(
        summary=ReplayCaptureSummary(
            total=len(items),
            by_kind=by_kind,
            bytes_total=bytes_total,
            unique_hashes=len(hashes),
        ),
        items=items,
    )
