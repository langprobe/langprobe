# LiteLLM dispatch + project-scoped credential enablement

**Status:** design  
**Date:** 2026-06-06  
**Owner:** langprobe/langprobe

## Problem

Today five FastAPI surfaces (playground, comparisons, studio, evals/Luna, poll_runs) each re-implement provider HTTP using `urllib.request`. Two providers are supported (`anthropic`, `openai`); the matrix is hand-rolled in `_call_anthropic` and `_call_openai` inside `playground.py`. Credentials live in `workspace_llm_credential` and resolve through `resolve_secret(pool, workspace_id, provider)`.

The `dispatch_cost.surface` enum has six values because Luna prompted-judges run from two surfaces (the eval runner UI and the poll_runs scheduler) and we want to attribute spend to whichever triggered it.

This works but does not scale to the user's actual workflow: they want to swap models across providers (Anthropic → OpenAI → Gemini → Mistral → DeepSeek → Groq) for evals, replays, and playground without us writing a new HTTP client every quarter, and they want each project to control which workspace credentials it is permitted to spend.

## Goals

1. Replace five copies of provider HTTP with one async gateway built on LiteLLM (Python library, in-process — not the proxy sidecar).
2. Widen the provider matrix to OpenAI, Anthropic, Google (Gemini), Mistral, DeepSeek, Groq. No allow-lists, no per-surface defaults — credential present = model appears.
3. Move from workspace-only credential enablement to **workspace credentials + project enablement**: keys live at workspace, projects link which to use. New projects auto-link credentials marked `default_enabled = true`.
4. Centralize cost recording in a single `dispatch_cost` table. Surface tables stop carrying cost.
5. Enforce `project.eval_cost_ceiling_usd_per_day` on automated dispatch surfaces (poll_runs, eval runner). Interactive surfaces (playground, comparisons, Studio) skip the ceiling — a researcher clicking "Run" represents intent.

## Non-goals

- Project credential picker UI (Surface 2 from the brainstorm). Deferred to v2; auto-link-on-create + workspace revoke covers v1.
- Bedrock, Vertex, Azure OpenAI, Ollama, OpenRouter. Different credential shapes; separate design.
- LiteLLM proxy as a sidecar service. We have our own data plane; running a second one duplicates cost tracking and audit.
- Streaming responses, tool-use, function calling exposed to UI. Gateway supports them; callers don't expose them in v1.
- Allow-lists or per-surface model defaults. Cost ceiling is the spending guardrail, not allow-lists.
- Backfilling `dispatch_cost` from existing rows. Historical cost was mostly null; start fresh.

## Architecture

```
                ┌──────────────────────────────────────┐
                │ Caller surfaces (FastAPI routers)    │
                │  playground / comparisons / studio   │
                │  evals (Luna) / poll_runs            │
                └────────────────┬─────────────────────┘
                                 │  await dispatch(project_id, model, messages, ...)
                                 ▼
                ┌──────────────────────────────────────┐
                │ langprobe.llm.gateway              │
                │  • resolve credentials (project→env) │
                │  • check project ceiling (auto only) │
                │  • LiteLLM acompletion call          │
                │  • normalize response                │
                │  • write to dispatch_cost            │
                └────────────────┬─────────────────────┘
                                 │
                                 ▼
                ┌──────────────────────────────────────┐
                │ litellm (Python lib, pinned)         │
                │  → provider HTTP                     │
                │     OpenAI / Anthropic / Gemini /    │
                │     Mistral / DeepSeek / Groq        │
                └──────────────────────────────────────┘
```

The five caller surfaces keep their public API. Each changes at exactly one call site (the dispatch invocation). All five copies of `_call_anthropic`/`_call_openai` are deleted.

## Data model

Two migrations.

### `0023_litellm_provider_matrix.sql`

```sql
begin;

-- Widen provider check.
alter table workspace_llm_credential
  drop constraint workspace_llm_credential_provider_check;
alter table workspace_llm_credential
  add constraint workspace_llm_credential_provider_check
  check (provider in (
    'anthropic', 'openai', 'gemini', 'mistral', 'deepseek', 'groq'
  ));

-- Default-on-new-projects flag.
alter table workspace_llm_credential
  add column default_enabled boolean not null default false;

-- Project ↔ credential link table.
create table project_llm_credential (
    project_id    uuid not null references project (id)               on delete cascade,
    credential_id uuid not null references workspace_llm_credential (id) on delete cascade,
    enabled_at    timestamptz not null default now(),
    enabled_by    uuid references app_user (id) on delete set null,
    primary key (project_id, credential_id)
);

create index project_llm_credential_proj_idx
  on project_llm_credential (project_id);

insert into schema_migrations (version) values ('0023_litellm_provider_matrix')
on conflict (version) do nothing;

commit;
```

### `0024_dispatch_cost.sql`

```sql
begin;

create table dispatch_cost (
    id                uuid primary key default gen_random_uuid(),
    project_id        uuid not null references project   (id) on delete cascade,
    workspace_id      uuid not null references workspace (id) on delete cascade,
    surface           text not null check (surface in (
        'playground','comparisons','studio','luna','eval','poll'
    )),
    surface_ref_id    uuid not null,
    provider          text not null,
    model             text not null,
    prompt_tokens     integer,
    completion_tokens integer,
    cost_usd          numeric(10, 6) not null default 0,
    cost_calculated_via text not null default 'litellm-table',
    dispatched_at     timestamptz not null default now(),
    error_code        text,
    error_detail      text
);

create index dispatch_cost_proj_dispatched_idx
  on dispatch_cost (project_id, dispatched_at desc);
create index dispatch_cost_proj_surface_idx
  on dispatch_cost (project_id, surface, dispatched_at desc);
create index dispatch_cost_surface_ref_idx
  on dispatch_cost (surface, surface_ref_id);

insert into schema_migrations (version) values ('0024_dispatch_cost')
on conflict (version) do nothing;

commit;
```

### Resolution order (the new `resolve_secret`)

```
1. project_llm_credential JOIN workspace_llm_credential
   WHERE project = $1 AND provider = $2 AND revoked_at IS NULL
   ORDER BY workspace_llm_credential.created_at DESC LIMIT 1
2. Env var (ANTHROPIC_API_KEY / OPENAI_API_KEY / GEMINI_API_KEY /
   MISTRAL_API_KEY / DEEPSEEK_API_KEY / GROQ_API_KEY)
3. None — caller surfaces 'no <provider> credential resolved' on the run row.
```

Function signature changes from `workspace_id=` to `project_id=`. Six callers updated mechanically.

### Auto-link on project creation

`POST /v1/projects` runs one extra SQL after the project insert:

```sql
insert into project_llm_credential (project_id, credential_id, enabled_by)
select :new_project_id, c.id, :user_id
  from workspace_llm_credential c
 where c.workspace_id = :workspace_id
   and c.default_enabled = true
   and c.revoked_at is null;
```

### `default_enabled` toggle behavior

- **false → true:** also auto-links to existing projects in the workspace that lack a link. Otherwise a key added after the project would never reach it.
- **true → false:** leaves existing links intact. Workspace-level revoke is the actual "no longer use this" path.

## Gateway module

**File:** `services/api/langprobe_api/llm/gateway.py`

```python
@dataclass(frozen=True)
class Message:
    role: Literal["system", "user", "assistant", "tool"]
    content: str

@dataclass(frozen=True)
class DispatchResult:
    text: str
    prompt_tokens: int | None
    completion_tokens: int | None
    cost_usd: float | None
    provider: str
    model: str
    raw: dict[str, Any]

class DispatchError(Exception):
    code: Literal[
        "no_credential",
        "provider_error",
        "bad_model",
        "timeout",
        "ceiling_exceeded",
    ]
    provider: str | None
    detail: str

async def dispatch(
    pool: asyncpg.Pool,
    *,
    project_id: UUID,
    surface: Literal["playground","comparisons","studio","luna","eval","poll"],
    surface_ref_id: UUID,
    model: str,                  # 'anthropic/claude-sonnet-4', 'openai/gpt-4o', etc.
    messages: list[Message],
    temperature: float | None = None,
    max_tokens: int = 2048,
    timeout_s: float = 60.0,
    extra: dict[str, Any] | None = None,
) -> DispatchResult: ...
```

Caller code never imports `litellm`. If we ever swap libraries we change one file.

### LiteLLM environment hygiene

- `litellm.suppress_debug_info = True`
- `litellm.drop_params = True` — silently strip provider-incompatible params
- `litellm.set_verbose = False`
- `litellm.telemetry = False` — no LiteLLM analytics endpoint
- `num_retries=0` — retries are the caller's job, not LiteLLM's
- No global default api_key — keys come from `resolve_secret` per call

### Cost recording

Every dispatch (success or fail) writes one row to `dispatch_cost`. Surface tables (`playground_session`, `comparison_run`, `studio_branch`, `eval_score`, `eval_run`) keep their existing schema unchanged — `surface_ref_id` is the join key.

`cost_usd` is computed via `litellm.completion_cost(completion_response=resp)`. If LiteLLM returns 0 for a non-zero-token call (out-of-date price table), we still record the row with `cost_usd=0`. A health check warns when >5% of dispatches in the last 24h have `cost_usd=0` despite non-zero tokens.

## Error surface

| `DispatchError.code` | Cause | Caller behavior |
|---|---|---|
| `no_credential` | `resolve_secret` returned None | surface marks row failed; rate-limited audit `dispatch.no_credential` (1/project/provider/hour) |
| `provider_error` | LiteLLM raised `APIError` / `RateLimitError` / `AuthenticationError` | surface marks row failed; provider's original detail trimmed to 500 chars and recorded |
| `bad_model` | model prefix not in scope | surface marks row failed; for Luna, validated at judge create-time |
| `timeout` | LiteLLM `Timeout` after 60s | surface marks row failed; poll_runs retries on next tick |
| `ceiling_exceeded` | rolling-24h spend ≥ `eval_cost_ceiling_usd_per_day` (automated surfaces only) | surface marks row failed; rate-limited audit `dispatch.ceiling_exceeded` (1/project/hour) |

**Three principles:**

1. **No silent fallbacks.** Missing credential never falls through to "stub" or to a different provider.
2. **No retry inside the gateway.** Each surface decides; LiteLLM's retries are off.
3. **Provider-error detail is verbatim, not editorialized.** Operators want the original message when debugging.

## Cost ceiling enforcement

`project.eval_cost_ceiling_usd_per_day` becomes real. Today it's stored but not enforced.

**Automated surfaces (`surface in ('luna','eval','poll')`):** before each dispatch, the gateway runs:

```sql
select coalesce(sum(cost_usd), 0)
  from dispatch_cost
 where project_id = $1
   and dispatched_at > now() - interval '24 hours';
```

If the result + estimated cost ≥ `eval_cost_ceiling_usd_per_day`, raise `DispatchError("ceiling_exceeded")` (a fifth code). Surface marks the row failed with reason `ceiling_exceeded`. Once-per-hour audit event so a workspace admin can see the project hit its limit.

**Interactive surfaces (`surface in ('playground','comparisons','studio')`):** skip the ceiling check. Show today's spend in the chrome (`today: $4.20 / $50.00`) but never block.

Ceiling change takes effect immediately (no cache).

## Settings UX (v1)

**`/workspace/credentials`** gains one new column: **Default for new projects** (toggle). Owner/admin only. Toggling it on auto-links to existing projects that lack a link; toggling off leaves existing links intact.

**Project credential picker UI is out of scope for v1** (Surface 2 from the brainstorm). The auto-link-on-create + workspace revoke flow handles the realistic v1 cases. The link table ships in v1 to write into; the v2 picker reads/writes the same table.

## Audit

Every dispatch failure with `error_code in ('no_credential','ceiling_exceeded')` is rate-limited at one audit event per (project, provider, error_code) per hour. Without this a misconfigured poll loop firing 10k/min would flood the audit table.

Audit actions:
- `dispatch.no_credential` — payload `{provider, surface}`
- `dispatch.ceiling_exceeded` — payload `{ceiling_usd, spent_24h_usd}`

## Testing

| Layer | File | Behavior covered | Run when |
|---|---|---|---|
| Unit | `tests/unit/llm/test_gateway.py` | each `DispatchError` code, six-provider matrix normalized response, `extra` passthrough, `resolve_secret` priority | every PR |
| Integration | `tests/integration/test_llm_credentials.py` | link table cascade, default-credential auto-link on project create, `default_enabled` toggle propagation, cross-workspace link rejection | every PR |
| Live | `tests/live/test_litellm_providers.py` | one 5-token "say hi" per provider, asserts text + cost > 0 | nightly + on `PROVIDER_LIVE_TEST=1` |
| Smoke | `services/api/tests/smoke_dispatch.py` | end-to-end click on each surface, asserts surface table joins to `dispatch_cost` | post-deploy |

## Rollout

Single PR, behind `LLM_GATEWAY=litellm | legacy` env var.

- `legacy` — keeps existing `_call_anthropic` / `_call_openai`. ~300 lines of dead code, gated.
- `litellm` (default) — new gateway.

Migration order:

1. Apply `0023_litellm_provider_matrix.sql`.
2. Apply `0024_dispatch_cost.sql`.
3. Deploy api with `LLM_GATEWAY=litellm`. Existing single-tenant self-host workspaces unaffected (env fallback in `resolve_secret`).
4. UI ships the workspace-credentials column and the dispatch-cost view.
5. Next release: delete the legacy code, drop the flag.

## Risks

- **LiteLLM version churn.** Pinned `litellm == 1.x.y`. Live-providers test gates upgrades.
- **Cost calc accuracy.** `litellm.completion_cost` reads a baked-in price table; out-of-date prices show as $0. Health check warns when >5% of dispatches in 24h have `cost_usd=0` with non-zero tokens.
- **Audit log spam.** Rate-limit (1 event per project/provider/hour) is mandatory.
- **Provider-string drift.** LiteLLM has occasionally renamed prefixes (`gemini` ↔ `google`). The `_PROVIDER_BY_PREFIX` table is the single source; live test catches breakage.

## Open questions

None at design time. Implementation may surface new ones; capture them in the implementation plan.
