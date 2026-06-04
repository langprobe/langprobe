"""Project CRUD.

A project is the unit of tenancy on the data plane: every run/span/eval row in
ClickHouse carries ``project_id`` and queries always filter on it. So the
control-plane CRUD here is also where sampling, PII redaction, and RCA mode
are configured for the entire data plane.
"""

from __future__ import annotations

from decimal import Decimal
from typing import Literal
from uuid import UUID

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field

from .. import audit
from ..auth import Principal, assert_workspace_role, require_user

router = APIRouter(prefix="/v1/projects", tags=["projects"])
workspaces_router = APIRouter(prefix="/v1/workspaces", tags=["workspaces"])

RcaMode = Literal["off", "errors_only", "errors_and_poor", "all"]


class WorkspaceOut(BaseModel):
    id: UUID
    slug: str
    name: str


@workspaces_router.get("", response_model=list[WorkspaceOut])
async def list_workspaces(
    request: Request,
    principal: Principal = Depends(require_user),
) -> list[WorkspaceOut]:
    """List the workspaces the current user is a member of.

    Used by the SSO config page to render the sign-in URL with the
    workspace slug. Slug is otherwise hidden from the project shape;
    surfacing it here keeps the projects router focused on projects.
    """
    pool: asyncpg.Pool = request.app.state.pg
    rows = await pool.fetch(
        """
        select w.id, w.slug, w.name
          from workspace w
          join workspace_member wm on wm.workspace_id = w.id
         where wm.user_id = $1
         order by w.name asc
        """,
        principal.user_id,
    )
    return [WorkspaceOut(id=r["id"], slug=r["slug"], name=r["name"]) for r in rows]


class ProjectOut(BaseModel):
    id: UUID
    workspace_id: UUID
    slug: str
    name: str
    sample_rate: float
    pii_redaction: bool
    eval_default_judge: str | None
    eval_cost_ceiling_usd_per_day: Decimal | None
    rca_mode: RcaMode


class ProjectCreate(BaseModel):
    workspace_id: UUID
    slug: str = Field(min_length=1, max_length=64, pattern=r"^[a-z0-9][a-z0-9_-]*$")
    name: str = Field(min_length=1, max_length=255)
    sample_rate: float = Field(default=1.0, ge=0.0, le=1.0)
    pii_redaction: bool = True
    eval_default_judge: str | None = None
    eval_cost_ceiling_usd_per_day: Decimal | None = None
    rca_mode: RcaMode = "errors_only"


class ProjectPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    sample_rate: float | None = Field(default=None, ge=0.0, le=1.0)
    pii_redaction: bool | None = None
    eval_default_judge: str | None = None
    eval_cost_ceiling_usd_per_day: Decimal | None = None
    rca_mode: RcaMode | None = None


@router.get("", response_model=list[ProjectOut])
async def list_projects(
    request: Request,
    principal: Principal = Depends(require_user),
) -> list[ProjectOut]:
    pool: asyncpg.Pool = request.app.state.pg
    rows = await pool.fetch(
        """
        select p.id, p.workspace_id, p.slug, p.name, p.sample_rate,
               p.pii_redaction, p.eval_default_judge,
               p.eval_cost_ceiling_usd_per_day, p.rca_mode
        from project p
        join workspace_member wm on wm.workspace_id = p.workspace_id
        where wm.user_id = $1
          and p.deleted_at is null
        order by p.created_at desc
        """,
        principal.user_id,
    )
    return [ProjectOut(**dict(r)) for r in rows]


@router.post("", response_model=ProjectOut, status_code=status.HTTP_201_CREATED)
async def create_project(
    request: Request,
    body: ProjectCreate,
    principal: Principal = Depends(require_user),
) -> ProjectOut:
    pool: asyncpg.Pool = request.app.state.pg
    await assert_workspace_role(
        pool,
        user_id=principal.user_id,
        workspace_id=body.workspace_id,
        allowed=("owner", "admin"),
    )
    try:
        row = await pool.fetchrow(
            """
            insert into project (
                workspace_id, slug, name, sample_rate, pii_redaction,
                eval_default_judge, eval_cost_ceiling_usd_per_day, rca_mode
            )
            values ($1, $2, $3, $4, $5, $6, $7, $8)
            returning id, workspace_id, slug, name, sample_rate, pii_redaction,
                      eval_default_judge, eval_cost_ceiling_usd_per_day, rca_mode
            """,
            body.workspace_id,
            body.slug,
            body.name,
            body.sample_rate,
            body.pii_redaction,
            body.eval_default_judge,
            body.eval_cost_ceiling_usd_per_day,
            body.rca_mode,
        )
    except asyncpg.UniqueViolationError as exc:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "project slug already exists in workspace"
        ) from exc
    assert row is not None
    project = ProjectOut(**dict(row))
    await audit.record(
        pool,
        principal=principal,
        action="project.create",
        target_kind="project",
        target_id=project.id,
        payload={"slug": project.slug, "name": project.name},
        request=request,
        workspace_id=project.workspace_id,
        project_id=project.id,
    )
    return project


@router.patch("/{project_id}", response_model=ProjectOut)
async def update_project(
    request: Request,
    project_id: UUID,
    body: ProjectPatch,
    principal: Principal = Depends(require_user),
) -> ProjectOut:
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
        allowed=("owner", "admin"),
    )

    updates = body.model_dump(exclude_unset=True)
    if not updates:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "no fields to update")
    set_fragments = ", ".join(f"{col} = ${i + 2}" for i, col in enumerate(updates.keys()))
    params: list[object] = [project_id, *updates.values()]
    row = await pool.fetchrow(
        f"""
        update project set {set_fragments}, updated_at = now()
        where id = $1
        returning id, workspace_id, slug, name, sample_rate, pii_redaction,
                  eval_default_judge, eval_cost_ceiling_usd_per_day, rca_mode
        """,
        *params,
    )
    assert row is not None
    project = ProjectOut(**dict(row))
    await audit.record(
        pool,
        principal=principal,
        action="project.update",
        target_kind="project",
        target_id=project.id,
        payload=updates,
        request=request,
        workspace_id=project.workspace_id,
        project_id=project.id,
    )
    return project
