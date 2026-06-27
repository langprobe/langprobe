"""API-key auth for ingest. Format: ``lt_<public_id>.<secret>``.

Postgres stores `public_id` (lookup key) and `secret_hash` (argon2id of secret).
Per ER-09: if Postgres is unreachable we fail closed (401), never bypass.
Per ER-20: revoked keys 401 immediately.

The resolved tuple is the ``TenantContext`` from ``langprobe_tenant`` —
the same type ingest-worker / api / eval-orchestrator use. We keep
``AuthContext`` as a thin alias so existing imports continue to work.
"""

from __future__ import annotations

from typing import Final

import asyncpg
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError
from fastapi import Header, HTTPException, Request, status
from langprobe_tenant import Resolver, TenantContext
from langprobe_tenant.resolver import ResolverInvalidKey, ResolverUnavailable

_PH: Final = PasswordHasher()

# Backwards-compat alias. Routers that currently import ``AuthContext`` will
# transparently get a ``TenantContext`` (which carries workspace_id + plan).
AuthContext = TenantContext


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
) -> TenantContext:
    raw = x_api_key
    if raw is None and authorization and authorization.lower().startswith("bearer "):
        raw = authorization[len("Bearer ") :].strip()
    if not raw:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "missing api key")

    public_id, secret = _split_key(raw)

    # Resolver covers project/workspace/org/plan/scopes lookup with Redis cache.
    # We still need the per-key ``secret_hash`` to verify the secret, which the
    # resolver intentionally does not cache (it's argon2 — verification cost is
    # the point). One small pg lookup per cache miss + one per request.
    resolver: Resolver = request.app.state.resolver
    pool: asyncpg.Pool = request.app.state.pg

    try:
        ctx = await resolver.resolve(public_id)
    except ResolverInvalidKey as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid api key") from exc
    except ResolverUnavailable as exc:
        # ER-09: fail closed
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "auth backend unavailable") from exc

    try:
        secret_row = await pool.fetchrow(
            "select secret_hash from api_key where id = $1",
            ctx.api_key_id,
        )
    except (asyncpg.PostgresError, OSError) as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "auth backend unavailable") from exc

    if secret_row is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid api key")

    try:
        _PH.verify(secret_row["secret_hash"], secret)
    except VerifyMismatchError as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid api key") from exc

    return ctx
