# GKE continuous deploy on every commit to `main`

**Date:** 2026-06-06
**Status:** approved (brainstorming) → pending implementation plan
**Owner:** infra

## Summary

Every push to `main` builds the four service images (`web`, `api`,
`ingest-api`, `ingest-worker`), pushes them to Artifact Registry, and
runs `helm upgrade --install` against the existing GKE Autopilot
cluster. Authentication is via Workload Identity Federation — no
long-lived JSON keys. Existing `ci.yml` (ruff + lint + typecheck)
gates the deploy via `workflow_run`.

This is a CI/CD design, not a refactor of the chart. The chart at
`deploy/helm/langprobe/` already supports image tag + registry
overrides; the workflow just supplies them.

## Target environment

- **GCP project:** `project-c4ff4ea3-775a-4e0c-9a3`
- **GKE cluster:** `langprobe-cluster-1`, region `asia-southeast2`
  (Autopilot, public endpoint, Workload Identity enabled at pool
  `project-c4ff4ea3-775a-4e0c-9a3.svc.id.goog`)
- **Artifact Registry:** repo `langprobe`, region `asia-southeast2`
  → `asia-southeast2-docker.pkg.dev/project-c4ff4ea3-775a-4e0c-9a3/langprobe/<service>:<tag>`
- **Kubernetes namespace:** `langprobe` (Helm `--create-namespace`)
- **GitHub repo:** `langprobe/langprobe`
- **Branch that deploys:** `main`

## Out of scope

- Provisioning Postgres / ClickHouse / Redis. The chart deliberately
  does not bundle stateful deps; production uses managed services
  referenced by k8s secret. Bootstrap doc records which secrets must
  exist before first deploy.
- Ingress / domain wiring. `ingress.enabled=false` in `values-gke.yaml`
  for the first deploy. Verification is via `kubectl port-forward`.
- Multi-environment promotion (staging → prod). Single environment
  for now: every `main` commit goes straight to the cluster.
- Database migrations. The chart does not currently run migration
  jobs; that's a separate spec.
- ArgoCD / GitOps reconcile. Direct `helm upgrade` from CI for v1.

## Architecture

### Two pipelines, two lifecycles

```
                         ONE-TIME (human runs locally)
docs/superpowers/runbooks/gke-bootstrap.md
   │
   ├── creates WIF pool + provider, pinned to repo + main
   ├── creates deploy SA with: artifactregistry.writer
   │                           container.developer
   │                           container.clusterViewer
   ├── binds WIF principal → deploy SA via roles/iam.workloadIdentityUser
   ├── verifies Artifact Registry repo exists
   ├── creates `langprobe` namespace
   └── creates k8s secrets (postgres, clickhouse, redis, session)


                         PER-COMMIT (GitHub Actions)
.github/workflows/deploy.yml
   triggered: workflow_run on `ci` completing successfully on main
   │
   ├── job: build-images (matrix x4, fail-fast: false)
   │     ├── auth via WIF
   │     ├── docker buildx build + push to Artifact Registry
   │     │       tag with ${{ github.sha }} AND `latest`
   │     └── cache via type=gha
   │
   └── job: helm-deploy (needs all 4 build jobs)
         ├── auth via WIF
         ├── gcloud container clusters get-credentials
         └── helm upgrade --install langprobe \
                 deploy/helm/langprobe \
                 -n langprobe --create-namespace \
                 -f deploy/helm/langprobe/values-gke.yaml \
                 --set image.tag=${{ github.sha }} \
                 --atomic --wait --timeout 5m
```

### Why `workflow_run`, not duplicate steps

The existing `ci.yml` already runs ruff + lint + typecheck on `push:
main`. Duplicating those steps inside `deploy.yml` would drift over
time. `workflow_run` makes `ci` the single source of truth for
"correctness gate" and `deploy.yml` the single source for "delivery
gate." Each workflow has one job.

### Why all four images on every commit

Building only changed services (path-filtered) is faster but creates
image-tag drift across services that's hard to reason about. The
chart deploys all four with the same `image.tag = github.sha`, which
makes "what is in production" trivially answerable. Buildx layer
cache (`type=gha`) makes unchanged services rebuild in seconds.

### Why direct `helm upgrade`, not GitOps

ArgoCD is the better answer at scale (proper audit, drift
detection, multi-cluster). For one cluster + one environment + one
team it's a moving part to maintain. We can move to GitOps later by
having the workflow write a tag to a values file instead of
running `helm upgrade`.

## Authentication flow (per commit)

```
GitHub Actions runner
   │
   │  permissions: id-token: write
   ▼
GitHub OIDC token  (subject: repo:langprobe/langprobe:ref:refs/heads/main)
   │
   │  google-github-actions/auth@v2
   ▼
WIF provider exchanges token, validates:
   assertion.repository == "langprobe/langprobe"
   assertion.ref        == "refs/heads/main"
   │
   ▼
Short-lived federated identity, impersonates:
   langprobe-deploy@project-c4ff4ea3-775a-4e0c-9a3.iam.gserviceaccount.com
   roles: roles/artifactregistry.writer
          roles/container.developer
          roles/container.clusterViewer
   │
   ├──► docker push to Artifact Registry  (artifactregistry.writer)
   └──► gcloud container clusters get-credentials
        → kubeconfig uses gke-gcloud-auth-plugin with the same token
        → helm upgrade authenticates as the deploy SA
```

The WIF attribute condition rejects forks, feature branches, and
PRs from forks. The deploy SA has no project-owner / no org-level
perms. The only GitHub-side secret is the built-in `GITHUB_TOKEN`.

## Files written by this design

```
.github/workflows/deploy.yml                          NEW
docs/superpowers/runbooks/gke-bootstrap.md            NEW
deploy/helm/langprobe/values-gke.yaml               NEW
docs/superpowers/specs/2026-06-06-gke-cicd-design.md  THIS DOC
```

### `values-gke.yaml` shape

Overrides only what differs from `values.yaml`:

- `image.registry: asia-southeast2-docker.pkg.dev/project-c4ff4ea3-775a-4e0c-9a3/langprobe`
- per-service `image.repository` set to the bare service name
  (`web`, `api`, `ingest-api`, `ingest-worker`) since the registry
  path already includes `/langprobe`
- `ingress.enabled: false`
- replica counts unchanged from `values.yaml` defaults (2 each)
- `postgres.existingSecret: langprobe-postgres`
- `clickhouse.existingSecret: langprobe-clickhouse`
- `redis.existingSecret: langprobe-redis`
- `session.existingSecret: langprobe-session`

`image.tag` is supplied by `--set` from the workflow, never written
to a file (so a re-deploy of the same SHA is reproducible from the
file alone).

### `deploy.yml` shape

```yaml
name: deploy
on:
  workflow_run:
    workflows: ["ci"]
    types: [completed]
    branches: [main]

permissions:
  contents: read
  id-token: write          # required for WIF

concurrency:
  group: deploy-main
  cancel-in-progress: false   # never race two `helm upgrade`s

jobs:
  build-images:
    if: github.event.workflow_run.conclusion == 'success'
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix:
        service: [web, api, ingest-api, ingest-worker]
    steps:
      - actions/checkout
      - google-github-actions/auth@v2 (WIF)
      - gcloud auth configure-docker asia-southeast2-docker.pkg.dev
      - docker/setup-buildx-action
      - docker/build-push-action
          context: .
          file: services/${{ matrix.service }}/Dockerfile  (web/Dockerfile for web)
          tags: |
            asia-southeast2-docker.pkg.dev/.../langprobe/${{ matrix.service }}:${{ github.sha }}
            asia-southeast2-docker.pkg.dev/.../langprobe/${{ matrix.service }}:latest
          cache-from: type=gha,scope=${{ matrix.service }}
          cache-to:   type=gha,mode=max,scope=${{ matrix.service }}

  helm-deploy:
    needs: build-images
    runs-on: ubuntu-latest
    steps:
      - actions/checkout
      - google-github-actions/auth@v2 (WIF)
      - google-github-actions/setup-gcloud@v2
      - gcloud components install gke-gcloud-auth-plugin --quiet
      - gcloud container clusters get-credentials langprobe-cluster-1 --region asia-southeast2
      - azure/setup-helm@v4
      - helm upgrade --install langprobe deploy/helm/langprobe \
          --namespace langprobe --create-namespace \
          --values deploy/helm/langprobe/values-gke.yaml \
          --set image.tag=${{ github.event.workflow_run.head_sha }} \
          --atomic --wait --timeout 5m
      - kubectl rollout status (per deployment, sanity check)
```

`github.event.workflow_run.head_sha` is the SHA the `ci` workflow
ran on, not the tip of `main` at the time `deploy.yml` runs — keeps
deploy and gate aligned even if commits land while the workflow
queues.

## Failure modes designed for

| Failure | Outcome |
|---|---|
| `ci.yml` fails on `main` | `deploy.yml` never runs (gated on `workflow_run.conclusion == 'success'`) |
| Image build fails for 1 service | Other 3 still build (`fail-fast: false`); `helm-deploy` does not run because `needs:` is not satisfied; cluster stays on previous SHA |
| Pods crash-loop after `helm upgrade` | `--atomic --wait` rolls back the release; workflow exits non-zero; cluster stays on previous SHA |
| Required k8s secret missing | `helm upgrade` fails fast on missing `existingSecret` reference; rollback as above. Bootstrap doc enforces secret existence pre-first-deploy |
| Two commits land back-to-back | `concurrency: deploy-main, cancel-in-progress: false` queues the second deploy; never two `helm upgrade`s in flight |
| Fork or feature-branch token tries to push | WIF attribute condition rejects (`assertion.repository` / `assertion.ref` mismatch) |
| Cluster temporarily unreachable | `helm upgrade --timeout 5m` fails after 5 minutes; workflow red; safe to re-run by pushing an empty commit or via "Re-run jobs" |
| Re-deploy of same SHA needed | Workflow can be re-run from the Actions UI; `--set image.tag=<sha>` is deterministic; image is still in Artifact Registry |
| Deploy SA leaked | Rotate by deleting + recreating the SA; WIF binding is the only persistent surface |

## Bootstrap runbook (one-time, written as `gke-bootstrap.md`)

The runbook contains exact `gcloud` / `kubectl` commands for:

1. **Enable APIs:** `iamcredentials`, `sts`, `container`,
   `artifactregistry` (Autopilot already needs `container`).
2. **Verify Artifact Registry repo** `langprobe` exists in
   `asia-southeast2`. Create if missing.
3. **Create deploy SA** `langprobe-deploy@<project>.iam.gserviceaccount.com`.
4. **Grant minimum IAM** to the deploy SA:
   - `roles/artifactregistry.writer` on the AR repo
   - `roles/container.developer` on the cluster
   - `roles/container.clusterViewer` on the cluster
5. **Create WIF pool** `github-actions-pool` and **provider**
   `github-actions-provider` with attribute mapping
   `attribute.repository=assertion.repository`,
   `attribute.ref=assertion.ref`, and attribute condition
   `assertion.repository == "langprobe/langprobe"`.
6. **Bind WIF principal → deploy SA:**
   `gcloud iam service-accounts add-iam-policy-binding ... --role roles/iam.workloadIdentityUser --member principalSet://iam.googleapis.com/projects/.../locations/global/workloadIdentityPools/github-actions-pool/attribute.repository/langprobe/langprobe`.
7. **Create k8s namespace** `langprobe`.
8. **Create k8s secrets** with documented shape:
   - `langprobe-postgres` key `dsn` →  `postgres://...`
   - `langprobe-clickhouse` key `url` → `http://...`
   - `langprobe-redis` key `url` → `redis://...`
   - `langprobe-session` key `secret` → 32+ char random
     (`openssl rand -hex 32`)
9. **Set GitHub repo variables:**
   `GCP_PROJECT_ID`, `GCP_REGION`, `GKE_CLUSTER`, `AR_REPO`,
   `WIF_PROVIDER`, `DEPLOY_SA_EMAIL`. Variables, not secrets — none
   are sensitive on their own.

The runbook is idempotent: re-running it on a fully-bootstrapped
project should be a no-op (all `gcloud` commands either succeed or
return "already exists" and the runbook documents which is fine).

## Open follow-ups (NOT this spec)

- Database migration job (Helm pre-upgrade hook → `alembic upgrade head` for control plane, ClickHouse migrations for data plane).
- Ingress + domain wiring (GCE Ingress or Gateway API; Autopilot supports both).
- Staging environment with promote-by-tag.
- ArgoCD migration if the team grows past one cluster.
- Per-PR ephemeral environments.
- Cosign signing of pushed images + Binary Authorization on the cluster.

## Acceptance criteria for the implementation plan

A reviewer should be able to verify all of these after merge:

1. `.github/workflows/deploy.yml` exists, is gated on `ci`, builds
   four images in parallel, deploys via Helm.
2. `docs/superpowers/runbooks/gke-bootstrap.md` exists, lists every
   `gcloud` / `kubectl` command, is idempotent, names every IAM role
   and every k8s secret.
3. `deploy/helm/langprobe/values-gke.yaml` exists, points at
   Artifact Registry, references existing secrets by name, leaves
   ingress disabled.
4. The first deploy after running the bootstrap runbook produces
   four healthy deployments in namespace `langprobe` and a green
   workflow run.
5. A subsequent commit to `main` rolls all four deployments to the
   new SHA and stays green; `kubectl rollout status` reports
   complete for each.
