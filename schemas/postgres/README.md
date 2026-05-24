# Postgres schema (control plane)

Stores org/workspace/project hierarchy, users, API keys, audit log, and metadata
that needs strong consistency. Heavy trace/eval data lives in ClickHouse — see
`schemas/clickhouse/`.

## Migrations

Numbered, idempotent, transactional. Each file is one logical step. Apply with:

```bash
psql "$TRACEBILITY_PG_DSN" -f schemas/postgres/migrations/0001_init.sql
```

Or, when the migrator service exists:

```bash
tracebility migrate up
```

## Conventions

- `id` is `uuid` default `gen_random_uuid()` (requires `pgcrypto`).
- All tables have `created_at timestamptz default now()` and `updated_at timestamptz default now()`.
- Soft-delete via `deleted_at timestamptz` where applicable; queries filter
  `deleted_at is null` by default.
- `audit_log` is append-only — no updates, no deletes (enforced by trigger in 0002).
- All foreign keys are `on delete restrict` unless cascade is the explicit intent.

## Multi-tenancy

Hierarchy: `org` -> `workspace` -> `project`. RBAC scopes attach to org and
workspace levels. Per-row tenancy is enforced application-side (not RLS) because
the api service uses a single connection pool and per-request tenant filtering.
