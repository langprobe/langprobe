-- 0012_annotations.sql
-- Annotation queues for human review.
--
-- An `annotation_queue` is a project-scoped queue with a sampling rule
-- (random N from the last window) and a rubric (categorical labels +
-- optional 0..1 score). When the queue is created the API samples N
-- runs from ClickHouse and inserts one `annotation_item` row per
-- sampled run with status='pending'. Reviewers walk the queue,
-- submit a label per item, and the submission flips the item to
-- 'done' AND writes one ClickHouse `eval_score` row tagged with
-- `judge_name='human'` so human labels aggregate alongside LLM judges
-- and end-user feedback in the same store. No second source of truth.
--
-- Why a fixed sample at queue-creation time instead of a streaming
-- rule? Two reasons. First, queue size is the contract reviewers care
-- about — "I have 50 runs to review" stays true between sessions.
-- Second, a streaming sampler that re-evaluates on every render is a
-- subtle source of double-counting. We can add a refresh action later;
-- for v1, the queue is materialized and finite.

begin;

create table annotation_queue (
    id uuid primary key default gen_random_uuid(),
    project_id uuid not null references project (id) on delete restrict,
    name text not null,
    -- Free-text scope so the UI can scope a queue to "checkout flow",
    -- "claude-haiku 4.5", whatever -- we don't constrain the operator's
    -- mental model here.
    description text,
    -- Sampling rule snapshot. Schema:
    --   {"window_seconds": 86400, "sample_size": 50,
    --    "where": {"status": "error" | "ok" | "any"}}
    -- Stored verbatim so the UI can replay how the queue was built.
    sampling jsonb not null default '{}'::jsonb,
    -- Rubric snapshot. Schema:
    --   {"labels": ["correct", "off-topic", "harmful"],
    --    "score": "binary" | "scalar" | "none"}
    -- "binary" maps "pass"=1.0, "fail"=0.0; "scalar" expects an
    -- explicit 0..1 score on each submission; "none" stores label
    -- only with a sentinel 0.0 score.
    rubric jsonb not null default '{}'::jsonb,
    -- Counters maintained by the API on every submission.
    item_total integer not null default 0,
    item_done integer not null default 0,
    -- Status surfaced in the UI; "open" while item_done < item_total,
    -- "complete" once they match. We don't auto-close on creation so
    -- a 0-sample queue (no runs matched the window) renders as
    -- "complete" with a clear empty state.
    status text not null default 'open' check (
        status in ('open', 'complete', 'archived')
    ),
    created_by uuid references app_user (id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create trigger annotation_queue_updated_at
    before update on annotation_queue
    for each row execute function set_updated_at();

create index annotation_queue_project_id_idx on annotation_queue (project_id);
create index annotation_queue_status_idx on annotation_queue (status);

create table annotation_item (
    id uuid primary key default gen_random_uuid(),
    queue_id uuid not null references annotation_queue (id) on delete cascade,
    project_id uuid not null references project (id) on delete restrict,
    -- The run this item is reviewing. We don't FK to ClickHouse;
    -- this is just the id used to fetch the run/spans for review.
    run_id uuid not null,
    status text not null default 'pending' check (
        status in ('pending', 'done', 'skipped')
    ),
    -- Label chosen from the rubric (text). Null until reviewed.
    label text,
    -- Score derived from rubric ("binary"/"scalar") or null for "none".
    score double precision,
    rationale text,
    reviewed_by uuid references app_user (id) on delete set null,
    reviewed_at timestamptz,
    created_at timestamptz not null default now(),
    -- One run can sit in many queues, but only once per queue. The
    -- sampling step is idempotent -- re-running it would no-op.
    constraint annotation_item_queue_run_unique unique (queue_id, run_id)
);

create index annotation_item_queue_id_idx on annotation_item (queue_id);
create index annotation_item_project_id_idx on annotation_item (project_id);
create index annotation_item_status_idx on annotation_item (status);

insert into schema_migrations (version) values ('0012_annotations')
on conflict (version) do nothing;

commit;
