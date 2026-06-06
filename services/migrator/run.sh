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

# We talk to ClickHouse over HTTP rather than the native binary protocol,
# because the DSN we get (TRACEBILITY_CLICKHOUSE_URL) already targets the
# HTTP endpoint. clickhouse-client's URL form isn't supported in 24.x and
# adding the binary would balloon the image by ~480 MB.
#
# DSN convention in this project is http(s)://USER:PASS@HOST:PORT/DB.
# Over HTTP, ClickHouse expects the database as a query param, not a path
# segment — rewrite "/<db>" -> "/?database=<db>" before sending.
ch_re='^(https?://[^/]+)/([^?]+)(\?.*)?$'
if [[ "$CH_URL" =~ $ch_re ]]; then
  ch_endpoint="${BASH_REMATCH[1]}/?database=${BASH_REMATCH[2]}${BASH_REMATCH[3]:+&${BASH_REMATCH[3]:1}}"
else
  ch_endpoint="$CH_URL"   # already has /?... form, send as-is
fi

# ClickHouse's HTTP endpoint doesn't accept multi-statement bodies (no
# `multi_statements` setting in 24.x), so split each .sql file into
# individual statements on `;` followed by newline, drop empty/whitespace-
# only chunks, and POST each one separately.
ch_total=0
for f in /schemas/clickhouse/*.sql; do
  echo "  apply: $(basename "$f" .sql)"
  # awk produces a NUL-delimited stream of statements; while-loop reads them
  # without subshell issues.
  while IFS= read -r -d '' stmt; do
    # Skip pure-whitespace / comment-only chunks.
    case "$(printf '%s' "$stmt" | tr -d '[:space:]' | sed -E 's/--[^\\n]*//g')" in
      "") continue ;;
    esac
    http_status=$(printf '%s' "$stmt" | curl -sS -o /tmp/ch_response -w "%{http_code}" \
      --data-binary @- "$ch_endpoint" || true)
    if [ "$http_status" != "200" ]; then
      echo "ERROR: ClickHouse returned HTTP $http_status on statement from $(basename "$f")"
      cat /tmp/ch_response
      exit 1
    fi
  done < <(awk 'BEGIN{RS=";\n"; ORS="\0"} { print }' "$f")
  ch_total=$((ch_total + 1))
done
echo "==> ClickHouse: applied $ch_total file(s)"

echo "==> migrator: done"
