-- 0013_studio_branches.sql
-- Studio canvas: branches of captured runs.
--
-- A `studio_branch` is a derivative of a real captured run -- pick a
-- source run, pick the span where you want to edit (the "branch point"),
-- record an ordered list of edits (prompt/model/tool args/etc.), and
-- replay from that span. The branch links back to the replay's
-- resulting run_id once it has been executed.
--
-- Storage shape rationale:
-- - `edits` is jsonb (not a separate table) because edits are an
--   ordered list authored as one transaction by the canvas; they're
--   not independently queryable. Querying "find me branches that
--   edited the prompt of an llm_router span" can still be done with
--   jsonb path operators when that becomes useful.
-- - `replay_run_id` is text (mirrors `dataset_item.source_run_id`
--   which also stores ClickHouse run ids as text) and nullable: a
--   branch can be drafted before it's replayed.
-- - `status` lifecycle: draft -> replayed -> promoted. "promoted"
--   means the branch has been saved as a candidate prompt revision
--   (Prompts + Studio round-trip — wired in a later iteration).
-- - We don't FK to the source run because runs live in ClickHouse,
--   not postgres. ER-23: never silent-drop. If the source run is
--   garbage-collected later, the branch row stays with the run_id
--   string and the UI surfaces "source run missing" rather than
--   cascading the delete.

begin;

create table studio_branch (
    id uuid primary key default gen_random_uuid(),
    project_id uuid not null references project (id) on delete restrict,
    name text not null,
    description text,
    -- ClickHouse run id we're branching from. Text because the
    -- ingest worker writes them as UUIDv7-ish strings and we don't
    -- want a hard FK across data planes.
    source_run_id text not null,
    -- The span inside that run where the edits start. Same string
    -- shape (UUID text). Null is allowed for "branch the whole run"
    -- (replay from the top with global edits applied).
    source_span_id text,
    -- Ordered list of edits. Schema:
    --   [{"target_span_id": "...",
    --     "field": "prompt" | "model" | "temperature" | "tool_args",
    --     "value": <any>}]
    -- Authored as one transaction by the canvas; no per-edit row.
    edits jsonb not null default '[]'::jsonb,
    -- ClickHouse run id produced when the branch was replayed. Null
    -- until the user clicks "replay" on the canvas. Text for the same
    -- reason as source_run_id.
    replay_run_id text,
    status text not null default 'draft' check (
        status in ('draft', 'replayed', 'promoted')
    ),
    -- One-line summary of how the branch diverged from source -- the
    -- replay step writes this so the list view is scannable without
    -- re-querying ClickHouse on every render.
    diff_summary text,
    author_id uuid references app_user (id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    replayed_at timestamptz
);

create trigger studio_branch_updated_at
    before update on studio_branch
    for each row execute function set_updated_at();

create index studio_branch_project_id_idx on studio_branch (project_id);
create index studio_branch_source_run_id_idx on studio_branch (source_run_id);
create index studio_branch_status_idx on studio_branch (status);

insert into schema_migrations (version) values ('0013_studio_branches')
on conflict (version) do nothing;

commit;
