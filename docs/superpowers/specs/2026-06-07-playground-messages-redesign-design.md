# Playground messages redesign

**Status:** Draft
**Owner:** mia
**Date:** 2026-06-07

## Why

The playground today asks the user to compose a single text template and
fill `{{ var }}` placeholders. That doesn't match how modern chat models
are actually called: a typed list of messages where the system prompt and
the user turn are separate things. The reference UX
([LangSmith's playground][langsmith-pg]) shows what we want — typed
messages, an Inputs panel that fills detected variables, save-as-prompt
with versioning. PR #10 made the model picker honor configured
credentials but left the playground's data shape untouched.

[langsmith-pg]: https://docs.langchain.com/langsmith/playground

## Decisions (locked in brainstorm)

| # | Topic | Decision |
|---|---|---|
| 1 | Storage shape | Replace `prompt_version.template text` with `template_messages jsonb`. Backfill rewrites every existing row to `[{role: "human", content: <template>}]`. |
| 2 | Message roles (v1) | `system` and `human` only. AI / tool / output_schema are deferred. |
| 3 | Variable syntax | Jinja `{{ var }}`. No format selector. |
| 4 | Compare mode | Deferred. Single prompt panel only. |
| 5 | Save scope | Messages only. Model + temperature stay as runtime knobs on the playground request. |
| 6 | Layout | Stacked. Prompt → Inputs → Output, full-width. |
| 7 | Save behavior | Always creates a new version. Save on a loaded `v3` produces `v4`. |
| 8 | Save (new prompt) | Prompt picker has a `New prompt…` option that surfaces an inline name+slug field. |
| 9 | Empty variables | Render as empty string. No pre-flight block, no warning banner. |

## Out of scope

- Compare mode (two prompt panels, two outputs). Deferred to its own follow-up.
- AI / tool / output_schema message types.
- Streaming responses. Playground stays sync.
- Editing the loaded prompt in place (always-new-version is the rule).
- Per-prompt "recommended model" persistence (model is runtime-only).

## Goals

1. The playground composer renders System and Human messages as separate, typed editors.
2. Variables in any message body show up in the Inputs panel with one row per `{{var}}`.
3. Save creates a new `prompt_version` whose `template_messages` carries the structured shape; versioning is preserved.
4. Existing prompts in production keep loading with no operator action.

## Non-goals

- We do not maintain wire-compatibility with the old `template text` field on the response. Clients reading prompts will get `template_messages` instead.

## Architecture

### Postgres schema (migration 0026)

```sql
alter table prompt_version
    add column template_messages jsonb;

-- Backfill existing rows.
update prompt_version
   set template_messages = jsonb_build_array(
           jsonb_build_object('role', 'human', 'content', template)
       )
 where template_messages is null;

alter table prompt_version
    alter column template_messages set not null;

-- The legacy column stays for one release as a back-reference.
-- A follow-up migration drops it once we've confirmed the new code path
-- handles every consumer (api router, eval runner, studio playback).
comment on column prompt_version.template is
    'DEPRECATED — see template_messages. Drop after one release.';
```

We keep `template` for one release window so a rollback during the
deploy can read the old data. Drop in a follow-up migration once
production is stable.

### Message structure

```python
class Message(BaseModel):
    role: Literal["system", "human"]
    content: str  # may contain {{ var }} placeholders
```

Stored as a JSON array. The order is significant — it's the order the
messages reach the model. The renderer iterates the array and emits
provider-specific message dicts (Anthropic / OpenAI / Gemini all accept
`{"role": <r>, "content": <s>}` shapes; LiteLLM normalizes for us).

### API contract

**Prompt versions**

`prompt_version.template` becomes optional in the response shape (kept
during the one-release window). The new field is authoritative:

```python
class PromptVersionOut(BaseModel):
    id: UUID
    prompt_id: UUID
    version: int
    template_messages: list[Message]
    template: str | None  # legacy; populated from template_messages[0].content
                          # when there's exactly one human message and no system
    input_schema: dict | None
    model_params: dict | None
    aliases: list[str]
    commit_message: str | None
    created_at: datetime
```

`POST /v1/prompts/{prompt_id}/versions` accepts `template_messages`
(required) and ignores `template` if also sent. The
`commit_message` is optional, populated from the playground's "Save"
flow.

**Playground runs**

The request body shape changes:

```python
class PlaygroundCreate(BaseModel):
    project_id: UUID
    prompt_version_id: UUID | None = None
    raw_messages: list[Message] | None = None  # was: raw_template: str | None
    variables: dict[str, Any]
    model: str
    temperature: float | None
    max_tokens: int | None
```

Exactly one of `prompt_version_id` or `raw_messages` is required (same
xor as today). The renderer:

```python
def render_messages(messages: list[Message], vars: dict) -> list[Message]:
    return [
        Message(role=m.role, content=jinja_render(m.content, vars))
        for m in messages
    ]
```

The dispatcher hands the rendered list to LiteLLM verbatim (no
single-string compaction).

**Old field retained for one release** — the request still accepts
`raw_template` and wraps it as `[{"role": "human", "content": <s>}]`
internally. Old clients keep working until we drop the column.

### Web UI

`web/src/components/PlaygroundClient.tsx` rewires the composer:

- State shape:
  ```ts
  type Message = { role: "system" | "human"; content: string };
  const [messages, setMessages] = useState<Message[]>([
    { role: "system", content: "" },
    { role: "human", content: "" },
  ]);
  ```
- Each message renders in its own card with: a role pill (clickable
  dropdown to switch system↔human), a content `<textarea>` that
  auto-grows, reorder ↑↓ buttons, delete ×, and a tiny variable
  highlight overlay.
- "+ Add message" button at the bottom of the prompt panel inserts a new
  empty human message.
- Variable detection: regex `/\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g`
  over each message content. The Inputs panel shows the deduped union.
  An Input value that no longer matches a detected variable stays in
  state but is hidden from the panel; if the var reappears the value
  re-attaches.
- Save: if `loadedPrompt` is null, "Save" opens an inline `name + slug`
  input pair (slug auto-derived from name on first keystroke); on submit
  posts `POST /v1/prompts` then `POST /v1/prompts/{id}/versions`. If
  `loadedPrompt` is non-null, posts `POST /v1/prompts/{id}/versions`
  directly — that endpoint always creates the next version number,
  EXCEPT when the messages are byte-identical to the most recent version
  (server short-circuits and returns the existing row; UI surfaces "no
  changes since v{n}").
- The role pill is a 2-option dropdown (`system` / `human`) for v1. If
  AI is added later, this widens; nothing else about the composer
  changes.

### Worker / dispatcher

`services/api/tracebility_api/routers/playground.py` swaps:

- `_render_template(template, vars)` → `_render_messages(messages, vars)`
  returning a list of dicts.
- The dispatch call (`gateway.dispatch(...)`) now passes
  `messages=rendered_messages` instead of constructing a single
  `[{"role": "user", "content": rendered}]`. The gateway already
  accepts a list (LiteLLM's `completion(messages=[...])`); we were
  collapsing it for no reason.
- `playground_session.rendered_prompt text` is kept and set to a
  human-readable join of the rendered messages (for the trace view).
  The structured form is in the new column described next.

`alter table playground_session add column rendered_messages jsonb;`
populated alongside `rendered_prompt`. Read paths can prefer the
structured form.

### Trace view (no change required)

The run still writes `inputs` as the rendered system+human concatenation
(the worker's existing path for `playground_session`). The trace at
`/runs/{id}` doesn't need to know about the structured shape; it's a
display-time concern. We can render messages explicitly later as a
follow-up.

## Data flow

```
[ web composer ]                        [ api ]                          [ litellm ]
  messages: list -- POST /playground/runs ----> render Jinja per msg ---> dispatch(messages=[...])
                                              \                                        |
                                               -- write playground_session row         v
                                                  rendered_messages jsonb              llm
                                                  rendered_prompt text                  |
                                                                                       result
                                              <-- worker writes run + span <-----------/
```

## Errors

- **Template render failure** (Jinja syntax error in a saved prompt) →
  `500` with `error.code = "template_render_error"` plus the offending
  Jinja error text. Today's behavior. We surface it on the row.
- **Empty variable** → renders as empty string. No error.
- **Save when prompt is unloaded and no name supplied** → 400 with a
  field-level error from the inline form. The button is disabled until
  the name field has at least 2 chars; that's the primary defense.
- **Save when current messages would produce a no-op version (identical
  to last version)** → server returns the existing version, doesn't
  create a duplicate. UI shows "no changes since v{n}".

## Testing

- **Unit (api):** `_render_messages` over a 2-message prompt with one
  variable — verify variables get substituted in both system and human.
  Round-trip a `Message` through the migration backfill — old `template`
  becomes `[{role: "human", content: <same>}]`.
- **Unit (web):** detect-variables regex over a multi-message array;
  duplicate variables across messages dedupe to one input row; deleting
  the only message containing `{{ tx }}` removes the row.
- **Integration:** a `POST /v1/playground/runs` with
  `raw_messages = [system, human-with-{{x}}]` and `variables = {"x":
  "y"}` produces a session whose `rendered_messages` matches and whose
  output is the model's response. Existing tests around the
  `raw_template` path stay green via the back-compat wrapper.
- **Migration:** smoke against staging — every existing
  `prompt_version` row picks up `template_messages` with the wrap shape.

## Rollout

1. Land the migration first as a separate PR (additive only;
   deployable independently). Backfill in the same migration.
2. Land the api change in a second PR — accepts both `raw_template` and
   `raw_messages`, prefers messages when both are present.
3. Land the web change in a third PR — composer rewrite, save flow.
   Ship behind no flag; the api back-compat covers any race.
4. After one release window: drop the legacy `template` column,
   remove the `raw_template` accept path. Separate cleanup PR.

## Open items

- Whether to render system + human in `playground_session.rendered_prompt`
  with `<system>...</system>\n<human>...</human>` delimiters or a plain
  newline-join. Going with plain join (`\n\n`) for v1; the structured
  form in `rendered_messages` is the source of truth for replay.
