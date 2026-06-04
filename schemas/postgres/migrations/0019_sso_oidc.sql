-- 0019_sso_oidc.sql
-- Workspace-scoped OIDC SSO configuration.
--
-- Each workspace can configure ONE OIDC provider; users authenticate
-- via the IdP and either match an existing app_user by email or
-- get auto-provisioned (controlled by `auto_provision`). When a new
-- app_user is created via SSO, they're added to the workspace as
-- `member` (operators can promote them via /members).
--
-- Storage rationale:
-- - One row per workspace; partial-unique on `enabled = true` makes
--   "find the active config for this workspace" a single index hit.
-- - `client_secret_encrypted` is a TEXT column today (no envelope
--   encryption yet); the next iteration plugs in a KMS-backed
--   encryptor. We mark the field name explicitly so a future
--   migration can flip it without operator confusion.
-- - We DO NOT store IdP user IDs. Email is the primary join key
--   between IdP and app_user. If two providers issue tokens for the
--   same email, both can sign that user in — that's the expected
--   semantics for a corporate SSO setup with one IdP per workspace.

begin;

create table workspace_sso_config (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null references workspace (id) on delete cascade,
    issuer text not null,
    client_id text not null,
    -- The secret is stored as plaintext today; the column name is
    -- `_encrypted` so we can swap to ciphertext without a migration
    -- visible to operator code.
    client_secret_encrypted text not null,
    -- Discovery: at first sign-in we fetch <issuer>/.well-known/
    -- openid-configuration; the resolved auth/token endpoints get
    -- cached on the row so subsequent sign-ins skip the round-trip.
    -- A null means "fetch on next use" (forces re-discovery).
    authorization_endpoint text,
    token_endpoint text,
    jwks_uri text,
    -- Provisioning policy: 'auto' = create app_user on first sign-in
    -- with email match-no-found; 'match-only' = require an existing
    -- app_user with that email or 401.
    auto_provision text not null default 'auto'
        check (auto_provision in ('auto', 'match-only')),
    -- Default role on auto-provision (member is the safe choice).
    default_role text not null default 'member'
        check (default_role in ('owner', 'admin', 'member', 'viewer')),
    enabled boolean not null default true,
    created_by uuid references app_user (id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create unique index workspace_sso_config_one_per_ws
    on workspace_sso_config (workspace_id)
    where enabled = true;

create trigger workspace_sso_config_updated_at
    before update on workspace_sso_config
    for each row execute function set_updated_at();

-- OIDC state nonces: short-lived random tokens that survive the
-- IdP redirect round-trip. We store them server-side rather than
-- packing into the cookie because some browsers strip cross-site
-- cookies on the IdP→callback hop.
create table sso_state (
    state text primary key,
    workspace_id uuid not null references workspace (id) on delete cascade,
    code_verifier text not null,
    redirect_uri text not null,
    -- Where to send the user after we mint the session.
    return_to text,
    created_at timestamptz not null default now(),
    expires_at timestamptz not null
);

create index sso_state_expires_at_idx on sso_state (expires_at);

insert into schema_migrations (version) values ('0019_sso_oidc')
on conflict (version) do nothing;

commit;
