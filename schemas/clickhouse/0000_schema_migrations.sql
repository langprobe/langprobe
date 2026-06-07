-- 0000_schema_migrations.sql
-- Bootstrap version-tracking table for ClickHouse migrations.
--
-- Numbered 0000 (instead of 0001+) so it sorts first under glob ordering
-- and is always applied before any other migration. The migrator runner
-- (services/migrator/run.sh) treats this file specially: it always runs,
-- consults the resulting `schema_migrations` table to learn which other
-- migrations have already been applied, and skips those.
--
-- This unblocks non-idempotent migrations (CREATE-INSERT-RENAME, ALTER,
-- DROP), which the previous "always re-apply with CREATE IF NOT EXISTS"
-- contract couldn't support. See 0006_tenant_columns.sql for the case
-- that motivated this.

create table if not exists schema_migrations
(
    version    String,
    applied_at DateTime64(9, 'UTC') default now64(9)
)
engine = MergeTree
order by version
settings index_granularity = 8192;
