# Schema migration runner for GKE deploys

**Date:** 2026-06-07
**Status:** approved (brainstorming) → pending implementation plan
**Owner:** infra
**Predecessors:** [2026-06-06-gke-cicd-design.md](./2026-06-06-gke-cicd-design.md), [2026-06-06-oauth-signup-gke-design.md](./2026-06-06-oauth-signup-gke-design.md)

## Summary

Postgres + ClickHouse schema migrations live in `schemas/postgres/migrations/`
and `schemas/clickhouse/`. The local docker-compose stack mounts them into
`/docker-entrypoint-initdb.d` and they apply on first boot. The GKE deploy
has nothing equivalent — Postgres and ClickHouse start empty, and the API
crashes whenever it touches a table that doesn't exist (we just hit this
with `oauth_state` blocking the OAuth flow).

This spec adds a `migrator` container image baked with the SQL files, run
as a Helm pre-upgrade Job before any Deployment rolls. The Job applies
unapplied Postgres migrations using the project's existing
`schema_migrations` tracking table, then runs all ClickHouse migrations
(currently safe to re-run because they're all `CREATE IF NOT EXISTS`).

The image is built and pushed by the existing `deploy.yml` workflow as a
fifth matrix entry. The Helm hook annotations make it `--atomic`-friendly:
a failed migration aborts the upgrade and rolls the cluster back to the
previous SHA + previous schema state.

## Out of scope

- **DOWN / rollback migrations.** Project convention is forward-only; not
  changing that here.
- **ClickHouse migration tracker.** No CH migration in-tree currently uses
  ALTER, so re-running them is a no-op. The first PR that introduces a
  CH ALTER must also introduce a tracker; out of scope today.
- **Migration linting in CI.** Catching non-transactional SQL or
  non-idempotent statements at PR time is a separate spec.
- **Data backfill jobs.** Schema-only here. Backfills are application
  code, run from their own Jobs, and have different correctness needs.
- **Schema diff / drift detection.** Out of scope.

## Architecture

### Lifecycle

```
git push origin main
   │
   ▼
deploy.yml → build-images (matrix x5: api, ingest-api, ingest-worker, web, migrator)
   │             ↓
   │             pushes asia-southeast2-docker.pkg.dev/.../migrator:<sha>
   ▼
helm-deploy → helm upgrade --install --atomic --wait --timeout 5m
   │
   │  (during the upgrade, BEFORE any Deployment is reconciled:)
   ▼
PRE-UPGRADE HOOK: Job langprobe-migrator-<release-revision>
   │
   ├── psql -At -c "SELECT version FROM schema_migrations" → list of applied
   ├── for each *.sql in /schemas/postgres/migrations/ in lexical order:
   │     if version in applied → skip
   │     else                  → psql -v ON_ERROR_STOP=1 -f <file>
   │                            (each migration is wrapped in BEGIN/COMMIT)
   ├── for each *.sql in /schemas/clickhouse/ in lexical order:
   │     clickhouse-client --queries-file <file>
   │     (all current files are CREATE IF NOT EXISTS, so re-runs are no-ops)
   │
   ├── EXIT 0 on success → hook completes, helm proceeds with Deployments
   └── EXIT non-zero      → hook fails, --atomic rolls back the release
                            (cluster stays on previous SHA + previous schema)
```

### Why these choices

- **Helm pre-upgrade hook** vs. a separate workflow: migrations and the
  matching code ship as one atomic unit. You can't have api pods running
  on commit X while the database is still on commit X-1's schema.

- **Single dedicated image** vs. reusing `postgres:16` + `clickhouse:24.8`:
  one image runs both clients. Cuts the chart from two Jobs to one. The
  image is tiny — `postgres:16-alpine` + `apk add clickhouse-client`.

- **SQL baked into image** vs. mounted via ConfigMap: the image SHA
  matches the deploy SHA, so "what migrations got applied" is auditable
  by inspecting the image. ConfigMap approach risks drift if someone
  edits a SQL file in-cluster.

- **Existing `schema_migrations` table** vs. a new tracker: every
  Postgres migration in-tree already does
  `INSERT INTO schema_migrations (version) VALUES ('NNNN_name') ON CONFLICT DO NOTHING`.
  We don't introduce a new convention, we just respect the existing one.

- **No ClickHouse tracker (yet)**: would force a tracker design before
  it's needed. Today all 5 CH files are `CREATE TABLE IF NOT EXISTS`,
  re-runnable. The first ALTER must come with a tracker — flagged as a
  follow-up.

- **`backoffLimit: 0` + `restartPolicy: Never`**: a failing migration
  should not silently retry. It should fail loudly so the operator
  inspects logs and decides.

## Files written by this design

```
services/migrator/Dockerfile                                   NEW
services/migrator/run.sh                                       NEW
deploy/helm/langprobe/values.yaml                            MODIFIED (+1 block)
deploy/helm/langprobe/templates/migrator-job.yaml            NEW
.github/workflows/deploy.yml                                   MODIFIED (+1 matrix entry)
docs/superpowers/specs/2026-06-07-migration-runner-design.md   THIS DOC
```

No changes to:

- The chart's existing api/ingest-api/ingest-worker/web Deployments.
- `_helpers.tpl` (the `langprobe.image` helper already handles any
  component; `langprobe.envFromSecret` already wires Postgres + ClickHouse).
- `values-gke.yaml` (the new `migrator.enabled` defaults to `true`;
  GKE-specific values stay focused on what differs from chart defaults).
- The migration SQL files themselves.

## Component shapes

### `services/migrator/Dockerfile`

```dockerfile
FROM postgres:16-alpine

# clickhouse-client is in the alpine community repo
RUN apk add --no-cache bash clickhouse-client

WORKDIR /app
COPY services/migrator/run.sh /app/run.sh
COPY schemas/postgres/migrations /schemas/postgres
COPY schemas/clickhouse /schemas/clickhouse

RUN chmod +x /app/run.sh

ENTRYPOINT ["/app/run.sh"]
```

The build context is the repo root (already the case for the existing
matrix builds), so the COPY paths are repo-relative.

### `services/migrator/run.sh`

```bash
#!/usr/bin/env bash
set -euo pipefail

PG_DSN="${LANGPROBE_PG_DSN:?LANGPROBE_PG_DSN must be set}"
CH_URL="${LANGPROBE_CLICKHOUSE_URL:?LANGPROBE_CLICKHOUSE_URL must be set}"

echo "==> Postgres: collecting applied migrations"
applied="$(psql -At -c "SELECT version FROM schema_migrations" "$PG_DSN" 2>/dev/null || true)"

count_applied=0
count_skipped=0
for f in /schemas/postgres/*.sql; do
  v="$(basename "$f" .sql)"
  if printf '%s\n' "$applied" | grep -qx "$v"; then
    echo "  skip: $v"
    count_skipped=$((count_skipped + 1))
    continue
  fi
  echo "  apply: $v"
  psql -v ON_ERROR_STOP=1 -f "$f" "$PG_DSN" >/dev/null
  count_applied=$((count_applied + 1))
done
echo "==> Postgres: applied $count_applied, skipped $count_skipped"

echo "==> ClickHouse: applying all migrations (CREATE IF NOT EXISTS)"
for f in /schemas/clickhouse/*.sql; do
  echo "  apply: $(basename "$f" .sql)"
  clickhouse-client --url "$CH_URL" --queries-file "$f"
done
echo "==> ClickHouse: applied $(ls /schemas/clickhouse/*.sql | wc -l) file(s)"

echo "==> migrator: done"
```

`set -euo pipefail` plus `psql -v ON_ERROR_STOP=1` ensures any error
fails the script. ClickHouse-client returns non-zero on syntax error.

### `deploy/helm/langprobe/values.yaml` addition

```yaml

## Schema migration runner. Helm pre-upgrade Job that applies any
## unapplied Postgres + ClickHouse migrations before any Deployment
## rolls. Same image lifecycle as the four service images — it's
## built per-commit with the same image.tag.
##
## To opt out (e.g. if you run migrations out-of-band), set enabled: false.
migrator:
  enabled: true
  image:
    repository: migrator
    tag: ""           # falls back to image.tag
  resources:
    requests:
      cpu: 100m
      memory: 128Mi
    limits:
      cpu: 500m
      memory: 512Mi
```

### `deploy/helm/langprobe/templates/migrator-job.yaml`

```yaml
{{- if .Values.migrator.enabled }}
apiVersion: batch/v1
kind: Job
metadata:
  name: {{ include "langprobe.fullname" . }}-migrator-{{ .Release.Revision }}
  labels:
    {{- include "langprobe.labels" . | nindent 4 }}
    app.kubernetes.io/component: migrator
  annotations:
    helm.sh/hook: pre-install,pre-upgrade
    helm.sh/hook-weight: "-5"
    helm.sh/hook-delete-policy: before-hook-creation
spec:
  backoffLimit: 0
  template:
    metadata:
      labels:
        {{- include "langprobe.labels" . | nindent 8 }}
        app.kubernetes.io/component: migrator
    spec:
      serviceAccountName: {{ include "langprobe.serviceAccountName" . }}
      restartPolicy: Never
      {{- with .Values.global.imagePullSecrets }}
      imagePullSecrets:
        {{- toYaml . | nindent 8 }}
      {{- end }}
      containers:
        - name: migrator
          image: {{ include "langprobe.image" (dict "root" . "component" .Values.migrator) }}
          imagePullPolicy: {{ default .Values.global.imagePullPolicy .Values.image.pullPolicy }}
          env:
            {{- include "langprobe.envFromSecret" (dict "cfg" .Values.postgres "name" "LANGPROBE_PG_DSN") | nindent 12 }}
            {{- include "langprobe.envFromSecret" (dict "cfg" .Values.clickhouse "name" "LANGPROBE_CLICKHOUSE_URL") | nindent 12 }}
          resources:
            {{- toYaml .Values.migrator.resources | nindent 12 }}
{{- end }}
```

`{{ .Release.Revision }}` makes the Job name unique per upgrade, so
`kubectl logs job/<name>-migrator-<rev>` is unambiguous and the
previous Job stays around for inspection until the next upgrade
(`hook-delete-policy: before-hook-creation`).

### `.github/workflows/deploy.yml` matrix addition

```yaml
        include:
          - service: api
            dockerfile: services/api/Dockerfile
          - service: ingest-api
            dockerfile: services/ingest-api/Dockerfile
          - service: ingest-worker
            dockerfile: services/ingest-worker/Dockerfile
          - service: web
            dockerfile: web/Dockerfile
          - service: migrator
            dockerfile: services/migrator/Dockerfile
```

That's the only change needed; the rest of the matrix-job body is
service-name-agnostic.

## Failure modes

| Failure | Outcome |
|---|---|
| Migration SQL has a syntax error. | `psql -v ON_ERROR_STOP=1` exits non-zero, `set -e` kills the script, Job pod exits non-zero, hook fails, Helm `--atomic` rolls back. Cluster stays on previous SHA + previous schema. Operator inspects `kubectl logs job/langprobe-migrator-<rev>`. |
| Migration acquires a long lock (e.g. ALTER on a 50M-row table). | Job runs to completion or hits `helm --timeout 5m` and gets killed mid-execution. ALL current migrations are wrapped in BEGIN/COMMIT, so a kill rolls back the open transaction cleanly. New migrations MUST keep this property — we'll add a CI lint for it as a follow-up. |
| Postgres unreachable. | psql connect fails, Job fails, hook fails, rollback. Recovery: fix the dev-deps Postgres or the secret, re-run the deploy. |
| ClickHouse unreachable. | Same — Job fails, rollback. |
| `schema_migrations` row exists but the table body wasn't actually created (manual surgery, partial restore). | Runner skips the migration (it trusts the row). Recovery: `DELETE FROM schema_migrations WHERE version = 'NNNN_thing'`, re-deploy. |
| Two `helm upgrade`s racing. | Already prevented by `concurrency: deploy-main, cancel-in-progress: false` in `deploy.yml`. The hook Job creation is also serialized by the Helm release lock. |
| First-ever install on an empty Postgres. | `psql ... 2>/dev/null || true` returns empty string; loop applies all 22 in lexical order. `0001_init.sql` creates `schema_migrations` then inserts its own row. Re-running on second install is a no-op. |
| Deploy SA doesn't have permission to create Jobs. | `roles/container.developer` (already granted in the bootstrap runbook) covers Jobs. No change. |
| ClickHouse migration in the future introduces an ALTER. | This spec doesn't handle it. The PR introducing the ALTER must also introduce a CH `schema_migrations` equivalent and update `run.sh`. Flagged in "Out of scope". |
| Operator wants to opt out (e.g. running migrations from a separate runner). | `--set migrator.enabled=false` skips the template. They run migrations themselves before deploys. |
| Job log retention. | `hook-delete-policy: before-hook-creation` keeps the previous Job until the next upgrade. After the next upgrade, the old Job (and its pod logs) are gone. For long-term auditing, ship logs to Cloud Logging via Autopilot's default log forwarder (already enabled). |

## Verification (acceptance criteria)

A reviewer should be able to verify all of these after merge + deploy:

1. `services/migrator/Dockerfile` and `services/migrator/run.sh` exist; the image builds locally with `docker build -f services/migrator/Dockerfile .`.
2. `.github/workflows/deploy.yml` matrix has 5 entries (api, ingest-api, ingest-worker, web, migrator). The deploy workflow on main produces `asia-southeast2-docker.pkg.dev/.../migrator:<sha>`.
3. `helm template langprobe deploy/helm/langprobe -f values-gke.yaml --set image.tag=test` renders a `kind: Job` resource with `helm.sh/hook: pre-install,pre-upgrade`. Setting `--set migrator.enabled=false` produces zero `kind: Job` resources.
4. After the next deploy on the langprobe cluster, `kubectl -n langprobe get jobs` shows a `langprobe-migrator-<rev>` Job with status `Complete`.
5. `kubectl -n langprobe logs job/langprobe-migrator-<rev>` shows lines like `==> Postgres: applied N, skipped M` and `==> ClickHouse: applied 5 file(s)`.
6. After the deploy, `psql -c "SELECT count(*) FROM schema_migrations"` (via `kubectl exec`) returns `22` (or however many migrations are in-tree at deploy time), matching `ls schemas/postgres/migrations/*.sql | wc -l`.
7. A second deploy of the same SHA results in `==> Postgres: applied 0, skipped 22` — re-run is idempotent.
8. The `oauth_state` table exists and OAuth `/api/auth/oauth/google/start?intent=login` returns `302` (no longer 500).

## Open follow-ups (NOT this spec)

- ClickHouse migration tracker (when the first ALTER lands).
- CI lint that rejects migrations missing `BEGIN/COMMIT` or missing the
  `INSERT INTO schema_migrations` line.
- A mechanism for data backfill jobs distinct from schema migrations.
- A `schema_migrations.applied_by` / `applied_from_image` column for richer audit.
- Automatic `kubectl exec` runbook command to inspect a failed migration's logs from a workflow re-run failure annotation.
