-- 0026_prompt_template_messages.sql
-- Replace the single-string `prompt_version.template` with a structured
-- list of typed messages (system / human, with the door open for ai/tool
-- later). The legacy `template` column is kept for one release as a
-- deploy/rollback safety net; a follow-up migration drops it.
--
-- Backfill: every existing row becomes
--     [{"role": "human", "content": <old template>}]
-- which preserves single-message prompt behavior verbatim. Variable
-- syntax stays Jinja {{ var }} — same renderer, same wire format on
-- the LiteLLM dispatch side.

begin;

alter table prompt_version
    add column template_messages jsonb;

update prompt_version
   set template_messages = jsonb_build_array(
           jsonb_build_object('role', 'human', 'content', template)
       )
 where template_messages is null;

alter table prompt_version
    alter column template_messages set not null;

-- The legacy column is now redundant. Keep it for one release window
-- so a rollback can read the old shape; a follow-up migration drops it.
comment on column prompt_version.template is
    'DEPRECATED: replaced by template_messages. Drop after one release.';

-- Cheap structural guard: every row's template_messages must be a
-- non-empty jsonb array. The check is structural-only; role-value
-- validation lives at the application layer (matches how we validate
-- other jsonb columns like quota_period.attributes).
alter table prompt_version
    add constraint prompt_version_template_messages_nonempty
    check (jsonb_typeof(template_messages) = 'array'
           and jsonb_array_length(template_messages) > 0);

insert into schema_migrations (version) values ('0026_prompt_template_messages')
on conflict (version) do nothing;

commit;
