-- 0003_users_and_membership.sql
-- Users, identity providers, RBAC membership.

begin;

create table app_user (
    id uuid primary key default gen_random_uuid(),
    email citext not null unique,
    name text,
    -- one of these will be populated; identity_provider explains which
    password_hash text,
    external_idp text,           -- 'oidc' | 'saml' | null
    external_subject text,       -- IdP-issued sub
    is_root boolean not null default false,
    last_login_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    deleted_at timestamptz,
    check (
        (password_hash is not null and external_idp is null)
        or (password_hash is null and external_idp is not null)
    )
);

create trigger app_user_updated_at
    before update on app_user
    for each row execute function set_updated_at();

create unique index app_user_external_subject_idx
    on app_user (external_idp, external_subject)
    where external_idp is not null;

-- Org membership + role
create table org_member (
    org_id uuid not null references org (id) on delete restrict,
    user_id uuid not null references app_user (id) on delete restrict,
    role text not null check (role in ('owner', 'admin', 'member', 'viewer')),
    created_at timestamptz not null default now(),
    primary key (org_id, user_id)
);

create index org_member_user_id_idx on org_member (user_id);

-- Optional workspace-scoped role overrides (defaults to org role)
create table workspace_member (
    workspace_id uuid not null references workspace (id) on delete restrict,
    user_id uuid not null references app_user (id) on delete restrict,
    role text not null check (role in ('admin', 'member', 'viewer')),
    created_at timestamptz not null default now(),
    primary key (workspace_id, user_id)
);

create index workspace_member_user_id_idx on workspace_member (user_id);

insert into schema_migrations (version) values ('0003_users_and_membership')
on conflict (version) do nothing;

commit;
