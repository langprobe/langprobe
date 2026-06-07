"""LangSmith export → tracebility ingest CLI.

Usage:
    tb-migrate-langsmith --input runs.jsonl \
        --endpoint https://traces.example.com \
        --api-key tk_... \
        --batch-size 100 \
        --dry-run

Input formats:
  - one JSON object per line (`runs.jsonl`)
  - a directory; we recurse into `*.jsonl` and `*.json`
  - `-` reads from stdin

Each row is the LangSmith `RunCreate` payload shape. We forward
each batch to the ingest-api at POST /runs/batch which already
accepts {post: [...], patch: [...]} and translates verbatim into
the native IngestBatch (same path as the live shim).

ER-23: never silent-drop. Per-row parse failures are logged with
file:line and skipped; the operator sees a non-zero exit code if
any row failed to parse OR any batch returned non-2xx.

The CLI is intentionally read-only on the source side and never
deletes / mutates anything in LangSmith. Migrating runs is a
one-shot replay; idempotency lives on the receiving end (the worker
upserts on run_id).
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from collections.abc import Iterator
from pathlib import Path
from typing import Any

try:
    import httpx
except ImportError as exc:  # pragma: no cover
    raise SystemExit("tracebility-migrate-langsmith requires httpx; pip install httpx") from exc


_DEFAULT_BATCH_SIZE = 100
_USER_AGENT = "tb-migrate-langsmith/0.0.1"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="tb-migrate-langsmith",
        description="Migrate LangSmith export rows to a tracebility ingest host.",
    )
    parser.add_argument(
        "--input",
        "-i",
        required=True,
        help="JSONL file, directory of JSONL/JSON, or '-' for stdin.",
    )
    parser.add_argument(
        "--endpoint",
        default=os.environ.get("TRACEBILITY_INGEST_URL")
        or os.environ.get("LANGSMITH_ENDPOINT")
        or "http://localhost:7080",
        help="tracebility ingest base URL (default: env TRACEBILITY_INGEST_URL).",
    )
    parser.add_argument(
        "--api-key",
        default=os.environ.get("TRACEBILITY_INGEST_KEY") or os.environ.get("LANGSMITH_API_KEY"),
        help="Bearer token for the ingest host (default: env TRACEBILITY_INGEST_KEY).",
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=_DEFAULT_BATCH_SIZE,
        help=f"How many rows per /runs/batch POST (default: {_DEFAULT_BATCH_SIZE}).",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Parse + summarize but do not POST anything.",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Optional row cap (handy for sampling a large export).",
    )
    parser.add_argument(
        "--timeout",
        type=float,
        default=30.0,
        help="Per-request HTTP timeout in seconds (default: 30).",
    )
    args = parser.parse_args(argv)

    if not args.dry_run and not args.api_key:
        print(
            "warning: no --api-key or TRACEBILITY_INGEST_KEY set; the ingest host "
            "will likely 401. Pass --dry-run to validate the input first.",
            file=sys.stderr,
        )

    if args.batch_size < 1 or args.batch_size > 1000:
        print("error: --batch-size must be between 1 and 1000", file=sys.stderr)
        return 2

    rows_iter = _stream_rows(args.input, args.limit)

    parse_failures = 0
    accepted = 0
    posted_batches = 0
    failed_batches: list[str] = []

    if args.dry_run:
        for _ in rows_iter:
            accepted += 1
        parse_failures = _ROW_PARSE_FAILURES
        print(
            f"dry-run: parsed {accepted} rows; "
            f"parse_failures={parse_failures}; "
            f"would post in batches of {args.batch_size}"
        )
        return 1 if parse_failures else 0

    base = args.endpoint.rstrip("/")
    headers = {
        "content-type": "application/json",
        "user-agent": _USER_AGENT,
    }
    if args.api_key:
        headers["authorization"] = f"Bearer {args.api_key}"
        # LangSmith historically also reads x-api-key — set both so
        # whichever the ingest host is wired for picks it up.
        headers["x-api-key"] = args.api_key

    with httpx.Client(timeout=args.timeout, headers=headers) as client:
        for batch in _batched(rows_iter, args.batch_size):
            posted_batches += 1
            payload = {"post": batch, "patch": []}
            try:
                resp = client.post(f"{base}/runs/batch", json=payload)
            except httpx.HTTPError as exc:
                msg = f"batch {posted_batches}: transport error: {exc}"
                print(msg, file=sys.stderr)
                failed_batches.append(msg)
                continue
            if resp.status_code >= 400:
                msg = (
                    f"batch {posted_batches}: ingest returned {resp.status_code}: {resp.text[:200]}"
                )
                print(msg, file=sys.stderr)
                failed_batches.append(msg)
                continue
            accepted += len(batch)
            if posted_batches % 10 == 0:
                print(f"… posted {posted_batches} batches ({accepted} rows)")

    parse_failures = _ROW_PARSE_FAILURES
    print(
        f"done. accepted={accepted} batches={posted_batches} "
        f"parse_failures={parse_failures} failed_batches={len(failed_batches)}"
    )
    if failed_batches or parse_failures:
        return 1
    return 0


_ROW_PARSE_FAILURES = 0


def _stream_rows(source: str, limit: int | None) -> Iterator[dict[str, Any]]:
    """Yield one parsed JSON object per row.

    Rows that fail to parse are logged to stderr (file:line) and
    counted via _ROW_PARSE_FAILURES so the CLI can report them at
    exit. We never raise mid-stream — the CLI's exit code is the
    error signal.
    """
    global _ROW_PARSE_FAILURES
    yielded = 0

    files: list[tuple[str, Iterator[str]]]
    if source == "-":
        files = [("<stdin>", iter(sys.stdin))]
    else:
        path = Path(source)
        if not path.exists():
            raise SystemExit(f"input not found: {source}")
        if path.is_dir():
            jsonl_files = sorted(p for p in path.rglob("*") if p.suffix in (".jsonl", ".json"))
            if not jsonl_files:
                raise SystemExit(f"no .jsonl/.json files under {source}")
            files = [(str(p), open(p)) for p in jsonl_files]  # type: ignore[arg-type]
        else:
            files = [(str(path), open(path))]  # type: ignore[arg-type]

    try:
        for filename, fh in files:
            for lineno, raw in enumerate(fh, start=1):
                line = raw.strip()
                if not line:
                    continue
                try:
                    obj = json.loads(line)
                except json.JSONDecodeError as exc:
                    _ROW_PARSE_FAILURES += 1
                    print(
                        f"{filename}:{lineno}: parse error: {exc.msg}",
                        file=sys.stderr,
                    )
                    continue
                if not isinstance(obj, dict):
                    _ROW_PARSE_FAILURES += 1
                    print(
                        f"{filename}:{lineno}: row is not a JSON object",
                        file=sys.stderr,
                    )
                    continue
                if "id" not in obj:
                    _ROW_PARSE_FAILURES += 1
                    print(
                        f"{filename}:{lineno}: row missing 'id' field; skipping",
                        file=sys.stderr,
                    )
                    continue
                yield obj
                yielded += 1
                if limit is not None and yielded >= limit:
                    return
    finally:
        for _, fh in files:
            close = getattr(fh, "close", None)
            if callable(close) and fh is not sys.stdin:
                try:
                    close()
                except Exception:  # noqa: BLE001
                    pass


def _batched(rows: Iterator[dict[str, Any]], n: int) -> Iterator[list[dict[str, Any]]]:
    batch: list[dict[str, Any]] = []
    for row in rows:
        batch.append(row)
        if len(batch) >= n:
            yield batch
            batch = []
    if batch:
        yield batch


if __name__ == "__main__":
    raise SystemExit(main())
