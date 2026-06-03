-- 0010_comparisons.sql
-- Side-by-side prompt comparisons.
--
-- A comparison row pairs a dataset with two prompt versions and a judge,
-- then scores every item under each variant using the chosen judge. Per-
-- item scores live in ClickHouse `eval_score` (one row per side, with the
-- side carried in `judge_name` as `cmp:a` / `cmp:b` so we don't need a
-- schema change on the data plane). Aggregates live here.
--
-- Lifecycle mirrors `eval_run`: queued → running → done/failed. We track
-- per-side counters (`item_done_a`, `score_sum_a`, etc.) so a partial
-- comparison still shows useful numbers in the UI.

begin;

create table comparison (
    id uuid primary key default gen_random_uuid(),
    project_id uuid not null references project (id) on delete restrict,
    dataset_id uuid not null references dataset (id) on delete restrict,
    -- both sides reference real prompt versions; left/right ordering is
    -- presentational, we never assume A is the "winner" or "control".
    prompt_version_id_a uuid not null references prompt_version (id) on delete restrict,
    prompt_version_id_b uuid not null references prompt_version (id) on delete restrict,
    -- 'echo' | 'contains' | 'exact' for v1; LLM judges swap in later.
    judge_kind text not null check (
        judge_kind in ('echo', 'contains', 'exact')
    ),
    name text,
    status text not null default 'queued' check (
        status in ('queued', 'running', 'done', 'failed')
    ),
    item_total integer not null default 0,
    item_done_a integer not null default 0,
    item_done_b integer not null default 0,
    score_sum_a double precision not null default 0,
    score_sum_b double precision not null default 0,
    score_avg_a double precision,
    score_avg_b double precision,
    error text,
    started_at timestamptz,
    finished_at timestamptz,
    created_by uuid references app_user (id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    -- comparing a prompt version to itself is nonsensical; cheap guard.
    constraint comparison_distinct_versions
        check (prompt_version_id_a <> prompt_version_id_b)
);

create trigger comparison_updated_at
    before update on comparison
    for each row execute function set_updated_at();

create index comparison_project_id_idx on comparison (project_id);
create index comparison_dataset_id_idx on comparison (dataset_id);
create index comparison_status_idx on comparison (status);

insert into schema_migrations (version) values ('0010_comparisons')
on conflict (version) do nothing;

commit;
