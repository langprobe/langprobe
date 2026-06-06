-- 0001_runs_and_spans.sql
-- Core trace data plane: runs (top-level traces) and spans (the tree).

-- Runs: a top-level trace (an agent invocation, a user-turn handler, etc.)
create table if not exists run
(
    project_id        UUID,
    run_id            UUID,
    parent_run_id     Nullable(UUID),
    name              LowCardinality(String),
    -- 'agent' | 'chain' | 'tool' | 'llm' | 'retriever' | 'embedding' | 'workflow'
    kind              LowCardinality(String),
    -- 'ok' | 'error' | 'cancelled' | 'in_progress'
    status            LowCardinality(String),
    start_time        DateTime64(9, 'UTC'),
    end_time          Nullable(DateTime64(9, 'UTC')),
    duration_ns       Nullable(UInt64),
    -- io blobs > inline_threshold are stored in object storage; this is a hash+ref
    inputs            String,
    outputs           String,
    inputs_obj_ref    Nullable(String),
    outputs_obj_ref   Nullable(String),
    -- token + cost rollup across child spans (denormalized for fast list queries)
    prompt_tokens     UInt32 default 0,
    completion_tokens UInt32 default 0,
    total_tokens      UInt32 default 0,
    cost_usd          Decimal(18, 8) default 0,
    -- 'lt-py-0.1' etc.
    sdk               LowCardinality(String),
    sdk_version       LowCardinality(String),
    -- session/user/org-supplied tags
    session_id        Nullable(String),
    user_id           Nullable(String),
    tags              Array(LowCardinality(String)),
    metadata          String,           -- json-encoded; we keep it opaque
    error_kind        LowCardinality(String) default '',
    error_message     String default '',
    -- bookkeeping
    received_at       DateTime64(9, 'UTC') default now64(9),
    -- ingest schema version; lets us evolve without breaking old rows
    schema_version    UInt8 default 1
)
engine = ReplacingMergeTree(received_at)
partition by toYYYYMM(start_time)
order by (project_id, start_time, run_id)
ttl toDateTime(start_time) + interval 90 day
settings index_granularity = 8192;

-- Spans: nodes in the run tree
create table if not exists span
(
    project_id        UUID,
    run_id            UUID,
    span_id           UUID,
    parent_span_id    Nullable(UUID),
    name              LowCardinality(String),
    kind              LowCardinality(String),    -- agent | chain | tool | llm | retriever | embedding
    status            LowCardinality(String),
    start_time        DateTime64(9, 'UTC'),
    end_time          Nullable(DateTime64(9, 'UTC')),
    duration_ns       Nullable(UInt64),
    inputs            String,
    outputs           String,
    inputs_obj_ref    Nullable(String),
    outputs_obj_ref   Nullable(String),
    -- llm-specific
    model             LowCardinality(String) default '',
    temperature       Nullable(Float32),
    prompt_tokens     UInt32 default 0,
    completion_tokens UInt32 default 0,
    total_tokens      UInt32 default 0,
    cost_usd          Decimal(18, 8) default 0,
    -- error
    error_kind        LowCardinality(String) default '',
    error_message     String default '',
    -- arbitrary user attributes (otel-genai semantic-conventions friendly)
    attributes        String,           -- json
    received_at       DateTime64(9, 'UTC') default now64(9),
    schema_version    UInt8 default 1
)
engine = ReplacingMergeTree(received_at)
partition by toYYYYMM(start_time)
order by (project_id, run_id, span_id)
ttl toDateTime(start_time) + interval 90 day
settings index_granularity = 8192;

-- Index helpers (idempotent: re-running is a no-op)
alter table span add index if not exists idx_span_kind kind type set(0) granularity 4;
alter table span add index if not exists idx_span_model model type set(0) granularity 4;
alter table span add index if not exists idx_span_status status type set(0) granularity 4;

alter table run add index if not exists idx_run_status status type set(0) granularity 4;
alter table run add index if not exists idx_run_session session_id type bloom_filter granularity 4;
alter table run add index if not exists idx_run_user user_id type bloom_filter granularity 4;
alter table run add index if not exists idx_run_tags tags type bloom_filter granularity 4;
