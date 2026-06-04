-- 0015_poll_runs.sql
-- Panel-of-LLM-Judges (PoLL) eval runs.
--
-- A poll_run scores every item in a dataset with N judges, writes one
-- eval_score row per (item, judge) pair to ClickHouse, and tracks an
-- aggregate consensus score + pairwise agreement on the postgres row.
--
-- Why a separate table from eval_run?
--   - eval_run.judge_kind is singular by design; widening it to a list
--     would break the existing list view's "Judge" column semantics.
--   - The aggregation strategy (mean/majority/min/max) is a property of
--     the panel, not of any single judge; lives on the parent row.
--   - List queries differ: "show me eval runs" and "show me panel runs"
--     have different mental models for an operator.
--
-- Why N rows per item in eval_score and not a denormalized per-item
-- consensus column?
--   - The eval_score store is the single source of truth for any
--     judge-emitted signal (annotations, feedback, comparisons all
--     write there too). A second store would mean reconciling.
--   - Consensus is cheap to compute at read time with GROUP BY item_id
--     and the analytic UI is already designed around that aggregation
--     shape.

begin;

create table poll_run (
    id uuid primary key default gen_random_uuid(),
    project_id uuid not null references project (id) on delete restrict,
    dataset_id uuid not null references dataset (id) on delete restrict,
    name text,
    -- Judges in the panel (text[] of judge kinds). At least 2; we
    -- enforce upper bound in the application layer (≤5 in v1).
    judges text[] not null,
    -- Aggregation strategy for the per-item consensus score. The
    -- judge-wise scores themselves stay in eval_score; this column
    -- records how we collapsed them on the parent row.
    aggregation text not null default 'mean' check (
        aggregation in ('mean', 'majority', 'min', 'max')
    ),
    status text not null default 'queued' check (
        status in ('queued', 'running', 'done', 'failed')
    ),
    item_total integer not null default 0,
    item_done integer not null default 0,
    -- Aggregate metrics. consensus_avg is the mean of per-item
    -- consensus scores. agreement is the pairwise judge-pair agreement
    -- ratio (binary outcome): for every (item, judge_pair), 1 if both
    -- judges classified the item the same way (above/below 0.5),
    -- averaged across all pairs and items. 1.0 = perfect agreement.
    consensus_avg double precision,
    agreement double precision,
    error text,
    created_by uuid references app_user (id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    started_at timestamptz,
    finished_at timestamptz,
    -- Panel must have at least two judges; otherwise this would be
    -- a regular eval_run and the operator picked the wrong surface.
    constraint poll_run_judges_min_two check (array_length(judges, 1) >= 2)
);

create trigger poll_run_updated_at
    before update on poll_run
    for each row execute function set_updated_at();

create index poll_run_project_id_idx on poll_run (project_id);
create index poll_run_dataset_id_idx on poll_run (dataset_id);
create index poll_run_status_idx on poll_run (status);

insert into schema_migrations (version) values ('0015_poll_runs')
on conflict (version) do nothing;

commit;
