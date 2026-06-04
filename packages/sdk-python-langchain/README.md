# tracebility-langchain

LangChain / LangGraph callback bridge for tracebility. Drop the
handler into a runnable's config and every callback event becomes a
tracebility trace — no `@traceable` rewrites required.

## Install

```bash
pip install tracebility-langchain
```

## Use

```python
from langchain_openai import ChatOpenAI
from tracebility_langchain import TracebilityCallbackHandler

handler = TracebilityCallbackHandler()  # picks up TRACEBILITY_INGEST_URL/KEY

llm = ChatOpenAI(model="gpt-4o-mini")
result = llm.invoke(
    [{"role": "user", "content": "hi"}],
    config={"callbacks": [handler]},
)
# → one tracebility run with one llm-kind span, posted to ingest-api
```

For LangGraph, pass the same handler in the node's config — LangGraph
emits the same callback shapes and the bridge handles them
identically. Override `sdk="langgraph"` if you want the two streams
to be distinguishable in `/runs`.

## How it works

LangChain owns the tree topology. Each callback event carries a
stable `run_id` and (sometimes) a `parent_run_id`. The handler:

1. Records every `on_*_start` event as a node in an in-memory tree
   keyed by the top-level run id.
2. Updates the matching node on `on_*_end` with outputs / wall time.
3. When the **root** node ends, the entire tree flushes as one
   tracebility ingest envelope: the root becomes a `run`, every
   nested node becomes a `span` under it.

Concurrency is fine — the tree dict is guarded by a lock.

## Boundary

- Telemetry must never crash the caller. Ingest failures are
  logged and swallowed.
- Synthesized trees: if a callback fires for a run we never saw
  start, we synthesize one. Better to over-report than drop.
- We don't import `langchain-core` — the handler is duck-typed.
  Pin LangChain in your own project.
