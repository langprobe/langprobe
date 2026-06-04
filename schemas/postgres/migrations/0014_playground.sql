-- 0014_playground.sql
-- Playground sessions: prompt + model + variables → LLM call → trace row.
--
-- A playground_session is one invocation of "run THIS prompt with
-- THESE variables against THIS model". We record:
--   - inputs (prompt_version_id OR raw_template, variables jsonb)
--   - which model + temperature + provider was used
--   - outputs (output_text plus the ClickHouse run_id for the
--     end-to-end trace; the full output is in run.outputs)
--   - lifecycle (queued -> running -> done/failed) and timing
--
-- Why a table and not just rely on the ClickHouse trace store?
-- Two reasons. First, the playground list view ("my last 50 sessions")
-- is much cheaper to render from postgres than scanning the run table
-- by sdk='playground'. Second, the session row is what gets promoted
-- (next iteration) into a prompt revision -- it needs to live in the
-- same store as the prompt_version it would update.
--
-- ER-23: the LLM call goes through best-effort error handling. If the
-- provider returns 5xx, we write the session row with status='failed'
-- and an error message rather than dropping the attempt silently.

begin;

create table playground_session (
    id uuid primary key default gen_random_uuid(),
    project_id uuid not null references project (id) on delete restrict,
    -- Optional FK to a saved prompt revision; null means raw template
    -- pasted into the canvas (still legitimate, just unsaved).
    prompt_version_id uuid references prompt_version (id) on delete set null,
    raw_template text,
    -- The rendered final prompt that went to the model (post variable
    -- substitution). Stored verbatim for reproducibility.
    rendered_prompt text not null,
    -- The variable map (free-form jsonb so SDKs can pass anything).
    variables jsonb not null default '{}'::jsonb,
    -- LLM call configuration. Provider is derived server-side from
    -- the model string (anthropic/openai); we record both so the
    -- list view is scannable.
    provider text not null check (provider in ('anthropic', 'openai', 'stub')),
    model text not null,
    temperature double precision,
    max_tokens integer,
    -- Outcome. status flips queued -> running -> done/failed inside
    -- the same request handler (the playground is synchronous v1).
    status text not null default 'queued' check (
        status in ('queued', 'running', 'done', 'failed')
    ),
    output_text text,
    prompt_tokens integer,
    completion_tokens integer,
    total_tokens integer,
    cost_usd double precision,
    latency_ms integer,
    -- ClickHouse run id (text because runs live in ClickHouse, not
    -- postgres). Lets the "open in /runs" link work.
    run_id text,
    error text,
    created_by uuid references app_user (id) on delete set null,
    created_at timestamptz not null default now(),
    finished_at timestamptz,
    -- One of prompt_version_id OR raw_template must be present; both
    -- being null means "what did you even send?" and we reject it
    -- at the application layer.
    constraint playground_session_source_present check (
        prompt_version_id is not null or raw_template is not null
    )
);

create index playground_session_project_id_idx on playground_session (project_id);
create index playground_session_prompt_version_idx on playground_session (prompt_version_id);
create index playground_session_created_at_idx on playground_session (created_at desc);

insert into schema_migrations (version) values ('0014_playground')
on conflict (version) do nothing;

commit;
