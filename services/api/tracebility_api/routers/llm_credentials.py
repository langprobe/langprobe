"""Workspace-scoped LLM provider credentials.

CRUD over `workspace_llm_credential`. Plus a public dispatch helper
``resolve_secret(pool, workspace_id, provider) -> str | None`` that
playground / luna_judges / future comparisons + studio runners use to
prefer workspace creds over env.

V1 boundaries:
- Plaintext at rest. Column name (`secret_encrypted`) is the contract;
  swapping to KMS envelope is invisible to callers.
- Reveal-once on POST. We never echo the secret back; rotation is a
  new row. This matches how api_keys handle credentials elsewhere.
- The `name` field lets an operator have "prod" + "staging" keys per
  provider; resolution picks the most-recently-created active match.
- RBAC: list/get for any role; create/revoke for owner/admin only.
- Audit-fail-closed (ER-10) on every write.
"""

from __future__ import annotations

import os
from datetime import datetime
from typing import Any
from uuid import UUID

import asyncpg
import structlog
from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, Field

from .. import audit
from ..auth import Principal, assert_workspace_role, require_user

log = structlog.get_logger("tracebility.api.llm_credentials")

router = APIRouter(prefix="/v1/llm-credentials", tags=["llm-credentials"])

_VALID_PROVIDERS = {"anthropic", "openai"}


# ---------------------------------------------------------------------------
# Pydantic
# ---------------------------------------------------------------------------


class LLMCredentialOut(BaseModel):
    id: UUID
    workspace_id: UUID
    provider: str
    name: str
    secret_last4: str
    created_at: datetime
    updated_at: datetime
    revoked_at: datetime | None


class LLMCredentialCreated(LLMCredentialOut):
    plaintext: str = Field(
        description="Full secret, shown ONCE. Save it now.",
    )


class LLMCredentialCreate(BaseModel):
    provider: str = Field(min_length=1, max_length=16)
    name: str = Field(default="default", min_length=1, max_length=64)
    secret: str = Field(min_length=1, max_length=2048)


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@router.get("", response_model=list[LLMCredentialOut])
async def list_credentials(
    request: Request,
    workspace_id: UUID = Query(...),
    principal: Principal = Depends(require_user),
) -> list[LLMCredentialOut]:
    pool: asyncpg.Pool = request.app.state.pg
    await assert_workspace_role(
        pool,
        user_id=principal.user_id,
        workspace_id=workspace_id,
        allowed=("owner", "admin", "member", "viewer"),
    )
    rows = await pool.fetch(
        """
        select id, workspace_id, provider, name, secret_last4,
               created_at, updated_at, revoked_at
          from workspace_llm_credential
         where workspace_id = $1
         order by revoked_at nulls first, created_at desc
        """,
        workspace_id,
    )
    return [LLMCredentialOut(**dict(r)) for r in rows]


@router.post(
    "",
    response_model=LLMCredentialCreated,
    status_code=status.HTTP_201_CREATED,
)
async def create_credential(
    request: Request,
    body: LLMCredentialCreate,
    workspace_id: UUID = Query(...),
    principal: Principal = Depends(require_user),
) -> LLMCredentialCreated:
    if body.provider not in _VALID_PROVIDERS:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"provider must be one of {sorted(_VALID_PROVIDERS)}",
        )

    pool: asyncpg.Pool = request.app.state.pg
    await assert_workspace_role(
        pool,
        user_id=principal.user_id,
        workspace_id=workspace_id,
        allowed=("owner", "admin"),
    )

    last4 = body.secret[-4:] if len(body.secret) >= 4 else body.secret

    try:
        row = await pool.fetchrow(
            """
            insert into workspace_llm_credential (
                workspace_id, provider, name, secret_encrypted,
                secret_last4, created_by
            )
            values ($1, $2, $3, $4, $5, $6)
            returning id, workspace_id, provider, name, secret_last4,
                      created_at, updated_at, revoked_at
            """,
            workspace_id,
            body.provider,
            body.name,
            body.secret,
            last4,
            principal.user_id,
        )
    except asyncpg.UniqueViolationError as exc:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"a {body.provider} credential named '{body.name}' already exists; "
            "revoke the existing one first",
        ) from exc
    assert row is not None

    await audit.record(
        pool,
        principal=principal,
        action="llm_credential.create",
        target_kind="workspace_llm_credential",
        target_id=row["id"],
        payload={
            "provider": body.provider,
            "name": body.name,
            "secret_last4": last4,
        },
        request=request,
        workspace_id=workspace_id,
    )
    return LLMCredentialCreated(plaintext=body.secret, **dict(row))


@router.delete("/{credential_id}", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_credential(
    request: Request,
    credential_id: UUID,
    principal: Principal = Depends(require_user),
) -> None:
    pool: asyncpg.Pool = request.app.state.pg
    row = await pool.fetchrow(
        "select workspace_id, provider, name from workspace_llm_credential where id = $1",
        credential_id,
    )
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "credential not found")
    await assert_workspace_role(
        pool,
        user_id=principal.user_id,
        workspace_id=row["workspace_id"],
        allowed=("owner", "admin"),
    )
    await pool.execute(
        "update workspace_llm_credential set revoked_at = now() where id = $1 and revoked_at is null",
        credential_id,
    )
    await audit.record(
        pool,
        principal=principal,
        action="llm_credential.revoke",
        target_kind="workspace_llm_credential",
        target_id=credential_id,
        payload={"provider": row["provider"], "name": row["name"]},
        request=request,
        workspace_id=row["workspace_id"],
    )


# ---------------------------------------------------------------------------
# Public dispatch helper
# ---------------------------------------------------------------------------


async def resolve_secret(
    pool: asyncpg.Pool,
    *,
    workspace_id: UUID | None,
    provider: str,
) -> str | None:
    """Find an active secret for (workspace, provider).

    Lookup order:
      1. The most-recently-created active workspace credential.
      2. Env var for the provider (`ANTHROPIC_API_KEY` /
         `OPENAI_API_KEY`).
      3. None — caller decides whether that's fatal.

    Self-host single-tenant deployments don't need workspace creds;
    the env fallback keeps that path working unchanged.
    """
    if workspace_id is not None:
        try:
            row = await pool.fetchrow(
                """
                select secret_encrypted
                  from workspace_llm_credential
                 where workspace_id = $1
                   and provider = $2
                   and revoked_at is null
                 order by created_at desc
                 limit 1
                """,
                workspace_id,
                provider,
            )
            if row is not None and row["secret_encrypted"]:
                return str(row["secret_encrypted"])
        except asyncpg.PostgresError as exc:  # pragma: no cover
            log.warning(
                "credential lookup failed",
                workspace_id=str(workspace_id),
                provider=provider,
                error=str(exc),
            )

    env_key = {
        "anthropic": "ANTHROPIC_API_KEY",
        "openai": "OPENAI_API_KEY",
    }.get(provider)
    if env_key is None:
        return None
    return os.environ.get(env_key)
