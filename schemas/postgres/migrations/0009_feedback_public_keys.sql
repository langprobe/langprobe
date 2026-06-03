-- 0009_feedback_public_keys.sql
-- Public scoped keys for end-user feedback ingest.
--
-- Unlike `api_key`, these keys are write-only and embedded in browser code.
-- They have no secret half — the entire key (`tbf_pub_<public_id>`) is the
-- credential. Possession of the key authorizes posting feedback against
-- runs in one project and nothing else. Server-side it is rate-limited and
-- can be revoked instantly (ER-20). Origin allowlist is optional (empty
-- array = allow any origin); intended for first-class CORS at the
-- ingest-api edge.

begin;

create table feedback_public_key (
    id uuid primary key default gen_random_uuid(),
    project_id uuid not null references project (id) on delete restrict,
    -- 'tbf_pub_' prefix + 32-char hex public_id; entire key is shown once
    public_id text not null unique,
    name text,
    -- CORS allowlist; empty array means allow any origin
    allowed_origins text[] not null default array[]::text[],
    created_by uuid references app_user (id) on delete set null,
    last_used_at timestamptz,
    revoked_at timestamptz,
    created_at timestamptz not null default now()
);

create index feedback_public_key_project_id_idx
    on feedback_public_key (project_id);
create index feedback_public_key_active_idx
    on feedback_public_key (revoked_at)
    where revoked_at is null;

insert into schema_migrations (version) values ('0009_feedback_public_keys')
on conflict (version) do nothing;

commit;
