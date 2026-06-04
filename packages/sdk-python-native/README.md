# tracebility — native Python SDK

Tracebility-shaped Python client for the self-hosted tracebility
platform. Two surfaces:

- **Ingest** (write): post traces to ingest-api.
- **Control** (read + write): query the control-plane API for runs,
  threads, datasets, prompts, eval-runs, comparisons, poll panels,
  and playground sessions.

For LangSmith-compatible callers, use the sibling package
[`tracebility-langsmith-shim`](../sdk-python). This package is the
tracebility-native surface — different naming, different ergonomics,
no LangSmith concepts leak into the API.

## Install

```bash
pip install tracebility
```

## Configure

| Env var | Purpose |
|---|---|
| `TRACEBILITY_INGEST_URL` | ingest-api host |
| `TRACEBILITY_INGEST_KEY` | bearer token for ingest |
| `TRACEBILITY_API_URL`    | control-plane API host |
| `TRACEBILITY_API_KEY`    | bearer token for control |

Constructor args override env.

## Trace your code

```python
from tracebility import trace, span

@trace(kind="agent", name="customer.support")
def handle(query: str) -> str:
    with span("retrieve", kind="retriever") as s:
        docs = retrieve(query)
        s.set_output(docs)

    with span("generate", kind="llm", model="claude-sonnet-4-6") as s:
        s.set_input({"query": query, "docs": docs})
        answer = call_model(query, docs)
        s.set_output(answer)

    return answer

handle("how do I reset my password?")
# → one tracebility run with two spans, posted to ingest-api
```

`trace` and `span` thread `run_id` / `parent_span_id` through a
ContextVar so nested calls form a tree.

## Read from the control plane

```python
from tracebility import TracebilityClient

client = TracebilityClient(project_id="prj_...")

# Recent runs (with the same filter knobs as /runs)
runs = client.runs.list(status="error", window_seconds=3600, limit=20)
for r in runs:
    print(r["run_id"], r["name"], r["status"])

# Datasets, prompts, evals
ds = client.datasets.list()
prompts = client.prompts.list()
evals = client.evals.list()

# Run a panel-of-LLM-judges eval
poll = client.poll.create(
    dataset_id="...",
    judges=["contains", "exact"],
    aggregation="majority",
)

# Playground
session = client.playground.run(
    model="gpt-4o-mini",
    raw_template="Summarize: {{ text }}",
    variables={"text": "..."},
)
```

## Boundary

- Methods return raw dicts (the server's pydantic JSON shape). We
  intentionally don't impose a parallel typed model — the wire shape
  evolves and a generated client would slow that down.
- HTTP errors raise `tracebility.TracebilityHTTPError` with
  `.status_code` / `.body` / `.url`.
- `TracebilityClient`, `IngestClient`, and `ControlClient` are all
  context managers; `.close()` releases the underlying httpx pool.
