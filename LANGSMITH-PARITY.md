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
| Python SDK (native) | ❌ | not started |
| JS/TS SDK (native) | ❌ | not started |
| LangSmith-compatible Python shim | ✅ | `tracebility-langsmith-shim` ships `Client` + `@traceable` (sync+async) posting to ingest-api parity endpoints; one-line import migration (loop #4 item 11) |
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

## Loop iteration #5 — plan

Re-scoring the scoreboard at the top, the remaining ❌ / 🟡 cells
break into five buckets. Ordered by leverage (visible gap × user
demand ÷ implementation cost):

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
8. **Saved filters / dashboards on /monitoring** — extends item 3.
9. **Helm chart** (❌) — self-host adoption surface.
10. **Native Python SDK** (❌) — tracebility-shaped client (read +
    write); the LangSmith shim covers write parity but the read
    side needs its own surface.

Each step ends with: commit, push, re-run gap analysis at top of this file, repeat.
