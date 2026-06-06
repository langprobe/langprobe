-- 0023_litellm_provider_matrix.sql
-- Widen the provider check from {anthropic, openai} to the six-provider
-- matrix LiteLLM dispatches against. Add a default-enabled flag so a
-- workspace admin can mark which credentials should auto-link to new
-- projects. Add the project ↔ credential link table that every
-- LLM-dispatching surface joins through to find a key.

begin;

alter table workspace_llm_credential
    drop constraint workspace_llm_credential_provider_check;
alter table workspace_llm_credential
    add constraint workspace_llm_credential_provider_check
    check (provider in (
        'anthropic', 'openai', 'gemini', 'mistral', 'deepseek', 'groq'
    ));

alter table workspace_llm_credential
    add column default_enabled boolean not null default false;

create table project_llm_credential (
    project_id    uuid not null references project (id)               on delete cascade,
    credential_id uuid not null references workspace_llm_credential (id) on delete cascade,
    enabled_at    timestamptz not null default now(),
    enabled_by    uuid references app_user (id) on delete set null,
    primary key (project_id, credential_id)
);

insert into schema_migrations (version) values ('0023_litellm_provider_matrix')
on conflict (version) do nothing;

commit;
