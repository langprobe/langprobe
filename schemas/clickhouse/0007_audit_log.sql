-- 0007_audit_log.sql
-- ClickHouse audit_log per multi-tenancy spec §5.8.
--
-- Postgres `audit_log` (from migration 0005) is read-only after this lands.
-- New writes go here. The reconciliation procedure (services/_shared/audit/
-- reconciler.py) compares postgres state changes to ClickHouse audit rows
-- daily and flags gaps for the auditor evidence pack.
--
-- event_type lexicon (kept narrow on purpose; widen with intent):
--   identity:  login | logout
--              api_key.create | api_key.revoke
--              role.change
--   egress:    export.run | export.span
--              share_link.create
--              webhook.dispatch
--              read_api.inputs_outputs
--   quota:     quota.warn | quota.block
--
-- target_kind lexicon: run | span | project | api_key | user | share_link |
--                     webhook | dataset | '' (empty when no single target)

create table if not exists audit_log
(
    org_id           UUID,
    workspace_id     Nullable(UUID),
    actor_user_id    Nullable(UUID),
    actor_api_key_id Nullable(UUID),
    event_type       LowCardinality(String),
    target_kind      LowCardinality(String),
    target_id        Nullable(UUID),
    -- json payload: request_id, ip, user_agent, scope diff, export size, ...
    attributes       String,
    event_time       DateTime64(9, 'UTC'),
    received_at      DateTime64(9, 'UTC') default now64(9),
    schema_version   UInt8 default 1
)
engine = MergeTree
partition by toYYYYMM(event_time)
order by (org_id, event_time, event_type)
ttl toDateTime(event_time) + interval 730 day
settings index_granularity = 8192;

-- Bloom-filter the actor + target so per-user / per-target lookups in the
-- admin UI don't full-scan the org's history.
alter table audit_log add index idx_audit_actor actor_user_id type bloom_filter granularity 4;
alter table audit_log add index idx_audit_target target_id      type bloom_filter granularity 4;

-- audit_reconciliation_gap: where the daily reconciler logs detected misses
-- between the postgres state stream and ClickHouse audit rows. Auditors care
-- that we DETECT gaps; the rows themselves go here.
create table if not exists audit_reconciliation_gap
(
    org_id          UUID,
    -- 'audit_missing' | 'state_missing'
    gap_kind        LowCardinality(String),
    expected_event  LowCardinality(String),
    target_kind     LowCardinality(String),
    target_id       Nullable(UUID),
    pg_row_id       Nullable(UUID),
    -- json: full reconciler diagnostic for the auditor evidence pack
    diagnostic      String,
    detected_at     DateTime64(9, 'UTC') default now64(9),
    detection_run   UUID
)
engine = MergeTree
partition by toYYYYMM(detected_at)
order by (org_id, detected_at, gap_kind)
ttl toDateTime(detected_at) + interval 730 day
settings index_granularity = 8192;
