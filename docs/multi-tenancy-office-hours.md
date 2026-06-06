# Multi-tenancy & SaaS readiness — office hours notes

**Author:** mia · **Date:** 2026-06-06 · **With:** gstack
**Status:** Closed — decisions captured below; spec updated in [multi-tenancy-spec.md](./multi-tenancy-spec.md)

## Goal (going in)

Make tracebility a true multi-tenant product so it can ship as **(a) public SaaS**, **(b) BYOC / dedicated cloud**, and **(c) on-prem helm chart + license** — without forking the codebase.

## Decisions

| # | Topic | Decision | Rationale |
|---|---|---|---|
| 1 | Workspace tier (v1 vs v2) | **v1, full throttle** | Cost is not the constraint. RBAC scope is correct from day one; second migration avoided. |
| 2 | Two-tier cluster routing | **No seam, single cluster** | Untested seams rot. Add `cluster_id` when first enterprise/BYOC deal forces it. |
| 3 | Per-org KMS encryption | **Defer entirely** | EBS/GP3 disk encryption is sufficient for SOC2. Per-row KMS is a HIPAA/FedRAMP concern, not v1. |
| 4 | Quota enforcement | **Optimistic only** | ~60s overshoot acceptable for observability data. No strict-mode flag. Add later if a contract demands it. |
| 5 | Billing source of truth | **Postgres-only** | No Stripe / Lago in v1. Manual invoicing for the first ~10 customers. |
| 6 | Stream sharding | **Uniform hash now, weighted later** | `hash(org_id) % 16`. TODO + alerting on shard-level backlog skew. Replace with weighted map when triggered. |
| 7 | BYOC quota policy | **Collapsed into `self_hosted`** | No license JWT in v1. BYOC becomes a focused project when the first contract is signed. |
| 8 | Audit log scope | **Egress events only** | Exports, share-link creation, webhook fan-out, read-API hits that return inputs/outputs. UI detail views covered by session log. |
| 9 | Audit log storage | **ClickHouse only** | Postgres is the wrong store at SaaS volume. Reconciliation procedure documented for the auditor evidence pack. |

## Final tenant model

```
org (billing boundary, plan, retention_days)
 └── workspace (team boundary, RBAC scope) — first-class in v1
      └── project (existing concept — app/env)
```

- `org_id` → billing, plan, retention.
- `workspace_id` → RBAC (`workspace:viewer|editor`, `org:admin`), logical isolation between teams.
- `project_id` → already exists; unchanged.
- Ingest keys resolve to `(org_id, workspace_id, project_id, scopes, plan)` — Redis-cached from postgres on the hot path.

## Final deployment matrix

Two modes only. `byoc` collapses into `self_hosted` for v1.

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

## Final data isolation

Single shared cluster. No `cluster_id`, no `region`. ClickHouse trace tables grow `org_id` and `workspace_id` columns; `ORDER BY` puts `org_id` first so partition pruning gives near-free per-tenant reads. `workspace_id` is filtered by the query-builder when a workspace-scoped role is in play.

## Final compliance posture (v1)

- ClickHouse `audit_log` table for egress events (exports, share links, webhooks, read-API inputs/outputs returns) and identity events (login, key lifecycle, role changes).
- Per-org retention TTL via daily `ALTER TABLE ... MODIFY TTL` job, keyed off `org.retention_days`.
- Disk-level encryption only (EBS/GP3 default-encrypted).
- Audit reconciliation job (daily): compares postgres state to ClickHouse audit history, flags gaps for the auditor evidence pack.

## Deferred (with the trigger that brings each back)

| Deferred | Reactivation trigger |
|---|---|
| `cluster_id` / `region` routing | First enterprise BYOC contract or first compliance buyer demanding region pinning. |
| Per-org KMS encryption | First HIPAA / FedRAMP / financial-services buyer. |
| Strict-mode quota (synchronous Redis check) | First contract clause requiring hard usage cap. |
| License JWT for `byoc` | First BYOC deal signed. |
| Stripe / Lago billing | First paying customer (after the manual-invoicing cohort of ~10). |
| Weighted shard map | A single tenant saturates one shard for sustained periods. |
| Workspaces hidden when single | Default workspace is `main`; switcher hides automatically. |

## Open items remaining

Only one, and it's product-side, not engineering:

- Plan limit numbers in the spec (`free` / `pro` / `enterprise` monthly meter limits) are placeholders. Product confirms before public launch.

## Migration shape (final)

1. `0023_multitenancy_seam.sql` (postgres) — `org.retention_days`, `plan`, `plan_meter_limit`, `quota_period`. Additive.
2. `0006_tenant_columns.sql` (clickhouse) — add `org_id`/`workspace_id`, swap `ORDER BY` via CREATE-INSERT-RENAME. `*_v1` retained one release.
3. `0007_audit_log.sql` (clickhouse) — new `audit_log` table; backfill from postgres.
4. Shared `services/_shared/tenant/` module (`TenantContext`, `Resolver`, `RateLimiter`, `QuotaMeter`, `ShardRouter`, `AuditWriter`).
5. Ingest-api: resolver, envelope stamping, rate limiter, quota check, shard router.
6. Ingest-worker: tenant-aware writer, multi-shard consumer.
7. API: query-builder enforces `org_id`, workspace switcher in UI, audit egress events.
8. Eval orchestrator: per-org semaphore.
9. Stream sharding cutover; old single stream drained then deleted.
10. `/admin/quotas` and `/admin/audit` UI surfaces.
11. Audit reconciliation job (daily).

Full detail in [multi-tenancy-spec.md](./multi-tenancy-spec.md).
