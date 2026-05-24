-- 0005_audit_log.sql
-- Append-only audit log. Per CEO plan ER-10: blocking-action if write fails.
-- Updates and deletes are blocked by trigger.

begin;

create table audit_log (
    id uuid primary key default gen_random_uuid(),
    org_id uuid references org (id) on delete restrict,
    workspace_id uuid references workspace (id) on delete restrict,
    project_id uuid references project (id) on delete restrict,
    actor_user_id uuid references app_user (id) on delete restrict,
    actor_api_key_id uuid references api_key (id) on delete restrict,
    -- 'project.create', 'api_key.revoke', 'dataset.update', 'eval.config.update', ...
    action text not null,
    target_kind text not null,
    target_id uuid,
    -- redacted before write; never store secrets
    payload jsonb,
    request_ip inet,
    user_agent text,
    ts timestamptz not null default now()
);

create index audit_log_org_ts_idx on audit_log (org_id, ts desc);
create index audit_log_actor_user_idx on audit_log (actor_user_id, ts desc);
create index audit_log_action_idx on audit_log (action, ts desc);

create or replace function audit_log_block_mutations()
returns trigger
language plpgsql
as $$
begin
    raise exception 'audit_log is append-only; % not permitted', tg_op;
end;
$$;

create trigger audit_log_no_update
    before update on audit_log
    for each row execute function audit_log_block_mutations();

create trigger audit_log_no_delete
    before delete on audit_log
    for each row execute function audit_log_block_mutations();

insert into schema_migrations (version) values ('0005_audit_log')
on conflict (version) do nothing;

commit;
