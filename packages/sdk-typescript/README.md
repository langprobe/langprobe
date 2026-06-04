# tracebility-langsmith-shim (TypeScript)

Drop-in TypeScript adapter that lets LangSmith-style code post to a
self-hosted **tracebility** ingest host. Same `Client`, `traceable`,
and `wrapOpenAI` / `wrapAnthropic` surface; different backend.

> Nominative fair use only. This package is not affiliated with or
> endorsed by LangChain Inc. The name "LangSmith" is referenced solely
> to describe the API shape this shim implements.

## Install

```bash
npm install tracebility-langsmith-shim
```

## Migrate

```diff
- import { Client, traceable } from "langsmith";
+ import { Client, traceable } from "tracebility-langsmith-shim";
```

That is the whole change.

## Configure

The shim honors the same env vars as the real LangSmith client:

| Env var | Purpose |
|---|---|
| `LANGSMITH_ENDPOINT` (or `LANGCHAIN_ENDPOINT`) | tracebility ingest host |
| `LANGSMITH_API_KEY`  (or `LANGCHAIN_API_KEY`)  | bearer token (tracebility ingest key) |
| `LANGSMITH_PROJECT`  (or `LANGCHAIN_PROJECT`)  | default project |

Constructor options override env.

## Use

```ts
import { Client, traceable } from "tracebility-langsmith-shim";

const client = new Client();

const generate = traceable(
  async (prompt: string): Promise<string> => {
    // your LLM call here
    return "...";
  },
  { runType: "llm", name: "generate", tags: ["prod"] },
);

await generate("hello");
// entry: POST /runs   inputs={"args":["hello"]}
// exit:  PATCH /runs/{id}  outputs={"output":"..."}
```

Nested `traceable` calls form a tree via `AsyncLocalStorage`
(Node 18+) — matching LangSmith's semantics.

## Auto-tracing vendor SDKs

```ts
import OpenAI from "openai";
import { wrapOpenAI } from "tracebility-langsmith-shim";

const openai = wrapOpenAI(new OpenAI());
await openai.chat.completions.create({
  model: "gpt-4o-mini",
  messages: [{ role: "user", content: "hi" }],
});
// → one tracebility run per call
```

```ts
import Anthropic from "@anthropic-ai/sdk";
import { wrapAnthropic } from "tracebility-langsmith-shim";

const anthropic = wrapAnthropic(new Anthropic());
await anthropic.messages.create({
  model: "claude-sonnet-4-6",
  max_tokens: 512,
  messages: [{ role: "user", content: "hi" }],
});
```

The wrappers are duck-typed `Proxy`-based — anything we don't
intercept is delegated transparently. We don't import `openai` /
`@anthropic-ai/sdk` at module load, so the shim stays installable
without those vendor SDKs as transitive deps.

## Scope

The shim covers the **write path** LangSmith users actually call from
application code:

- `Client.createRun(...)` → `POST /runs`
- `Client.updateRun(...)` → `PATCH /runs/{id}`
- `Client.batchIngestRuns(...)` → `POST /runs/batch`
- `traceable(fn, opts)` — decorator-style wrapper (sync + async)
- `wrapOpenAI(client)` / `wrapAnthropic(client)` — auto-trace every
  vendor SDK call with one run per invocation

The read-side (`readRun`, `listRuns`, `readProject`) is intentionally
**not** implemented. tracebility's read API has a different shape;
use the native tracebility JS SDK for queries.
