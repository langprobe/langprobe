#!/usr/bin/env bash
set -euo pipefail

PG_DSN="${TRACEBILITY_PG_DSN:?TRACEBILITY_PG_DSN must be set}"
CH_URL="${TRACEBILITY_CLICKHOUSE_URL:?TRACEBILITY_CLICKHOUSE_URL must be set}"

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

# All ClickHouse migrations must be idempotent (CREATE TABLE IF NOT EXISTS).
# ALTER migrations require a version-tracking table before being added.
echo "==> ClickHouse: applying all migrations (CREATE IF NOT EXISTS)"
ch_total=0
for f in /schemas/clickhouse/*.sql; do
  echo "  apply: $(basename "$f" .sql)"
  clickhouse-client --url "$CH_URL" --queries-file "$f"
  ch_total=$((ch_total + 1))
done
echo "==> ClickHouse: applied $ch_total file(s)"

echo "==> migrator: done"
