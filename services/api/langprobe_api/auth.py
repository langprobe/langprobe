"""Session-cookie auth + RBAC helpers for the control-plane API.

Session cookie: signed by ``itsdangerous.URLSafeTimedSerializer`` with the
``session_secret`` from config. Payload is just ``{"uid": str(user_id),
"iat": unix_ts}``. We re-fetch the user row on every request so revocations
take effect within the next request, not the next session.

Per ER-09 we fail closed if Postgres is unreachable: 503 here, not 200 with a
'maybe' user. RBAC checks are also database-backed (no cached principals).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Final, Literal
from uuid import UUID

import asyncpg
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError
from fastapi import Cookie, HTTPException, Request, status
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer

from .config import Settings

_PH: Final = PasswordHasher()

OrgRole = Literal["owner", "admin", "member", "viewer"]
WorkspaceRole = Literal["owner", "admin", "member", "viewer"]


@dataclass(frozen=True)
class Principal:
    user_id: UUID
    email: str
    is_root: bool


def _signer(settings: Settings) -> URLSafeTimedSerializer:
    return URLSafeTimedSerializer(settings.session_secret, salt="langprobe-session-v1")


def issue_session_cookie(settings: Settings, user_id: UUID) -> str:
    return _signer(settings).dumps({"uid": str(user_id), "iat": int(datetime.now(UTC).timestamp())})


def verify_password(stored_hash: str, plain: str) -> bool:
    try:
        _PH.verify(stored_hash, plain)
        return True
    except VerifyMismatchError:
        return False


def hash_password(plain: str) -> str:
    return _PH.hash(plain)


async def require_user(
    request: Request,
    session_cookie: str | None = Cookie(default=None, alias="langprobe_session"),
) -> Principal:
    settings: Settings = request.app.state.settings
    if not session_cookie:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "not authenticated")
    try:
        payload = _signer(settings).loads(session_cookie, max_age=settings.session_max_age_seconds)
    except SignatureExpired as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "session expired") from exc
    except BadSignature as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid session") from exc
    try:
        user_id = UUID(payload["uid"])
    except (KeyError, ValueError) as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid session") from exc

    pool: asyncpg.Pool = request.app.state.pg
    try:
        row = await pool.fetchrow(
            "select id, email, is_root, deleted_at from app_user where id = $1",
            user_id,
        )
    except (asyncpg.PostgresError, OSError) as exc:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE, "auth backend unavailable"
        ) from exc
    if row is None or row["deleted_at"] is not None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "user not found")
    return Principal(user_id=row["id"], email=row["email"], is_root=row["is_root"])


async def assert_org_role(
    pool: asyncpg.Pool,
    *,
    user_id: UUID,
    org_id: UUID,
    allowed: tuple[OrgRole, ...],
) -> OrgRole:
    try:
        role = await pool.fetchval(
            "select role from org_member where org_id = $1 and user_id = $2",
            org_id,
            user_id,
        )
    except (asyncpg.PostgresError, OSError) as exc:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE, "rbac backend unavailable"
        ) from exc
    if role is None or role not in allowed:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "insufficient role")
    return role  # type: ignore[return-value]


async def assert_workspace_role(
    pool: asyncpg.Pool,
    *,
    user_id: UUID,
    workspace_id: UUID,
    allowed: tuple[WorkspaceRole, ...],
) -> WorkspaceRole:
    try:
        role = await pool.fetchval(
            "select role from workspace_member where workspace_id = $1 and user_id = $2",
            workspace_id,
            user_id,
        )
    except (asyncpg.PostgresError, OSError) as exc:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE, "rbac backend unavailable"
        ) from exc
    if role is None or role not in allowed:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "insufficient role")
    return role  # type: ignore[return-value]
