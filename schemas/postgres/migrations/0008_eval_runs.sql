-- 0008_eval_runs.sql
-- Eval-run lifecycle. The judge outputs themselves (per-item scores) live in
-- ClickHouse `eval_score`; this catalog row tracks queued/running/done/failed
-- and rolls up averages so the list view stays cheap. Built-in judges
-- (echo / contains / exact) ship first, no LLM API key required; LLM-as-judge
-- swaps in once `eval_config.judges` is wired through this same table.

begin;

create table eval_run (
    id uuid primary key default gen_random_uuid(),
    project_id uuid not null references project (id) on delete restrict,
    dataset_id uuid not null references dataset (id) on delete restrict,
    -- a built-in v1 row may not pin a prompt; later, LLM-judge runs will.
    prompt_id uuid references prompt (id) on delete set null,
    prompt_version_id uuid references prompt_version (id) on delete set null,
    -- 'echo' | 'contains' | 'exact' for v1; 'llm:single' / 'llm:poll' next.
    judge_kind text not null check (
        judge_kind in ('echo', 'contains', 'exact')
    ),
    name text,
    -- 'queued' | 'running' | 'done' | 'failed'
    status text not null default 'queued' check (
        status in ('queued', 'running', 'done', 'failed')
    ),
    item_total integer not null default 0,
    item_done integer not null default 0,
    score_sum double precision not null default 0,
    score_avg double precision,
    error text,
    started_at timestamptz,
    finished_at timestamptz,
    created_by uuid references app_user (id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create trigger eval_run_updated_at
    before update on eval_run
    for each row execute function set_updated_at();

create index eval_run_project_id_idx on eval_run (project_id);
create index eval_run_dataset_id_idx on eval_run (dataset_id);
create index eval_run_status_idx on eval_run (status);

insert into schema_migrations (version) values ('0008_eval_runs')
on conflict (version) do nothing;

commit;
