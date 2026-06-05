-- 0022_oauth_signup.sql
-- Public OAuth signup/login (Google + GitHub).
--
-- This is the personal-account onboarding path: a user clicks
-- "Continue with Google" / "Continue with GitHub" on /login or
-- /signup, the api round-trips the IdP, and on first sign-in we
-- auto-provision an app_user + a personal org/workspace so they
-- land somewhere usable instead of staring at "no project resolved".
--
-- This is INTENTIONALLY separate from `workspace_sso_config` (the
-- per-workspace OIDC SSO that corporate admins configure for their
-- IdP). Public OAuth signup is operator-controlled at the env-var
-- level (you set OAUTH_GOOGLE_CLIENT_ID / OAUTH_GITHUB_CLIENT_ID
-- once at deploy time); per-workspace SSO is workspace-admin
-- controlled and lives at /workspace/sso. They share the
-- `app_user.external_idp / external_subject` columns (added in
-- 0003) but do not share state tables.
--
-- `oauth_state` mirrors `sso_state`'s shape: a short-lived random
-- nonce that survives the IdP redirect round-trip. Stored
-- server-side (not packed into a cookie) because some browsers
-- strip cross-site cookies on the IdP→callback hop.

begin;

create table oauth_state (
    state text primary key,
    -- 'google' | 'github'
    provider text not null check (provider in ('google', 'github')),
    -- PKCE: stored when we issue the state, verified on callback.
    -- Github does not require PKCE today but we generate it anyway
    -- so the storage shape is uniform; a future provider that
    -- mandates PKCE slots in without a migration.
    code_verifier text not null,
    redirect_uri text not null,
    -- intent: 'signup' or 'login' — drives whether we 401 a
    -- not-yet-provisioned user (login) or auto-create one (signup).
    intent text not null default 'login'
        check (intent in ('signup', 'login')),
    -- Where to send the user after we mint the session.
    return_to text,
    created_at timestamptz not null default now(),
    expires_at timestamptz not null
);

create index oauth_state_expires_at_idx on oauth_state (expires_at);

insert into schema_migrations (version) values ('0022_oauth_signup')
on conflict (version) do nothing;

commit;
