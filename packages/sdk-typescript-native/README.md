# tracebility — native TypeScript SDK

Tracebility-shaped TS client for the self-hosted tracebility platform.
Two surfaces: **Ingest** (write traces) and **Control** (read +
mutate runs/datasets/prompts/evals/etc).

For LangSmith-compat callers, use the sibling package
[`tracebility-langsmith-shim`](../sdk-typescript). This package is
the tracebility-native surface.

## Install

```bash
npm install tracebility
```

## Configure

| Env var | Purpose |
|---|---|
| `TRACEBILITY_INGEST_URL` | ingest-api host |
| `TRACEBILITY_INGEST_KEY` | bearer token for ingest |
| `TRACEBILITY_API_URL`    | control-plane API host |
| `TRACEBILITY_API_KEY`    | bearer token for control |

## Trace your code

```ts
import { trace, span } from "tracebility";

const handle = trace(
  async (query: string): Promise<string> => {
    const docs = await span.around("retrieve", { kind: "retriever" }, async (s) => {
      const result = await retrieve(query);
      s.setOutput(result);
      return result;
    });

    return span.around("generate", { kind: "llm", model: "claude-sonnet-4-6" }, async (s) => {
      s.setInput({ query, docs });
      const answer = await callModel(query, docs);
      s.setOutput(answer);
      return answer;
    });
  },
  { kind: "agent", name: "customer.support" },
);

await handle("how do I reset my password?");
// → one tracebility run with two spans, posted to ingest-api
```

`trace` and `span` thread `run_id` / `parent_span_id` via
`AsyncLocalStorage` (Node 18+) with a fallback stack for browsers.

## Read from the control plane

```ts
import { TracebilityClient } from "tracebility";

const client = new TracebilityClient({ projectId: "prj_..." });

const runs = await client.runs.list({
  status: "error",
  window_seconds: 3600,
  limit: 20,
});

const ds = await client.datasets.list();
const polls = await client.poll.list();

const session = await client.playground.run({
  model: "gpt-4o-mini",
  raw_template: "Summarize: {{ text }}",
  variables: { text: "..." },
});
```

## Boundary

- Methods return raw response objects (the server's pydantic JSON
  shape). We don't impose a parallel typed model — the wire shape
  evolves.
- HTTP errors throw `TracebilityHTTPError` with `.statusCode`,
  `.body`, `.url`.
- No third-party runtime deps; uses global `fetch` (Node 18+,
  browsers).
