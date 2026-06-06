-- 0024_dispatch_cost.sql
-- Single source of truth for "what a dispatch cost". Every LLM call
-- writes one row here on success or failure; surface tables (playground
-- _session / comparison_run / studio_branch / eval_score / eval_run) do
-- NOT carry cost columns. surface_ref_id joins back to those tables.

begin;

create table dispatch_cost (
    id                  uuid primary key default gen_random_uuid(),
    project_id          uuid not null references project   (id) on delete cascade,
    workspace_id        uuid not null references workspace (id) on delete cascade,
    surface             text not null check (surface in (
        'playground', 'comparisons', 'studio', 'luna', 'eval', 'poll'
    )),
    surface_ref_id      uuid not null,
    provider            text not null,
    model               text not null,
    prompt_tokens       integer,
    completion_tokens   integer,
    cost_usd            numeric(10, 6) not null default 0,
    cost_calculated_via text not null default 'litellm-table',
    dispatched_at       timestamptz not null default now(),
    error_code          text,
    error_detail        text
);

create index dispatch_cost_proj_dispatched_idx
    on dispatch_cost (project_id, dispatched_at desc);
create index dispatch_cost_proj_surface_idx
    on dispatch_cost (project_id, surface, dispatched_at desc);
create index dispatch_cost_surface_ref_idx
    on dispatch_cost (surface, surface_ref_id);

insert into schema_migrations (version) values ('0024_dispatch_cost')
on conflict (version) do nothing;

commit;
