# ClickHouse schema (data plane)

High-volume telemetry: runs, spans, eval scores, replay captures. Control-plane
metadata (org/project/user/api_key/audit) is in Postgres — see `schemas/postgres/`.

## Why ClickHouse

- Trace/span volume on a single project can hit hundreds of millions of rows/day.
  Postgres can't keep up at write throughput we need; ClickHouse can ingest
  hundreds of MB/sec on commodity hardware.
- Aggregate queries (p50/p95/p99 latency, token cost over 30d, error rate per
  span kind) are exactly what ClickHouse is built for.
- TTLs at the partition level give cheap retention controls.

## Conventions

- Engine: `MergeTree` family. Default `ReplacingMergeTree` ordered by
  `(project_id, run_id, span_id)` for idempotent ingest.
- Partition by month: `toYYYYMM(start_time)`.
- Order by `(project_id, start_time, ...)` so per-project time-range scans are
  pruned efficiently.
- TTL: 90 days default (configurable per project at the application layer; we
  do not eagerly DROP partitions because per-project retention is enforced at
  query time + nightly compaction).
- Strings: low-cardinality columns use `LowCardinality(String)`.
- IDs: `UUID` from Postgres for `project_id` and our own `run_id`/`span_id`
  (UUIDv7 for time-ordering).

## Files

- `0001_runs_and_spans.sql` — core trace tables
- `0002_eval_scores.sql` — judge outputs
- `0003_replay_captures.sql` — agent replay capture index
- `0004_dataset_items.sql` — dataset rows
- `0005_billing_meters.sql` — usage meters (per CEO plan: never silently lose)
