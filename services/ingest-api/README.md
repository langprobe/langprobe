# ingest-api

Accept-and-202 ingest service. Validates API keys against Postgres, wraps the
batch with tenant identifiers, pushes to a Redis stream, and returns 202. The
ingest-worker drains the stream and writes to ClickHouse.

If Redis is down we spill to a local disk buffer instead of dropping (ER-01).
A background drain loop pushes spills back when Redis returns.

## Endpoints

Native (OTel GenAI-aligned):
- `POST /v1/runs` — `IngestBatch` of runs+spans

LangSmith parity shim (point `LANGSMITH_ENDPOINT` here):
- `POST /runs` — single `RunCreate`
- `POST /runs/batch` — `{post: [...], patch: [...]}`
- `PATCH /runs/{run_id}` — partial update

Operational:
- `GET /healthz` — process liveness
- `GET /readyz` — pings Redis + Postgres

## Auth

`Authorization: Bearer lt_<public_id>.<secret>` or `X-Api-Key: lt_…`. Secret is
verified with argon2id against `api_key.secret_hash`. Postgres unreachable →
401 (fail-closed, ER-09). Revoked or expired keys → 401 (ER-20).

## Run

```sh
export TRACEBILITY_REDIS_URL=redis://localhost:6379/0
export TRACEBILITY_PG_DSN=postgres://tracebility:tracebility@localhost:5432/tracebility
python -m tracebility_ingest
```

## Env vars

| name                                | default                              |
| ----------------------------------- | ------------------------------------ |
| `TRACEBILITY_REDIS_URL`             | required                             |
| `TRACEBILITY_PG_DSN`                | required                             |
| `TRACEBILITY_DISK_BUFFER_PATH`      | `/var/lib/tracebility/ingest-buffer` |
| `TRACEBILITY_INLINE_BLOB_MAX_BYTES` | `1000000`                            |
| `TRACEBILITY_BIND_HOST`             | `0.0.0.0`                            |
| `TRACEBILITY_BIND_PORT`             | `7080`                               |
| `TRACEBILITY_LOG_LEVEL`             | `INFO`                               |
