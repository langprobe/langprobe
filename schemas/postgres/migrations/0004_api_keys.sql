-- 0004_api_keys.sql
-- API keys for SDK ingest + read API. Hashed at rest, prefix indexed for lookup.

begin;

create table api_key (
    id uuid primary key default gen_random_uuid(),
    project_id uuid not null references project (id) on delete restrict,
    -- 'lt_' prefix + 12-char public id; full key is shown once at creation
    public_id text not null unique,
    -- argon2id hash of the secret half; never store plaintext
    secret_hash text not null,
    name text,
    scopes text[] not null default array['ingest:write']::text[],
    created_by uuid references app_user (id) on delete set null,
    last_used_at timestamptz,
    revoked_at timestamptz,
    expires_at timestamptz,
    created_at timestamptz not null default now()
);

create index api_key_project_id_idx on api_key (project_id);
create index api_key_active_idx on api_key (revoked_at, expires_at) where revoked_at is null;

insert into schema_migrations (version) values ('0004_api_keys')
on conflict (version) do nothing;

commit;
