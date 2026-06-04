# tracebility Helm chart

Self-hosted LLM observability + eval-rigor + agent-replay platform on
Kubernetes. Deploys the four tracebility services: `api`, `ingest-api`,
`ingest-worker`, `web`.

## What this chart does NOT do

It deliberately does **not** bundle Postgres, ClickHouse, or Redis.
Production deployments almost always want managed Postgres / managed
ClickHouse, and bundling them in the chart makes that worse, not
better. For a one-command dev loop, run the docker-compose stack at
`infra/docker-compose.yml`.

## Prerequisites

- Kubernetes 1.25+
- A reachable Postgres (16+), ClickHouse (24.x+), and Redis (7+)
- Helm 3.10+

## Install

```sh
# Pre-create secrets that hold the DSN/URL for each external dep.
kubectl create secret generic tracebility-postgres \
  --from-literal=dsn='postgres://user:pass@host:5432/tracebility'
kubectl create secret generic tracebility-clickhouse \
  --from-literal=url='http://user:pass@host:8123/tracebility'
kubectl create secret generic tracebility-redis \
  --from-literal=url='redis://host:6379/0'
kubectl create secret generic tracebility-session \
  --from-literal=secret="$(openssl rand -hex 32)"

helm install tb deploy/helm/tracebility \
  --set postgres.existingSecret=tracebility-postgres \
  --set clickhouse.existingSecret=tracebility-clickhouse \
  --set redis.existingSecret=tracebility-redis \
  --set session.existingSecret=tracebility-session \
  --set web.publicApiBase=https://api.example.com \
  --set ingress.enabled=true \
  --set ingress.className=nginx \
  --set ingress.hosts.web.host=app.example.com \
  --set ingress.hosts.api.host=api.example.com \
  --set ingress.hosts.ingest.host=ingest.example.com
```

## Run database migrations

Migrations live in `schemas/postgres/migrations/` (numbered SQL files).
The simplest path is a one-shot `kubectl run` against your cluster's
psql image; CI-driven migrations come with a separate Job in the next
iteration.

## Upgrade

```sh
helm upgrade tb deploy/helm/tracebility \
  --reuse-values \
  --set image.tag=v0.2.0
```

## Values

See `values.yaml`. The secret-resolution helpers prefer
`existingSecret` over inline values; never put plaintext credentials
in your Helm release manifests.

## Notes

- The `ingest-api` mounts an optional disk buffer PVC (RWO) for
  envelope durability across pod restarts. Redis is the source of
  truth; the buffer is best-effort, so the deployment uses
  `strategy: Recreate` on rollout.
- The `api` service exposes `/healthz` for readiness/liveness probes.
- All four services log JSON via `structlog`; ship to your log
  aggregator of choice.
