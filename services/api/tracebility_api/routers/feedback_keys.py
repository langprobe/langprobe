"""Feedback public-key management.

Public keys (`tbf_pub_<32 hex>`) authorize browser-side feedback POSTs to
`POST /v1/feedback`. Unlike `api_key`, they are write-only and have no
secret half — possession of the key is the credential, scoped to one
project, rate-limited at the edge, and revocable instantly per ER-20.

Boundaries
- list/get for any role on the project; create/revoke = owner/admin only.
- Keys returned to the browser only once at creation (just like `api_key`).
- Audit-fail-closed (ER-10) on every write through `audit.record`.
"""

from __future__ import annotations

import secrets
from datetime import datetime
from uuid import UUID

import asyncpg
import structlog
from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, Field

from .. import audit
from ..auth import Principal, assert_workspace_role, require_user

log = structlog.get_logger("tracebility.api.feedback_keys")

router = APIRouter(prefix="/v1/feedback-keys", tags=["feedback"])

_PUBLIC_ID_BYTES = 16  # 32 hex chars — no secret half, so make it long


def _generate_public_id() -> str:
    return secrets.token_hex(_PUBLIC_ID_BYTES)


class FeedbackKeyOut(BaseModel):
    id: UUID
    project_id: UUID
    public_id: str
    name: str | None
    allowed_origins: list[str]
    last_used_at: datetime | None
    revoked_at: datetime | None
    created_at: datetime


class FeedbackKeyCreate(BaseModel):
    project_id: UUID
    name: str = Field(min_length=1, max_length=128)
    allowed_origins: list[str] = Field(default_factory=list, max_length=32)


class FeedbackKeyCreateResponse(BaseModel):
    key: FeedbackKeyOut
    plaintext_key: str  # shown ONCE; format `tbf_pub_<public_id>`


@router.get("", response_model=list[FeedbackKeyOut])
async def list_feedback_keys(
    request: Request,
    project_id: UUID = Query(...),
    principal: Principal = Depends(require_user),
) -> list[FeedbackKeyOut]:
    pool: asyncpg.Pool = request.app.state.pg
    await _assert_project_role(
        pool,
        project_id,
        principal,
        allowed=("owner", "admin", "member", "viewer"),
    )
    rows = await pool.fetch(
        """
        select id, project_id, public_id, name, allowed_origins,
               last_used_at, revoked_at, created_at
        from feedback_public_key
        where project_id = $1
        order by created_at desc
        """,
        project_id,
    )
    return [FeedbackKeyOut(**dict(r)) for r in rows]


@router.post(
    "",
    response_model=FeedbackKeyCreateResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_feedback_key(
    request: Request,
    body: FeedbackKeyCreate,
    principal: Principal = Depends(require_user),
) -> FeedbackKeyCreateResponse:
    pool: asyncpg.Pool = request.app.state.pg
    workspace_id = await _assert_project_role(
        pool,
        body.project_id,
        principal,
        allowed=("owner", "admin"),
    )
    # very light origin sanity — full URL parsing is overkill for an allowlist
    cleaned_origins: list[str] = []
    for o in body.allowed_origins:
        s = o.strip()
        if not s:
            continue
        if len(s) > 255:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "origin too long (max 255 chars)",
            )
        cleaned_origins.append(s)

    public_id = _generate_public_id()
    plaintext = f"tbf_pub_{public_id}"

    row = await pool.fetchrow(
        """
        insert into feedback_public_key (
            project_id, public_id, name, allowed_origins, created_by
        )
        values ($1, $2, $3, $4, $5)
        returning id, project_id, public_id, name, allowed_origins,
                  last_used_at, revoked_at, created_at
        """,
        body.project_id,
        public_id,
        body.name,
        cleaned_origins,
        principal.user_id,
    )
    assert row is not None
    key = FeedbackKeyOut(**dict(row))
    await audit.record(
        pool,
        principal=principal,
        action="feedback_key.create",
        target_kind="feedback_public_key",
        target_id=key.id,
        payload={
            "name": key.name,
            "allowed_origins": key.allowed_origins,
        },
        request=request,
        workspace_id=workspace_id,
        project_id=key.project_id,
    )
    return FeedbackKeyCreateResponse(key=key, plaintext_key=plaintext)


@router.delete("/{key_id}", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_feedback_key(
    request: Request,
    key_id: UUID,
    principal: Principal = Depends(require_user),
) -> None:
    pool: asyncpg.Pool = request.app.state.pg
    row = await pool.fetchrow(
        """
        select feedback_public_key.project_id, project.workspace_id
        from feedback_public_key
        join project on project.id = feedback_public_key.project_id
        where feedback_public_key.id = $1
          and feedback_public_key.revoked_at is null
        """,
        key_id,
    )
    if row is None:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND,
            "feedback key not found or already revoked",
        )
    await assert_workspace_role(
        pool,
        user_id=principal.user_id,
        workspace_id=row["workspace_id"],
        allowed=("owner", "admin"),
    )
    await pool.execute(
        "update feedback_public_key set revoked_at = now() where id = $1",
        key_id,
    )
    await audit.record(
        pool,
        principal=principal,
        action="feedback_key.revoke",
        target_kind="feedback_public_key",
        target_id=key_id,
        request=request,
        workspace_id=row["workspace_id"],
        project_id=row["project_id"],
    )


# ----- helpers -------------------------------------------------------------


async def _assert_project_role(
    pool: asyncpg.Pool,
    project_id: UUID,
    principal: Principal,
    *,
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
