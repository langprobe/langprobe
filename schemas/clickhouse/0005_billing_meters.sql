-- 0005_billing_meters.sql
-- Usage meters. Per CEO plan ER-24: billing-meter writes must never silently
-- lose data. Disk-buffer fallback at the app layer; this is the destination.

create table if not exists billing_meter
(
    project_id        UUID,
    org_id            UUID,
    -- 'span_ingested' | 'span_bytes' | 'eval_judge_call' | 'eval_judge_tokens'
    -- | 'replay_capture_bytes' | 'replay_run' | 'object_storage_bytes'
    meter             LowCardinality(String),
    -- amount metered in this event (counts, bytes, tokens, ...)
    amount            UInt64,
    -- the source event id (run_id, span_id, eval_score row, replay_run, ...)
    source_kind       LowCardinality(String),
    source_id         UUID,
    -- arbitrary attributes (model, judge_name, etc.)
    attributes        String,
    -- when the metered event happened (event-time, not ingest-time)
    event_time        DateTime64(9, 'UTC'),
    received_at       DateTime64(9, 'UTC') default now64(9),
    schema_version    UInt8 default 1
)
engine = MergeTree
partition by toYYYYMM(event_time)
order by (org_id, project_id, meter, event_time)
ttl toDateTime(event_time) + interval 730 day
settings index_granularity = 8192;
