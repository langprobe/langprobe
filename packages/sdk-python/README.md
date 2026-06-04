# tracebility-langsmith-shim

Drop-in Python adapter that lets LangSmith-style code post to a
self-hosted **tracebility** ingest host. Same `Client` and `traceable`
surface; different backend.

> Nominative fair use only. This package is not affiliated with or
> endorsed by LangChain Inc. The name "LangSmith" is referenced solely
> to describe the API shape this shim implements.

## Install

```bash
pip install tracebility-langsmith-shim
```

## Migrate

```diff
- from langsmith import Client, traceable
+ from tracebility_langsmith_shim import Client, traceable
```

That is the whole change.

## Configure

The shim honors the same environment variables as the real LangSmith
client, so existing deployments migrate without code changes:

| Env var | Purpose |
|---|---|
| `LANGSMITH_ENDPOINT` (or `LANGCHAIN_ENDPOINT`) | tracebility ingest host, e.g. `https://traces.your-host` |
| `LANGSMITH_API_KEY` (or `LANGCHAIN_API_KEY`)  | bearer token (tracebility ingest key) |
| `LANGSMITH_PROJECT` (or `LANGCHAIN_PROJECT`)  | default project name |

Constructor arguments override env.

## Use

```python
from tracebility_langsmith_shim import Client, traceable

client = Client()  # picks up env, or pass args explicitly

@traceable(run_type="llm", name="generate", tags=["prod"])
def generate(prompt: str) -> str:
    # your call to anthropic / openai / etc.
    return "..."

generate("hello")
# entry: POST /runs with inputs={"prompt": "hello"}
# exit:  PATCH /runs/{id} with outputs={"output": "..."}
```

Nested `@traceable` calls form a tree via a `ContextVar` that threads
`parent_run_id` through the call stack — matching LangSmith's semantics.

## Auto-tracing vendor SDKs

Hand the wrapper your existing OpenAI / Anthropic client and every
call emits one tracebility run with prompt + completion + token
usage:

```python
from openai import OpenAI
from tracebility_langsmith_shim import wrap_openai

client = wrap_openai(OpenAI())
client.chat.completions.create(
    model="gpt-4o-mini",
    messages=[{"role": "user", "content": "hi"}],
)
# → one tracebility run per call (model, messages, tokens, output)
```

```python
from anthropic import Anthropic
from tracebility_langsmith_shim import wrap_anthropic

client = wrap_anthropic(Anthropic())
client.messages.create(
    model="claude-sonnet-4-6",
    max_tokens=512,
    messages=[{"role": "user", "content": "hi"}],
)
```

The wrappers are duck-typed proxies — anything you don't trace is
delegated transparently. We don't import `openai` / `anthropic` at
module load, so the shim stays installable without those vendor
SDKs as transitive deps.

## Scope

The shim covers the **write path** LangSmith users actually call from
application code:

- `Client.create_run(...)` → `POST /runs`
- `Client.update_run(...)` → `PATCH /runs/{id}`
- `Client.batch_ingest_runs(create=..., update=...)` → `POST /runs/batch`
- `@traceable` decorator (sync + async)
- `wrap_openai(client)` / `wrap_anthropic(client)` — auto-trace every
  vendor SDK call with one run per invocation

The read-side (`read_run`, `list_runs`, `read_project`) is intentionally
**not** implemented. tracebility's read API has a different shape; use
the native tracebility Python SDK for queries.

## Why "shim", not "drop-in replacement"

Two reasons:

1. **Legal.** We can describe our shape as *compatible with* LangSmith;
   we cannot ship a package named `langsmith` on PyPI. The package
   name is `tracebility-langsmith-shim`. Imports use
   `tracebility_langsmith_shim`. One import line changes.
2. **Honest surface.** We implement the write API faithfully. The read
   API is left to tracebility's native SDK because the surfaces
   meaningfully differ — pretending otherwise would mask bugs.
