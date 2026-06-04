"""Studio canvas — branches of captured runs (parity loop #4 item #9).

A `studio_branch` is the postgres-side record of "I took run X, picked
span Y as the branch point, and want to edit fields A/B/C". Studio is
the round-trip surface between Replay (the captured truth) and Prompts
(the candidate revision). The actual replay-runner that re-executes
the branched flow with edits applied slots in next iteration; here we
ship the storage shape and the canvas wiring.

V1 honest scope:
- Branch CRUD: draft -> replayed -> promoted lifecycle.
- Replay action: synthesizes a `diff_summary` describing what the
  branch changes (prompt/model/temperature/tool_args per target span),
  flips status to `replayed`, stamps `replayed_at`. Does NOT yet
  produce a new ClickHouse run; `replay_run_id` stays null until the
  runner lands. This is the same shape the comparisons runner uses
  (built-in stand-in today, real LLM runner tomorrow).
- Promote action: flips status to `promoted`. Wiring into Prompts
  revisions also lands next iteration.

ER-23: never silent-drop. If the source run is missing in ClickHouse
the branch row stays — the UI surfaces "source run missing" instead
of cascading delete.
"""

from __future__ import annotations

import json as _json
from datetime import datetime, timezone
from typing import Any
from uuid import UUID

import asyncpg
import structlog
from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, Field

from .. import audit
from ..auth import Principal, assert_workspace_role, require_user

log = structlog.get_logger("tracebility.api.studio")

router = APIRouter(prefix="/v1/studio", tags=["studio"])

_ALLOWED_FIELDS = {"prompt", "model", "temperature", "tool_args"}
_BRANCH_STATUSES = {"draft", "replayed", "promoted"}


class StudioEdit(BaseModel):
    target_span_id: str = Field(min_length=1, max_length=128)
    field: str = Field(min_length=1, max_length=32)
    value: Any = None


class StudioBranchOut(BaseModel):
    id: UUID
    project_id: UUID
    name: str
    description: str | None
    source_run_id: str
    source_span_id: str | None
    edits: list[StudioEdit]
    replay_run_id: str | None
    status: str
    diff_summary: str | None
    created_at: datetime
    updated_at: datetime
    replayed_at: datetime | None


class StudioBranchCreate(BaseModel):
    project_id: UUID
    name: str = Field(min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=2000)
    source_run_id: str = Field(min_length=1, max_length=128)
    source_span_id: str | None = Field(default=None, max_length=128)
    edits: list[StudioEdit] = Field(default_factory=list, max_length=64)


class StudioBranchPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=2000)
    edits: list[StudioEdit] | None = Field(default=None, max_length=64)


class StudioBranchList(BaseModel):
    items: list[StudioBranchOut]


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@router.get("/branches", response_model=StudioBranchList)
async def list_branches(
    request: Request,
    project_id: UUID = Query(...),
    limit: int = Query(default=200, ge=1, le=500),
    principal: Principal = Depends(require_user),
) -> StudioBranchList:
    pool: asyncpg.Pool = request.app.state.pg
    await _assert_project_role(
        pool, principal, project_id,
        ("owner", "admin", "member", "viewer"),
    )
    rows = await pool.fetch(
        """
        select id, project_id, name, description, source_run_id,
               source_span_id, edits, replay_run_id, status,
               diff_summary, created_at, updated_at, replayed_at
          from studio_branch
         where project_id = $1
         order by created_at desc
         limit $2
        """,
        project_id,
        limit,
    )
    return StudioBranchList(items=[_branch_out(r) for r in rows])


@router.post(
    "/branches",
    response_model=StudioBranchOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_branch(
    request: Request,
    body: StudioBranchCreate,
    principal: Principal = Depends(require_user),
) -> StudioBranchOut:
    _validate_edits(body.edits)

    pool: asyncpg.Pool = request.app.state.pg
    workspace_id = await _assert_project_role(
        pool, principal, body.project_id, ("owner", "admin", "member")
    )

    edits_json = _json.dumps([e.model_dump() for e in body.edits])

    row = await pool.fetchrow(
        """
        insert into studio_branch (
            project_id, name, description, source_run_id, source_span_id,
            edits, status, author_id
        )
        values ($1, $2, $3, $4, $5, $6::jsonb, 'draft', $7)
        returning id, project_id, name, description, source_run_id,
                  source_span_id, edits, replay_run_id, status,
                  diff_summary, created_at, updated_at, replayed_at
        """,
        body.project_id,
        body.name,
        body.description,
        body.source_run_id,
        body.source_span_id,
        edits_json,
        principal.user_id,
    )
    assert row is not None

    await audit.record(
        pool,
        principal=principal,
        action="studio_branch.create",
        target_kind="studio_branch",
        target_id=row["id"],
        payload={
            "name": body.name,
            "source_run_id": body.source_run_id,
            "source_span_id": body.source_span_id,
            "edit_count": len(body.edits),
        },
        request=request,
        workspace_id=workspace_id,
        project_id=body.project_id,
    )
    return _branch_out(row)


@router.get("/branches/{branch_id}", response_model=StudioBranchOut)
async def get_branch(
    request: Request,
    branch_id: UUID,
    principal: Principal = Depends(require_user),
) -> StudioBranchOut:
    pool: asyncpg.Pool = request.app.state.pg
    row = await _fetch_branch(pool, branch_id)
    await _assert_project_role(
        pool, principal, row["project_id"],
        ("owner", "admin", "member", "viewer"),
    )
    return _branch_out(row)


@router.patch("/branches/{branch_id}", response_model=StudioBranchOut)
async def patch_branch(
    request: Request,
    branch_id: UUID,
    body: StudioBranchPatch,
    principal: Principal = Depends(require_user),
) -> StudioBranchOut:
    pool: asyncpg.Pool = request.app.state.pg
    row = await _fetch_branch(pool, branch_id)
    project_id: UUID = row["project_id"]
    workspace_id = await _assert_project_role(
        pool, principal, project_id, ("owner", "admin", "member")
    )

    if row["status"] != "draft" and body.edits is not None:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "edits are frozen once the branch has been replayed",
        )

    if body.edits is not None:
        _validate_edits(body.edits)

    sets: list[str] = []
    args: list[Any] = []
    if body.name is not None:
        args.append(body.name)
        sets.append(f"name = ${len(args)}")
    if body.description is not None:
        args.append(body.description)
        sets.append(f"description = ${len(args)}")
    if body.edits is not None:
        args.append(_json.dumps([e.model_dump() for e in body.edits]))
        sets.append(f"edits = ${len(args)}::jsonb")

    if not sets:
        return _branch_out(row)

    args.append(branch_id)
    updated = await pool.fetchrow(
        f"""
        update studio_branch
           set {", ".join(sets)}
         where id = ${len(args)}
        returning id, project_id, name, description, source_run_id,
                  source_span_id, edits, replay_run_id, status,
                  diff_summary, created_at, updated_at, replayed_at
        """,
        *args,
    )
    assert updated is not None

    await audit.record(
        pool,
        principal=principal,
        action="studio_branch.update",
        target_kind="studio_branch",
        target_id=branch_id,
        payload={"fields": sorted([s.split(" ")[0] for s in sets])},
        request=request,
        workspace_id=workspace_id,
        project_id=project_id,
    )
    return _branch_out(updated)


@router.delete(
    "/branches/{branch_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_branch(
    request: Request,
    branch_id: UUID,
    principal: Principal = Depends(require_user),
) -> None:
    pool: asyncpg.Pool = request.app.state.pg
    row = await _fetch_branch(pool, branch_id)
    project_id: UUID = row["project_id"]
    workspace_id = await _assert_project_role(
        pool, principal, project_id, ("owner", "admin")
    )
    await pool.execute("delete from studio_branch where id = $1", branch_id)
    await audit.record(
        pool,
        principal=principal,
        action="studio_branch.delete",
        target_kind="studio_branch",
        target_id=branch_id,
        payload={},
        request=request,
        workspace_id=workspace_id,
        project_id=project_id,
    )


@router.post(
    "/branches/{branch_id}/replay",
    response_model=StudioBranchOut,
)
async def replay_branch(
    request: Request,
    branch_id: UUID,
    principal: Principal = Depends(require_user),
) -> StudioBranchOut:
    """Stand-in replay action.

    V1 doesn't yet re-execute the run with edits applied — that needs
    a real LLM runner with model adapters. What we DO ship is the
    contract: flip the branch from `draft` to `replayed`, synthesize
    a `diff_summary` describing how the edits would diverge from the
    source, stamp `replayed_at`. When the runner lands it slots in
    here without changing the storage shape (same way `_render_for_variant`
    is the seam in comparisons.py).
    """
    pool: asyncpg.Pool = request.app.state.pg
    row = await _fetch_branch(pool, branch_id)
    project_id: UUID = row["project_id"]
    workspace_id = await _assert_project_role(
        pool, principal, project_id, ("owner", "admin", "member")
    )
    if row["status"] not in ("draft", "replayed"):
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"cannot replay a branch in status={row['status']}",
        )

    edits = _parse_edits(row["edits"])
    diff_summary = _summarize_edits(edits) or "no edits applied"

    updated = await pool.fetchrow(
        """
        update studio_branch
           set status = 'replayed',
               diff_summary = $2,
               replayed_at = $3
         where id = $1
        returning id, project_id, name, description, source_run_id,
                  source_span_id, edits, replay_run_id, status,
                  diff_summary, created_at, updated_at, replayed_at
        """,
        branch_id,
        diff_summary,
        datetime.now(timezone.utc),
    )
    assert updated is not None

    await audit.record(
        pool,
        principal=principal,
        action="studio_branch.replay",
        target_kind="studio_branch",
        target_id=branch_id,
        payload={"edit_count": len(edits), "diff_summary": diff_summary},
        request=request,
        workspace_id=workspace_id,
        project_id=project_id,
    )
    return _branch_out(updated)


@router.post(
    "/branches/{branch_id}/promote",
    response_model=StudioBranchOut,
)
async def promote_branch(
    request: Request,
    branch_id: UUID,
    principal: Principal = Depends(require_user),
) -> StudioBranchOut:
    pool: asyncpg.Pool = request.app.state.pg
    row = await _fetch_branch(pool, branch_id)
    project_id: UUID = row["project_id"]
    workspace_id = await _assert_project_role(
        pool, principal, project_id, ("owner", "admin", "member")
    )
    if row["status"] != "replayed":
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "branch must be replayed before it can be promoted",
        )

    updated = await pool.fetchrow(
        """
        update studio_branch
           set status = 'promoted'
         where id = $1
        returning id, project_id, name, description, source_run_id,
                  source_span_id, edits, replay_run_id, status,
                  diff_summary, created_at, updated_at, replayed_at
        """,
        branch_id,
    )
    assert updated is not None

    await audit.record(
        pool,
        principal=principal,
        action="studio_branch.promote",
        target_kind="studio_branch",
        target_id=branch_id,
        payload={},
        request=request,
        workspace_id=workspace_id,
        project_id=project_id,
    )
    return _branch_out(updated)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _validate_edits(edits: list[StudioEdit]) -> None:
    for idx, edit in enumerate(edits):
        if edit.field not in _ALLOWED_FIELDS:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                f"edits[{idx}].field must be one of {sorted(_ALLOWED_FIELDS)}",
            )
        if edit.field == "temperature":
            try:
                t = float(edit.value)
            except (TypeError, ValueError) as exc:
                raise HTTPException(
                    status.HTTP_400_BAD_REQUEST,
                    f"edits[{idx}].value must be a number for temperature",
                ) from exc
            if not 0.0 <= t <= 2.0:
                raise HTTPException(
                    status.HTTP_400_BAD_REQUEST,
                    f"edits[{idx}].value must be in [0.0, 2.0] for temperature",
                )
        elif edit.field in ("prompt", "model"):
            if not isinstance(edit.value, str) or not edit.value.strip():
                raise HTTPException(
                    status.HTTP_400_BAD_REQUEST,
                    f"edits[{idx}].value must be a non-empty string for {edit.field}",
                )
        elif edit.field == "tool_args":
            if not isinstance(edit.value, (dict, list)):
                raise HTTPException(
                    status.HTTP_400_BAD_REQUEST,
                    f"edits[{idx}].value must be a JSON object or array for tool_args",
                )


def _summarize_edits(edits: list[StudioEdit]) -> str:
    if not edits:
        return ""
    parts: list[str] = []
    for edit in edits:
        target = (edit.target_span_id or "")[:8] or "—"
        if edit.field == "model":
            parts.append(f"model@{target} → {edit.value}")
        elif edit.field == "temperature":
            parts.append(f"temp@{target} → {edit.value}")
        elif edit.field == "prompt":
            length = len(str(edit.value)) if edit.value is not None else 0
            parts.append(f"prompt@{target} ({length} chars)")
        elif edit.field == "tool_args":
            keys = (
                ", ".join(sorted(edit.value.keys()))
                if isinstance(edit.value, dict)
                else "[...]"
            )
            parts.append(f"tool_args@{target} ({keys})")
        else:
            parts.append(f"{edit.field}@{target}")
    return f"{len(edits)} edit{'s' if len(edits) != 1 else ''}: {'; '.join(parts)}"


async def _fetch_branch(pool: asyncpg.Pool, branch_id: UUID) -> asyncpg.Record:
    row = await pool.fetchrow(
        """
        select id, project_id, name, description, source_run_id,
               source_span_id, edits, replay_run_id, status,
               diff_summary, created_at, updated_at, replayed_at
          from studio_branch
         where id = $1
        """,
        branch_id,
    )
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "branch not found")
    return row


async def _assert_project_role(
    pool: asyncpg.Pool,
    principal: Principal,
    project_id: UUID,
    allowed: tuple[str, ...],
) -> UUID:
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
        allowed=allowed,
    )
    return workspace_id


def _branch_out(row: asyncpg.Record) -> StudioBranchOut:
    return StudioBranchOut(
        id=row["id"],
        project_id=row["project_id"],
        name=row["name"],
        description=row["description"],
        source_run_id=row["source_run_id"],
        source_span_id=row["source_span_id"],
        edits=_parse_edits(row["edits"]),
        replay_run_id=row["replay_run_id"],
        status=row["status"],
        diff_summary=row["diff_summary"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
        replayed_at=row["replayed_at"],
    )


def _parse_edits(raw: Any) -> list[StudioEdit]:
    data = raw
    if isinstance(raw, str):
        try:
            data = _json.loads(raw)
        except _json.JSONDecodeError:
            return []
    if not isinstance(data, list):
        return []
    out: list[StudioEdit] = []
    for entry in data:
        if not isinstance(entry, dict):
            continue
        try:
            out.append(StudioEdit(**entry))
        except Exception:  # noqa: BLE001
            continue
    return out
