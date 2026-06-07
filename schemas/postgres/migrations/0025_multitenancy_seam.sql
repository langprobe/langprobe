-- 0025_multitenancy_seam.sql
-- Multi-tenancy seam (postgres side).
--
-- Adds the budget + plan reference data the ingest path needs to enforce
-- per-org rate limits and monthly meter quotas. The hot-path counter lives
-- in Redis; this table is the durable budget and the reconciliation target.
--
-- `org.retention_days` lets a daily job rebuild per-partition ClickHouse TTLs
-- from one source of truth (per the multi-tenancy spec §5.7).
--
-- Plan rows are reference data: the runtime currently ships only the cloud
-- (saas) path, so `self_hosted`'s rate-limit columns are effectively unused —
-- we keep the row because the `_legacy` org from 0002 already references it
-- and dropping it would orphan that FK.

begin;

alter table org
    add column retention_days integer not null default 90;

create table plan (
    code             text primary key,
    display_name     text not null,
    rate_limit_rps   integer not null,
    rate_limit_burst integer not null,
    eval_concurrency integer not null,
    created_at       timestamptz not null default now()
);

insert into plan (code, display_name, rate_limit_rps, rate_limit_burst, eval_concurrency) values
    ('free',         'Free',         50,     200,     2),
    ('pro',          'Pro',          500,    2000,    16),
    ('enterprise',   'Enterprise',   5000,   20000,   64),
    ('self_hosted',  'Self-hosted',  50000,  200000,  64)
on conflict (code) do nothing;

create table plan_meter_limit (
    plan_code     text not null references plan (code) on delete restrict,
    meter         text not null,
    -- monthly cap; -1 means unlimited
    monthly_limit bigint not null,
    primary key (plan_code, meter)
);

-- Seed limits are placeholders; product to confirm before public launch.
insert into plan_meter_limit (plan_code, meter, monthly_limit) values
    ('free',        'span_ingested',   1000000),
    ('free',        'span_bytes',      5368709120),    -- 5 GiB
    ('free',        'eval_judge_call', 10000),
    ('pro',         'span_ingested',   50000000),
    ('pro',         'span_bytes',      268435456000),  -- 250 GiB
    ('pro',         'eval_judge_call', 500000),
    ('enterprise',  'span_ingested',   -1),
    ('enterprise',  'span_bytes',      -1),
    ('enterprise',  'eval_judge_call', -1),
    ('self_hosted', 'span_ingested',   -1),
    ('self_hosted', 'span_bytes',      -1),
    ('self_hosted', 'eval_judge_call', -1)
on conflict (plan_code, meter) do nothing;

-- Durable per-org budget. Period is the first-of-month UTC for the calendar
-- month being metered. `used_amount` is the reconciled value from ClickHouse
-- `billing_meter`; the live counter lives in Redis at
-- `quota:<org_id>:<YYYYMM>:<meter>` and is reset to this value every 60s.
create table quota_period (
    org_id          uuid not null references org (id) on delete restrict,
    period_start    date not null,
    meter           text not null,
    -- denormalized from plan_meter_limit at period open; -1 = unlimited
    limit_amount    bigint not null,
    used_amount     bigint not null default 0,
    last_reconciled timestamptz not null default now(),
    primary key (org_id, period_start, meter)
);

create index quota_period_org_idx on quota_period (org_id, period_start);

-- View consumed by ClickHouse `project_tenant_dict` so the 0006 backfill can
-- map project_id -> (workspace_id, org_id) without a service round-trip.
create or replace view project_tenant_view as
    select project.id        as project_id,
           project.workspace_id,
           workspace.org_id
    from project
    join workspace on workspace.id = project.workspace_id;

insert into schema_migrations (version) values ('0025_multitenancy_seam')
on conflict (version) do nothing;

commit;
