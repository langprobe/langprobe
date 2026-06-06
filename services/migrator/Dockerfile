FROM postgres:16-alpine

# clickhouse-client is not in Alpine repos; download the official static binary.
# The single `clickhouse` binary supports all sub-commands including `client`.
# We symlink clickhouse-client -> clickhouse so run.sh works unchanged.
RUN apk add --no-cache bash curl \
 && ARCH="$(uname -m)" \
 && case "$ARCH" in \
      x86_64)  DIR="amd64musl" ;; \
      aarch64) DIR="aarch64"   ;; \
      *)       echo "Unsupported arch: $ARCH" && exit 1 ;; \
    esac \
 && curl -fsSL "https://builds.clickhouse.com/master/${DIR}/clickhouse" \
      -o /usr/local/bin/clickhouse \
 && chmod +x /usr/local/bin/clickhouse \
 && ln -s /usr/local/bin/clickhouse /usr/local/bin/clickhouse-client

WORKDIR /app
COPY services/migrator/run.sh /app/run.sh
COPY schemas/postgres/migrations /schemas/postgres
COPY schemas/clickhouse /schemas/clickhouse

RUN chmod +x /app/run.sh

ENTRYPOINT ["/app/run.sh"]
