-- 0003_replay_captures.sql
-- Agent-replay capture index. The actual capture artifacts (tool I/O, RNG state,
-- retrieval results, time/env) are content-addressed in object storage; this
-- table is the index that lets us locate them per run.

create table if not exists replay_capture
(
    project_id        UUID,
    run_id            UUID,
    -- which span produced the capture (a tool call, llm call, retrieval, etc.)
    span_id           UUID,
    -- 'tool_io' | 'llm_call' | 'retrieval' | 'env' | 'rng_state' | 'time'
    kind              LowCardinality(String),
    -- content-addressed sha256 hash; the same artifact is shared across runs if
    -- byte-identical
    content_hash      FixedString(64),
    -- object storage URI (s3://, file://, ...)
    object_ref        String,
    -- size in bytes for cost/quota accounting
    size_bytes        UInt64,
    -- additional kind-specific metadata as json (e.g. for llm_call:
    -- {"model":"gpt-4o","temperature":0,"seed":1234})
    attributes        String,
    captured_at       DateTime64(9, 'UTC') default now64(9),
    schema_version    UInt8 default 1
)
engine = ReplacingMergeTree(captured_at)
partition by toYYYYMM(captured_at)
order by (project_id, run_id, span_id, kind)
ttl toDateTime(captured_at) + interval 90 day
settings index_granularity = 8192;

-- Replay execution record: one row per replay attempt of a captured run
create table if not exists replay_run
(
    project_id        UUID,
    -- new run_id of the replay execution itself
    replay_run_id     UUID,
    -- the original run we are replaying
    original_run_id   UUID,
    -- 'deterministic' | 'nondeterministic' | 'env_drift' | 'tool_unavailable'
    determinism       LowCardinality(String),
    -- diff summary: number of spans that diverged
    span_count_total  UInt32,
    span_count_diverged UInt32,
    -- 'ok' | 'replay_nondeterministic' | 'tool_io_missing' | 'model_version_diff'
    outcome           LowCardinality(String),
    -- per ER-18: model endpoint version diff is warned, not silent-substituted
    notes             String,
    started_at        DateTime64(9, 'UTC'),
    finished_at       Nullable(DateTime64(9, 'UTC')),
    schema_version    UInt8 default 1
)
engine = ReplacingMergeTree(started_at)
partition by toYYYYMM(started_at)
order by (project_id, original_run_id, replay_run_id)
ttl toDateTime(started_at) + interval 365 day
settings index_granularity = 8192;
