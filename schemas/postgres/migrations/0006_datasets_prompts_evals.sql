-- 0006_datasets_prompts_evals.sql
-- Dataset, prompt, and eval-config metadata. Heavy data (eval scores per run)
-- lives in ClickHouse; this is the catalog.

begin;

-- Datasets: collections of inputs (and optional reference outputs)
create table dataset (
    id uuid primary key default gen_random_uuid(),
    project_id uuid not null references project (id) on delete restrict,
    slug text not null,
    name text not null,
    description text,
    -- counters maintained by app code; ClickHouse holds the rows
    item_count integer not null default 0,
    created_by uuid references app_user (id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    deleted_at timestamptz,
    unique (project_id, slug)
);

create trigger dataset_updated_at
    before update on dataset
    for each row execute function set_updated_at();

create index dataset_project_id_idx on dataset (project_id);

-- Prompts: versioned templates
create table prompt (
    id uuid primary key default gen_random_uuid(),
    project_id uuid not null references project (id) on delete restrict,
    slug text not null,
    name text not null,
    description text,
    created_by uuid references app_user (id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    deleted_at timestamptz,
    unique (project_id, slug)
);

create trigger prompt_updated_at
    before update on prompt
    for each row execute function set_updated_at();

create table prompt_version (
    id uuid primary key default gen_random_uuid(),
    prompt_id uuid not null references prompt (id) on delete restrict,
    version integer not null,
    template text not null,
    -- jsonschema for inputs
    input_schema jsonb,
    -- {model, temperature, max_tokens, ...}
    model_params jsonb,
    -- '@prod', '@staging' aliases applied here
    aliases text[] not null default array[]::text[],
    commit_message text,
    created_by uuid references app_user (id) on delete set null,
    created_at timestamptz not null default now(),
    unique (prompt_id, version)
);

create index prompt_version_prompt_id_idx on prompt_version (prompt_id);
create index prompt_version_aliases_idx on prompt_version using gin (aliases);

-- Eval configs: judge + sampling settings
create table eval_config (
    id uuid primary key default gen_random_uuid(),
    project_id uuid not null references project (id) on delete restrict,
    slug text not null,
    name text not null,
    -- 'single' | 'poll' (panel-of-LLM-judges)
    mode text not null check (mode in ('single', 'poll')),
    -- judge endpoints + scoring rubric stored here; payload is small jsonb,
    -- not the judge weights
    judges jsonb not null,
    rubric jsonb not null,
    -- sampling
    sample_rate real not null default 1.0 check (sample_rate >= 0 and sample_rate <= 1),
    cost_ceiling_usd_per_day numeric(12, 4),
    enabled boolean not null default true,
    created_by uuid references app_user (id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    deleted_at timestamptz,
    unique (project_id, slug)
);

create trigger eval_config_updated_at
    before update on eval_config
    for each row execute function set_updated_at();

create index eval_config_project_id_idx on eval_config (project_id);

insert into schema_migrations (version) values ('0006_datasets_prompts_evals')
on conflict (version) do nothing;

commit;
