# LangSmith parity loop

Self-improvement tracker. The loop is:

1. **Compare** — score current state against LangSmith on every dimension.
2. **Plan** — pick the highest-leverage gap.
3. **Build** — ship a real implementation (not a roadmap page).
4. **Re-compare** — go to step 1.

Stop only when no dimension is materially behind LangSmith.

## Legend

- ✅ **shipped** — real, working feature in tracebility today.
- 🟡 **partial** — backend or UI exists, the other half doesn't, or it's a roadmap page only.
- ❌ **missing** — nothing exists for this dimension.

## Current scoreboard (loop iteration #0)

Generated 2026-06-03 after the first sidebar pass (8 LangSmith-equivalent surfaces added as roadmap pages).

### Tracing

| Feature | Status | Notes |
|---|---|---|
| Run/span ingest | ✅ | `/v1/runs` (api), ClickHouse `runs_and_spans` |
| Run list view | ✅ | `/runs` page renders real data |
| Run detail (3-pane debugger) | ✅ | spans tree + timeline + inspector |
| OTel/OpenInference ingestion | ❌ | translation layer not built |
| LangChain callback bridge | ❌ | shim package not built |
| LangGraph callback bridge | ❌ | shim package not built |
| OpenAI Agents SDK ingest | ❌ | shim package not built |
| `wrap_openai` / `wrap_anthropic` | ❌ | shim package not built |
| Multipart `/runs/multipart` | ❌ | endpoint not built |
| Migration importer (LS export → tb) | ❌ | tool not built |

### Observability surfaces

| Feature | Status | Notes |
|---|---|---|
| Threads (multi-turn sessions) | 🟡 | roadmap page; needs `session_id` rollup view |
| Monitoring dashboards | 🟡 | roadmap page; `/v1/metrics` backend exists |
| Alerts | 🟡 | roadmap page; no rules engine |
| Saved filters / views | ❌ | not designed |
| Bulk actions on runs | ❌ | not designed |

### Eval + improvement

| Feature | Status | Notes |
|---|---|---|
| Datasets | 🟡 | postgres tables exist, no UI/API |
| Prompts (versioning + tags) | 🟡 | postgres tables exist, no UI/API |
| Evals (single-judge) | 🟡 | clickhouse `eval_score` exists, no runner |
| Evals (PoLL multi-judge) | ❌ | not built |
| Luna prompted-judges | ❌ | not built |
| Comparisons (A/B experiments) | 🟡 | roadmap page only |
| Playground | 🟡 | roadmap page only |
| Annotations queue | 🟡 | roadmap page only |
| Feedback (end-user signal) | 🟡 | roadmap page only |
| Replay (deterministic re-run) | 🟡 | clickhouse `replay_captures` exists, no capture writer |
| Studio (visual canvas) | 🟡 | roadmap page only; depends on Replay |

### Workspace + identity

| Feature | Status | Notes |
|---|---|---|
| API keys (list/create/revoke) | ✅ | full CRUD + reveal-once + audit |
| Workspace settings | ✅ | sample, PII, RCA mode, cost ceiling |
| Members RBAC backend | ✅ | owner/admin/member enforced |
| Members UI | 🟡 | roadmap page; no invite flow |
| SSO (OIDC) | ❌ | not built |
| SCIM 2.0 | ❌ | not built |
| Audit log | ✅ | postgres `audit_log` table writes |

### SDK + integrations

| Feature | Status | Notes |
|---|---|---|
| Python SDK (native) | ❌ | not started |
| JS/TS SDK (native) | ❌ | not started |
| LangSmith-compatible Python shim | ❌ | not built |
| LangSmith-compatible JS shim | ❌ | not built |
| Public-key (browser) feedback SDK | ❌ | not built |

### Self-hosting + ops

| Feature | Status | Notes |
|---|---|---|
| Docker compose stack | ✅ | 7 services up green |
| Postgres migrations | ✅ | 6 migrations |
| ClickHouse migrations | ✅ | 5 migrations |
| Redis (queue) | ✅ | up |
| Ingest worker | ✅ | up |
| Setup wizard (first-run) | ✅ | `/v1/setup` |
| Health endpoint | ✅ | `/healthz` |
| Helm chart | ❌ | not built |
| Kubernetes operator | ❌ | not built |

## Loop iteration #1 — plan (next)

Highest leverage that isn't already in flight. Order chosen to maximize **demoability** per
unit of code (each surface is something a user can land on and use):

1. **Members invite UI** (membership backend exists, just needs API + form)
2. **Threads view** (groups runs by `session_id`; ClickHouse query only)
3. **Monitoring dashboards** (charts over the existing `/v1/metrics` endpoint)
4. **Datasets CRUD** (postgres tables exist; build list/create/row pages)
5. **Prompts CRUD** (postgres tables exist; build list/version/diff pages)
6. **Evals runner v1** (single-judge; writes to existing `eval_score` table)
7. **Feedback public-key endpoint** (write-only, scoped key)
8. **Comparisons v1** (run two prompts on a dataset, render diff table)
9. **Alerts rules engine** (new postgres table; cron evaluator)
10. **Annotations queue** (sampling rule + reviewer queue UI)
11. **Replay capture writer** (extends ingest worker)
12. **Studio canvas** (depends on Replay — last)
13. **OpenInference / OTel ingest** (interop layer)
14. **LangSmith Python shim** (drop-in compat package)

Each step ends with: commit, push, re-run gap analysis at top of this file, repeat.
