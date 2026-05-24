# ingest-worker

Drains the Redis Stream `tracebility:ingest:v1` (consumer group `ingest`) and
writes envelopes into ClickHouse `run` / `span` tables.

Idempotency is delegated to ClickHouse: both tables are `ReplacingMergeTree`
on `(project_id, run_id, span_id)` ordered by `received_at`, so a redelivery
from the stream produces a row that the merge collapses. The worker does
not dedupe.

Failed envelopes go to `tracebility:ingest:v1:dlq` after `max_deliveries`
redeliveries (ER-23 — never silently drop).

## Run

```sh
export TRACEBILITY_REDIS_URL=redis://localhost:6379/0
export TRACEBILITY_CLICKHOUSE_URL=http://default@localhost:8123/tracebility
python -m tracebility_worker
```

## Env vars

| name                                | default   |
| ----------------------------------- | --------- |
| `TRACEBILITY_REDIS_URL`             | required  |
| `TRACEBILITY_CLICKHOUSE_URL`        | required  |
| `TRACEBILITY_WORKER_CONSUMER_NAME`  | host name |
| `TRACEBILITY_WORKER_BATCH_SIZE`     | `500`     |
| `TRACEBILITY_WORKER_BLOCK_MS`       | `2000`    |
| `TRACEBILITY_WORKER_MAX_DELIVERIES` | `5`       |
| `TRACEBILITY_LOG_LEVEL`             | `INFO`    |

Stream key (`tracebility:ingest:v1`), group (`ingest`), and DLQ stream
(`tracebility:ingest:v1:dlq`) are not env-tunable — they're a contract with
the ingest-api.
