"""Prompts CRUD + versions.

A prompt is a versioned template; every save mints a new immutable
`prompt_version` row. Aliases like `@prod` / `@staging` are stored on
the version (postgres `text[]`) and are unique-per-prompt — moving an
alias re-points the SDK without a redeploy.

Boundaries:
- All state lives in postgres; ClickHouse is not in this path.
- A delete on the parent prompt is a soft delete (`deleted_at`); versions
  stay so audit trails and historical run links don't break (ER-23).
- Audit-fail-closed (ER-10): every write records `audit_log` in-band.
- RBAC: list/get for any role; create/update/version-create for owner/
  admin/member; delete prompt for owner/admin only.
"""

from __future__ import annotations

import json as _json
import re
from datetime import datetime
from typing import Any, Literal
from uuid import UUID

import asyncpg
import structlog
from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from pydantic import BaseModel, Field, model_validator

from .. import audit
from ..auth import Principal, assert_workspace_role, require_user

log = structlog.get_logger("langprobe.api.prompts")

router = APIRouter(prefix="/v1/prompts", tags=["prompts"])

_ALIAS_RE = re.compile(r"^[a-z0-9][a-z0-9_-]*$")


class PromptOut(BaseModel):
    id: UUID
    project_id: UUID
    slug: str
    name: str
    description: str | None
    latest_version: int | None
    version_count: int
    aliases: list[str]
    created_at: datetime
    updated_at: datetime


class PromptCreate(BaseModel):
    project_id: UUID
    slug: str = Field(min_length=1, max_length=64, pattern=r"^[a-z0-9][a-z0-9_-]*$")
    name: str = Field(min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=2000)


class PromptPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=2000)


class Message(BaseModel):
    """A single typed message in a prompt template.

    v1 supports `system` and `human` roles. AI / tool / output_schema are
    deferred — see the spec for the rationale and the deferral triggers.
    The content is a Jinja `{{ var }}` template; substitution happens at
    render time on the playground / dispatch path.
    """

    role: Literal["system", "human"]
    content: str


class PromptVersionOut(BaseModel):
    id: UUID
    prompt_id: UUID
    version: int
    template_messages: list[Message]
    # Legacy single-string field. Populated for back-compat with clients
    # written before plan B lands. Derived from `template_messages` when
    # the version is exactly one human message; otherwise empty string.
    # Drop after one release per the migration cleanup plan.
    template: str
    input_schema: dict[str, Any] | None
    model_params: dict[str, Any] | None
    aliases: list[str]
    commit_message: str | None
    created_at: datetime


class PromptVersionList(BaseModel):
    versions: list[PromptVersionOut]


class PromptVersionCreate(BaseModel):
    """Body for POST /v1/prompts/{prompt_id}/versions.

    Exactly one of `template_messages` (preferred, structured) and
    `template` (legacy single-string) must be provided. The legacy
    field stays for one release of back-compat; it wraps to a single
    human message internally before write.
    """

    template_messages: list[Message] | None = Field(default=None, min_length=1)
    template: str | None = Field(default=None, min_length=1)
    input_schema: dict[str, Any] | None = None
    model_params: dict[str, Any] | None = None
    aliases: list[str] = Field(default_factory=list)
    commit_message: str | None = Field(default=None, max_length=2000)

    @model_validator(mode="after")
    def _exactly_one_template_source(self) -> PromptVersionCreate:
        n = sum(
            [
                self.template_messages is not None,
                self.template is not None,
            ]
        )
        if n == 0:
            raise ValueError("one of template, template_messages is required")
        if n > 1:
            raise ValueError(
                "template and template_messages are mutually exclusive; provide exactly one"
            )
        return self

    def to_messages(self) -> list[Message]:
        """Resolve to the canonical list-of-messages form for storage."""
        if self.template_messages is not None:
            return self.template_messages
        assert self.template is not None  # validated above
        return [Message(role="human", content=self.template)]


class AliasUpdate(BaseModel):
    alias: str = Field(min_length=1, max_length=64, pattern=r"^[a-z0-9][a-z0-9_-]*$")
    version: int = Field(ge=1)


@router.get("", response_model=list[PromptOut])
async def list_prompts(
    request: Request,
    project_id: UUID = Query(...),
    principal: Principal = Depends(require_user),
) -> list[PromptOut]:
    pool: asyncpg.Pool = request.app.state.pg
    await _assert_project_role(
        pool,
        project_id,
        principal,
        allowed=("owner", "admin", "member", "viewer"),
    )
    rows = await pool.fetch(
        """
        select
            p.id, p.project_id, p.slug, p.name, p.description,
            p.created_at, p.updated_at,
            (
                select max(version) from prompt_version pv
                where pv.prompt_id = p.id
            ) as latest_version,
            (
                select count(*) from prompt_version pv
                where pv.prompt_id = p.id
            ) as version_count,
            coalesce(
                (
                    select array_agg(distinct a)
                    from prompt_version pv, unnest(pv.aliases) a
                    where pv.prompt_id = p.id
                ),
                array[]::text[]
            ) as aliases
        from prompt p
        where p.project_id = $1 and p.deleted_at is null
        order by p.created_at desc
        """,
        project_id,
    )
    return [PromptOut(**dict(r)) for r in rows]


@router.post("", response_model=PromptOut, status_code=status.HTTP_201_CREATED)
async def create_prompt(
    request: Request,
    body: PromptCreate,
    principal: Principal = Depends(require_user),
) -> PromptOut:
    pool: asyncpg.Pool = request.app.state.pg
    workspace_id = await _assert_project_role(
        pool,
        body.project_id,
        principal,
        allowed=("owner", "admin", "member"),
    )
    try:
        row = await pool.fetchrow(
            """
            insert into prompt (project_id, slug, name, description, created_by)
            values ($1, $2, $3, $4, $5)
            returning id, project_id, slug, name, description, created_at, updated_at
            """,
            body.project_id,
            body.slug,
            body.name,
            body.description,
            principal.user_id,
        )
    except asyncpg.UniqueViolationError as exc:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "prompt slug already exists in project"
        ) from exc
    assert row is not None
    prompt = PromptOut(latest_version=None, version_count=0, aliases=[], **dict(row))
    await audit.record(
        pool,
        principal=principal,
        action="prompt.create",
        target_kind="prompt",
        target_id=prompt.id,
        payload={"slug": prompt.slug, "name": prompt.name},
        request=request,
        workspace_id=workspace_id,
        project_id=prompt.project_id,
    )
    return prompt


@router.get("/{prompt_id}", response_model=PromptOut)
async def get_prompt(
    request: Request,
    prompt_id: UUID,
    principal: Principal = Depends(require_user),
) -> PromptOut:
    pool: asyncpg.Pool = request.app.state.pg
    row = await _fetch_prompt_full(pool, prompt_id)
    await _assert_project_role(
        pool,
        row["project_id"],
        principal,
        allowed=("owner", "admin", "member", "viewer"),
    )
    return PromptOut(**dict(row))


@router.patch("/{prompt_id}", response_model=PromptOut)
async def update_prompt(
    request: Request,
    prompt_id: UUID,
    body: PromptPatch,
    principal: Principal = Depends(require_user),
) -> PromptOut:
    pool: asyncpg.Pool = request.app.state.pg
    existing = await _fetch_prompt_row(pool, prompt_id)
    workspace_id = await _assert_project_role(
        pool,
        existing["project_id"],
        principal,
        allowed=("owner", "admin", "member"),
    )
    updates = body.model_dump(exclude_unset=True)
    if not updates:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "no fields to update")
    set_fragments = ", ".join(f"{col} = ${i + 2}" for i, col in enumerate(updates.keys()))
    params: list[object] = [prompt_id, *updates.values()]
    await pool.execute(
        f"update prompt set {set_fragments}, updated_at = now() where id = $1",
        *params,
    )
    full = await _fetch_prompt_full(pool, prompt_id)
    await audit.record(
        pool,
        principal=principal,
        action="prompt.update",
        target_kind="prompt",
        target_id=prompt_id,
        payload=updates,
        request=request,
        workspace_id=workspace_id,
        project_id=existing["project_id"],
    )
    return PromptOut(**dict(full))


@router.delete("/{prompt_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_prompt(
    request: Request,
    prompt_id: UUID,
    principal: Principal = Depends(require_user),
) -> None:
    pool: asyncpg.Pool = request.app.state.pg
    existing = await _fetch_prompt_row(pool, prompt_id)
    workspace_id = await _assert_project_role(
        pool,
        existing["project_id"],
        principal,
        allowed=("owner", "admin"),
    )
    await pool.execute(
        "update prompt set deleted_at = now(), updated_at = now() where id = $1",
        prompt_id,
    )
    await audit.record(
        pool,
        principal=principal,
        action="prompt.delete",
        target_kind="prompt",
        target_id=prompt_id,
        payload={"slug": existing["slug"]},
        request=request,
        workspace_id=workspace_id,
        project_id=existing["project_id"],
    )


@router.get("/{prompt_id}/versions", response_model=PromptVersionList)
async def list_versions(
    request: Request,
    prompt_id: UUID,
    principal: Principal = Depends(require_user),
) -> PromptVersionList:
    pool: asyncpg.Pool = request.app.state.pg
    prompt = await _fetch_prompt_row(pool, prompt_id)
    await _assert_project_role(
        pool,
        prompt["project_id"],
        principal,
        allowed=("owner", "admin", "member", "viewer"),
    )
    rows = await pool.fetch(
        """
        select id, prompt_id, version, template, template_messages,
               input_schema, model_params, aliases, commit_message, created_at
        from prompt_version
        where prompt_id = $1
        order by version desc
        """,
        prompt_id,
    )
    return PromptVersionList(versions=[_hydrate_version(r) for r in rows])


@router.post(
    "/{prompt_id}/versions",
    response_model=PromptVersionOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_version(
    request: Request,
    response: Response,
    prompt_id: UUID,
    body: PromptVersionCreate,
    principal: Principal = Depends(require_user),
) -> PromptVersionOut:
    pool: asyncpg.Pool = request.app.state.pg
    prompt = await _fetch_prompt_row(pool, prompt_id)
    workspace_id = await _assert_project_role(
        pool,
        prompt["project_id"],
        principal,
        allowed=("owner", "admin", "member"),
    )

    aliases = _normalize_aliases(body.aliases)
    input_schema_json = _json.dumps(body.input_schema) if body.input_schema is not None else None
    model_params_json = _json.dumps(body.model_params) if body.model_params is not None else None

    messages = body.to_messages()
    messages_json_list = [m.model_dump() for m in messages]

    async with pool.acquire() as conn, conn.transaction():
        # Latest version for this prompt, if any. Used both to compute the
        # next version number and to detect a no-op duplicate.
        latest = await conn.fetchrow(
            """
                select id, prompt_id, version, template, template_messages,
                       input_schema, model_params, aliases, commit_message,
                       created_at
                  from prompt_version
                 where prompt_id = $1
                 order by version desc
                 limit 1
                """,
            prompt_id,
        )

        if latest is not None:
            # Decode jsonb defensively (some asyncpg codec configs return str).
            latest_msgs_raw = latest["template_messages"]
            if isinstance(latest_msgs_raw, str):
                latest_msgs_raw = _json.loads(latest_msgs_raw)
            # No-op short-circuit: identical to the most recent version.
            # End-to-end coverage of this branch lives in the deferred
            # integration test (Plan B Task 6 follow-up); the comparison
            # contract is pinned by tests/unit/test_prompt_version_create_validation.py
            # so a regression in to_messages()/model_dump fails fast.
            if latest_msgs_raw == messages_json_list:
                response.status_code = status.HTTP_200_OK
                return _hydrate_version(latest)

        next_version = (latest["version"] + 1) if latest is not None else 1

        if aliases:
            await conn.execute(
                """
                    update prompt_version
                    set aliases = array(
                        select unnest(aliases) except select unnest($2::text[])
                    )
                    where prompt_id = $1 and aliases && $2::text[]
                    """,
                prompt_id,
                aliases,
            )

        legacy_template = _derive_legacy_template(messages)
        row = await conn.fetchrow(
            """
                insert into prompt_version (
                    prompt_id, version, template, template_messages,
                    input_schema, model_params, aliases, commit_message,
                    created_by
                )
                values ($1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb, $7, $8, $9)
                returning id, prompt_id, version, template, template_messages,
                          input_schema, model_params, aliases, commit_message,
                          created_at
                """,
            prompt_id,
            next_version,
            legacy_template,
            _json.dumps(messages_json_list),
            input_schema_json,
            model_params_json,
            aliases,
            body.commit_message,
            principal.user_id,
        )
        await conn.execute(
            "update prompt set updated_at = now() where id = $1",
            prompt_id,
        )
    assert row is not None
    version = _hydrate_version(row)
    await audit.record(
        pool,
        principal=principal,
        action="prompt_version.create",
        target_kind="prompt_version",
        target_id=version.id,
        payload={
            "prompt_id": str(prompt_id),
            "version": version.version,
            "aliases": aliases,
            "template_messages": body.template_messages is not None,
        },
        request=request,
        workspace_id=workspace_id,
        project_id=prompt["project_id"],
    )
    return version


@router.get("/{prompt_id}/versions/{version}", response_model=PromptVersionOut)
async def get_version(
    request: Request,
    prompt_id: UUID,
    version: int,
    principal: Principal = Depends(require_user),
) -> PromptVersionOut:
    pool: asyncpg.Pool = request.app.state.pg
    prompt = await _fetch_prompt_row(pool, prompt_id)
    await _assert_project_role(
        pool,
        prompt["project_id"],
        principal,
        allowed=("owner", "admin", "member", "viewer"),
    )
    row = await pool.fetchrow(
        """
        select id, prompt_id, version, template, template_messages,
               input_schema, model_params, aliases, commit_message, created_at
        from prompt_version
        where prompt_id = $1 and version = $2
        """,
        prompt_id,
        version,
    )
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "version not found")
    return _hydrate_version(row)


@router.post("/{prompt_id}/aliases", response_model=PromptVersionOut)
async def assign_alias(
    request: Request,
    prompt_id: UUID,
    body: AliasUpdate,
    principal: Principal = Depends(require_user),
) -> PromptVersionOut:
    pool: asyncpg.Pool = request.app.state.pg
    prompt = await _fetch_prompt_row(pool, prompt_id)
    workspace_id = await _assert_project_role(
        pool,
        prompt["project_id"],
        principal,
        allowed=("owner", "admin", "member"),
    )
    target = await pool.fetchval(
        "select 1 from prompt_version where prompt_id = $1 and version = $2",
        prompt_id,
        body.version,
    )
    if target is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "version not found")

    async with pool.acquire() as conn, conn.transaction():
        await conn.execute(
            """
                update prompt_version
                set aliases = array_remove(aliases, $2)
                where prompt_id = $1 and version <> $3 and $2 = any(aliases)
                """,
            prompt_id,
            body.alias,
            body.version,
        )
        row = await conn.fetchrow(
            """
                update prompt_version
                set aliases = case
                    when $2 = any(aliases) then aliases
                    else aliases || array[$2]
                end
                where prompt_id = $1 and version = $3
                returning id, prompt_id, version, template, template_messages,
                          input_schema, model_params, aliases, commit_message,
                          created_at
                """,
            prompt_id,
            body.alias,
            body.version,
        )
        await conn.execute(
            "update prompt set updated_at = now() where id = $1",
            prompt_id,
        )
    assert row is not None
    version = _hydrate_version(row)
    await audit.record(
        pool,
        principal=principal,
        action="prompt_alias.assign",
        target_kind="prompt_version",
        target_id=version.id,
        payload={
            "prompt_id": str(prompt_id),
            "version": version.version,
            "alias": body.alias,
        },
        request=request,
        workspace_id=workspace_id,
        project_id=prompt["project_id"],
    )
    return version


def _derive_legacy_template(messages: list[Message]) -> str:
    """Compute the legacy `template` text from the canonical messages.

    Returns the human content only when the version is exactly one bare
    human message; otherwise empty string. Lying about the legacy field
    (e.g., picking the human content from a multi-message version) would
    quietly mislead old clients during the deprecation window.

    This rule is the ONE source of truth — the create write path and the
    read hydration path both call this so the response shape can never
    diverge between create and read.
    """
    if len(messages) == 1 and messages[0].role == "human":
        return messages[0].content
    return ""


def _normalize_aliases(raw: list[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for a in raw:
        s = a.strip().lower()
        if not s or s in seen:
            continue
        if not _ALIAS_RE.fullmatch(s):
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                f"alias '{a}' must match ^[a-z0-9][a-z0-9_-]*$",
            )
        seen.add(s)
        out.append(s)
    return out


def _hydrate_version(row: asyncpg.Record) -> PromptVersionOut:
    """Convert a prompt_version row to the response model.

    Reads template_messages (the canonical structured field) and derives
    the legacy `template` for one release of back-compat — only populated
    when the version is exactly one bare human message; otherwise empty
    so old clients see a cleanly-empty value rather than a half-truth.
    """
    data = dict(row)
    msgs_raw = data["template_messages"]
    # asyncpg normally returns jsonb already decoded (here always a list),
    # but some driver/codec configurations hand back the raw json string —
    # decode defensively so we never feed a str into model_validate.
    if isinstance(msgs_raw, str):
        msgs_raw = _json.loads(msgs_raw)
    # Unknown roles raise ValidationError by design: v1 only persists
    # {system, human}, and silently widening the Literal would mask a
    # data-corruption bug. If/when ai/tool roles land, extend Message,
    # don't loosen this validation.
    messages = [Message.model_validate(m) for m in msgs_raw]
    legacy_template = _derive_legacy_template(messages)
    return PromptVersionOut(
        id=data["id"],
        prompt_id=data["prompt_id"],
        version=data["version"],
        template_messages=messages,
        template=legacy_template,
        input_schema=_jsonb(data.get("input_schema")),
        model_params=_jsonb(data.get("model_params")),
        aliases=list(data.get("aliases") or []),
        commit_message=data.get("commit_message"),
        created_at=data["created_at"],
    )


def _jsonb(raw: object) -> dict[str, Any] | None:
    if raw is None:
        return None
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str):
        try:
            parsed = _json.loads(raw)
        except (TypeError, ValueError):
            return None
        return parsed if isinstance(parsed, dict) else None
    return None


async def _fetch_prompt_row(pool: asyncpg.Pool, prompt_id: UUID) -> asyncpg.Record:
    row = await pool.fetchrow(
        """
        select id, project_id, slug, name, description, created_at, updated_at
        from prompt
        where id = $1 and deleted_at is null
        """,
        prompt_id,
    )
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "prompt not found")
    return row


async def _fetch_prompt_full(pool: asyncpg.Pool, prompt_id: UUID) -> asyncpg.Record:
    row = await pool.fetchrow(
        """
        select
            p.id, p.project_id, p.slug, p.name, p.description,
            p.created_at, p.updated_at,
            (
                select max(version) from prompt_version pv
                where pv.prompt_id = p.id
            ) as latest_version,
            (
                select count(*) from prompt_version pv
                where pv.prompt_id = p.id
            ) as version_count,
            coalesce(
                (
                    select array_agg(distinct a)
                    from prompt_version pv, unnest(pv.aliases) a
                    where pv.prompt_id = p.id
                ),
                array[]::text[]
            ) as aliases
        from prompt p
        where p.id = $1 and p.deleted_at is null
        """,
        prompt_id,
    )
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "prompt not found")
    return row


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
