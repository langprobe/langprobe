# Single-stage Debian base. Has psql via the postgres:16 image and the
# clickhouse-client via the official ClickHouse apt repo. Larger than
# Alpine but reproducible, doesn't require multi-stage glibc tricks,
# and runs as a one-shot Job so cold-start size doesn't matter.
FROM postgres:16

ARG CLICKHOUSE_VERSION=24.8.14.39
ENV DEBIAN_FRONTEND=noninteractive

# ClickHouse apt repo + pinned client install. Build-only deps
# (curl, gnupg) are removed in the same RUN to keep the layer small.
RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends ca-certificates curl gnupg; \
    curl -fsSL https://packages.clickhouse.com/rpm/lts/repodata/repomd.xml.key \
      | gpg --dearmor -o /usr/share/keyrings/clickhouse-keyring.gpg; \
    echo "deb [signed-by=/usr/share/keyrings/clickhouse-keyring.gpg] https://packages.clickhouse.com/deb stable main" \
      > /etc/apt/sources.list.d/clickhouse.list; \
    apt-get update; \
    apt-get install -y --no-install-recommends \
      "clickhouse-client=${CLICKHOUSE_VERSION}" \
      "clickhouse-common-static=${CLICKHOUSE_VERSION}"; \
    apt-get purge -y --auto-remove curl gnupg; \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY services/migrator/run.sh /app/run.sh
COPY schemas/postgres/migrations /schemas/postgres
COPY schemas/clickhouse /schemas/clickhouse

RUN chmod +x /app/run.sh

ENTRYPOINT ["/app/run.sh"]
