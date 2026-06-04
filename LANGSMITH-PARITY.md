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
| OTel/OpenInference ingestion | ✅ | `POST /v1/traces` accepts OTLP HTTP/JSON; translates OpenInference + OTel GenAI attributes to native run/span envelopes (loop #4 item 10) |
| LangChain callback bridge | ❌ | shim package not built |
| LangGraph callback bridge | ❌ | shim package not built |
| OpenAI Agents SDK ingest | 🟡 | works via OTel intake (loop #4 item 10); first-class adapter pending SDK launch |
| `wrap_openai` / `wrap_anthropic` | ✅ | duck-typed proxies on `tracebility-langsmith-shim`; one tracebility run per vendor SDK call with prompt+completion+token usage; vendor SDKs not transitive deps (loop #5 item 5) |
| Multipart `/runs/multipart` | ❌ | endpoint not built |
| Migration importer (LS export → tb) | ✅ | `tb-migrate-langsmith` CLI streams JSONL/dir/stdin → `/runs/batch` in batches of 100; dry-run validates without posting; per-row parse failures logged with `<file>:<line>` and counted; non-zero exit on any failure (loop #5 item 7) |

### Observability surfaces

| Feature | Status | Notes |
|---|---|---|
| Threads (multi-turn sessions) | ✅ | `/v1/threads` + `/v1/threads/{session_id}`; list + detail UI (loop #2) |
| Monitoring dashboards | ✅ | `/v1/metrics/timeseries` + `/v1/metrics/by-model`; SVG charts UI (loop #3) |
| Alerts | ✅ | postgres `alert_rule` + `alert_event` lifecycle; in-process evaluator scans ClickHouse every 60s; CRUD + history UI (loop #4) |
| Saved filters / views | ✅ | postgres `saved_view` (personal + shared) on /runs; URL-as-source-of-truth filter state (status/kind/search/window) round-trips with chip clicks; pin + delete (loop #5 item 3) |
| Bulk actions on runs | ✅ | checkbox column on /runs + sticky action bar; "add to dataset" (writes dataset_item rows with source_run_id) and "send to annotation queue" (writes annotation_item rows, dedup'd) (loop #5 item 4) |

### Eval + improvement

| Feature | Status | Notes |
|---|---|---|
| Datasets | ✅ | postgres CRUD + clickhouse items; list/detail UI (loop #4) |
| Prompts (versioning + tags) | ✅ | postgres CRUD + versions + aliases; list/detail UI (loop #4) |
| Evals (single-judge) | ✅ | postgres `eval_run` lifecycle + clickhouse `eval_score` writes; built-in judges echo/contains/exact (loop #4) |
| Evals (PoLL multi-judge) | ✅ | postgres `poll_run` lifecycle (queued → running → done/failed) + judges text[] + aggregation (mean/majority/min/max) + pairwise agreement metric; scores all (item × judge) pairs to `eval_score` (loop #5 item 2) |
| Luna prompted-judges | ❌ | not built |
| Comparisons (A/B experiments) | ✅ | postgres `comparison` lifecycle + clickhouse `eval_score` cmp:a/cmp:b rows; list + paired-diff detail UI (loop #4) |
| Playground | ✅ | postgres `playground_session` + sync runner; anthropic/openai/stub providers; side-by-side compare mode; results write a real trace to ClickHouse with `sdk='playground'` (loop #5 item 1) |
| Annotations queue | ✅ | postgres queue/item lifecycle + ClickHouse run sampling + reviewer UI; submissions write `eval_score` with `judge_name='human'` (loop #4) |
| Feedback (end-user signal) | ✅ | `tbf_pub_*` public keys + `POST /v1/feedback`; same eval_score store as judges (loop #4) |
| Replay (deterministic re-run) | ✅ | worker derives content-addressed captures per llm/tool/retrieval span; per-run index endpoint + run-detail panel (loop #4 item 8) |
| Studio (visual canvas) | ✅ | postgres `studio_branch` lifecycle (draft → replayed → promoted) + edits jsonb + canvas UI; v1 replay synthesizes diff_summary, real LLM runner slots in next iteration (loop #4 item 9) |

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
| Python SDK (native) | ✅ | `tracebility` package (separate from langsmith-shim); `IngestClient` + `ControlClient` namespaces (runs / threads / datasets / prompts / evals / poll / comparisons / playground); `@trace` + `with span()` decorator/context-manager surface (loop #5 item 10) |
| JS/TS SDK (native) | ❌ | not started |
| LangSmith-compatible Python shim | ✅ | `tracebility-langsmith-shim` ships `Client` + `@traceable` (sync+async) posting to ingest-api parity endpoints; one-line import migration (loop #4 item 11) |
| LangSmith-compatible JS shim | ✅ | `packages/sdk-typescript/` ships `Client` + `traceable` (Proxy-free; `AsyncLocalStorage`-threaded parent ids) + `wrapOpenAI` / `wrapAnthropic`; one-line import migration; smoke-tested 8/8 (loop #5 item 6) |
| Public-key (browser) feedback SDK | ✅ | `tracebility-feedback-browser` zero-dep TS package; `init({key, endpoint})` + `submit/thumbsUp/thumbsDown`; `credentials: omit`, `keepalive: true`, never throws on net errors; smoke 8/8 (loop #6 item 1) |

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
| Helm chart | ✅ | `deploy/helm/tracebility/` chart deploys api / ingest-api / ingest-worker / web; secret-resolution helper for postgres / clickhouse / redis / session; Ingress + ServiceAccount + PVC for ingest disk buffer (loop #5 item 9) |
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

## Loop iteration #4 — done (item #9)

✅ **Studio canvas** —
`schemas/postgres/migrations/0013_studio_branches.sql` adds the
`studio_branch` table (project-scoped row pointing at a captured run
+ optional branch-point span + ordered jsonb edits + lifecycle
`draft` → `replayed` → `promoted` + `diff_summary` + `replay_run_id`).
No FK to ClickHouse runs; ER-23 says we don't cascade-delete on a
missing source. Storage shape rationale: edits are an ordered list
authored as one transaction on the canvas, not a queryable per-edit
table; jsonb path operators cover the rare "find branches that
edited model on llm_router spans" query.

`services/api/tracebility_api/routers/studio.py` exposes
`/v1/studio/branches` (list/create), `/v1/studio/branches/{id}`
(get/patch/delete), `/v1/studio/branches/{id}/replay` (the stand-in
runner that flips status to `replayed` and synthesizes
`diff_summary` from the edit list), and `/v1/studio/branches/{id}/promote`
(replayed → promoted; Prompts revision wiring ships next iteration).
Edit field allowlist: `prompt | model | temperature | tool_args`
with per-field validation (temperature in [0.0, 2.0], prompt/model
non-empty string, tool_args object/array). Edits are frozen via 409
once the branch has been replayed — re-iterating means creating a
new branch (same pattern as immutable prompt_version rows).
RBAC: list/get all roles; create/patch/replay/promote owner/admin/member;
delete owner/admin only. Audit-fail-closed on every write (ER-10).

UI: `web/src/app/studio/page.tsx` rewritten from RoadmapSurface to a
server-component branches list with KPI strip (branches / drafts /
replayed / promoted), `NewBranchButton` (modal: name + description
+ source_run_id + optional source_span_id; POST returns id, we push
straight to `/studio/{id}`), and a usage card explaining the
edit-replay-promote round-trip. `web/src/app/studio/[id]/page.tsx`
is the canvas — header with status badge + Replay/Promote/Delete
actions, source card linking back to `/runs/{run_id}` (and to
`/runs/{run_id}?span={span_id}` when the branch point is a span),
diff-summary card once replayed, and the in-place `StudioEditsEditor`
client component (add/remove rows, target_span_id + field
dropdown + value editor that adapts per field type — multiline
textarea for prompt and tool_args JSON, numeric for temperature).
Editor is frozen post-replay. Cookie-forwarding proxies under
`web/src/app/api/studio/branches/route.ts` (POST),
`web/src/app/api/studio/branches/[id]/route.ts` (PATCH/DELETE),
`web/src/app/api/studio/branches/[id]/replay/route.ts` (POST), and
`web/src/app/api/studio/branches/[id]/promote/route.ts` (POST).

## Loop iteration #4 — done (item #10)

✅ **OpenInference / OTel ingest** —
`services/ingest-api/tracebility_ingest/routers/otel.py` adds
`POST /v1/traces` (the OTLP HTTP/JSON collector path). The router
accepts the standard `resourceSpans` envelope every OTel SDK already
emits, walks `scopeSpans[].spans[]`, and translates each span into a
native `SpanIngest`. OpenInference's `openinference.span.kind`
(LLM / TOOL / CHAIN / RETRIEVER / EMBEDDING / AGENT / RERANKER) is
the primary kind signal with a fallback chain to OTel GenAI's
`gen_ai.operation.name` and finally span-name heuristics. Model,
temperature, token counts (prompt/completion/total), and IO read
both OpenInference (`llm.model_name`, `llm.token_count.prompt`,
`input.value`, `output.value`) and OTel GenAI (`gen_ai.request.model`,
`gen_ai.usage.input_tokens`, `gen_ai.prompt`) attribute namespaces.

Id mapping: OTel `traceId` is 32-hex → UUID directly; OTel `spanId`
is 16-hex → left-padded to 32-hex → UUID (reversible, and we always
pair with run_id on every write so the high-bit collision is
harmless). `startTimeUnixNano`/`endTimeUnixNano` parse to UTC
datetimes; missing start defaults to now() rather than dropping the
span (ER-23).

Per trace, we group spans by `traceId` and synthesize one root
`RunIngest`: name + kind from the root span (first with
`parentSpanId` empty, earliest start_time tiebreak); start/end bracket
all spans; tokens aggregate LLM-kind spans; error if any span is
status=ERROR. The synthesized run is enqueued onto the same Redis
queue native ingest uses — the worker is path-agnostic. Skipped spans
(missing trace_id / span_id) are logged not dropped silently;
the 202 ack reports honest accepted counts. Wired in `app.py`
alongside `langsmith_shim` and native `runs`.

Drop-in usage:
```
export OTEL_EXPORTER_OTLP_ENDPOINT=https://your-tracebility-host
export OTEL_EXPORTER_OTLP_HEADERS=authorization=Bearer\ tk_...
# any OTel-instrumented agent (LlamaIndex, OpenAI Agents SDK,
# Phoenix-compatible, custom) starts flowing without changing code.
```

## Loop iteration #4 — done (item #11)

✅ **LangSmith Python shim** —
`packages/sdk-python/tracebility_langsmith_shim/` ships a drop-in
compat layer for LangSmith's `Client` + `@traceable` write surface.
One-line migration: `from langsmith import Client, traceable` →
`from tracebility_langsmith_shim import Client, traceable`. The
shim honors `LANGSMITH_ENDPOINT` / `LANGCHAIN_ENDPOINT`,
`LANGSMITH_API_KEY` / `LANGCHAIN_API_KEY`, and `LANGSMITH_PROJECT`
/ `LANGCHAIN_PROJECT` so existing deployments migrate without code
changes; constructor args override env.

`Client.create_run` POSTs `/runs`, `update_run` PATCHes
`/runs/{id}`, `batch_ingest_runs` POSTs `/runs/batch` — all hitting
the existing `services/ingest-api/.../langsmith_shim.py` router so
SDK calls land in the same Redis queue native ingest uses. The
shim is small on purpose (≈220 lines client + 150 lines traceable):
the heavy work — queueing, redaction, batching to ClickHouse —
happens server-side.

`@traceable` covers both sync and async functions; nested calls
form a parent/child tree via a `ContextVar` that threads
`parent_run_id` through the call stack (matches LangSmith semantics).
Bare `@traceable` and parameterized `@traceable(run_type="llm",
tags=[...])` both work.

Read-side methods (`read_run`, `list_runs`, `read_project`) are
intentionally NOT implemented — tracebility's read API has a
different shape and pretending otherwise would mask bugs. The
native tracebility Python SDK (not this shim) is the right surface
for queries.

Legal/security: the package name is `tracebility-langsmith-shim`,
NOT `langsmith` — nominative fair use only. The README is explicit
about non-affiliation.

## Loop iteration #4 — done

All eleven items shipped. Next iteration begins with a fresh
gap analysis at the top of this file.

## Loop iteration #5 — done (item #1)

✅ **Playground** —
`schemas/postgres/migrations/0014_playground.sql` adds the
`playground_session` table (project-scoped row that records the
rendered prompt, variables jsonb, model + provider + temperature
+ max_tokens, lifecycle queued → running → done/failed, output
text, token + latency, and the ClickHouse run_id of the resulting
trace). One-of constraint: prompt_version_id OR raw_template must
be present.

`services/api/tracebility_api/routers/playground.py` exposes
`GET /v1/playground/runs?project_id=&limit=`, `POST /v1/playground/runs`
(the synchronous LLM invocation — renders `{{ var }}` substitutions,
calls anthropic / openai / stub via stdlib urllib so we don't add
a runtime dep on httpx, then writes a `run` + `span` row to
ClickHouse with `sdk='playground'` so the result is visible at
`/runs/{id}` like any other trace), and `GET /v1/playground/runs/{id}`.
Provider routing is derived from the model string (`claude-*` →
anthropic, `gpt-*`/`o*-*` → openai, `stub-*` → echo). Env-derived
credentials (`ANTHROPIC_API_KEY` / `OPENAI_API_KEY`) — per-workspace
encrypted credentials slot in a later iteration without changing
this URL surface. RBAC fail-closed; audit-fail-closed on every
invocation (ER-10); 5xx from a provider writes status='failed'
with the error text rather than dropping the attempt (ER-23).

UI: `web/src/app/playground/page.tsx` rewritten from RoadmapSurface
to a server-component composer + sticky recent-runs sidebar. Server
fetches the prompt catalog + each prompt's versions + the most
recent 20 sessions in parallel. `PlaygroundClient.tsx` is the
interactive composer: catalog/raw toggle for prompt source,
auto-detected `{{ var }}` variable form, model + temperature +
max_tokens controls, **single vs side-by-side compare** mode (two
parallel POSTs against different models), per-output card with
latency + token stats + deep-link to the trace at `/runs/{id}`.
Cookie-forwarding proxy at `web/src/app/api/playground/runs/route.ts`.

## Loop iteration #6 — done (last roadmap-stub eliminated)

✅ **/replay launcher + stub deletion** —
The last `RoadmapSurface` page (`/replay`) is now a real launcher.
`services/api/tracebility_api/routers/replays.py` adds
`GET /v1/replays/runs?project_id=&limit=` — a cross-run aggregate
over `replay_capture` (GROUP BY run_id, JOIN against `run` for
name/status/start_time, ORDER BY most-recent-capture). Returns
`{run_id, name, kind, status, start_time, capture_count,
bytes_total, unique_hashes, by_kind}` per row. The router is split
into `runs_router` (the existing per-run captures path under
`/v1/runs/{run_id}/replay-captures`) and `catalog_router` (the new
`/v1/replays/runs`) so the catalog endpoint doesn't collide with
the parameterized `/{run_id}` route in `runs_query`.

UI: `web/src/app/replay/page.tsx` rewritten from RoadmapSurface to
a server-component launcher. KPI strip (replayable runs / captures
/ unique hashes / bytes), runs table (status / id / name /
kind-mix badges / capture totals / "open →" + "branch" actions),
empty state, usage card explaining content-addressing. Cookie-
forwarding proxy at `web/src/app/api/replays/runs/route.ts`.

Studio deep-link wired: clicking "branch" on a run navigates to
`/studio?source_run_id=<run_id>`; the page forwards
`searchParams.source_run_id` into the `NewBranchButton` which
auto-opens the modal with the source run pre-filled.

Stub components deleted: `RoadmapSurface.tsx` and `ComingSoon.tsx`
removed from the codebase. **No page in the app renders a
"coming soon" surface anymore.** Every sidebar link routes to a
real page backed by a real router. The product is now fully
operational from a `docker-compose up` clean install.

## Loop iteration #6 — done (item #1)

✅ **Browser feedback SDK** —
`packages/sdk-feedback-browser/` ships a zero-dep TS package
(`tracebility-feedback-browser`) that wraps the existing
`POST /v1/feedback` ingest endpoint. Module surface:

```ts
import { init, submit, FeedbackClient } from "tracebility-feedback-browser";

init({ key: "tbf_pub_...", endpoint: "https://traces.example.com" });
await submit({ run_id, score: 1, kind: "thumbs", comment: "👍" });
```

Plus `FeedbackClient.thumbsUp(runId)` / `.thumbsDown(runId)`
convenience helpers.

Design boundaries:
  - **Never throws on network errors.** All failures resolve as
    `{ok: false}` with `.retryable` set when retry is meaningful
    (5xx, network), explicitly false on 4xx (bad key / revoked /
    validation). Throwing inside a thumbs-up handler is bad UX;
    crashing a click handler over a transient ingest blip is
    worse.
  - **Public-key auth, never carries cookies.** `credentials:
    "omit"` so a misconfigured CORS allow-credentials doesn't
    accidentally leak session state to the ingest host.
  - `keepalive: true` so a `submit(...)` issued during page
    unload has a fighting chance to complete.
  - Constructor rejects keys not prefixed `tbf_pub_` early —
    catches misconfiguration at boot, not at first user feedback.

Smoke-tested 8/8: bad-key rejection, happy path body shape,
score range validation, 5xx retryable, 4xx non-retryable, network
error → retryable, thumbs convenience score correctness, and the
process-global `init`/`submit`. Server-side allowed-origins
allowlist remains the auth backstop; the SDK relies on it rather
than re-implementing in the client.

## Loop iteration #6 — plan

Re-scoring after loop #5: the remaining ❌ cells fall into three
buckets — interop shims, eval-rigor extensions, and enterprise.
Ordered by leverage:

1. **Public-key browser feedback SDK** — JS package that wraps the
   existing `tbf_pub_*` ingest endpoint; closes the loop from
   "user thumbs-up in production" to `eval_score` rows.
2. **Native JS/TS SDK** — symmetric port of the native Python SDK
   (`tracebility` package); the LangSmith JS shim covers compat,
   but tracebility-shaped read+write needs its own surface.
3. **LangChain / LangGraph callback bridges** — Python adapters that
   plug into LangChain's `BaseCallbackHandler` / LangGraph's
   `astream_events` so apps using those frameworks get traces
   without a `@traceable` rewrite.
4. **Multipart `/runs/multipart`** — accept large multipart payloads
   (file attachments, large tool I/O); LangSmith ships this and a
   handful of users will hit the JSON envelope size ceiling.
5. **Luna prompted-judges** — an LLM-judge type that takes a
   user-authored rubric prompt; rides the existing `eval_score`
   shape so reads inherit.
6. **SSO (OIDC)** — enterprise checkbox; auth_router already ships
   the session machinery so this is a pluggable backend.
7. **SCIM 2.0** — enterprise; provisioning workspace members from
   an IdP without each one self-signing-up.
8. **Kubernetes operator** — declarative tracebility CRDs; only
   worth building once Helm sees real adoption.

## Loop iteration #5 — plan (closed)

Re-scoring the scoreboard at the top, the remaining ❌ / 🟡 cells
break into five buckets. Ordered by leverage (visible gap × user
demand ÷ implementation cost):

## Loop iteration #5 — done (item #10)

✅ **Native Python SDK** —
`packages/sdk-python-native/tracebility/` is the tracebility-shaped
client, distinct from the LangSmith-shim sibling. The shim mimics
LangSmith's `Client` / `traceable`; this package's surface is
"tracebility-native" — different naming, different ergonomics, no
LangSmith concepts in the API.

Two transports under one umbrella:
  - `IngestClient` (write): `submit_run` / `submit_batch` →
    `POST /v1/runs` against the ingest-api native envelope. Uses
    the same OTel-GenAI-aligned shape the worker expects, so no
    translation hop on the receive side.
  - `ControlClient` (read + write): namespaced surfaces for
    `runs / threads / datasets / prompts / evals / poll / comparisons
    / playground` with method shapes that mirror the URL surface
    (`runs.list(status=, kind=, search=, window_seconds=)`,
    `runs.get(run_id)`, `runs.spans(run_id)`,
    `runs.replay_captures(run_id)`, etc).

`TracebilityClient` bundles both and aliases the most-used surfaces
to `client.runs` / `client.datasets` / etc — so callers don't have
to dig through `client.control.runs.list(...)` for the common case.
Each transport is a context manager and releases its httpx pool on
`close()`.

Decorator + context manager: `@trace` wraps a function so each
call emits one run; `with span(...)` opens a span inside the
current trace (parent threading via `ContextVar`). Sync + async
both supported. Inputs/outputs JSON-encoded with `default=str`
fallback so user values that don't natively serialize still land
on the wire.

Methods return raw dicts (server pydantic JSON shape) — we
intentionally don't impose a parallel typed model. The wire shape
evolves and a generated client would slow that down. HTTP errors
raise `TracebilityHTTPError` with `.status_code` / `.body` /
`.url`.

Runtime dep: `httpx` only. Smoke-tested 5/5: `submit_run`,
`@trace` + `span` happy path, `@trace` error path, `runs.list`
read, and the `TracebilityHTTPError` propagation path. Workspace
member registered in the root pyproject.toml.

## Loop iteration #5 — done (item #9)

✅ **Helm chart** —
`deploy/helm/tracebility/` deploys the four tracebility services
(`api`, `ingest-api`, `ingest-worker`, `web`) on Kubernetes.
Deliberately does **not** bundle Postgres / ClickHouse / Redis —
production deployments almost always want managed Postgres, and
bundling those into the chart makes that worse, not better. For a
one-command dev loop, `infra/docker-compose.yml` is the right shape.

Secret resolution: each external dep takes
`existingSecret + existingSecretKey`, with an `inline*` escape
hatch for dev. The `tracebility.envFromSecret` helper in
`_helpers.tpl` renders either a `secretKeyRef` or a literal
`value` so the templates stay branch-free at the env-var site.
Required secrets are documented in `NOTES.txt` (rendered after
install) and in the chart's README.

Topology specifics:
  - `api` + `web` use rolling updates; both expose `/healthz`-style
    probes.
  - `ingest-api` mounts an optional RWO PVC for the disk buffer
    (Redis is the source of truth; the buffer is best-effort), so
    the deployment uses `strategy: Recreate` to dodge the multi-attach
    constraint. Operators who want zero-downtime can flip to a
    StatefulSet pattern in the next iteration without changing the
    rest of the chart.
  - `ingest-worker` has no probes (it's a Redis consumer; readiness
    via consumer lag is a future PR).
  - `Ingress` provisions three optional hosts (web / api / ingest)
    behind one ingress object so a typical TLS setup is one secret
    + three hostnames.

Everything else (image registry/tag, replica counts, resources,
nodeSelector / tolerations / affinity, podAnnotations, log level)
is configurable from values.yaml. Image tag defaults to `latest`;
the README explicitly recommends pinning a digest in production.

Validated: values.yaml + Chart.yaml parse; every template's
`.Values.X` reference resolves to a key declared in values.yaml;
`helm` itself isn't installed in this env so the live render lands
in CI.

## Loop iteration #5 — done (item #8)

✅ **Saved dashboards on /monitoring** —
`schemas/postgres/migrations/0017_saved_view_surface.sql` adds a
`surface` discriminator column (default `'runs'`, check constraint
allows `'monitoring'` too). The two existing partial unique indices
were dropped and rebuilt with `surface` in the key — a `runs` view
named *"p95 last 24h"* no longer collides with a `monitoring` view
of the same name in the same project.

`services/api/tracebility_api/routers/saved_views.py`: list now
takes `surface` as a query param; create persists + validates it;
the read-time filter coercion accepts `window` (label form like
`"1h"`) and `model` keys for the monitoring surface alongside the
existing runs keys. The free-form jsonb shape means both surfaces
share one schema with no migration churn when one of them grows
new knobs.

`web/src/components/SavedViewsClient.tsx`: `SavedViewsBar` now
takes `surface` and `basePath` props; chip clicks navigate to the
right page (`/runs` or `/monitoring`) and the URL→filters
extraction branches per surface. `buildSearchParams` and
`filtersEqual` are surface-aware so the chip-active detection still
round-trips. The "Save view" modal includes the surface in the POST
so a saved monitoring view never leaks onto /runs.

`web/src/app/monitoring/page.tsx`: server-fetches the monitoring
saved views in parallel with timeseries + by-model, drops a
`SavedViewsBar surface="monitoring"` above the KPI strip, and
applies the optional `?model=` filter at the view layer (the
breakdown endpoint stays unchanged; we filter in TS so the saved
view round-trips cleanly when we extend the endpoint with a
server-side model filter later).

## Loop iteration #5 — done (item #7)

✅ **Migration importer** —
`services/migrate-langsmith/tracebility_migrate_langsmith/cli.py`
ships `tb-migrate-langsmith`, a thin CLI that streams a LangSmith
export into a tracebility ingest host. The receiving end already
understands the LangSmith `RunCreate` shape via the in-process shim
(`services/ingest-api/.../langsmith_shim.py`), so the importer's job
is just to stream + batch + POST to `/runs/batch` —
the heavy lifting (translation → IngestBatch → Redis → ClickHouse)
happens inside the worker, identical to the live shim path.

Inputs:
  - JSONL file (one JSON object per line)
  - directory (recurses into `*.jsonl` and `*.json`)
  - `-` for stdin

Behavior:
  - **Idempotent on the receive side**: the worker upserts by
    `run_id`, so re-running an import is safe.
  - **Never silent-drop** (ER-23): per-row parse failures are
    logged with `<file>:<line>` and counted; the CLI exits non-zero
    if any row failed to parse OR any batch returned ≥400 — even
    in `--dry-run`.
  - **Batches**: 100 rows per `/runs/batch` POST by default;
    1–1000 via `--batch-size`.
  - **Read-only** on the source: never deletes / mutates the
    LangSmith data.

Auth env: `--api-key` overrides; falls back to
`TRACEBILITY_INGEST_KEY` then `LANGSMITH_API_KEY` so existing
LangSmith ops env can be reused. Endpoint env: `--endpoint`
overrides; falls back to `TRACEBILITY_INGEST_URL`,
`LANGSMITH_ENDPOINT`, then `http://localhost:7080`.

Smoke-tested:
  - dirty file → parse failures logged, exit 1
  - clean file → exit 0
  - directory recurse picks up `.jsonl` + `.json`
  - `--limit` caps the row stream cleanly

Wired into `pyproject.toml` workspace members; entry point
`tb-migrate-langsmith = "tracebility_migrate_langsmith.cli:main"`.

## Loop iteration #5 — done (item #6)

✅ **JS/TS LangSmith shim** —
`packages/sdk-typescript/` is the symmetric port of the Python shim:
`Client` with `createRun` / `updateRun` / `batchIngestRuns`,
`traceable` wrapper for sync + async functions, and `wrapOpenAI` /
`wrapAnthropic` Proxy-based vendor SDK wrappers. One-line import
migration:

```diff
- import { Client, traceable } from "langsmith";
+ import { Client, traceable } from "tracebility-langsmith-shim";
```

Same env-var contract as the Python side (`LANGSMITH_ENDPOINT` /
`LANGSMITH_API_KEY` / `LANGSMITH_PROJECT`, with `LANGCHAIN_*`
fallbacks). Runtime: Node 18+ for `fetch` and `crypto.randomUUID`;
no third-party runtime deps. Tests inject a custom `fetchImpl` so
they never hit the network.

`traceable` threads `parent_run_id` through nested calls via
`AsyncLocalStorage` (loaded lazily so non-Node runtimes still work
with a module-level fallback stack). Async functions are detected at
runtime — return a `Promise` from your wrapped fn and the run is
finalized after the promise settles.

`wrapOpenAI` and `wrapAnthropic` use `Proxy` walks rather than
class-extension so vendor SDK internals stay opaque. We do NOT
import `openai` or `@anthropic-ai/sdk` at module load; the proxy
inspects whatever object is handed in. That keeps the shim
installable without those vendor SDKs as transitive deps. Traced
paths: `chat.completions.create` (OpenAI), `messages.create`
(Anthropic). Streaming responses are recorded as one run with
`stream=true` in inputs (per-chunk spans would explode the trace
tree without helping anyone debug agents).

Smoke-tested end-to-end via a fake fetch + fake vendor clients:
`createRun` / `updateRun` / `batchIngestRuns`, sync + async
`traceable`, nested traceable, `wrapOpenAI` happy path,
`wrapAnthropic` happy path, and `wrapAnthropic` error path —
8/8 pass. README ships migration + usage examples for both
vendor wrappers.

## Loop iteration #5 — done (item #5)

✅ **`wrap_openai` / `wrap_anthropic` helpers** —
`packages/sdk-python/tracebility_langsmith_shim/wrappers.py` adds
two duck-typed proxies that wrap a vendor SDK client and emit one
tracebility run per call. Usage:

```python
from openai import OpenAI
from tracebility_langsmith_shim import wrap_openai
client = wrap_openai(OpenAI())
client.chat.completions.create(model="gpt-4o-mini", messages=[...])
```

Mechanics: `_Proxy` + `_SubPath` walk dotted attribute access lazily
so `client.chat.completions.create(...)` resolves through one traced
hop with everything else delegated transparently to the underlying
vendor object. Traced paths are declared per-vendor:
`("chat", "completions", "create")` for OpenAI,
`("messages", "create")` for Anthropic. We don't import the vendor
SDK at module load — the proxy inspects whatever object you hand it,
so the shim remains installable without `openai` / `anthropic` as
transitive deps.

Per call: at entry we POST a `run_type="llm"` with model + messages
+ temperature/max_tokens (and `extra.metadata.vendor` so reads can
filter). At exit we PATCH with the response summary —
`{output, prompt_tokens, completion_tokens, total_tokens, finish_reason
| stop_reason}`. The summarizers honor both `model_dump()`-style
modern responses and dict responses. Errors are caught, recorded
with `error="<ExcType>: <msg>"`, and re-raised — the wrapper never
swallows.

Async wrappers slot in next iteration without changing the surface
(same dotted-path table). Streaming responses are recorded as one
run with `stream=true` in inputs; per-chunk spans would explode the
trace tree without helping anyone debug agents.

Bumped package version to `0.0.2`. README extended with vendor-SDK
usage examples. Smoke tests verified both vendors plus the
error-path PATCH.

## Loop iteration #5 — done (item #4)

✅ **Bulk actions on runs** —
`services/api/tracebility_api/routers/run_actions.py` adds
`POST /v1/runs/_actions/add-to-dataset` and
`POST /v1/runs/_actions/add-to-annotation-queue`. Both accept a
selection of up to 200 run_ids, resolve them against the run table
in ClickHouse (`run_id IN ({...})` with positional UUID params),
then either:

  - write one `dataset_item` per resolved run (with
    `source_run_id` so the dataset row points back to the trace)
    in a single batched insert, then bump `dataset.item_count` in
    one statement, OR
  - upsert one `annotation_item` per resolved run via a single
    `INSERT … SELECT FROM unnest(...) ON CONFLICT (queue_id, run_id)
    DO NOTHING` and bump `annotation_queue.item_total` by the actual
    insert count (dedup-aware — re-running a bulk add doesn't double
    a queue's denominator). The queue flips back from `complete` to
    `open` if items were added.

Both paths are RBAC-fail-closed (owner/admin/member), audit-write
the bulk operation with accepted/skipped totals (ER-10), and
report per-run results so the UI can surface "this one was missing
from ClickHouse" without dropping the rest of the batch (ER-23).
Selection cap (200) is shared between server validation and the UI
"select all visible" affordance.

UI: `web/src/components/RunsBulkClient.tsx` ships
  - `RunsBulkProvider` (React context for the selection set; lives
    in component state, NOT URL — URL is the filter state)
  - `RunCheckbox` per row
  - `SelectAllVisibleCheckbox` in the table header
  - `BulkActionBar` — sticky-bottom card that surfaces when ≥1 run
    is selected; toggles between "Add to dataset" and "Send to
    queue" modes with a dataset/queue picker; calls the cookie-
    forwarding proxies under `web/src/app/api/runs/_actions/...`
    and refreshes the page on success; shows accepted/skipped
    summary inline.

`web/src/app/runs/page.tsx` server-fetches the active project's
datasets and annotation queues alongside runs + saved views (one
parallel `Promise.all`), wraps the runs table in
`RunsBulkProvider`, prepends a checkbox column, and renders the
`BulkActionBar` after the table.

## Loop iteration #5 — done (item #3)

✅ **Saved filters / views on /runs** —
`schemas/postgres/migrations/0016_saved_views.sql` adds `saved_view`
(project-scoped, jsonb `filters` bag, `is_shared` bool, `pinned` bool,
`sort_index`, `created_by`) with two partial unique indices: one on
`(project_id, name) where is_shared` for shared views, one on
`(project_id, created_by, name) where not is_shared` for personal
views. Filter shape v1: `{status, kind, search, window_seconds}` —
free-form jsonb so we can extend without migration; unknown keys
dropped at read time (defense-in-depth against v2-poisoning-v1).

`services/api/tracebility_api/routers/saved_views.py` exposes
`GET/POST /v1/saved-views`, `PATCH/DELETE /v1/saved-views/{id}`.
List filters server-side to "shared OR mine" so personal views
stay private. RBAC: personal view edits/deletes restricted to the
creator; shared edits/deletes restricted to owner/admin. Audit
fail-closed (ER-10) on every write. Constraint enforces
`(is_shared and created_by IS NULL) OR (NOT is_shared AND created_by
IS NOT NULL)` so a personal view always has an owner.

`services/api/tracebility_api/routers/runs_query.py` `list_runs`
now accepts `kind`, `search`, `window_seconds` alongside `status`.
Search uses `positionCaseInsensitive` on the `name` column (it's
LowCardinality(String); the column isn't indexed for search but the
hot path is start_time + project so this is fine). Window filter
uses `start_time >= now64(9) - toIntervalSecond({window:UInt32})`.

UI: `web/src/app/runs/page.tsx` reads filters from `searchParams`
and forwards them to `/v1/runs`; URL is the single source of truth.
Two new bars stack above the runs table:
  - `SavedViewsBar` — chips for shared and personal views with
    "active" detection (chip lights up when its filter shape matches
    the URL — survives reload, shareable URLs work). Per-chip pin
    and delete affordances; clear-filter affordance and
    "Save view" modal that captures the current URL filter as a
    new row. Save modal toggles personal vs shared visibility +
    optional pin (personal only in v1; per-user pins on shared
    views need a join table — deferred).
  - `FilterBar` — search input + status / kind / window-window
    selectors; submitting pushes a new URL via `router.push` so the
    server re-renders.

Cookie-forwarding proxies under
`web/src/app/api/saved-views/route.ts` (POST) and
`web/src/app/api/saved-views/[id]/route.ts` (PATCH/DELETE).

## Loop iteration #5 — done (item #2)

✅ **PoLL multi-judge evals** —
`schemas/postgres/migrations/0015_poll_runs.sql` adds the `poll_run`
table (project-scoped row with `judges text[]` of judge kinds —
constraint enforces ≥2 — plus `aggregation` enum mean/majority/min/max,
lifecycle queued → running → done/failed, counters, `consensus_avg`,
and a pairwise `agreement` metric).
`services/api/tracebility_api/routers/poll_runs.py` exposes
`GET/POST /v1/poll-runs`, `GET /v1/poll-runs/{id}`, and
`GET /v1/poll-runs/{id}/items?limit=`. POST validates ≥2 distinct
judges (built-in echo / contains / exact in v1) + the aggregation
enum, queues the row, and dispatches `_run_poll` via `BackgroundTasks`.

The runner fetches dataset items once, scores each item with every
judge, batches ONE ClickHouse insert with all (item × judge) rows
tagged `eval_config_id=poll_run.id` and `judge_name=<kind>` (same
shape as single-judge evals so analytic queries still work), then
computes:
  - `consensus_avg` per the chosen aggregation strategy
  - `agreement` = pairwise binary-outcome match ratio across all
    (item, judge_pair) cells, threshold at 0.5 (simpler than
    Fleiss-kappa, conveys the same "do judges disagree?" signal)

Per-item read computes consensus + per-judge breakdown via
GROUP BY at query time — no denormalized per-item table; the
single `eval_score` store remains the source of truth and existing
dashboards inherit human + LLM + cmp:a/b + PoLL panel rows in one
shelf.

UI: new sidebar entry "PoLL panels" under /poll-runs.
`web/src/app/poll-runs/page.tsx` is the server-component list with
KPI strip (runs / in-flight / consensus avg / **agreement** —
warn-toned below 70%) and a per-row table (judges as badges,
strategy, consensus%, agreement%, items, created).
`web/src/app/poll-runs/[id]/page.tsx` is the detail view: header
with status + aggregation + judge badges; KPI strip including a
**disputed** counter (items where judges split); items table
sorted ascending by consensus so the most-disputed rows surface
first, with one column per judge + a per-row "disputed" badge when
judges disagree. `NewPollRunButton` (modal: dataset picker + judge
multi-select + aggregation picker) posts to the cookie-forwarding
proxy at `web/src/app/api/poll-runs/route.ts` and routes straight
to the detail page.

LLM judges (LLM-as-judge with rationale) slot in next iteration via
the same dispatcher pattern as Playground; storage shape stays
unchanged.

1. **Playground** ✅ shipped (item #1) — most visible LangSmith feature;
   directly closes the "where do I iterate on a prompt?" gap.
   Backend: prompt_version + workspace LLM creds + dispatcher.
   UI: prompt picker → editor → run → side-by-side.
2. **PoLL multi-judge evals** (❌) — multi-judge aggregation on
   the existing `eval_score` store; the real eval-rigor wedge.
3. **Saved filters / views on /runs** (❌) — quality-of-life on
   the most-visited screen.
4. **Bulk actions on runs** (❌) — pair with item 3: tag, add to
   dataset, send to annotation queue.
5. **`wrap_openai` / `wrap_anthropic`** convenience helpers on
   `tracebility-langsmith-shim` (❌).
6. **JS/TS LangSmith shim** (❌) — symmetric port of the Python shim.
7. **Migration importer** (❌) — LangSmith export JSON → tracebility
   ClickHouse runs; the unblocker for "we already have history".
8. **Saved filters / dashboards on /monitoring** ✅ shipped (item #8).
9. **Helm chart** ✅ shipped (item #9).
10. **Native Python SDK** ✅ shipped (item #10) — tracebility-shaped
    client (read + write).

Each step ends with: commit, push, re-run gap analysis at top of this file, repeat.
