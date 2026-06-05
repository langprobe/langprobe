-- 0021_llm_credentials.sql
-- Workspace-scoped LLM provider credentials.
--
-- Today every LLM-dispatching surface (playground, luna prompted-
-- judges, comparisons stand-in, studio replay) reads provider keys
-- from the api service env. That works for single-tenant self-host
-- but doesn't survive multi-workspace usage where each workspace
-- brings its own keys.
--
-- This table holds encrypted secrets keyed by (workspace, provider,
-- name). Lookup order at dispatch time:
--   1. workspace_llm_credential (this table) — first match where
--      provider matches and revoked_at is null
--   2. environment variable (ANTHROPIC_API_KEY / OPENAI_API_KEY)
-- so the env path remains for self-host single-tenant.
--
-- Storage rationale:
-- - One row per (workspace, provider, name): named keys let an
--   operator have "prod" + "staging" credentials side-by-side and
--   a future surface can choose between them.
-- - `secret_encrypted` is plaintext today (column name is the
--   contract); KMS envelope encryption swaps in without a migration.
-- - Soft-revoke via revoked_at — historical audit trails keep
--   pointing at the row even after rotation.
-- - We DO NOT store the public key prefix or anything that lets us
--   echo back the secret. Reveal-once on creation; rotation requires
--   a fresh row.

begin;

create table workspace_llm_credential (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null references workspace (id) on delete cascade,
    provider text not null check (provider in ('anthropic', 'openai')),
    name text not null,
    -- Plaintext today; the column is named `_encrypted` so a future
    -- KMS envelope migration is invisible to operator code.
    secret_encrypted text not null,
    -- Last-4 of the secret for visual disambiguation on the list
    -- view. Helps operators tell "prod" from "staging" at a glance
    -- without surfacing the full key.
    secret_last4 text not null,
    created_by uuid references app_user (id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    revoked_at timestamptz
);

-- One active credential per (workspace, provider, name) — re-issuing
-- with the same name requires revoking the old one first.
create unique index workspace_llm_credential_active_uniq
    on workspace_llm_credential (workspace_id, provider, name)
    where revoked_at is null;

create index workspace_llm_credential_ws_idx
    on workspace_llm_credential (workspace_id);

create trigger workspace_llm_credential_updated_at
    before update on workspace_llm_credential
    for each row execute function set_updated_at();

insert into schema_migrations (version) values ('0021_llm_credentials')
on conflict (version) do nothing;

commit;
