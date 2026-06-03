-- 0007_invitations.sql
-- Workspace invitations. The accept flow turns an invitation into a
-- workspace_member row; until then, the row sits here with an Argon2id-hashed
-- single-use token and a 7-day expiry. We keep accepted/revoked rows for
-- audit, never hard-delete (parallels how api_key.revoked_at works).

begin;

create table workspace_invitation (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null references workspace (id) on delete restrict,
    email citext not null,
    role text not null check (role in ('admin', 'member', 'viewer')),
    -- argon2id hash of the secret half; the plaintext token is shown ONCE
    -- to the inviter (or emailed) and never persisted.
    token_hash text not null,
    -- short lookup id encoded in the token, similar to api_key.public_id
    token_public_id text not null unique,
    invited_by uuid references app_user (id) on delete set null,
    created_at timestamptz not null default now(),
    expires_at timestamptz not null default (now() + interval '7 days'),
    accepted_at timestamptz,
    accepted_by uuid references app_user (id) on delete set null,
    revoked_at timestamptz
);

create index workspace_invitation_workspace_idx
    on workspace_invitation (workspace_id);

create index workspace_invitation_email_idx
    on workspace_invitation (email)
    where accepted_at is null and revoked_at is null;

create index workspace_invitation_active_idx
    on workspace_invitation (expires_at)
    where accepted_at is null and revoked_at is null;

insert into schema_migrations (version) values ('0007_invitations')
on conflict (version) do nothing;

commit;
