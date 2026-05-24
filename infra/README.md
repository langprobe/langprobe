# infra

Self-host stack: Postgres + ClickHouse + Redis + ingest-api + api +
ingest-worker + web. One file boots the whole thing locally.

## First boot

```sh
cp infra/.env.example infra/.env
# fill in SESSION_SECRET (openssl rand -hex 32)
docker compose -f infra/docker-compose.yml up --build
```

Postgres runs the SQL files in `schemas/postgres/migrations/` in
alphabetical order on first boot. ClickHouse does the same for
`schemas/clickhouse/`. Both are mounted read-only from the repo so an
edit + `docker compose down -v && docker compose up` re-applies a fresh
schema. `-v` wipes the volumes — only do that locally.

## Ports

| service    | host port | what to hit                    |
| ---------- | --------- | ------------------------------ |
| web        | 7090      | the product UI                 |
| api        | 7081      | control plane (login/projects) |
| ingest-api | 7080      | SDK ingest endpoint            |
| postgres   | 5432      | psql for inspection            |
| clickhouse | 8123/9000 | HTTP / native                  |
| redis      | 6379      | redis-cli                      |

`ingest-worker` is internal-only — it consumes the Redis stream.

## Health check

```sh
curl -s http://localhost:7080/healthz   # ingest-api
curl -s http://localhost:7081/healthz   # api
curl -s http://localhost:7090/          # web
```
