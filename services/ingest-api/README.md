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
export LANGPROBE_REDIS_URL=redis://localhost:6379/0
export LANGPROBE_PG_DSN=postgres://langprobe:langprobe@localhost:5432/langprobe
python -m langprobe_ingest
```

## Env vars

| name                                | default                              |
| ----------------------------------- | ------------------------------------ |
| `LANGPROBE_REDIS_URL`             | required                             |
| `LANGPROBE_PG_DSN`                | required                             |
| `LANGPROBE_DISK_BUFFER_PATH`      | `/var/lib/langprobe/ingest-buffer` |
| `LANGPROBE_INLINE_BLOB_MAX_BYTES` | `1000000`                            |
| `LANGPROBE_BIND_HOST`             | `0.0.0.0`                            |
| `LANGPROBE_BIND_PORT`             | `7080`                               |
| `LANGPROBE_LOG_LEVEL`             | `INFO`                               |
