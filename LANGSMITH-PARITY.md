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
| Alerts | ✅ | postgres `alert_rule` + `alert_event` lifecycle; in-process evaluator scans ClickHouse every 60s; CRUD + history UI (loop #4) |
| Saved filters / views | ❌ | not designed |
| Bulk actions on runs | ❌ | not designed |

### Eval + improvement

| Feature | Status | Notes |
|---|---|---|
| Datasets | ✅ | postgres CRUD + clickhouse items; list/detail UI (loop #4) |
| Prompts (versioning + tags) | ✅ | postgres CRUD + versions + aliases; list/detail UI (loop #4) |
| Evals (single-judge) | ✅ | postgres `eval_run` lifecycle + clickhouse `eval_score` writes; built-in judges echo/contains/exact (loop #4) |
| Evals (PoLL multi-judge) | ❌ | not built |
| Luna prompted-judges | ❌ | not built |
| Comparisons (A/B experiments) | ✅ | postgres `comparison` lifecycle + clickhouse `eval_score` cmp:a/cmp:b rows; list + paired-diff detail UI (loop #4) |
| Playground | 🟡 | roadmap page only |
| Annotations queue | ✅ | postgres queue/item lifecycle + ClickHouse run sampling + reviewer UI; submissions write `eval_score` with `judge_name='human'` (loop #4) |
| Feedback (end-user signal) | ✅ | `tbf_pub_*` public keys + `POST /v1/feedback`; same eval_score store as judges (loop #4) |
| Replay (deterministic re-run) | ✅ | worker derives content-addressed captures per llm/tool/retrieval span; per-run index endpoint + run-detail panel (loop #4 item 8) |
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
| Postgres migrations | ✅ | 12 migrations |
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

## Loop iteration #4 — done (item #3)

✅ **Evals runner v1** — `schemas/postgres/migrations/0008_eval_runs.sql`
adds `eval_run` (lifecycle: queued → running → done/failed; tracks
`item_total`, `item_done`, `score_sum`, `score_avg`, `error`, timestamps).
`services/api/tracebility_api/routers/evals.py` implements `GET/POST
/v1/eval-runs`, `GET /v1/eval-runs/{id}`, `GET /v1/eval-runs/{id}/scores`.
POST inserts the queued postgres row, returns 202, and kicks off
`asyncio` `BackgroundTasks` runner. The runner pulls dataset items from
ClickHouse `dataset_item`, scores each with a deterministic built-in
judge (`echo` / `contains` / `exact` — no LLM key required), inserts
one ClickHouse `eval_score` row per item (carrying `item_id` in `run_id`
slot, postgres `eval_run.id` in `eval_config_id`), and rolls up
`score_avg` on the postgres row. Audit-fail-closed on creation (ER-10).
RBAC: list/get = all roles; create = owner/admin/member. UI:
`web/src/app/evals/page.tsx` rewritten from RoadmapSurface to a real
runs table with status badges and color-coded avg-score percentages;
`NewEvalRunButton` modal picks dataset + judge_kind + optional name.
`web/src/app/evals/[id]/page.tsx` detail page renders KPI strip
(judge / progress / avg / duration), optional error card on failure,
and a per-item scores table with label/outcome/rationale. LLM-as-judge
swaps in next iteration without changing the storage shape.

## Loop iteration #4 — done (item #4)

✅ **Feedback public-key endpoint** —
`schemas/postgres/migrations/0009_feedback_public_keys.sql` adds
`feedback_public_key` (id, project_id, public_id text unique, name,
allowed_origins text[], created_by, last_used_at, revoked_at,
created_at).
`services/api/tracebility_api/routers/feedback_keys.py` implements
admin CRUD at `/v1/feedback-keys` — `GET ?project_id=...`,
`POST` (returns `plaintext_key: tbf_pub_<32 hex>` shown ONCE),
`DELETE /{id}` — RBAC: list = all roles, create/revoke = owner/admin.
Audit-fail-closed on every write (ER-10); ER-20 revocation immediate.
`services/api/tracebility_api/routers/feedback.py` exposes the public
ingest endpoint `POST /v1/feedback` — no `require_user` dep, the
`tbf_pub_*` key is the credential. Validates key format, checks
revoked_at IS NULL, enforces optional `allowed_origins` against the
request `Origin` header (server-to-server with no Origin still
allowed), then writes one ClickHouse `eval_score` row with
`judge_name='user'`, `judge_endpoint='browser'`, `judge_version='v1'`
so feedback aggregates alongside LLM-judge scores in the same store.
Returns 202 on accept; 503 if ClickHouse is unreachable so SDKs can
buffer (ER-23 — never silent-drop). UI:
`web/src/app/feedback/page.tsx` rewritten from RoadmapSurface to a
real list with `CreateFeedbackKeyButton` (modal with one-shot reveal +
Copy) and per-row `RevokeFeedbackKeyButton`; Origins column shows up
to two with `+N more`, Status column shows active/revoked badge.
Below the table is a 4-line browser snippet you can paste in to wire
it up immediately — no SDK required yet.

## Loop iteration #4 — done (item #5)

✅ **Comparisons v1** —
`schemas/postgres/migrations/0010_comparisons.sql` adds the `comparison`
table (lifecycle queued → running → done/failed; per-side counters
`item_done_a/b`, `score_sum_a/b`, `score_avg_a/b`; check constraint
`comparison_distinct_versions` so A and B must differ).
`services/api/tracebility_api/routers/comparisons.py` implements
`GET/POST /v1/comparisons`, `GET /v1/comparisons/{id}`,
`GET /v1/comparisons/{id}/items?limit=...`. POST validates the judge
kind (`echo` / `contains` / `exact`), distinct versions, dataset
project ownership, and resolves both prompt versions through
`prompt.project_id` to reject cross-project IDs at create time.
Inserts the queued postgres row, returns 202, and dispatches
`_run_comparison` via FastAPI `BackgroundTasks`. The runner pulls
dataset items + both prompt templates, scores each item on both
sides via `_render_for_variant(template, item)` + the deterministic
judge, batches one ClickHouse insert with `judge_name='cmp:a'` and
`'cmp:b'` rows tagged `eval_config_id=comparison.id`, then updates
postgres counters per side. V1 stand-in: `_render_for_variant`
returns the template body — real LLM generation slots into that one
function next iteration without changing storage shape. Pairing for
the diff view is a FULL OUTER JOIN on `run_id` (which carries
`item_id`). Audit-fail-closed on creation (ER-10). RBAC: list/get =
all roles; create = owner/admin/member. UI:
`web/src/app/comparisons/page.tsx` rewritten from RoadmapSurface to a
real comparisons list with `NewComparisonButton` (modal: dataset +
two variant pickers + judge + optional name); table shows status,
dataset slug, both variant labels (`prompt_slug v{n} @alias`), per-side
averages, and the Δ. `web/src/app/comparisons/[id]/page.tsx` is the
detail page with KPI strip (judge / Avg A / Avg B / Δ B−A / progress)
and the per-item paired diff table — one row per dataset item with
score A, score B, Δ, both labels, the winner's rationale, and
judged_at. `pickWinnerRationale` falls back to either side if scores
tie or one side hasn't run yet.

## Loop iteration #4 — done (item #6)

✅ **Alerts rules engine** —
`schemas/postgres/migrations/0011_alerts.sql` adds `alert_rule` (project-scoped
rule with metric + comparator + threshold + window_seconds 60–86400 + jsonb
routes + enabled flag + last_evaluated_at/last_value cache + open_incident_id
pointer to the firing event) and `alert_event` (fired/resolved transitions,
both sides of an incident share the same `incident_id`). An incident is the
event pair, not a third table — materializing it bought nothing while v1
routes nowhere; the deferrable FK on `alert_rule.open_incident_id` lets
fire-and-update happen in one transaction.
`services/api/tracebility_api/routers/alerts.py` implements
`GET/POST /v1/alerts`, `PATCH/DELETE /v1/alerts/{id}`, and
`GET /v1/alerts/events?project_id=...&limit=...`. RBAC: list/get + events =
all roles; create + patch (snooze/edit) = owner/admin/member;
delete = owner/admin only. Audit-fail-closed on every write (ER-10).
The evaluator runs in-process: `evaluator_loop(pool, clickhouse)` is
spawned from `app.lifespan` and ticks every 60s — `evaluate_due_rules`
selects enabled rules, `_measure` re-runs the same ClickHouse query the
Monitoring page uses (parameterized over `{project_id:UUID}` +
`{window:UInt32}` against `run final`), `_apply_rule_decision`
transactionally writes a `fired` event with a fresh `incident_id` and
flips the rule's `open_incident_id` pointer (or writes a `resolved`
event reusing the same `incident_id` and clears the pointer). Routes
are persisted but not delivered in v1 — Slack/PagerDuty/webhook/email
slot in next iteration without changing the schema. UI:
`web/src/app/alerts/page.tsx` rewritten from RoadmapSurface to a real
server component that parallel-fetches rules + events; KPI strip
(active rules / open incidents / events 24h / longest open), rules
table with status badge (firing/ok/snoozed/pending), comparator + threshold
formatted per metric, route badges, and per-row snooze/delete; events
history table with fired/resolved badges and incident-id grouping.
Cookie-forwarding proxies under `web/src/app/api/alerts/route.ts` (POST)
and `web/src/app/api/alerts/[id]/route.ts` (PATCH/DELETE).

## Loop iteration #4 — done (item #7)

✅ **Annotations queue** — `schemas/postgres/migrations/0012_annotations.sql`
adds `annotation_queue` (sampling rule + rubric snapshot, item totals,
status open/complete/archived) and `annotation_item` (queue-scoped run,
status pending/done/skipped, reviewer label/score/rationale, unique on
`(queue_id, run_id)`). Queue is materialized at creation: the FastAPI
router queries ClickHouse `run` for IDs in the configured window and
status filter, samples N with `random.sample`, and inserts items in a
single transaction. "I have N runs to review" stays true between
sessions; a streaming sampler that re-evaluates on every render is a
subtle source of double-counting.

`services/api/tracebility_api/routers/annotations.py` exposes
`/v1/annotations` (list/create/get/delete), `/v1/annotations/{id}/items`
(list with optional status filter), and per-item `/submit` and `/skip`.
Submission validates the label against `rubric.labels`, computes score
per `rubric.score` (binary→first label is 1.0; scalar→reviewer-supplied
0..1; none→0 sentinel), atomically flips item to `done` (only the
first-time transition increments `item_done`), and writes one ClickHouse
`eval_score` row tagged `judge_name='human'`, `judge_endpoint='annotation'`,
`judge_version='v1'` so human labels aggregate alongside LLM judges
(echo/contains/exact/cmp:a/cmp:b) and end-user feedback (`judge_name='user'`)
in the same store. RBAC fail-closed; queue delete is owner/admin only.

UI: server component list at `web/src/app/annotations/page.tsx` with
KPI strip (queues / open / to-review / progress%), queues table (status
badge, name+description link, rubric cell, sampling cell, progress bar,
review/delete actions), and a usage card explaining why human labels
share the `eval_score` store. Detail at
`web/src/app/annotations/[id]/page.tsx` parallel-fetches queue and items;
the next pending item gets a sticky `<AnnotationLabelForm>` panel above
the items table for keyboard-friendly review. Cookie-forwarding proxies
under `web/src/app/api/annotations/route.ts` (POST),
`web/src/app/api/annotations/[id]/route.ts` (DELETE),
`web/src/app/api/annotations/[id]/items/[itemId]/submit/route.ts` (POST),
and `.../skip/route.ts` (POST).

## Loop iteration #4 — done (item #8)

✅ **Replay capture writer** — `services/ingest-worker/tracebility_worker/writer.py`
now derives a `replay_capture` row alongside every span of kind
`llm` / `tool` / `retriever` (mapped to `llm_call` / `tool_io` /
`retrieval`; `embedding`, `parser`, `chain`, and `agent` are
orchestration concerns the replayer does not need to mock — only IO
at the boundary determines deterministic replay). Each capture is
content-addressed: sha256 over `(model, temperature.6f, inputs,
outputs)` for LLM calls, and `(inputs, outputs)` for tool/retrieval.
Same byte payload across runs → same hash → same `object_ref`,
so dedup is free at the object-store layer when that lands. Per
ER-18, model is the canonical replay-divergence signal — different
model string is a warned diff, not a silent substitute. Per ER-23,
if the `replay_capture` insert trips, we log and move on without
dropping the primary trace; the capture index can be rebuilt from
spans later. `insert_envelope` now returns `(runs, spans, captures)`;
`consumer.py` unpacks the third element and includes it in the
acked-message debug log. `services/api/tracebility_api/routers/replays.py`
exposes `GET /v1/runs/{run_id}/replay-captures?project_id=...&limit=`,
returning `ReplayCaptureList { summary { total, by_kind, bytes_total,
unique_hashes }, items[] }`. RBAC fail-closed via
`assert_workspace_role` (all roles); 503 if ClickHouse is unset.
UI: `web/src/app/runs/[run_id]/page.tsx` parallel-fetches captures
alongside the run + spans; the inspector renders a Replay panel on
the run view (KPI summary + first-50 captures table) and a
"replay-ready" badge plus a per-span CaptureBlock when a span is
selected. Cookie-forwarding proxy at
`web/src/app/api/runs/[run_id]/replay-captures/route.ts`. The
`object_ref` is `inline:sha256:<hash>` until the object-store backend
is wired; flipping to `s3://...` will not change the read path.

## Loop iteration #4 — plan (remaining)

9. **Studio canvas** (depends on Replay — last)
10. **OpenInference / OTel ingest** (interop layer)
11. **LangSmith Python shim** (drop-in compat package)

Each step ends with: commit, push, re-run gap analysis at top of this file, repeat.
