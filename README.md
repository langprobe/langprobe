# tracebility

**The real debugger for agents.**

Self-hosted LLM observability + eval-rigor + agent-replay. A LangSmith replacement that runs in your VPC and doubles as the debugger you reach for at 2am when an agent goes sideways.

> Status: pre-alpha. This repository is the initial scaffold for an 18-30 month build. Nothing here is production-ready.

## What's in here

```
services/
  ingest-api/         # OTel GenAI + LangSmith shim ingest, FastAPI
  api/                # auth, RBAC, project/dataset/prompt CRUD, FastAPI
  ingest-worker/      # Redis -> ClickHouse batch writer
  eval-orchestrator/  # judge fan-out, sampling, RCA
web/                  # Next.js + TypeScript product UI
schemas/
  postgres/           # control-plane schema (orgs, users, audit log, ...)
  clickhouse/         # data-plane schema (runs, spans, evals, replays)
packages/
  sdk-python/         # tracebility Python SDK
  sdk-typescript/     # tracebility TypeScript SDK
infra/                # docker-compose, k8s manifests
designs/              # UI mockups
DESIGN.md             # design system source of truth
CLAUDE.md             # project guide for agents
TODOS.md              # phased build list
```

## Storage stack

- **Postgres** — control plane (orgs, users, projects, api keys, audit log)
- **ClickHouse** — data plane (runs, spans, eval scores, replay captures)
- **Redis** — ingest queue, rate-limit token buckets, cache
- **Object storage** — large attachments (S3/MinIO)

## Quick start (when scaffold is wired)

```bash
docker compose -f infra/docker-compose.yml up -d
open http://localhost:3000
```

The setup wizard will walk you through creating the first org, root user, and API key.

## License

Apache 2.0. See [LICENSE](LICENSE).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). DCO sign-off is required.
