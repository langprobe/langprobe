-- 0027_playground_session_rendered_messages.sql
-- Add a structured form of the rendered prompt to playground_session.
-- The existing rendered_prompt text stays as a human-readable
-- newline-joined view (used by the trace UI today); the new
-- rendered_messages jsonb is what replay / re-dispatch will read so
-- the message structure round-trips exactly.

begin;

alter table playground_session
    add column rendered_messages jsonb;

-- Backfill: existing sessions wrapped as a single human message so the
-- column is never null going forward. This preserves the meaning of
-- old sessions whose rendered_prompt was a single concatenated string.
update playground_session
   set rendered_messages = jsonb_build_array(
           jsonb_build_object('role', 'human', 'content', rendered_prompt)
       )
 where rendered_messages is null;

alter table playground_session
    alter column rendered_messages set not null;

alter table playground_session
    add constraint playground_session_rendered_messages_nonempty
    check (jsonb_typeof(rendered_messages) = 'array'
           and jsonb_array_length(rendered_messages) > 0);

insert into schema_migrations (version) values ('0027_playground_session_rendered_messages')
on conflict (version) do nothing;

commit;
