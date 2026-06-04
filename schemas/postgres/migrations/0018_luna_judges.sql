-- 0018_luna_judges.sql
-- Luna prompted-judges: LLM-as-judge with a user-authored rubric.
--
-- An operator writes a rubric prompt that scores any (input, expected,
-- output) tuple on a 0..1 scale plus a short rationale. The runner
-- dispatches the prompt to the configured LLM provider/model, parses
-- the model's response, and writes the result to the same `eval_score`
-- store as built-in judges and human annotations — so the analytic
-- shape stays uniform.
--
-- Naming: "Luna" is the working name for the prompted-judge family,
-- chosen to be unambiguous in /runs filters (judge_name='luna:<slug>')
-- and not collide with vendor names. The slug is the
-- operator-facing handle.
--
-- Why a separate table from prompt_version?
--   - prompt_versions are application prompts (the thing your agent
--     uses); judges are evaluation prompts (the thing that grades the
--     agent). Conflating them would mean every prompt list is twice
--     as long and confusing to filter.
--   - Judge rubrics carry response-format constraints (the parser
--     expects "score: 0.X\nrationale: ...") which prompt_version
--     callers don't have.

begin;

create table luna_judge (
    id uuid primary key default gen_random_uuid(),
    project_id uuid not null references project (id) on delete restrict,
    slug text not null,
    name text not null,
    description text,
    -- The full system+rubric prompt sent to the model. Variables
    -- {{ input }}, {{ expected }}, {{ output }} get substituted by
    -- the runner. Other variables are passed through unchanged.
    rubric_prompt text not null,
    -- Optional output_format hint shown to the model: defaults to
    -- the structured form `score: 0.X\nrationale: <text>` which the
    -- runner parses; can be overridden if the operator wants a JSON
    -- response shape.
    output_format text not null default 'score-rationale'
        check (output_format in ('score-rationale', 'json-object')),
    -- Provider routing — same shape as the playground's resolver.
    provider text not null check (provider in ('anthropic', 'openai', 'stub')),
    model text not null,
    temperature double precision default 0.0,
    max_tokens integer default 512 check (max_tokens >= 1 and max_tokens <= 4096),
    -- soft-delete: dropping a judge keeps historical eval_score rows
    -- pointing at the slug intelligible.
    deleted_at timestamptz,
    created_by uuid references app_user (id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint luna_judge_slug_format check (slug ~ '^[a-z0-9][a-z0-9_-]*$')
);

create unique index luna_judge_slug_uniq on luna_judge (project_id, slug)
    where deleted_at is null;
create index luna_judge_project_id_idx on luna_judge (project_id);

create trigger luna_judge_updated_at
    before update on luna_judge
    for each row execute function set_updated_at();

insert into schema_migrations (version) values ('0018_luna_judges')
on conflict (version) do nothing;

commit;
