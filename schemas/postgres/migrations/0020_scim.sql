-- 0020_scim.sql
-- SCIM 2.0 provisioning: workspace-scoped SCIM tokens + a tracking
-- table that maps SCIM-side user IDs to app_user rows.
--
-- Why a tracking table?
--   - SCIM clients (Okta, Azure AD, JumpCloud) keep their own
--     stable IDs and expect us to honor them. We can't just hash
--     email — IdPs sometimes change emails (rebrands, marriages),
--     and SCIM PATCH /Users/{externalId} must continue to resolve.
--   - Mapping is per-workspace: the same external user could be
--     provisioned into two workspaces by two different IdPs.
--
-- Tokens are HMAC-prefixed (`tbs_<random>`); admin/owner-only to
-- mint/revoke. Per-token RBAC narrowing (e.g. "this token can only
-- manage users at member role") is deferred to a later iteration —
-- v1 has one privilege level: SCIM-admin.

begin;

create table workspace_scim_token (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null references workspace (id) on delete cascade,
    name text not null,
    -- token format: `tbs_<32 hex>`. The full plaintext is shown
    -- once on create; we store an Argon2id hash like api_key.
    public_id text not null unique,
    secret_hash text not null,
    created_by uuid references app_user (id) on delete set null,
    created_at timestamptz not null default now(),
    last_used_at timestamptz,
    revoked_at timestamptz
);

create index workspace_scim_token_ws_idx on workspace_scim_token (workspace_id);

-- Maps SCIM-side ids (externalId / Users.id) to local app_user.
-- One row per (workspace, external_id) so the same user can be
-- provisioned into multiple workspaces.
create table scim_user_mapping (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null references workspace (id) on delete cascade,
    -- The SCIM-side id. Most IdPs use a UUID-shaped string but the
    -- spec allows any opaque string ≤256 chars.
    external_id text not null,
    user_id uuid not null references app_user (id) on delete cascade,
    -- Snapshot of the role last assigned via SCIM. Useful for diff
    -- diagnostics ("Okta thinks this is admin, postgres has member").
    role text not null default 'member'
        check (role in ('owner', 'admin', 'member', 'viewer')),
    -- Active flag mirrors SCIM `active`. We soft-deactivate by
    -- removing workspace_member rather than deleting the mapping;
    -- re-activating restores membership.
    active boolean not null default true,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (workspace_id, external_id),
    unique (workspace_id, user_id)
);

create trigger scim_user_mapping_updated_at
    before update on scim_user_mapping
    for each row execute function set_updated_at();

create index scim_user_mapping_user_idx on scim_user_mapping (user_id);

insert into schema_migrations (version) values ('0020_scim')
on conflict (version) do nothing;

commit;
