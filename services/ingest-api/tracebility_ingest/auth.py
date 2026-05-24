"""API-key auth for ingest. Format: ``lt_<public_id>.<secret>``.

Postgres stores `public_id` (lookup key) and `secret_hash` (argon2id of secret).
Per ER-09: if Postgres is unreachable we fail closed (401), never bypass.
Per ER-20: revoked keys 401 immediately.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Final
from uuid import UUID

import asyncpg
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError
from fastapi import Header, HTTPException, Request, status

_PH: Final = PasswordHasher()


@dataclass(frozen=True)
class AuthContext:
    project_id: UUID
    org_id: UUID
    api_key_id: UUID
    scopes: tuple[str, ...]


def _split_key(raw: str) -> tuple[str, str]:
    if not raw.startswith("lt_"):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid api key format")
    body = raw[len("lt_") :]
    if "." not in body:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid api key format")
    public_id, _, secret = body.partition(".")
    if not public_id or not secret:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid api key format")
    return public_id, secret


async def require_ingest_key(
    request: Request,
    authorization: str | None = Header(default=None),
    x_api_key: str | None = Header(default=None, alias="X-Api-Key"),
) -> AuthContext:
    raw = x_api_key
    if raw is None and authorization and authorization.lower().startswith("bearer "):
        raw = authorization[len("Bearer ") :].strip()
    if not raw:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "missing api key")

    public_id, secret = _split_key(raw)
    pool: asyncpg.Pool = request.app.state.pg
    try:
        row = await pool.fetchrow(
            """
            select api_key.id as api_key_id,
                   api_key.project_id,
                   workspace.org_id,
                   api_key.secret_hash,
                   api_key.scopes,
                   api_key.revoked_at,
                   api_key.expires_at
            from api_key
            join project on project.id = api_key.project_id
            join workspace on workspace.id = project.workspace_id
            where api_key.public_id = $1
            """,
            public_id,
        )
    except (asyncpg.PostgresError, OSError) as exc:
        # ER-09: fail closed if pg unreachable; never bypass
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED, "auth backend unavailable"
        ) from exc

    if row is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid api key")
    if row["revoked_at"] is not None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "key revoked")
    if row["expires_at"] is not None and row["expires_at"] < datetime.now(UTC):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "key expired")

    try:
        _PH.verify(row["secret_hash"], secret)
    except VerifyMismatchError as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid api key") from exc

    return AuthContext(
        project_id=row["project_id"],
        org_id=row["org_id"],
        api_key_id=row["api_key_id"],
        scopes=tuple(row["scopes"]),
    )
