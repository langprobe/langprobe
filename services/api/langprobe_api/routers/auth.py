"""Login, logout, /me.

Login is rate-limit-naive in this skeleton; a future phase wires Redis
buckets. Audit log captures both success and failure (ER-10) so brute force
is observable from day one.
"""

from __future__ import annotations

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel, EmailStr

from .. import audit
from ..auth import (
    Principal,
    issue_session_cookie,
    require_user,
    verify_password,
)
from ..config import Settings

router = APIRouter(prefix="/v1/auth", tags=["auth"])


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class MeResponse(BaseModel):
    user_id: str
    email: str
    is_root: bool


@router.post("/login", status_code=status.HTTP_200_OK, response_model=MeResponse)
async def login(
    request: Request,
    body: LoginRequest,
    response: Response,
) -> MeResponse:
    settings: Settings = request.app.state.settings
    pool: asyncpg.Pool = request.app.state.pg
    try:
        row = await pool.fetchrow(
            """
            select id, email, password_hash, is_root, deleted_at
            from app_user
            where email = $1
            """,
            body.email,
        )
    except (asyncpg.PostgresError, OSError) as exc:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE, "auth backend unavailable"
        ) from exc

    if (
        row is None
        or row["deleted_at"] is not None
        or row["password_hash"] is None
        or not verify_password(row["password_hash"], body.password)
    ):
        await audit.record(
            pool,
            principal=None,
            action="auth.login.failure",
            target_kind="app_user",
            target_id=None,
            payload={"email": body.email},
            request=request,
        )
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid credentials")

    cookie_value = issue_session_cookie(settings, row["id"])
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
        principal=Principal(user_id=row["id"], email=row["email"], is_root=row["is_root"]),
        action="auth.login.success",
        target_kind="app_user",
        target_id=row["id"],
        request=request,
    )
    return MeResponse(
        user_id=str(row["id"]),
        email=row["email"],
        is_root=row["is_root"],
    )


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(
    request: Request,
    response: Response,
    principal: Principal = Depends(require_user),
) -> Response:
    settings: Settings = request.app.state.settings
    pool: asyncpg.Pool = request.app.state.pg
    response.delete_cookie(settings.session_cookie_name)
    await audit.record(
        pool,
        principal=principal,
        action="auth.logout",
        target_kind="app_user",
        target_id=principal.user_id,
        request=request,
    )
    return response


@router.get("/me", response_model=MeResponse)
async def me(principal: Principal = Depends(require_user)) -> MeResponse:
    return MeResponse(
        user_id=str(principal.user_id),
        email=principal.email,
        is_root=principal.is_root,
    )
