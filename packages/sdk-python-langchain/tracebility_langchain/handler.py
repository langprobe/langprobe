"""TracebilityCallbackHandler — LangChain → tracebility bridge.

LangChain emits callback events with stable shapes:

  - on_chain_start  / on_chain_end   / on_chain_error
  - on_llm_start    / on_llm_end     / on_llm_error
  - on_tool_start   / on_tool_end    / on_tool_error
  - on_retriever_start / on_retriever_end / on_retriever_error

Each event carries a ``run_id`` and (sometimes) a ``parent_run_id``;
LangChain owns the tree topology. We translate those into tracebility
ingest envelopes:

  - The first node we see in a tree (parent_run_id is None) becomes
    a `run` in tracebility's sense.
  - All nested events become `spans` under that run.

Because LangChain's `run_id` is a UUID we can use it as both
`run_id` and `span_id` directly — no remapping needed.

Concurrency: the handler holds a `_trees` dict keyed by the
top-level run UUID. Each tree carries the run_id, accumulated
spans, and start/end bracketing. When a top-level chain ends we
flush one ingest batch and drop the tree from the dict.

Failure modes (ER-23, never silent-drop):
  - If the underlying ingest POST fails we log + carry on; user
    code shouldn't crash because telemetry is down.
  - If a callback fires for a run we never saw start, we synthesize
    one — better to over-report than to drop.

We don't subclass LangChain's `BaseCallbackHandler` at the type
level — that would force a hard dependency. Duck-typing the method
shape is enough; LangChain uses `getattr(handler, "on_*")` to
dispatch.
"""

from __future__ import annotations

import json as _json
import logging
import threading
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from tracebility import IngestClient, IngestRun, IngestSpan

log = logging.getLogger("tracebility.langchain")


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _serialize(value: Any) -> str:
    try:
        return _json.dumps(value, default=str)
    except (TypeError, ValueError):
        return str(value)


def _coerce_uuid(value: Any) -> str:
    """LangChain hands us UUIDs; coerce to canonical str."""
    if isinstance(value, UUID):
        return str(value)
    return str(value)


@dataclass
class _NodeRecord:
    node_id: str
    parent_id: str | None
    name: str
    kind: str
    start_time: datetime
    end_time: datetime | None = None
    inputs: Any = None
    outputs: Any = None
    error: BaseException | None = None
    model: str | None = None
    temperature: float | None = None
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass
class _Tree:
    root_id: str
    nodes: dict[str, _NodeRecord] = field(default_factory=dict)


class TracebilityCallbackHandler:
    """Drop-in callback handler for LangChain / LangGraph.

    Args:
        project_id: tracebility project the runs belong to. The
            ingest-api uses the API key for tenancy; the project_id
            is recorded as metadata so the read-side filtering works.
            Optional if your ingest key is already project-scoped.
        ingest_client: pre-built `IngestClient` (test injection).
            If omitted, one is constructed from env.
        sdk: the SDK label that lands on every emitted run. Defaults
            to "langchain"; override to "langgraph" if you want the
            two streams to be distinguishable in /runs.
    """

    def __init__(
        self,
        *,
        project_id: str | None = None,
        ingest_client: IngestClient | None = None,
        sdk: str = "langchain",
    ) -> None:
        self._project_id = project_id
        self._ingest = ingest_client or IngestClient()
        self._sdk = sdk
        self._lock = threading.Lock()
        self._trees: dict[str, _Tree] = {}

    # ------------------------------------------------------------------
    # LangChain dispatch surface
    # ------------------------------------------------------------------

    def on_chain_start(self, serialized: dict[str, Any], inputs: Any, *, run_id: Any, parent_run_id: Any | None = None, **kwargs: Any) -> None:
        self._start("chain", run_id, parent_run_id, _name(serialized, "chain"), inputs, kwargs)

    def on_chain_end(self, outputs: Any, *, run_id: Any, **kwargs: Any) -> None:
        self._end(run_id, outputs)

    def on_chain_error(self, error: BaseException, *, run_id: Any, **kwargs: Any) -> None:
        self._error(run_id, error)

    def on_llm_start(self, serialized: dict[str, Any], prompts: list[str], *, run_id: Any, parent_run_id: Any | None = None, **kwargs: Any) -> None:
        node = self._start(
            "llm",
            run_id,
            parent_run_id,
            _name(serialized, "llm"),
            {"prompts": prompts},
            kwargs,
        )
        if node is not None:
            params = (kwargs.get("invocation_params") or kwargs.get("metadata") or {})
            if isinstance(params, dict):
                model = params.get("model") or params.get("model_name")
                if isinstance(model, str):
                    node.model = model
                temp = params.get("temperature")
                if isinstance(temp, (int, float)):
                    node.temperature = float(temp)

    def on_chat_model_start(self, serialized: dict[str, Any], messages: list[Any], *, run_id: Any, parent_run_id: Any | None = None, **kwargs: Any) -> None:
        # LangChain has a separate path for chat models; treat it as an LLM.
        node = self._start(
            "llm",
            run_id,
            parent_run_id,
            _name(serialized, "chat"),
            {"messages": messages},
            kwargs,
        )
        if node is not None:
            params = (kwargs.get("invocation_params") or kwargs.get("metadata") or {})
            if isinstance(params, dict):
                model = params.get("model") or params.get("model_name")
                if isinstance(model, str):
                    node.model = model
                temp = params.get("temperature")
                if isinstance(temp, (int, float)):
                    node.temperature = float(temp)

    def on_llm_end(self, response: Any, *, run_id: Any, **kwargs: Any) -> None:
        self._end(run_id, response)

    def on_llm_error(self, error: BaseException, *, run_id: Any, **kwargs: Any) -> None:
        self._error(run_id, error)

    def on_tool_start(self, serialized: dict[str, Any], input_str: str, *, run_id: Any, parent_run_id: Any | None = None, **kwargs: Any) -> None:
        self._start(
            "tool",
            run_id,
            parent_run_id,
            _name(serialized, "tool"),
            {"input": input_str},
            kwargs,
        )

    def on_tool_end(self, output: Any, *, run_id: Any, **kwargs: Any) -> None:
        self._end(run_id, output)

    def on_tool_error(self, error: BaseException, *, run_id: Any, **kwargs: Any) -> None:
        self._error(run_id, error)

    def on_retriever_start(self, serialized: dict[str, Any], query: str, *, run_id: Any, parent_run_id: Any | None = None, **kwargs: Any) -> None:
        self._start(
            "retriever",
            run_id,
            parent_run_id,
            _name(serialized, "retriever"),
            {"query": query},
            kwargs,
        )

    def on_retriever_end(self, documents: Any, *, run_id: Any, **kwargs: Any) -> None:
        self._end(run_id, documents)

    def on_retriever_error(self, error: BaseException, *, run_id: Any, **kwargs: Any) -> None:
        self._error(run_id, error)

    def on_agent_action(self, action: Any, *, run_id: Any, **kwargs: Any) -> None:
        # LangChain emits this between tool calls; we record it as an
        # event-style span but most callers just use on_tool_*.
        rid = _coerce_uuid(run_id)
        with self._lock:
            tree = self._tree_for(rid)
            if tree is None:
                return
            node = tree.nodes.get(rid)
            if node is None:
                return
            existing = node.metadata.setdefault("agent_actions", [])
            existing.append({"tool": getattr(action, "tool", None), "input": getattr(action, "tool_input", None)})

    def on_agent_finish(self, finish: Any, *, run_id: Any, **kwargs: Any) -> None:
        # End-of-agent signal arrives separately from the chain end;
        # we capture the return so the run_outputs aren't empty.
        self._end(run_id, getattr(finish, "return_values", finish))

    # ------------------------------------------------------------------
    # Internals
    # ------------------------------------------------------------------

    def _start(
        self,
        kind: str,
        run_id: Any,
        parent_run_id: Any | None,
        name: str,
        inputs: Any,
        kwargs: dict[str, Any],
    ) -> _NodeRecord | None:
        rid = _coerce_uuid(run_id)
        pid = _coerce_uuid(parent_run_id) if parent_run_id is not None else None
        node = _NodeRecord(
            node_id=rid,
            parent_id=pid,
            name=name,
            kind=kind,
            start_time=_now(),
            inputs=inputs,
            metadata=dict(kwargs.get("metadata") or {}),
        )
        with self._lock:
            # Resolve the owning tree.
            #   - rid already in a tree (re-entry): use that tree
            #   - parent in a tree: attach there (don't clobber the
            #     existing tree by overwriting `_trees[pid]`)
            #   - parent unknown but provided: synthesize a tree at
            #     pid so the eventual root matches
            #   - no parent: brand-new top-level tree at rid
            tree = self._tree_for(rid)
            if tree is None and pid is not None:
                tree = self._trees.get(pid) or self._tree_for(pid)
            if tree is None:
                root_id = pid or rid
                tree = self._trees.get(root_id)
                if tree is None:
                    tree = _Tree(root_id=root_id)
                    self._trees[root_id] = tree
            tree.nodes[rid] = node
            return node

    def _tree_for(self, rid: str) -> _Tree | None:
        # If the rid IS a root we know about, return that; otherwise
        # walk up via the registered nodes' parent pointers. We
        # accept O(depth) here because trees are bounded.
        tree = self._trees.get(rid)
        if tree is not None:
            return tree
        for tree in self._trees.values():
            node = tree.nodes.get(rid)
            if node is None:
                continue
            cur = node
            while cur.parent_id is not None:
                parent = tree.nodes.get(cur.parent_id)
                if parent is None:
                    break
                cur = parent
            return tree
        return None

    def _end(self, run_id: Any, outputs: Any) -> None:
        rid = _coerce_uuid(run_id)
        flushable: _Tree | None = None
        with self._lock:
            tree = self._tree_for(rid)
            if tree is None:
                return
            node = tree.nodes.get(rid)
            if node is None:
                return
            node.end_time = _now()
            node.outputs = _coerce_outputs(outputs)
            if rid == tree.root_id:
                flushable = tree
                self._trees.pop(rid, None)
        if flushable is not None:
            self._flush(flushable)

    def _error(self, run_id: Any, error: BaseException) -> None:
        rid = _coerce_uuid(run_id)
        flushable: _Tree | None = None
        with self._lock:
            tree = self._tree_for(rid)
            if tree is None:
                return
            node = tree.nodes.get(rid)
            if node is None:
                return
            node.end_time = _now()
            node.error = error
            if rid == tree.root_id:
                flushable = tree
                self._trees.pop(rid, None)
        if flushable is not None:
            self._flush(flushable)

    def _flush(self, tree: _Tree) -> None:
        root = tree.nodes.get(tree.root_id)
        if root is None:
            log.warning("flush called with missing root", extra={"root_id": tree.root_id})
            return
        spans: list[IngestSpan] = []
        for node in tree.nodes.values():
            if node.node_id == tree.root_id:
                continue
            spans.append(self._to_span(tree.root_id, node))
        run = self._to_run(root, spans)
        try:
            self._ingest.submit_run(run)
        except Exception as exc:  # noqa: BLE001 — telemetry must never crash callers
            log.warning(
                "tracebility ingest failed",
                extra={"run_id": tree.root_id, "error": str(exc)},
            )

    def _to_run(self, node: _NodeRecord, spans: list[IngestSpan]) -> IngestRun:
        meta: dict[str, Any] = dict(node.metadata)
        meta.setdefault("source", self._sdk)
        if self._project_id is not None:
            meta.setdefault("project_id", self._project_id)
        return IngestRun(
            run_id=node.node_id,
            name=node.name or "chain",
            kind=node.kind,
            status="error" if node.error is not None else "ok",
            sdk=self._sdk,
            start_time=node.start_time,
            end_time=node.end_time,
            inputs=_serialize(node.inputs) if node.inputs is not None else None,
            outputs=_serialize(node.outputs) if node.outputs is not None else None,
            metadata=meta,
            error_kind=type(node.error).__name__ if node.error else None,
            error_message=str(node.error) if node.error else None,
            spans=spans,
        )

    def _to_span(self, run_id: str, node: _NodeRecord) -> IngestSpan:
        return IngestSpan(
            span_id=node.node_id,
            run_id=run_id,
            parent_span_id=node.parent_id,
            name=node.name or node.kind,
            kind=node.kind,
            status="error" if node.error is not None else "ok",
            start_time=node.start_time,
            end_time=node.end_time,
            model=node.model,
            temperature=node.temperature,
            inputs=_serialize(node.inputs) if node.inputs is not None else None,
            outputs=_serialize(node.outputs) if node.outputs is not None else None,
            attributes=node.metadata,
            error_kind=type(node.error).__name__ if node.error else None,
            error_message=str(node.error) if node.error else None,
        )


def _name(serialized: dict[str, Any] | None, fallback: str) -> str:
    if not isinstance(serialized, dict):
        return fallback
    name = serialized.get("name")
    if isinstance(name, str) and name:
        return name
    ids = serialized.get("id")
    if isinstance(ids, list) and ids:
        return str(ids[-1])
    return fallback


def _coerce_outputs(value: Any) -> Any:
    """LangChain hands us pydantic objects; coerce to dict where possible."""
    dump = getattr(value, "model_dump", None)
    if callable(dump):
        try:
            return dump()
        except Exception:  # noqa: BLE001
            pass
    dump = getattr(value, "dict", None)
    if callable(dump):
        try:
            return dump()
        except Exception:  # noqa: BLE001
            pass
    return value
