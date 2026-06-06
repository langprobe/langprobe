# Slim Debian base. psql comes from the official PostgreSQL apt repo
# (pgdg). ClickHouse is talked to over HTTP via curl — we don't need
# the clickhouse-client binary, which would add ~480 MB.

FROM debian:bookworm-slim

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
    apt-get update; \
    apt-get install -y --no-install-recommends \
      bash \
      postgresql-client-16; \
    \
    # curl stays — it's our ClickHouse transport. Purge only the
    # apt-setup helpers we don't need at runtime.
    apt-get purge -y --auto-remove gnupg lsb-release; \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY services/migrator/run.sh /app/run.sh
COPY schemas/postgres/migrations /schemas/postgres
COPY schemas/clickhouse /schemas/clickhouse

RUN chmod +x /app/run.sh

ENTRYPOINT ["/app/run.sh"]
