# Multi-tenancy implementation spec

**Status:** Revised after office hours 2026-06-06
**Owner:** mia
**Last updated:** 2026-06-06
**Companion to:** [multi-tenancy-office-hours.md](./multi-tenancy-office-hours.md)

## 0. Office hours decisions baked in

| # | Topic | Decision |
|---|---|---|
| 1 | Workspace tier | **v1, full throttle** — column, queries, UI switcher |
| 2 | Cluster routing | **No seam, single cluster** — defer entirely |
| 3 | Per-org KMS | **Defer entirely** — disk-level encryption only |
| 4 | Quota enforcement | **Optimistic only** — no strict mode |
| 5 | Billing source | **Postgres-only** — no Stripe/Lago in v1 |
| 6 | Stream sharding | **Uniform hash now, weighted later** — TODO with failure mode in code |
| 7 | BYOC quota policy | **Collapsed into `self_hosted`** — no license JWT in v1 |
| 8 | Audit log scope | **Egress events only** — exports, share-link creation, webhook fan-out, read API; not UI detail views |
| 9 | Audit log storage | **ClickHouse only** — document reconciliation procedure for rare gaps |

## 1. Scope

Make tracebility a multi-tenant product that ships in two deployment modes from one codebase:

- **`saas`** — public cloud, shared infra, hard quotas, billing meters on.
- **`self_hosted`** — helm chart, single-tenant by default, quotas log-only.

`byoc` is collapsed into `self_hosted` for v1. When the first BYOC contract is signed, that becomes a focused project (license JWT, plan attributes from claims, optional strict mode).

Out of scope for this spec:
- Stripe / Lago wiring (deferred until first paying customer).
- Multi-cluster routing (`cluster_id` / `region` columns) — deferred.
- Per-org KMS encryption-at-rest — deferred. Disk-level encryption (EBS/GP3) is the v1 posture.
- License JWT verification — deferred.
- Region pinning — deferred (single-region deployment).
- SSO/SCIM beyond what already exists in migrations 0019/0020.
- BYOC control-plane (Terraform, customer-VPC reach-in).

## 2. Current state (what we already have)

- **Postgres**: `org`, `workspace`, `project`, `app_user`, `membership`, `api_key`, `audit_log` exist. `api_key.project_id` already scopes ingest credentials to a project (and via FK chain to a workspace and org).
- **ClickHouse**: `run`, `span`, `eval_score`, `replay_capture`, `dataset_item` carry `project_id` only. `billing_meter` already carries both `org_id` and `project_id`.
- **Ingest path**: `ingest-api` → Redis stream `tracebility:ingest:v1` → `ingest-worker` → ClickHouse. No rate limit, no quota.
- **Read path**: `api` service reads ClickHouse directly with `project_id` filter.
- **Deployment mode**: implicit (single-tenant assumption everywhere).
- **Audit log**: postgres `audit_log` table from migration 0005. Will be deprecated in favor of ClickHouse `audit_log` (see §5.8).

## 3. Goals

1. Every ClickHouse trace row carries `(org_id, workspace_id, project_id)`. Reads are rejected unless `org_id` is filtered.
2. One env var (`TRACEBILITY_DEPLOYMENT_MODE`) drives the runtime branch points (auto-org creation, quota enforcement, auth backend selection).
3. Rate limiting at the ingest edge protects the shared stream from a runaway tenant.
4. Quota meters run on every deployment; only `saas` mode hard-blocks at exhaustion (optimistic, ~60s overshoot acceptable).
5. The eval orchestrator cannot be starved by one tenant.
6. Compliance v1: ClickHouse `audit_log` covers data-egress events; per-org retention TTL is enforceable.
7. Workspace is a first-class tier from day one — column on every trace row, RBAC scope, UI switcher.

## 4. Non-goals (explicitly)

- Rewriting the ingest schema. We add columns; we do not change column meanings.
- Forking the writer for "multi-tenant mode." One writer, one path.
- Implementing billing reconciliation logic in this spec (the meters land; the invoice generator is separate).
- Any code path predicated on `cluster_id`, `region`, `cipher_version`, `license_jwt`, `enforcement_mode`. These are deferred.

## 5. Architecture changes

### 5.1 Tenant-aware row identity

Every ClickHouse trace table grows two columns:

```sql
org_id        UUID
workspace_id  UUID
```

`ORDER BY` clauses are extended to put `org_id` first, so partition pruning makes per-tenant reads near-free:

```sql
-- run
order by (org_id, project_id, start_time, run_id)
-- span
order by (org_id, project_id, run_id, span_id)
-- eval_score, replay_capture, dataset_item — same shape
```

`workspace_id` is not in the order key (it is a secondary filter, not a partition driver) but lives in every row and is always filtered server-side via the query-builder when a workspace-scoped role is in play.

### 5.2 Ingest-key resolver

Existing `api_key` row already binds to a `project_id` → `workspace_id` → `org_id`. We add a Redis-cached resolver in front so the hot path doesn't hit postgres on every envelope:

- Cache key: `apikey:<public_id>`
- Cache value: `{org_id, workspace_id, project_id, scopes, plan, revoked_at, expires_at}`
- TTL: 60s
- Negative cache (unknown / revoked): 30s
- Invalidation: `api_key` writes publish on Redis pub/sub channel `apikey:invalidate`; resolver subscribes and busts the entry.

Resolver returns a typed `TenantContext` that is threaded through the request:

```python
@dataclass(frozen=True)
class TenantContext:
    org_id: UUID
    workspace_id: UUID
    project_id: UUID
    scopes: frozenset[str]
    plan: str
```

### 5.3 Deployment-mode flag

```
TRACEBILITY_DEPLOYMENT_MODE = saas | self_hosted
```

Single source of truth in `tracebility.config.deployment_mode`. Behavior matrix:

| Behavior | `saas` | `self_hosted` |
|---|---|---|
| Auto-create default org on boot | no | yes |
| Quota: meter | yes | yes |
| Quota: hard-block at 100% | yes (optimistic) | no (log only) |
| Rate limit at edge | yes (per-plan) | yes (generous defaults) |
| Stripe webhook handler | unregistered (v1) | unregistered |
| Auth: local password | yes | yes |
| Auth: SSO | yes | yes |
| Default org plan | `free` | `self_hosted` |

### 5.4 Rate limiting

Token bucket per ingest key, in Redis, at the ingest-api edge.

- Key: `rl:ingest:<public_id>`
- Algorithm: GCRA (single Redis script, atomic).
- Limits per plan, env-driven:
  - `free`: 50 req/s, burst 200
  - `pro`: 500 req/s, burst 2000
  - `enterprise`: 5000 req/s, burst 20000
  - `self_hosted`: 50000 req/s, burst 200000 (effectively off)
- Response on exhaustion: `429 Too Many Requests` with `Retry-After` and `X-RateLimit-Reset` headers.
- Bypass: `internal:*` scope on the key (used by migrate-langsmith bulk imports).

### 5.5 Quota / metering (optimistic only)

One postgres table for the budget, one ClickHouse table for the audit trail (already exists as `billing_meter`).

**Postgres `quota_period` (the budget):**

```sql
create table quota_period (
    org_id           uuid not null references org (id) on delete restrict,
    period_start     date not null,        -- first of month, UTC
    meter            text not null,
    limit_amount     bigint not null,      -- from plan; -1 = unlimited
    used_amount      bigint not null default 0,
    last_reconciled  timestamptz not null default now(),
    primary key (org_id, period_start, meter)
);
```

**Hot-path counter in Redis** (optimistic, eventually reconciled):

- Key: `quota:<org_id>:<YYYYMM>:<meter>`
- INCRBY on every metered event; never blocks the write.
- Soft-warn at 80% (emits ClickHouse `audit_log` row + UI banner).
- Reconciliation job every 60s:
  1. SUM from `billing_meter` for the current period.
  2. UPDATE `quota_period.used_amount` and `last_reconciled`.
  3. SET Redis counter to authoritative value.
- Hard-block (only in `saas` mode): if `redis_counter > limit_amount`, ingest-api returns `402 Payment Required` for new envelopes and the worker stops draining for that org's stream shard. Worst-case overshoot ≈ 60s.

**Meters tracked (v1):**

| Meter | Unit | Counted at |
|---|---|---|
| `span_ingested` | spans | ingest-api (after auth, before enqueue) |
| `span_bytes` | bytes | ingest-api (envelope body length) |
| `eval_judge_call` | calls | eval-orchestrator (per judge invocation) |
| `eval_judge_tokens` | tokens | eval-orchestrator (sum of judge prompt+completion) |
| `replay_run` | runs | replay service |

### 5.6 Noisy-neighbor mitigations

- **Redis stream sharding (uniform hash).** Replace single `tracebility:ingest:v1` with N shards: `tracebility:ingest:v1:{0..15}`. Routing: `shard = mxmh3(org_id) % N`. One runaway org fills its shard, not the whole stream. Each worker reads round-robin across shards with a per-shard fairness budget.
  > **TODO** (post-v1): when a single tenant saturates one shard for sustained periods, replace uniform hash with a weighted shard map (postgres `org.shard_assignment text[]`) so big tenants get dedicated shards. Failure mode: persistent backlog skew on shard X with worker X CPU pinned.
- **Eval orchestrator concurrency cap.** Per-org semaphore in Redis: `eval:concurrency:<org_id>`. Enforced at job dispatch. Plan-driven cap (free: 2, pro: 16, enterprise: 64). Jobs above the cap stay in the queue.
- **Read API query budget.** Each `TenantContext` gets an in-process budget (queries/min, max scanned rows). Exceeded → `429`. Implemented as a middleware decorator on the router classes.

### 5.7 Compliance posture (v1)

- **Audit log writes** (ClickHouse, see §5.8) for the data-egress events:
  - Export endpoints (CSV / JSON / Parquet downloads).
  - Public share-link creation.
  - Webhook fan-out of run/span content.
  - Read API endpoints that return `inputs` / `outputs` columns.
  - Plus the identity events: API key creation/revocation, role changes, login.
  - **Not** logged: UI detail-view renders. Those are covered by the session/login event.
- **Retention TTL** is per-org, stored on `org.retention_days` (default 90). A daily job builds per-partition TTL DDL based on the org rows and runs `ALTER TABLE ... MODIFY TTL`.
- **Disk-level encryption** (EBS/GP3 default-encrypted volumes) is the v1 encryption-at-rest posture. No per-row KMS, no `cipher_version` column.

### 5.8 Audit log storage (ClickHouse only)

The postgres `audit_log` table from migration 0005 is **deprecated**. New writes go to a new ClickHouse `audit_log` table:

```sql
create table if not exists audit_log
(
    org_id           UUID,
    workspace_id     Nullable(UUID),
    actor_user_id    Nullable(UUID),
    actor_api_key_id Nullable(UUID),
    -- 'login' | 'api_key.create' | 'api_key.revoke' | 'role.change'
    -- | 'export.run' | 'export.span' | 'share_link.create'
    -- | 'webhook.dispatch' | 'read_api.inputs_outputs' | 'quota.warn' | 'quota.block'
    event_type       LowCardinality(String),
    -- target row kind: 'run' | 'span' | 'project' | 'api_key' | 'user' | ''
    target_kind      LowCardinality(String),
    target_id        Nullable(UUID),
    -- json payload (request id, ip, user-agent, scope diff, export size, ...)
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
```

**Reconciliation procedure** (operational, for the auditor evidence pack): a daily job compares postgres state changes against ClickHouse audit rows for the same primary keys. Gaps are flagged in a `audit_reconciliation_gap` log. Auditors accept "we have a documented gap-detection process" in lieu of distributed-transaction guarantees. Identity-event gaps are extremely rare (require a process crash between commit and ClickHouse insert) and easily recovered by replaying postgres history.

The postgres `audit_log` table is read-only after this migration lands, kept for one release as a back-reference, then dropped.

## 6. Migrations

### 6.1 Postgres

New migration: `0023_multitenancy_seam.sql`:

```sql
begin;

alter table org
    add column retention_days   integer not null default 90;

create table quota_period (
    org_id           uuid not null references org (id) on delete restrict,
    period_start     date not null,
    meter            text not null,
    limit_amount     bigint not null,
    used_amount      bigint not null default 0,
    last_reconciled  timestamptz not null default now(),
    primary key (org_id, period_start, meter)
);
create index quota_period_org_idx on quota_period (org_id, period_start);

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
    plan_code       text not null references plan (code) on delete restrict,
    meter           text not null,
    monthly_limit   bigint not null,        -- -1 = unlimited
    primary key (plan_code, meter)
);

-- Seed limits are placeholders; product to confirm before public launch.
insert into plan_meter_limit (plan_code, meter, monthly_limit) values
    ('free',        'span_ingested',     1000000),
    ('free',        'span_bytes',        5368709120),    -- 5 GB
    ('free',        'eval_judge_call',   10000),
    ('pro',         'span_ingested',     50000000),
    ('pro',         'span_bytes',        268435456000),  -- 250 GB
    ('pro',         'eval_judge_call',   500000),
    ('enterprise',  'span_ingested',     -1),
    ('enterprise',  'span_bytes',        -1),
    ('enterprise',  'eval_judge_call',   -1),
    ('self_hosted', 'span_ingested',     -1),
    ('self_hosted', 'span_bytes',        -1),
    ('self_hosted', 'eval_judge_call',   -1)
on conflict (plan_code, meter) do nothing;

insert into schema_migrations (version) values ('0023_multitenancy_seam')
on conflict (version) do nothing;

commit;
```

### 6.2 ClickHouse

New migrations:

- `0006_tenant_columns.sql` — adds `org_id`/`workspace_id` to trace tables, swaps `ORDER BY`.
- `0007_audit_log.sql` — creates the new ClickHouse `audit_log` table.

#### 6.2.1 Tenant columns + ORDER BY swap

ClickHouse cannot reorder primary key columns in place. Standard CREATE-INSERT-RENAME swap, with a postgres-backed dictionary providing `project_id → (workspace_id, org_id)`:

```sql
-- Postgres-side view consumed by the dictionary:
-- create view project_tenant_view as
--   select p.id as project_id, p.workspace_id, w.org_id
--   from project p join workspace w on w.id = p.workspace_id;

create dictionary if not exists project_tenant_dict
(
    project_id    UUID,
    workspace_id  UUID,
    org_id        UUID
)
primary key project_id
source(postgresql(
    host 'postgres' port 5432 db 'tracebility' user 'tracebility' password '...'
    table 'project_tenant_view'
))
lifetime(min 300 max 600)
layout(complex_key_hashed());

-- For each table (run, span, eval_score, replay_capture, dataset_item):
--   1. Create *_v2 with org_id, workspace_id columns and reordered ORDER BY.
--   2. INSERT INTO *_v2 SELECT *, dictGet(...) FROM *.
--   3. RENAME * TO *_v1; *_v2 TO *.

create table run_v2 (
    org_id            UUID,
    workspace_id      UUID,
    project_id        UUID,
    -- ... all existing columns unchanged ...
)
engine = ReplacingMergeTree(received_at)
partition by toYYYYMM(start_time)
order by (org_id, project_id, start_time, run_id)
ttl toDateTime(start_time) + interval 90 day
settings index_granularity = 8192;

insert into run_v2 select
    dictGet('project_tenant_dict', 'org_id', project_id) as org_id,
    dictGet('project_tenant_dict', 'workspace_id', project_id) as workspace_id,
    project_id, run_id, parent_run_id, name, kind, status, start_time, end_time,
    duration_ns, inputs, outputs, inputs_obj_ref, outputs_obj_ref,
    prompt_tokens, completion_tokens, total_tokens, cost_usd,
    sdk, sdk_version, session_id, user_id, tags, metadata,
    error_kind, error_message, received_at, schema_version
from run;

rename table run to run_v1, run_v2 to run;
-- (repeat for span, eval_score, replay_capture, dataset_item)
```

`*_v1` tables are kept for one release as a rollback target, then dropped.

`billing_meter` already has `org_id`; `workspace_id` is added with the same swap.

#### 6.2.2 Audit log

`0007_audit_log.sql` creates the table defined in §5.8. A backfill query copies existing rows from postgres `audit_log` into the new table for continuity, then postgres `audit_log` is marked read-only by the application (no DROP — kept one release for back-reference).

## 7. Code changes — by service

### 7.1 `ingest-api`

- Add `tracebility_ingest/tenant.py` with the Redis-cached resolver and `TenantContext`.
- `auth.py` returns a `TenantContext` instead of a bare `(project_id, scopes)` tuple.
- `enqueue.py` stamps `org_id`, `workspace_id` onto every envelope before push.
- New middleware `rate_limit.py` in front of all ingest routes; reads `plan` off context, runs the GCRA Redis script.
- New middleware `quota_check.py`. In `saas` mode, rejects with `402` when over hard cap. In `self_hosted` mode, increments the meter and returns.
- New shard router `enqueue.py::_shard_for(org_id)`; replace single-stream push with shard push. Includes the `# TODO: weighted map when one tenant saturates a shard` comment from §5.6.

### 7.2 `ingest-worker`

- Read from N stream shards round-robin (existing consumer-group flow generalized).
- `writer.py::_row_for_run` and `_row_for_span` thread `org_id` and `workspace_id` from the envelope into row tuples. Update `_RUN_COLUMNS`, `_SPAN_COLUMNS`, `_REPLAY_CAPTURE_COLUMNS`.
- `replay_capture` row gets `workspace_id`.
- Per-org backpressure: if `quota_period.used_amount > limit_amount` and mode is `saas`, the worker logs and skips draining the org's shard until reconciliation says otherwise. (Backlog stays in Redis; entries are not lost.)

### 7.3 `api`

- All route handlers depend on a `TenantContext` resolved from the request (session cookie or read API key).
- Single query-builder enforces `WHERE org_id = ?` (and, for workspace-scoped roles, `AND workspace_id = ?`) on every ClickHouse query. A test asserts that a query without `org_id` raises at compile time.
- New `audit.py` writes to ClickHouse `audit_log` for the events listed in §5.7.
- Top nav grows a workspace switcher; route handlers honor the active workspace from session.
- New router `routers/admin/quotas.py` exposes per-org quota usage so the UI can render meter bars.
- New router `routers/admin/audit.py` reads from ClickHouse `audit_log` for the admin UI.

### 7.4 `eval-orchestrator`

- Job dispatcher acquires `eval:concurrency:<org_id>` semaphore (Redis Lua). On failure, requeues with delay.
- Records `eval_judge_call` and `eval_judge_tokens` to `billing_meter`.

### 7.5 `migrate-langsmith`

- Inherits the `internal:*` scope path so its bulk imports bypass the rate limiter (still metered for quota).

### 7.6 New shared module: `tracebility/tenant`

Lives in `services/_shared/tenant/` (uv workspace member). Provides:

- `TenantContext` dataclass.
- `Resolver` interface with two implementations: `PostgresBackedResolver` (with Redis cache) and `StaticResolver` (for `self_hosted` single-org mode).
- `DeploymentMode` enum and `current_mode()` helper.
- `RateLimiter` GCRA implementation.
- `QuotaMeter` (record + check helpers).
- `ShardRouter` (uniform hash; weighted-map TODO documented).
- `AuditWriter` writing to ClickHouse `audit_log`.

All four services import from this module to keep the contracts identical.

## 8. Testing strategy

- **Unit tests** per service for the resolver, rate limiter, quota check, shard router, audit writer.
- **Integration tests** in `tests/integration/multitenancy/`:
  - Two orgs ingest concurrently; reads from one org never see the other's rows. (Repeat for spans, eval_scores, replay_captures, audit_log.)
  - Two workspaces in one org: workspace A's reader cannot see workspace B's runs.
  - Rate-limit exhaustion produces `429`.
  - Quota exhaustion produces `402` in `saas` mode and a `quota.warn` row in ClickHouse `audit_log` in `self_hosted` mode.
  - Eval orchestrator: org A can saturate its concurrency cap; org B's jobs still drain.
  - Migration: `run_v2` after rename has same row count and same content (modulo new columns) as `run_v1`.
  - Audit reconciliation job: simulated gap (audit row missing for a known postgres state change) is detected and reported.
- **Property test**: every ClickHouse query produced by the read API mentions `org_id` in its `WHERE` clause. Implemented as an AST visitor over the query-builder output.
- **Load test**: 1M spans/min on a single shared cluster across 4 simulated orgs with skew (one big, three small). Verify p99 ingest latency for the small orgs does not regress.

## 9. Rollout

Phased on shared infra; one tenant exists today (`_legacy` org).

1. **Migration 0023** (postgres): adds `org.retention_days`, `plan`, `plan_meter_limit`, `quota_period` tables. Backfills `_legacy` org with `retention_days=90`, `plan='self_hosted'`. Safe; additive.
2. **Migration 0006** (clickhouse): tenant-column table swap. Done in a maintenance window. `*_v1` retained for one release.
3. **Migration 0007** (clickhouse): new `audit_log` table; backfill from postgres.
4. **Shared `tenant` module** released to all four services together.
5. **Ingest-api**: resolver + envelope stamping + meter increment. Rate limiter and quota hard-block gated behind `TRACEBILITY_DEPLOYMENT_MODE=saas` so on-prem is unaffected.
6. **Ingest-worker**: writes new columns. Tolerates either schema by detecting column presence until step 2 lands everywhere.
7. **API**: query-builder rewrite + property test. Old direct-SQL paths removed. Workspace switcher + workspace-scoped queries land here.
8. **Eval orchestrator**: per-org semaphore.
9. **Stream sharding**: cut over from single stream to N shards. Workers run a brief dual-read window to drain the old stream before it is deleted.
10. **`/admin/quotas`** and **`/admin/audit`** UI surfaces go live.
11. **Audit reconciliation job** scheduled (daily).

Each step is independently revertible. Steps 1–3 must land before any service code that depends on the new columns.

## 10. Risks & mitigations

| Risk | Mitigation |
|---|---|
| ClickHouse table swap loses rows | Keep `*_v1` tables for one release; row-count assertion before rename; rehearse on staging. |
| Resolver cache stale after key revocation | Pub/sub invalidation channel; 60s TTL ceiling. |
| Optimistic quota lets a tenant overshoot | Reconciler runs every 60s; soft-warn at 80% gives early signal; hard-block kicks in within ~60s of breach. Documented in SaaS terms. |
| Stream shard imbalance from one big tenant | Uniform hash is the v1 bet. TODO + alerting on shard-level backlog skew. Replace with weighted map when triggered. |
| On-prem operators don't want quota UI noise | `TRACEBILITY_DEPLOYMENT_MODE=self_hosted` defaults to log-only and unlimited plan. Quota meters run silently for usage-page display. |
| Per-org TTL via `MODIFY TTL` is slow | Daily job, not per-write. |
| ClickHouse audit_log gap on crash between postgres commit and ClickHouse insert | Daily reconciliation job compares state to audit history, flags gaps for the auditor evidence pack. Documented as the operational tradeoff for the simplicity win. |
| Workspace adds UI complexity for single-team customers | Default workspace is `main`; switcher hides when only one workspace exists. |
| Future BYOC contract demands strict quota / region pinning / KMS | Each is a focused project, not a prerequisite. Spec sections explicitly mark what's deferred. |

## 11. Resolved (was: Open questions)

All five v1 open questions resolved in office hours 2026-06-06; see §0. Remaining product input:
- Plan limit numbers in §6.1 are placeholders; product to confirm before public launch.

## 12. Deliverables checklist

- [ ] `0023_multitenancy_seam.sql` (postgres)
- [ ] `0006_tenant_columns.sql` (clickhouse)
- [ ] `0007_audit_log.sql` (clickhouse)
- [ ] `services/_shared/tenant/` module
- [ ] Ingest-api: resolver, rate limiter, quota check, shard router
- [ ] Ingest-worker: tenant-aware writer, multi-shard consumer
- [ ] API: query-builder enforcing `org_id` (+ `workspace_id` when role-scoped), audit-log egress events, workspace switcher
- [ ] Eval orchestrator: per-org semaphore
- [ ] Reconciler job (`services/_shared/quota/reconciler.py`)
- [ ] Audit reconciliation job (`services/_shared/audit/reconciler.py`)
- [ ] `/admin/quotas` and `/admin/audit` UI surfaces
- [ ] Integration test pack (incl. workspace isolation + audit gap detection)
- [ ] Helm chart values for `deploymentMode`
