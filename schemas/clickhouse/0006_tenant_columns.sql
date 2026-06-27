-- 0006_tenant_columns.sql
-- Tenant-aware row identity. Every trace row gains org_id + workspace_id, and
-- the ORDER BY is rewritten so partition pruning makes per-tenant reads near
-- free. ClickHouse cannot reorder primary-key columns in place, so we use the
-- standard CREATE-INSERT-RENAME swap.
--
-- The backfill leans on a postgres dictionary (`project_tenant_dict`) so the
-- INSERT can map project_id -> (workspace_id, org_id) without a service
-- round-trip. The view is created in postgres migration 0024.
--
-- Tables touched (all that carry project_id):
--     run, span, eval_score, eval_aggregate,
--     replay_capture, replay_run, dataset_item, billing_meter
--
-- Spec §6.2.1 names only run/span/eval_score/replay_capture/dataset_item; we
-- include eval_aggregate and replay_run here because §3 goal #1 says EVERY
-- trace row carries the tenant tuple, and they're trace-derived. billing_meter
-- already has org_id from 0005 — we add workspace_id and rewrite ORDER BY for
-- the same reason.
--
-- Rollback: each *_v1 is retained for one release, then dropped in a follow-up
-- migration once the new tables are confirmed healthy in production.

-- ----------------------------------------------------------------------------
-- 0. Postgres-backed dictionary for the backfill.
-- ----------------------------------------------------------------------------
create dictionary if not exists project_tenant_dict
(
    project_id   UUID,
    workspace_id UUID,
    org_id       UUID
)
primary key project_id
source(postgresql(
    host 'postgres'
    port 5432
    user 'langprobe'
    password 'langprobe'
    db 'langprobe'
    table 'project_tenant_view'
    invalidate_query 'select max(workspace_id::text || org_id::text) from project_tenant_view'
))
lifetime(min 300 max 600)
layout(complex_key_hashed());

-- ----------------------------------------------------------------------------
-- 1. run
-- ----------------------------------------------------------------------------
create table if not exists run_v2
(
    org_id            UUID,
    workspace_id      UUID,
    project_id        UUID,
    run_id            UUID,
    parent_run_id     Nullable(UUID),
    name              LowCardinality(String),
    kind              LowCardinality(String),
    status            LowCardinality(String),
    start_time        DateTime64(9, 'UTC'),
    end_time          Nullable(DateTime64(9, 'UTC')),
    duration_ns       Nullable(UInt64),
    inputs            String,
    outputs           String,
    inputs_obj_ref    Nullable(String),
    outputs_obj_ref   Nullable(String),
    prompt_tokens     UInt32 default 0,
    completion_tokens UInt32 default 0,
    total_tokens      UInt32 default 0,
    cost_usd          Decimal(18, 8) default 0,
    sdk               LowCardinality(String),
    sdk_version       LowCardinality(String),
    session_id        Nullable(String),
    user_id           Nullable(String),
    tags              Array(LowCardinality(String)),
    metadata          String,
    error_kind        LowCardinality(String) default '',
    error_message     String default '',
    received_at       DateTime64(9, 'UTC') default now64(9),
    schema_version    UInt8 default 1
)
engine = ReplacingMergeTree(received_at)
partition by toYYYYMM(start_time)
order by (org_id, project_id, start_time, run_id)
ttl toDateTime(start_time) + interval 90 day
settings index_granularity = 8192;

insert into run_v2
select
    dictGet('project_tenant_dict', 'org_id',       project_id) as org_id,
    dictGet('project_tenant_dict', 'workspace_id', project_id) as workspace_id,
    project_id, run_id, parent_run_id, name, kind, status,
    start_time, end_time, duration_ns,
    inputs, outputs, inputs_obj_ref, outputs_obj_ref,
    prompt_tokens, completion_tokens, total_tokens, cost_usd,
    sdk, sdk_version, session_id, user_id, tags, metadata,
    error_kind, error_message, received_at, schema_version
from run;

rename table run to run_v1, run_v2 to run;

alter table run add index idx_run_status status type set(0) granularity 4;
alter table run add index idx_run_session session_id type bloom_filter granularity 4;
alter table run add index idx_run_user user_id type bloom_filter granularity 4;
alter table run add index idx_run_tags tags type bloom_filter granularity 4;
alter table run add index idx_run_workspace workspace_id type bloom_filter granularity 4;

-- ----------------------------------------------------------------------------
-- 2. span
-- ----------------------------------------------------------------------------
create table if not exists span_v2
(
    org_id            UUID,
    workspace_id      UUID,
    project_id        UUID,
    run_id            UUID,
    span_id           UUID,
    parent_span_id    Nullable(UUID),
    name              LowCardinality(String),
    kind              LowCardinality(String),
    status            LowCardinality(String),
    start_time        DateTime64(9, 'UTC'),
    end_time          Nullable(DateTime64(9, 'UTC')),
    duration_ns       Nullable(UInt64),
    inputs            String,
    outputs           String,
    inputs_obj_ref    Nullable(String),
    outputs_obj_ref   Nullable(String),
    model             LowCardinality(String) default '',
    temperature       Nullable(Float32),
    prompt_tokens     UInt32 default 0,
    completion_tokens UInt32 default 0,
    total_tokens      UInt32 default 0,
    cost_usd          Decimal(18, 8) default 0,
    error_kind        LowCardinality(String) default '',
    error_message     String default '',
    attributes        String,
    received_at       DateTime64(9, 'UTC') default now64(9),
    schema_version    UInt8 default 1
)
engine = ReplacingMergeTree(received_at)
partition by toYYYYMM(start_time)
order by (org_id, project_id, run_id, span_id)
ttl toDateTime(start_time) + interval 90 day
settings index_granularity = 8192;

insert into span_v2
select
    dictGet('project_tenant_dict', 'org_id',       project_id) as org_id,
    dictGet('project_tenant_dict', 'workspace_id', project_id) as workspace_id,
    project_id, run_id, span_id, parent_span_id,
    name, kind, status, start_time, end_time, duration_ns,
    inputs, outputs, inputs_obj_ref, outputs_obj_ref,
    model, temperature,
    prompt_tokens, completion_tokens, total_tokens, cost_usd,
    error_kind, error_message, attributes, received_at, schema_version
from span;

rename table span to span_v1, span_v2 to span;

alter table span add index idx_span_kind kind type set(0) granularity 4;
alter table span add index idx_span_model model type set(0) granularity 4;
alter table span add index idx_span_status status type set(0) granularity 4;
alter table span add index idx_span_workspace workspace_id type bloom_filter granularity 4;

-- ----------------------------------------------------------------------------
-- 3. eval_score
-- ----------------------------------------------------------------------------
create table if not exists eval_score_v2
(
    org_id            UUID,
    workspace_id      UUID,
    project_id        UUID,
    run_id            UUID,
    span_id           Nullable(UUID),
    eval_config_id    UUID,
    judge_name        LowCardinality(String),
    judge_endpoint    LowCardinality(String),
    judge_version     LowCardinality(String),
    score             Float64,
    label             LowCardinality(String) default '',
    rationale         String,
    raw_output        String,
    outcome           LowCardinality(String) default 'ok',
    judged_at         DateTime64(9, 'UTC') default now64(9),
    cost_usd          Decimal(18, 8) default 0,
    schema_version    UInt8 default 1
)
engine = ReplacingMergeTree(judged_at)
partition by toYYYYMM(judged_at)
order by (org_id, project_id, eval_config_id, run_id, judge_name)
ttl toDateTime(judged_at) + interval 365 day
settings index_granularity = 8192;

insert into eval_score_v2
select
    dictGet('project_tenant_dict', 'org_id',       project_id) as org_id,
    dictGet('project_tenant_dict', 'workspace_id', project_id) as workspace_id,
    project_id, run_id, span_id, eval_config_id,
    judge_name, judge_endpoint, judge_version,
    score, label, rationale, raw_output, outcome,
    judged_at, cost_usd, schema_version
from eval_score;

rename table eval_score to eval_score_v1, eval_score_v2 to eval_score;

-- ----------------------------------------------------------------------------
-- 4. eval_aggregate
-- ----------------------------------------------------------------------------
create table if not exists eval_aggregate_v2
(
    org_id            UUID,
    workspace_id      UUID,
    project_id        UUID,
    run_id            UUID,
    eval_config_id    UUID,
    method            LowCardinality(String),
    score             Float64,
    label             LowCardinality(String) default '',
    agreement         Nullable(Float64),
    reliability       LowCardinality(String) default 'reliable',
    judge_count       UInt8,
    aggregated_at     DateTime64(9, 'UTC') default now64(9)
)
engine = ReplacingMergeTree(aggregated_at)
partition by toYYYYMM(aggregated_at)
order by (org_id, project_id, eval_config_id, run_id)
ttl toDateTime(aggregated_at) + interval 365 day
settings index_granularity = 8192;

insert into eval_aggregate_v2
select
    dictGet('project_tenant_dict', 'org_id',       project_id) as org_id,
    dictGet('project_tenant_dict', 'workspace_id', project_id) as workspace_id,
    project_id, run_id, eval_config_id,
    method, score, label, agreement, reliability, judge_count, aggregated_at
from eval_aggregate;

rename table eval_aggregate to eval_aggregate_v1, eval_aggregate_v2 to eval_aggregate;

-- ----------------------------------------------------------------------------
-- 5. replay_capture
-- ----------------------------------------------------------------------------
create table if not exists replay_capture_v2
(
    org_id            UUID,
    workspace_id      UUID,
    project_id        UUID,
    run_id            UUID,
    span_id           UUID,
    kind              LowCardinality(String),
    content_hash      FixedString(64),
    object_ref        String,
    size_bytes        UInt64,
    attributes        String,
    captured_at       DateTime64(9, 'UTC') default now64(9),
    schema_version    UInt8 default 1
)
engine = ReplacingMergeTree(captured_at)
partition by toYYYYMM(captured_at)
order by (org_id, project_id, run_id, span_id, kind)
ttl toDateTime(captured_at) + interval 90 day
settings index_granularity = 8192;

insert into replay_capture_v2
select
    dictGet('project_tenant_dict', 'org_id',       project_id) as org_id,
    dictGet('project_tenant_dict', 'workspace_id', project_id) as workspace_id,
    project_id, run_id, span_id, kind,
    content_hash, object_ref, size_bytes, attributes,
    captured_at, schema_version
from replay_capture;

rename table replay_capture to replay_capture_v1, replay_capture_v2 to replay_capture;

-- ----------------------------------------------------------------------------
-- 6. replay_run
-- ----------------------------------------------------------------------------
create table if not exists replay_run_v2
(
    org_id              UUID,
    workspace_id        UUID,
    project_id          UUID,
    replay_run_id       UUID,
    original_run_id     UUID,
    determinism         LowCardinality(String),
    span_count_total    UInt32,
    span_count_diverged UInt32,
    outcome             LowCardinality(String),
    notes               String,
    started_at          DateTime64(9, 'UTC'),
    finished_at         Nullable(DateTime64(9, 'UTC')),
    schema_version      UInt8 default 1
)
engine = ReplacingMergeTree(started_at)
partition by toYYYYMM(started_at)
order by (org_id, project_id, original_run_id, replay_run_id)
ttl toDateTime(started_at) + interval 365 day
settings index_granularity = 8192;

insert into replay_run_v2
select
    dictGet('project_tenant_dict', 'org_id',       project_id) as org_id,
    dictGet('project_tenant_dict', 'workspace_id', project_id) as workspace_id,
    project_id, replay_run_id, original_run_id,
    determinism, span_count_total, span_count_diverged,
    outcome, notes, started_at, finished_at, schema_version
from replay_run;

rename table replay_run to replay_run_v1, replay_run_v2 to replay_run;

-- ----------------------------------------------------------------------------
-- 7. dataset_item
-- ----------------------------------------------------------------------------
create table if not exists dataset_item_v2
(
    org_id            UUID,
    workspace_id      UUID,
    project_id        UUID,
    dataset_id        UUID,
    item_id           UUID,
    input             String,
    expected          String,
    metadata          String,
    source_run_id     Nullable(UUID),
    source_span_id    Nullable(UUID),
    created_at        DateTime64(9, 'UTC') default now64(9),
    deleted_at        Nullable(DateTime64(9, 'UTC')),
    schema_version    UInt8 default 1
)
engine = ReplacingMergeTree(created_at)
partition by toYYYYMM(created_at)
order by (org_id, project_id, dataset_id, item_id)
settings index_granularity = 8192;

insert into dataset_item_v2
select
    dictGet('project_tenant_dict', 'org_id',       project_id) as org_id,
    dictGet('project_tenant_dict', 'workspace_id', project_id) as workspace_id,
    project_id, dataset_id, item_id,
    input, expected, metadata,
    source_run_id, source_span_id, created_at, deleted_at, schema_version
from dataset_item;

rename table dataset_item to dataset_item_v1, dataset_item_v2 to dataset_item;

-- ----------------------------------------------------------------------------
-- 8. billing_meter (already has org_id; we add workspace_id and reorder)
-- ----------------------------------------------------------------------------
create table if not exists billing_meter_v2
(
    org_id            UUID,
    workspace_id      UUID,
    project_id        UUID,
    meter             LowCardinality(String),
    amount            UInt64,
    source_kind       LowCardinality(String),
    source_id         UUID,
    attributes        String,
    event_time        DateTime64(9, 'UTC'),
    received_at       DateTime64(9, 'UTC') default now64(9),
    schema_version    UInt8 default 1
)
engine = MergeTree
partition by toYYYYMM(event_time)
order by (org_id, project_id, meter, event_time)
ttl toDateTime(event_time) + interval 730 day
settings index_granularity = 8192;

insert into billing_meter_v2
select
    org_id,
    dictGet('project_tenant_dict', 'workspace_id', project_id) as workspace_id,
    project_id, meter, amount, source_kind, source_id, attributes,
    event_time, received_at, schema_version
from billing_meter;

rename table billing_meter to billing_meter_v1, billing_meter_v2 to billing_meter;
