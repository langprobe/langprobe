# tracebility-migrate-langsmith

CLI that reads a LangSmith export (JSONL of run rows) and replays the
rows into a tracebility ingest host's LangSmith parity endpoints.

The receiving end already understands the LangSmith `RunCreate`
payload shape (`services/ingest-api/.../langsmith_shim.py`), so the
importer is intentionally thin: it streams the file, batches rows,
and POSTs to `/runs/batch`.

## Install

```bash
pip install tracebility-migrate-langsmith
```

## Use

```bash
# Configure
export TRACEBILITY_INGEST_URL=https://traces.example.com
export TRACEBILITY_INGEST_KEY=tk_...

# Validate first (parses, no network)
tb-migrate-langsmith --input ./langsmith-export.jsonl --dry-run

# Replay
tb-migrate-langsmith --input ./langsmith-export.jsonl

# Or stream from stdin
cat export.jsonl | tb-migrate-langsmith --input -

# Sample a large export
tb-migrate-langsmith --input ./big.jsonl --limit 1000 --batch-size 100
```

Inputs:

- a JSONL file (one JSON object per line)
- a directory (recurses into `*.jsonl` and `*.json`)
- `-` for stdin

## Behavior

- **Idempotent on the receive side**: the worker upserts by
  `run_id`, so re-running an import is safe.
- **Never silent-drop** (ER-23): per-row parse failures are logged
  with `<file>:<line>` and counted; the CLI exits non-zero if any
  row failed to parse or any batch returned ≥400.
- **Batches**: default 100 rows per `/runs/batch` POST; tune with
  `--batch-size` (1–1000).
- **Read-only on the source**: never deletes or mutates the
  LangSmith data — this is a one-shot replay.

## Authentication

- `--api-key` overrides env. Falls back to
  `TRACEBILITY_INGEST_KEY`, then `LANGSMITH_API_KEY` (lets you
  reuse a LangSmith-style env if your ops scripts already export
  it). The token is sent on `Authorization: Bearer …` and
  `x-api-key`.

## Endpoint

- `--endpoint` overrides env. Falls back to
  `TRACEBILITY_INGEST_URL`, then `LANGSMITH_ENDPOINT`, then
  `http://localhost:7080`.
