"""Workspace membership: list members, invite, change role, remove, accept.

Membership lives in ``workspace_member`` (admin/member/viewer); invitations
sit in ``workspace_invitation`` until accepted (then a ``workspace_member``
row is inserted). The plaintext invitation token is ``ti_<public_id>.<secret>``
shown ONCE on create — same shape as ``api_key``. We argon2-hash the secret
half; the public_id is the lookup key.

RBAC:
- list members         -> admin | member | viewer
- list invitations     -> admin
- invite               -> admin
- set role             -> admin (cannot demote the last admin)
- remove member        -> admin (cannot remove the last admin)
- revoke invitation    -> admin
- accept invitation    -> any authenticated user whose email matches

Audit-fail-closed: every write goes through ``audit.record``. Per ER-20
revocation is immediate (the row is updated, no cache).
"""

from __future__ import annotations

import secrets
from datetime import datetime
from uuid import UUID

import asyncpg
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError
from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, EmailStr, Field

from .. import audit
from ..auth import Principal, assert_workspace_role, require_user

router = APIRouter(tags=["members"])

_PH = PasswordHasher()
_PUBLIC_ID_BYTES = 8  # 16 hex chars
_SECRET_BYTES = 32


def _generate_public_id() -> str:
    return secrets.token_hex(_PUBLIC_ID_BYTES)


def _generate_secret() -> str:
    return secrets.token_urlsafe(_SECRET_BYTES)


def _format_token(public_id: str, secret: str) -> str:
    return f"ti_{public_id}.{secret}"


def _parse_token(token: str) -> tuple[str, str]:
    if not token.startswith("ti_") or "." not in token:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "malformed invitation token")
    rest = token[3:]
    public_id, _, secret = rest.partition(".")
    if not public_id or not secret:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "malformed invitation token")
    return public_id, secret


class MemberOut(BaseModel):
    user_id: UUID
    email: str
    name: str | None
    role: str
    created_at: datetime


class InvitationOut(BaseModel):
    id: UUID
    workspace_id: UUID
    email: str
    role: str
    token_public_id: str
    invited_by: UUID | None
    created_at: datetime
    expires_at: datetime
    accepted_at: datetime | None
    revoked_at: datetime | None


class InviteCreate(BaseModel):
    email: EmailStr
    role: str = Field(pattern=r"^(admin|member|viewer)$")


class InviteCreateResponse(BaseModel):
    invitation: InvitationOut
    plaintext_token: str  # shown ONCE


class RolePatch(BaseModel):
    role: str = Field(pattern=r"^(admin|member|viewer)$")


class AcceptBody(BaseModel):
    token: str


async def _ensure_workspace_exists(pool: asyncpg.Pool, workspace_id: UUID) -> None:
    exists = await pool.fetchval(
        "select 1 from workspace where id = $1 and deleted_at is null",
        workspace_id,
    )
    if not exists:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "workspace not found")


async def _count_admins(conn: asyncpg.Connection, workspace_id: UUID) -> int:
    val = await conn.fetchval(
        "select count(*) from workspace_member where workspace_id = $1 and role = 'admin'",
        workspace_id,
    )
    return int(val or 0)


@router.get(
    "/v1/workspaces/{workspace_id}/members",
    response_model=list[MemberOut],
)
async def list_members(
    request: Request,
    workspace_id: UUID,
    principal: Principal = Depends(require_user),
) -> list[MemberOut]:
    pool: asyncpg.Pool = request.app.state.pg
    await _ensure_workspace_exists(pool, workspace_id)
    await assert_workspace_role(
        pool,
        user_id=principal.user_id,
        workspace_id=workspace_id,
        allowed=("admin", "member", "viewer"),
    )
    rows = await pool.fetch(
        """
        select wm.user_id, u.email, u.name, wm.role, wm.created_at
        from workspace_member wm
        join app_user u on u.id = wm.user_id
        where wm.workspace_id = $1 and u.deleted_at is null
        order by wm.created_at asc
        """,
        workspace_id,
    )
    return [MemberOut(**dict(r)) for r in rows]


@router.patch(
    "/v1/workspaces/{workspace_id}/members/{user_id}",
    response_model=MemberOut,
)
async def set_member_role(
    request: Request,
    workspace_id: UUID,
    user_id: UUID,
    body: RolePatch,
    principal: Principal = Depends(require_user),
) -> MemberOut:
    pool: asyncpg.Pool = request.app.state.pg
    await _ensure_workspace_exists(pool, workspace_id)
    await assert_workspace_role(
        pool,
        user_id=principal.user_id,
        workspace_id=workspace_id,
        allowed=("admin",),
    )
    async with pool.acquire() as conn, conn.transaction():
        current = await conn.fetchval(
            "select role from workspace_member where workspace_id = $1 and user_id = $2 for update",
            workspace_id,
            user_id,
        )
        if current is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "member not found")
        if current == "admin" and body.role != "admin":
            admins = await _count_admins(conn, workspace_id)
            if admins <= 1:
                raise HTTPException(
                    status.HTTP_409_CONFLICT,
                    "cannot demote the last admin",
                )
        row = await conn.fetchrow(
            """
                update workspace_member set role = $3
                where workspace_id = $1 and user_id = $2
                returning user_id, role, created_at
                """,
            workspace_id,
            user_id,
            body.role,
        )
        assert row is not None
        user_row = await conn.fetchrow(
            "select email, name from app_user where id = $1",
            user_id,
        )
        assert user_row is not None
    member = MemberOut(
        user_id=user_id,
        email=user_row["email"],
        name=user_row["name"],
        role=row["role"],
        created_at=row["created_at"],
    )
    await audit.record(
        pool,
        principal=principal,
        action="member.set_role",
        target_kind="workspace_member",
        target_id=user_id,
        payload={"role": body.role},
        request=request,
        workspace_id=workspace_id,
    )
    return member


@router.delete(
    "/v1/workspaces/{workspace_id}/members/{user_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def remove_member(
    request: Request,
    workspace_id: UUID,
    user_id: UUID,
    principal: Principal = Depends(require_user),
) -> None:
    pool: asyncpg.Pool = request.app.state.pg
    await _ensure_workspace_exists(pool, workspace_id)
    await assert_workspace_role(
        pool,
        user_id=principal.user_id,
        workspace_id=workspace_id,
        allowed=("admin",),
    )
    async with pool.acquire() as conn, conn.transaction():
        current = await conn.fetchval(
            "select role from workspace_member where workspace_id = $1 and user_id = $2 for update",
            workspace_id,
            user_id,
        )
        if current is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "member not found")
        if current == "admin":
            admins = await _count_admins(conn, workspace_id)
            if admins <= 1:
                raise HTTPException(
                    status.HTTP_409_CONFLICT,
                    "cannot remove the last admin",
                )
        await conn.execute(
            "delete from workspace_member where workspace_id = $1 and user_id = $2",
            workspace_id,
            user_id,
        )
    await audit.record(
        pool,
        principal=principal,
        action="member.remove",
        target_kind="workspace_member",
        target_id=user_id,
        request=request,
        workspace_id=workspace_id,
    )


@router.get(
    "/v1/workspaces/{workspace_id}/invitations",
    response_model=list[InvitationOut],
)
async def list_invitations(
    request: Request,
    workspace_id: UUID,
    principal: Principal = Depends(require_user),
) -> list[InvitationOut]:
    pool: asyncpg.Pool = request.app.state.pg
    await _ensure_workspace_exists(pool, workspace_id)
    await assert_workspace_role(
        pool,
        user_id=principal.user_id,
        workspace_id=workspace_id,
        allowed=("admin",),
    )
    rows = await pool.fetch(
        """
        select id, workspace_id, email, role, token_public_id, invited_by,
               created_at, expires_at, accepted_at, revoked_at
        from workspace_invitation
        where workspace_id = $1
        order by created_at desc
        """,
        workspace_id,
    )
    return [InvitationOut(**dict(r)) for r in rows]


@router.post(
    "/v1/workspaces/{workspace_id}/invitations",
    response_model=InviteCreateResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_invitation(
    request: Request,
    workspace_id: UUID,
    body: InviteCreate,
    principal: Principal = Depends(require_user),
) -> InviteCreateResponse:
    pool: asyncpg.Pool = request.app.state.pg
    await _ensure_workspace_exists(pool, workspace_id)
    await assert_workspace_role(
        pool,
        user_id=principal.user_id,
        workspace_id=workspace_id,
        allowed=("admin",),
    )
    email = str(body.email).lower()

    already = await pool.fetchval(
        """
        select 1 from workspace_member wm
        join app_user u on u.id = wm.user_id
        where wm.workspace_id = $1 and lower(u.email) = $2
        """,
        workspace_id,
        email,
    )
    if already:
        raise HTTPException(status.HTTP_409_CONFLICT, "user is already a member of this workspace")

    public_id = _generate_public_id()
    secret = _generate_secret()
    token_hash = _PH.hash(secret)
    plaintext = _format_token(public_id, secret)

    row = await pool.fetchrow(
        """
        insert into workspace_invitation (
            workspace_id, email, role, token_hash, token_public_id, invited_by
        )
        values ($1, $2, $3, $4, $5, $6)
        returning id, workspace_id, email, role, token_public_id, invited_by,
                  created_at, expires_at, accepted_at, revoked_at
        """,
        workspace_id,
        email,
        body.role,
        token_hash,
        public_id,
        principal.user_id,
    )
    assert row is not None
    invitation = InvitationOut(**dict(row))
    await audit.record(
        pool,
        principal=principal,
        action="invitation.create",
        target_kind="workspace_invitation",
        target_id=invitation.id,
        payload={"email": email, "role": body.role},
        request=request,
        workspace_id=workspace_id,
    )
    return InviteCreateResponse(invitation=invitation, plaintext_token=plaintext)


@router.delete(
    "/v1/workspaces/{workspace_id}/invitations/{invitation_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def revoke_invitation(
    request: Request,
    workspace_id: UUID,
    invitation_id: UUID,
    principal: Principal = Depends(require_user),
) -> None:
    pool: asyncpg.Pool = request.app.state.pg
    await _ensure_workspace_exists(pool, workspace_id)
    await assert_workspace_role(
        pool,
        user_id=principal.user_id,
        workspace_id=workspace_id,
        allowed=("admin",),
    )
    row = await pool.fetchrow(
        """
        update workspace_invitation
        set revoked_at = now()
        where id = $1
          and workspace_id = $2
          and accepted_at is null
          and revoked_at is null
        returning id
        """,
        invitation_id,
        workspace_id,
    )
    if row is None:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND,
            "invitation not found or already accepted/revoked",
        )
    await audit.record(
        pool,
        principal=principal,
        action="invitation.revoke",
        target_kind="workspace_invitation",
        target_id=invitation_id,
        request=request,
        workspace_id=workspace_id,
    )


@router.post(
    "/v1/invitations/accept",
    response_model=MemberOut,
)
async def accept_invitation(
    request: Request,
    body: AcceptBody,
    principal: Principal = Depends(require_user),
) -> MemberOut:
    pool: asyncpg.Pool = request.app.state.pg
    public_id, secret = _parse_token(body.token)

    row = await pool.fetchrow(
        """
        select id, workspace_id, email, role, token_hash, expires_at,
               accepted_at, revoked_at
        from workspace_invitation
        where token_public_id = $1
        """,
        public_id,
    )
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "invitation not found")
    if row["revoked_at"] is not None:
        raise HTTPException(status.HTTP_410_GONE, "invitation revoked")
    if row["accepted_at"] is not None:
        raise HTTPException(status.HTTP_410_GONE, "invitation already accepted")
    if row["expires_at"] < datetime.now(row["expires_at"].tzinfo):
        raise HTTPException(status.HTTP_410_GONE, "invitation expired")
    try:
        _PH.verify(row["token_hash"], secret)
    except VerifyMismatchError as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid invitation token") from exc

    if principal.email.lower() != row["email"].lower():
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "this invitation was issued for a different email",
        )

    workspace_id: UUID = row["workspace_id"]
    role: str = row["role"]
    invitation_id: UUID = row["id"]

    async with pool.acquire() as conn, conn.transaction():
        await conn.execute(
            """
                insert into workspace_member (workspace_id, user_id, role)
                values ($1, $2, $3)
                on conflict (workspace_id, user_id) do update set role = excluded.role
                """,
            workspace_id,
            principal.user_id,
            role,
        )
        await conn.execute(
            """
                update workspace_invitation
                set accepted_at = now(), accepted_by = $2
                where id = $1
                """,
            invitation_id,
            principal.user_id,
        )
        member_row = await conn.fetchrow(
            """
                select wm.user_id, u.email, u.name, wm.role, wm.created_at
                from workspace_member wm
                join app_user u on u.id = wm.user_id
                where wm.workspace_id = $1 and wm.user_id = $2
                """,
            workspace_id,
            principal.user_id,
        )
        assert member_row is not None

    await audit.record(
        pool,
        principal=principal,
        action="invitation.accept",
        target_kind="workspace_invitation",
        target_id=invitation_id,
        payload={"role": role},
        request=request,
        workspace_id=workspace_id,
    )
    return MemberOut(**dict(member_row))
