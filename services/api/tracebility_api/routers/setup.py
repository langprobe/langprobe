"""First-run setup wizard.

The very first thing a self-hosted operator does is point a browser at
``/setup`` and create the root account. After that the endpoint is
inert: it 409s. We gate on ``select 1 from app_user limit 1`` rather
than a config flag so a half-completed init can be resumed without an
operator hand-editing rows.

What this creates in one transaction:
  - root :class:`app_user` (``is_root = true``)
  - default :class:`org` ("Default" / slug ``default``)
  - default :class:`workspace` ("Default" / slug ``default``)
  - one default :class:`project` ("Default" / slug ``default``)
  - org_member(owner) + workspace_member(admin) for the new user

Why a project is auto-created: the SDK quickstart hands the user an API
key in 30 seconds. Forcing them to navigate the workspace UI before
sending their first run defeats the wedge.
"""

from __future__ import annotations

import asyncpg
from fastapi import APIRouter, HTTPException, Request, Response, status
from pydantic import BaseModel, EmailStr, Field

from .. import audit
from ..auth import Principal, hash_password, issue_session_cookie
from ..config import Settings

router = APIRouter(prefix="/v1/setup", tags=["setup"])


class SetupStatus(BaseModel):
    needs_setup: bool


class SetupRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=12, max_length=256)
    name: str | None = Field(default=None, max_length=255)
    org_name: str = Field(default="Default", min_length=1, max_length=255)


class SetupResponse(BaseModel):
    user_id: str
    email: str
    org_id: str
    workspace_id: str
    project_id: str


async def _is_initialized(pool: asyncpg.Pool) -> bool:
    return bool(
        await pool.fetchval("select exists (select 1 from app_user)")
    )


@router.get("/status", response_model=SetupStatus)
async def setup_status(request: Request) -> SetupStatus:
    pool: asyncpg.Pool = request.app.state.pg
    return SetupStatus(needs_setup=not await _is_initialized(pool))


@router.post(
    "",
    response_model=SetupResponse,
    status_code=status.HTTP_201_CREATED,
)
async def setup(
    request: Request,
    body: SetupRequest,
    response: Response,
) -> SetupResponse:
    settings: Settings = request.app.state.settings
    pool: asyncpg.Pool = request.app.state.pg

    async with pool.acquire() as conn:
        async with conn.transaction():
            already = await conn.fetchval(
                "select exists (select 1 from app_user)"
            )
            if already:
                raise HTTPException(
                    status.HTTP_409_CONFLICT, "setup already completed"
                )

            user_row = await conn.fetchrow(
                """
                insert into app_user (email, name, password_hash, is_root)
                values ($1, $2, $3, true)
                returning id, email, is_root
                """,
                body.email,
                body.name,
                hash_password(body.password),
            )
            assert user_row is not None
            user_id = user_row["id"]

            org_row = await conn.fetchrow(
                """
                insert into org (slug, name) values ($1, $2)
                returning id
                """,
                "default",
                body.org_name,
            )
            assert org_row is not None
            org_id = org_row["id"]

            await conn.execute(
                """
                insert into org_member (org_id, user_id, role)
                values ($1, $2, 'owner')
                """,
                org_id,
                user_id,
            )

            workspace_row = await conn.fetchrow(
                """
                insert into workspace (org_id, slug, name)
                values ($1, 'default', 'Default')
                returning id
                """,
                org_id,
            )
            assert workspace_row is not None
            workspace_id = workspace_row["id"]

            await conn.execute(
                """
                insert into workspace_member (workspace_id, user_id, role)
                values ($1, $2, 'admin')
                """,
                workspace_id,
                user_id,
            )

            project_row = await conn.fetchrow(
                """
                insert into project (workspace_id, slug, name)
                values ($1, 'default', 'Default')
                returning id
                """,
                workspace_id,
            )
            assert project_row is not None
            project_id = project_row["id"]

    cookie_value = issue_session_cookie(settings, user_id)
    response.set_cookie(
        key=settings.session_cookie_name,
        value=cookie_value,
        httponly=True,
        secure=False,
        samesite="lax",
        max_age=settings.session_max_age_seconds,
    )

    await audit.record(
        pool,
        principal=Principal(
            user_id=user_id,
            email=user_row["email"],
            is_root=user_row["is_root"],
        ),
        action="setup.complete",
        target_kind="app_user",
        target_id=user_id,
        request=request,
        org_id=org_id,
        workspace_id=workspace_id,
        project_id=project_id,
        payload={"org_name": body.org_name},
    )

    return SetupResponse(
        user_id=str(user_id),
        email=user_row["email"],
        org_id=str(org_id),
        workspace_id=str(workspace_id),
        project_id=str(project_id),
    )
