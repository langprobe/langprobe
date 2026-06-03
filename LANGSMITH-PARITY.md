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
| Threads (multi-turn sessions) | ✅ | `/v1/threads` + `/v1/threads/{session_id}`; list + detail UI (loop #2) |
| Monitoring dashboards | ✅ | `/v1/metrics/timeseries` + `/v1/metrics/by-model`; SVG charts UI (loop #3) |
| Alerts | 🟡 | roadmap page; no rules engine |
| Saved filters / views | ❌ | not designed |
| Bulk actions on runs | ❌ | not designed |

### Eval + improvement

| Feature | Status | Notes |
|---|---|---|
| Datasets | ✅ | postgres CRUD + clickhouse items; list/detail UI (loop #4) |
| Prompts (versioning + tags) | ✅ | postgres CRUD + versions + aliases; list/detail UI (loop #4) |
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
| Members UI | ✅ | invite + role-change + revoke shipped (loop #1) |
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

## Loop iteration #1 — done

✅ **Members invite UI** — `0007_invitations.sql` migration; `members.py` router
with list/invite/role/remove/accept; Next.js proxy routes under
`/api/workspaces/{ws}/members[+/{id}]` and `.../invitations[+/{id}]`;
`MembersClient.tsx` with one-shot token reveal; `members/page.tsx` rewritten
from RoadmapSurface to real CRUD. RBAC: admin-only for writes; last-admin
guard. Audit-fail-closed on every write (ER-10). Token format `ti_<id>.<secret>`,
shown ONCE.

## Loop iteration #2 — done

✅ **Threads view** — `services/api/tracebility_api/routers/threads_query.py`
adds `GET /v1/threads?project_id=...` (group-by `session_id` with turn count,
total cost, error count, p95 latency, last status) and
`GET /v1/threads/{session_id}` (chronological run list for one session).
`web/src/app/threads/page.tsx` rewritten from RoadmapSurface to a real list
table linking to `web/src/app/threads/[session_id]/page.tsx` (turn-by-turn
detail with KPI strip — turns, errors, tokens, cost, duration). Single-turn
runs (empty `session_id`) are intentionally excluded; they remain on `/runs`.

## Loop iteration #3 — done

✅ **Monitoring dashboards** — `services/api/tracebility_api/routers/metrics.py`
adds `GET /v1/metrics/timeseries` (per-bucket runs, errors, latency p50/p95/p99,
tokens, cost — bucket size adapts to window) and `GET /v1/metrics/by-model`
(LLM-span breakdown by `model` with calls, errors, p95, tokens, cost).
`web/src/app/monitoring/page.tsx` rewritten from RoadmapSurface to a real
dashboard with KPI strip, four inline-SVG charts (latency, throughput,
errors, cost) and the by-model table. Window picker: 1h / 6h / 24h / 7d.
No client-side JS, no chart library — keeps the page light and on-brand.

## Loop iteration #4 — done (item #1)

✅ **Datasets CRUD** — `services/api/tracebility_api/routers/datasets.py` adds
`GET/POST /v1/datasets`, `GET/PATCH/DELETE /v1/datasets/{id}`, `GET/POST
/v1/datasets/{id}/items`, `DELETE /v1/datasets/{id}/items/{item_id}`. Catalog
rows live in postgres `dataset` (item_count maintained on every item write);
items live in ClickHouse `dataset_item` (ReplacingMergeTree) and use soft-delete
via `ALTER ... UPDATE deleted_at` so audit trails stay intact. RBAC: list/get =
all roles; create/update/items = owner/admin/member; delete dataset =
owner/admin only. Audit-fail-closed on every write (ER-10). `web/src/app/datasets/page.tsx`
rewritten from RoadmapSurface to real list with `CreateDatasetButton` + delete
per row; `web/src/app/datasets/[id]/page.tsx` is the detail page with KPI strip,
`AddItemButton` (input/expected/metadata-JSON/source_run_id) and items table
with per-row delete and source-run links back to `/runs/{id}`. Slug regex
`^[a-z0-9][a-z0-9_-]*$` matches projects.

## Loop iteration #4 — done (item #2)

✅ **Prompts CRUD with versions + aliases** —
`services/api/tracebility_api/routers/prompts.py` adds `GET/POST /v1/prompts`,
`GET/PATCH/DELETE /v1/prompts/{id}`, `GET/POST /v1/prompts/{id}/versions`,
`GET /v1/prompts/{id}/versions/{version}`, `POST /v1/prompts/{id}/aliases`.
Catalog rows live in postgres `prompt`; immutable revisions live in
`prompt_version` and carry the unique-per-prompt `aliases text[]`. Creating a
new version with aliases atomically strips those aliases off any prior versions
on the same prompt; assigning an alias to an existing version does the same in
a single transaction (idempotent). Soft-delete on the catalog row keeps version
history and historical run links intact (ER-23). jsonb columns `input_schema`
and `model_params` are serialized via `_json.dumps` and cast with `$N::jsonb`
on insert. RBAC: list/get = all roles; create/update/version-create =
owner/admin/member; delete = owner/admin only. Audit-fail-closed on every
write (ER-10). UI: `web/src/app/prompts/page.tsx` rewritten from RoadmapSurface
to a real list with `CreatePromptButton` + per-row delete; columns include
latest version, version count, and the union of aliases as badges.
`web/src/app/prompts/[id]/page.tsx` is the detail page with KPI strip and a
versions list showing template, optional input_schema/model_params, alias
badges, and a per-row `AssignAliasButton`. Header has `NewVersionButton` for
saving new revisions.

## Loop iteration #4 — plan (remaining)

3. **Evals runner v1** (single-judge; writes to existing `eval_score` table)
4. **Feedback public-key endpoint** (write-only, scoped key)
5. **Comparisons v1** (run two prompts on a dataset, render diff table)
6. **Alerts rules engine** (new postgres table; cron evaluator)
7. **Annotations queue** (sampling rule + reviewer queue UI)
8. **Replay capture writer** (extends ingest worker)
9. **Studio canvas** (depends on Replay — last)
10. **OpenInference / OTel ingest** (interop layer)
11. **LangSmith Python shim** (drop-in compat package)

Each step ends with: commit, push, re-run gap analysis at top of this file, repeat.
