# ClickHouse client stage: pull a pinned, official ClickHouse image and
# copy out the single `clickhouse` binary (which dispatches to all
# sub-commands including `client` via argv[0]).
#
# The version is pinned to match the ClickHouse server image used for
# dev-deps (see deploy/k8s/dev-deps/clickhouse.yaml). Bumping that image
# is when this pin should also bump.
FROM clickhouse/clickhouse-server:24.8-alpine AS clickhouse-binary

# Final stage: postgres:16-alpine for psql, with the clickhouse binary
# copied in from the stage above.
# NOTE: the ClickHouse binary is glibc-linked. The clickhouse-server:24.8-alpine
# image ships the glibc dynamic linker in /lib alongside musl. We copy
# the whole /lib directory so that both architectures (amd64/arm64) get
# the correct platform-specific glibc shims — only ~3 MB of overhead.
FROM postgres:16-alpine

RUN apk add --no-cache bash

# Bring in the glibc shims from the ClickHouse stage (arch-agnostic).
COPY --from=clickhouse-binary /lib/ /lib/

# clickhouse-client is symlinked -> clickhouse; both names work.
COPY --from=clickhouse-binary /usr/bin/clickhouse /usr/local/bin/clickhouse
RUN ln -s /usr/local/bin/clickhouse /usr/local/bin/clickhouse-client

WORKDIR /app
COPY services/migrator/run.sh /app/run.sh
COPY schemas/postgres/migrations /schemas/postgres
COPY schemas/clickhouse /schemas/clickhouse

RUN chmod +x /app/run.sh

ENTRYPOINT ["/app/run.sh"]
