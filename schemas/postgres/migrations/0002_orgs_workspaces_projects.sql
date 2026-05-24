-- 0002_orgs_workspaces_projects.sql
-- Tenancy hierarchy: org -> workspace -> project.

begin;

create table org (
    id uuid primary key default gen_random_uuid(),
    slug text not null unique,
    name text not null,
    plan text not null default 'self_hosted',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    deleted_at timestamptz
);

create trigger org_updated_at
    before update on org
    for each row execute function set_updated_at();

create table workspace (
    id uuid primary key default gen_random_uuid(),
    org_id uuid not null references org (id) on delete restrict,
    slug text not null,
    name text not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    deleted_at timestamptz,
    unique (org_id, slug)
);

create trigger workspace_updated_at
    before update on workspace
    for each row execute function set_updated_at();

create index workspace_org_id_idx on workspace (org_id);

create table project (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null references workspace (id) on delete restrict,
    slug text not null,
    name text not null,
    -- ingest knobs
    sample_rate real not null default 1.0 check (sample_rate >= 0 and sample_rate <= 1),
    pii_redaction boolean not null default true,
    -- eval knobs (defaults; per-call override allowed)
    eval_default_judge text,
    eval_cost_ceiling_usd_per_day numeric(12, 4),
    rca_mode text not null default 'errors_only'
        check (rca_mode in ('off', 'errors_only', 'errors_and_poor', 'all')),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    deleted_at timestamptz,
    unique (workspace_id, slug)
);

create trigger project_updated_at
    before update on project
    for each row execute function set_updated_at();

create index project_workspace_id_idx on project (workspace_id);

insert into schema_migrations (version) values ('0002_orgs_workspaces_projects')
on conflict (version) do nothing;

commit;
