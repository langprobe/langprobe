# Slim Debian base. We pull the postgresql-client-16 binary from the
# official PostgreSQL apt repo (pgdg) and the clickhouse-client binary
# from the official ClickHouse apt repo. Single stage, reproducible
# pinned versions, no postgres server / LLVM / Perl bloat.

FROM debian:bookworm-slim

ARG CLICKHOUSE_VERSION=24.8.14.39
ENV DEBIAN_FRONTEND=noninteractive

RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends \
      ca-certificates curl gnupg lsb-release; \
    \
    # PostgreSQL apt repo
    curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc \
      | gpg --dearmor -o /usr/share/keyrings/pgdg-keyring.gpg; \
    echo "deb [signed-by=/usr/share/keyrings/pgdg-keyring.gpg] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" \
      > /etc/apt/sources.list.d/pgdg.list; \
    \
    # ClickHouse apt repo
    curl -fsSL https://packages.clickhouse.com/rpm/lts/repodata/repomd.xml.key \
      | gpg --dearmor -o /usr/share/keyrings/clickhouse-keyring.gpg; \
    echo "deb [signed-by=/usr/share/keyrings/clickhouse-keyring.gpg] https://packages.clickhouse.com/deb stable main" \
      > /etc/apt/sources.list.d/clickhouse.list; \
    \
    apt-get update; \
    apt-get install -y --no-install-recommends \
      bash \
      postgresql-client-16 \
      "clickhouse-client=${CLICKHOUSE_VERSION}" \
      "clickhouse-common-static=${CLICKHOUSE_VERSION}"; \
    \
    apt-get purge -y --auto-remove curl gnupg lsb-release; \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY services/migrator/run.sh /app/run.sh
COPY schemas/postgres/migrations /schemas/postgres
COPY schemas/clickhouse /schemas/clickhouse

RUN chmod +x /app/run.sh

ENTRYPOINT ["/app/run.sh"]
