-- 0011_alerts.sql
-- Alert rules and incidents.
--
-- An `alert_rule` watches a single ClickHouse-backed metric (error_rate,
-- latency_p95, runs, cost_usd) over a sliding window and fires when the
-- value crosses a threshold. Evaluation is server-driven: a periodic
-- evaluator (cron-style, 60s default) re-queries the same `run` table
-- the Monitoring page does, compares to the rule's threshold, and either
-- opens an incident or resolves an existing one.
--
-- Every fire/resolve writes one row to `alert_event` so the UI can show
-- a flat history without scanning ClickHouse. An `incident` is just the
-- pair of (firing event, resolving event) joined by `incident_id`; we
-- keep the open incident's event id on the rule itself
-- (`open_incident_id`) so evaluator decisions are O(1) lookups.
--
-- Routes (slack/pagerduty/webhook/email) live in jsonb on the rule.
-- Actually delivering them is out of scope for v1; the rule still
-- evaluates and the incident still appears in the UI so the
-- self-improvement loop can ship the engine before the channels.

begin;

create table alert_rule (
    id uuid primary key default gen_random_uuid(),
    project_id uuid not null references project (id) on delete restrict,
    name text not null,
    -- 'error_rate' | 'latency_p95_ms' | 'runs_per_min' | 'cost_usd'
    metric text not null check (
        metric in ('error_rate', 'latency_p95_ms', 'runs_per_min', 'cost_usd')
    ),
    -- '>' | '>=' | '<' | '<='
    comparator text not null check (
        comparator in ('>', '>=', '<', '<=')
    ),
    threshold double precision not null,
    -- evaluator scans the last `window_seconds` of run rows; same shape
    -- the Monitoring page uses. Bounded so a misconfigured rule can't
    -- ask ClickHouse for a year of data on every tick.
    window_seconds integer not null check (window_seconds between 60 and 86400),
    -- routes is a list of {kind, target} dicts; v1 only stores them.
    routes jsonb not null default '[]'::jsonb,
    enabled boolean not null default true,
    -- last evaluator tick (success or failure); null until first run.
    last_evaluated_at timestamptz,
    last_value double precision,
    -- pointer to the currently-open incident's firing event, if any.
    open_incident_id uuid,
    created_by uuid references app_user (id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create trigger alert_rule_updated_at
    before update on alert_rule
    for each row execute function set_updated_at();

create index alert_rule_project_id_idx on alert_rule (project_id);
create index alert_rule_enabled_idx on alert_rule (enabled) where enabled;

create table alert_event (
    id uuid primary key default gen_random_uuid(),
    rule_id uuid not null references alert_rule (id) on delete cascade,
    project_id uuid not null references project (id) on delete restrict,
    -- 'fired' | 'resolved'
    kind text not null check (kind in ('fired', 'resolved')),
    -- value at the moment of firing/resolving (e.g. 0.034 for 3.4% error rate)
    value double precision not null,
    -- threshold at the moment of firing (snapshot for history fidelity)
    threshold double precision not null,
    occurred_at timestamptz not null default now(),
    -- both events for one incident share this id; evaluator stamps it.
    incident_id uuid not null
);

create index alert_event_rule_id_idx on alert_event (rule_id);
create index alert_event_project_id_idx on alert_event (project_id);
create index alert_event_incident_id_idx on alert_event (incident_id);
create index alert_event_occurred_at_idx on alert_event (occurred_at desc);

alter table alert_rule
    add constraint alert_rule_open_incident_fk
    foreign key (open_incident_id)
    references alert_event (id)
    deferrable initially deferred;

insert into schema_migrations (version) values ('0011_alerts')
on conflict (version) do nothing;

commit;
