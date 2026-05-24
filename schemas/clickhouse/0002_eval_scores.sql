-- 0002_eval_scores.sql
-- Judge outputs and aggregate eval scores per run / span.

create table if not exists eval_score
(
    project_id        UUID,
    run_id            UUID,
    span_id           Nullable(UUID),
    -- references postgres eval_config.id
    eval_config_id    UUID,
    -- which judge in the panel produced this row
    judge_name        LowCardinality(String),
    judge_endpoint    LowCardinality(String),
    judge_version     LowCardinality(String),
    -- numeric score; rubric-defined range, app-side normalization
    score             Float64,
    -- the categorical label, if any (e.g. 'pass' | 'fail' | 'partial')
    label             LowCardinality(String) default '',
    -- judge rationale; can be long
    rationale         String,
    -- raw judge output (pre-parse), kept for replay/audit
    raw_output        String,
    -- 'ok' | 'judge_unavailable' | 'schema_violation' | 'rate_limited' | 'cost_ceiling'
    -- per ER-12, ER-13, ER-14
    outcome           LowCardinality(String) default 'ok',
    -- bookkeeping
    judged_at         DateTime64(9, 'UTC') default now64(9),
    cost_usd          Decimal(18, 8) default 0,
    schema_version    UInt8 default 1
)
engine = ReplacingMergeTree(judged_at)
partition by toYYYYMM(judged_at)
order by (project_id, eval_config_id, run_id, judge_name)
ttl toDateTime(judged_at) + interval 365 day
settings index_granularity = 8192;

-- Aggregate panel-of-LLM-judges decision per run + config
create table if not exists eval_aggregate
(
    project_id        UUID,
    run_id            UUID,
    eval_config_id    UUID,
    -- aggregation method: 'majority' | 'mean' | 'median' | 'weighted'
    method            LowCardinality(String),
    score             Float64,
    label             LowCardinality(String) default '',
    -- inter-rater agreement (krippendorff / fleiss / pct), null if N/A
    agreement         Nullable(Float64),
    -- 'reliable' | 'low_agreement' | 'judge_unavailable_threshold'
    reliability       LowCardinality(String) default 'reliable',
    judge_count       UInt8,
    aggregated_at     DateTime64(9, 'UTC') default now64(9)
)
engine = ReplacingMergeTree(aggregated_at)
partition by toYYYYMM(aggregated_at)
order by (project_id, eval_config_id, run_id)
ttl toDateTime(aggregated_at) + interval 365 day
settings index_granularity = 8192;
