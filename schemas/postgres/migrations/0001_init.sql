-- 0001_init.sql
-- Bootstrap: extensions and shared functions.

begin;

create extension if not exists pgcrypto;
create extension if not exists citext;

-- updated_at trigger helper
create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

-- record schema version
create table if not exists schema_migrations (
    version text primary key,
    applied_at timestamptz not null default now()
);

insert into schema_migrations (version) values ('0001_init')
on conflict (version) do nothing;

commit;
