-- 0017_saved_view_surface.sql
-- Add a `surface` discriminator to saved_view so the same shape can
-- back saved filters on /runs and /monitoring without colliding.
--
-- Schema choice rationale: a discriminator column beats a second table
-- because the lifecycle (RBAC, sharing, pinning, audit) is identical
-- between surfaces — only the filter-bag schema differs, and that's
-- already free-form jsonb. A second table would mean duplicating
-- those concerns + their migrations.
--
-- The `runs` surface uses {status, kind, search, window_seconds}.
-- The `monitoring` surface uses {window_seconds, model, kind}.
-- Unknown surfaces are accepted but the UI will only render the
-- ones it knows about — keeps forward-compat clean.

begin;

alter table saved_view
    add column if not exists surface text not null default 'runs'
        check (surface in ('runs', 'monitoring'));

create index if not exists saved_view_surface_idx on saved_view (surface);

-- Drop the existing partial uniques (they didn't include surface, so
-- a `runs` view named 'p95 last 24h' would have collided with a
-- `monitoring` view of the same name in the same project).
drop index if exists saved_view_shared_name_uniq;
drop index if exists saved_view_personal_name_uniq;

create unique index saved_view_shared_name_uniq
    on saved_view (project_id, surface, name)
    where is_shared = true;

create unique index saved_view_personal_name_uniq
    on saved_view (project_id, surface, created_by, name)
    where is_shared = false;

insert into schema_migrations (version) values ('0017_saved_view_surface')
on conflict (version) do nothing;

commit;
