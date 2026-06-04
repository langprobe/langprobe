-- 0016_saved_views.sql
-- Saved filters / views over the /runs surface.
--
-- A saved_view is a project-scoped, named bundle of filter knobs the
-- /runs page applies. Schema (jsonb):
--   {
--     "status": "ok" | "error" | "running" | null,
--     "kind":   "agent" | "chain" | "llm" | "tool" | "retriever" | ...,
--     "search": "free-text substring against run.name",
--     "window_seconds": 3600   -- start_time >= now() - window_seconds
--   }
-- Unknown keys are ignored at read time so we can extend the shape
-- without a migration.
--
-- Why a row + jsonb instead of one column per knob?
--   - The set of filter knobs grows with the runs page (sdk version,
--     model, session_id, etc.). Adding a column per knob means a
--     migration every time. jsonb is the right shape here.
--   - Queries that need to filter the catalog by view contents can
--     use jsonb path operators; we don't need that today.
--
-- created_by is nullable: workspace-shared views (no owner) and
-- personal views (owner set) coexist. UI surfaces "Shared" vs
-- "My views" sections by branching on is_shared.
--
-- pinned controls sidebar surfacing; only the row owner can toggle
-- their own pin. Workspace owners/admins can edit shared views;
-- members can edit only their own.

begin;

create table saved_view (
    id uuid primary key default gen_random_uuid(),
    project_id uuid not null references project (id) on delete restrict,
    name text not null,
    -- Free-form filter bag; see header comment for the v1 schema.
    filters jsonb not null default '{}'::jsonb,
    -- Personal vs workspace-shared. NULL created_by = shared.
    is_shared boolean not null default false,
    -- Sort/order in the views list. UI exposes drag-to-reorder later;
    -- for v1 we sort by (pinned desc, sort_index asc, created_at asc).
    pinned boolean not null default false,
    sort_index integer not null default 0,
    created_by uuid references app_user (id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    -- A shared view can't have a creator-bound owner pin: pin is a
    -- per-user notion. We enforce this in the application layer
    -- because postgres can't easily express "if is_shared then pinned
    -- has the same value across users" without a join — and we
    -- don't want a per-user join just to enforce a sanity constraint.
    constraint saved_view_shared_or_owned check (
        (is_shared = true and created_by is null) or
        (is_shared = false and created_by is not null)
    ),
    -- Within a project, names must be unique per scope. We can't enforce
    -- that across personal+shared with a single index without a partial,
    -- so we use two partials.
    constraint saved_view_name_nonempty check (length(name) > 0)
);

-- Unique on (project_id, name) for shared views (one global "Errors").
create unique index saved_view_shared_name_uniq
    on saved_view (project_id, name)
    where is_shared = true;

-- Unique on (project_id, created_by, name) for personal views (one
-- per-user "My errors").
create unique index saved_view_personal_name_uniq
    on saved_view (project_id, created_by, name)
    where is_shared = false;

create index saved_view_project_id_idx on saved_view (project_id);
create index saved_view_created_by_idx on saved_view (created_by);

create trigger saved_view_updated_at
    before update on saved_view
    for each row execute function set_updated_at();

insert into schema_migrations (version) values ('0016_saved_views')
on conflict (version) do nothing;

commit;
