"""``wrap_openai`` / ``wrap_anthropic`` — auto-tracing client wrappers.

The pattern is: hand us a vendor SDK client, get back a proxy that
intercepts the call methods we care about and emits one tracebility
run per invocation. Everything else passes through unchanged so the
caller's existing code keeps working.

We deliberately don't subclass the vendor client (their classes have
private internals that change between minor versions). Instead we
wrap with a lightweight proxy that:
  - delegates attribute access to the underlying client
  - replaces specific call paths (chat.completions.create,
    messages.create) with traced versions
  - returns a wrapped object that still resembles the SDK's response

What we record per call:
  - run_type='llm'
  - inputs = {model, temperature, max_tokens, messages, …}
  - outputs = {output, prompt_tokens, completion_tokens, total_tokens}
  - error if the SDK raised

We do NOT record streaming chunks individually — the call is one run
regardless of streaming, and we tag streaming=true in extra. Per-chunk
spans would explode the trace tree without helping anyone debug
agents.

Both wrappers are no-op-safe if the underlying SDK isn't installed.
We never import the vendor library at module load; the wrap function
just inspects the object passed in. That keeps the shim importable
without anthropic / openai as transitive deps.
"""

from __future__ import annotations

import inspect
import uuid
from datetime import datetime, timezone
from typing import Any, Callable, TypeVar

from .client import Client

T = TypeVar("T")


_DEFAULT_CLIENT: Client | None = None


def _get_client() -> Client:
    global _DEFAULT_CLIENT
    if _DEFAULT_CLIENT is None:
        _DEFAULT_CLIENT = Client()
    return _DEFAULT_CLIENT


def _safe_attr(obj: Any, *path: str) -> Any | None:
    """Walk obj.path[0].path[1]…; return None if any hop missing."""
    cur = obj
    for name in path:
        cur = getattr(cur, name, None)
        if cur is None:
            return None
    return cur


# ---------------------------------------------------------------------------
# Generic proxy
# ---------------------------------------------------------------------------


class _Proxy:
    """Attribute-forwarding proxy with hooks for traced call paths.

    Subclasses set ``_traced_paths`` to a dict of dotted-path → wrap
    callable. On attribute access we walk the path; if it matches a
    traced path, we return a callable that emits a run + delegates;
    otherwise we delegate transparently.

    Sync only in v1 — the shim covers the call shapes the LangSmith
    Python SDK supports. Async wrappers slot in next iteration.
    """

    _traced_paths: dict[tuple[str, ...], Callable[[Any, Any, dict], Any]] = {}

    def __init__(self, target: Any, client: Client | None) -> None:
        self.__dict__["_target"] = target
        self.__dict__["_client"] = client or _get_client()

    def __getattr__(self, name: str) -> Any:
        target = self.__dict__["_target"]
        # Walk the registered traced paths to see if any starts with `name`.
        # Because traced paths are short ("chat.completions.create" etc.)
        # we materialize a sub-proxy so the dotted access works naturally.
        prefix_paths = [p for p in self._traced_paths if p[0] == name]
        if prefix_paths:
            child_target = getattr(target, name)
            # Build a SubPath proxy keyed by the partial path so far.
            return _SubPath(
                child_target, self.__dict__["_client"], (name,), self
            )
        return getattr(target, name)


class _SubPath:
    """Internal: walks a traced path one segment at a time."""

    def __init__(
        self,
        target: Any,
        client: Client,
        path: tuple[str, ...],
        root: _Proxy,
    ) -> None:
        self._target = target
        self._client = client
        self._path = path
        self._root = root

    def __getattr__(self, name: str) -> Any:
        new_path = self._path + (name,)
        attr = getattr(self._target, name)
        traced = self._root._traced_paths.get(new_path)
        if traced is not None:
            # Return the wrapped callable bound to the traced fn.
            def call(*args: Any, **kwargs: Any) -> Any:
                return traced(self._client, attr, kwargs, args=args)

            return call
        # Otherwise return another sub-proxy so nested .a.b chains keep working.
        return _SubPath(attr, self._client, new_path, self._root)


# ---------------------------------------------------------------------------
# OpenAI
# ---------------------------------------------------------------------------


def _trace_openai_chat_completion(
    client: Client,
    fn: Callable[..., Any],
    kwargs: dict[str, Any],
    *,
    args: tuple = (),
) -> Any:
    """Wrap one ``client.chat.completions.create`` call.

    We extract model + messages + temperature/max_tokens at entry,
    record completion + token usage at exit, and surface errors
    verbatim.
    """
    run_id = str(uuid.uuid4())
    model = kwargs.get("model")
    messages = kwargs.get("messages")
    inputs: dict[str, Any] = {
        "model": model,
        "messages": messages,
    }
    for opt in ("temperature", "max_tokens", "top_p", "stream"):
        if opt in kwargs:
            inputs[opt] = kwargs[opt]

    start = datetime.now(timezone.utc)
    client.create_run(
        name=f"openai.chat.completions.create:{model or 'unknown'}",
        inputs=inputs,
        run_type="llm",
        id=run_id,
        start_time=start,
        extra={"metadata": {"vendor": "openai", "wrap": True}},
    )
    try:
        result = fn(*args, **kwargs)
    except Exception as exc:
        client.update_run(
            run_id=run_id,
            end_time=datetime.now(timezone.utc),
            error=f"{type(exc).__name__}: {exc}",
        )
        raise

    outputs = _summarize_openai_response(result)
    client.update_run(
        run_id=run_id,
        end_time=datetime.now(timezone.utc),
        outputs=outputs,
    )
    return result


def _summarize_openai_response(result: Any) -> dict[str, Any]:
    """Extract the bits we trace from the OpenAI client's response.

    Works against both the modern SDK (pydantic-ish objects with
    ``model_dump``) and dict responses. Streaming responses don't
    surface the final text here; we just record the metadata we have.
    """
    if hasattr(result, "model_dump"):
        try:
            data = result.model_dump()
        except Exception:  # noqa: BLE001
            data = {}
    elif isinstance(result, dict):
        data = result
    else:
        data = {}

    text = ""
    choices = data.get("choices") or []
    if choices:
        first = choices[0] or {}
        msg = first.get("message") or {}
        text = msg.get("content") or first.get("text") or ""
    usage = data.get("usage") or {}
    return {
        "output": text,
        "prompt_tokens": usage.get("prompt_tokens"),
        "completion_tokens": usage.get("completion_tokens"),
        "total_tokens": usage.get("total_tokens"),
        "finish_reason": (
            (choices[0] or {}).get("finish_reason") if choices else None
        ),
    }


class _OpenAIProxy(_Proxy):
    _traced_paths = {
        ("chat", "completions", "create"): _trace_openai_chat_completion,
    }


def wrap_openai(client: Any, *, tracebility_client: Client | None = None) -> Any:
    """Wrap an OpenAI client so chat-completion calls auto-trace.

    Usage::

        from openai import OpenAI
        from tracebility_langsmith_shim import wrap_openai

        client = wrap_openai(OpenAI())
        client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "user", "content": "hi"}],
        )
        # → one tracebility run per invocation

    Anything we don't intercept is delegated transparently. The proxy
    is duck-typed; you can pass an AsyncOpenAI in v1, but only sync
    methods on the chat.completions path are traced (async coverage
    arrives in the next iteration).
    """
    return _OpenAIProxy(client, tracebility_client)


# ---------------------------------------------------------------------------
# Anthropic
# ---------------------------------------------------------------------------


def _trace_anthropic_messages_create(
    client: Client,
    fn: Callable[..., Any],
    kwargs: dict[str, Any],
    *,
    args: tuple = (),
) -> Any:
    run_id = str(uuid.uuid4())
    model = kwargs.get("model")
    inputs: dict[str, Any] = {
        "model": model,
        "messages": kwargs.get("messages"),
    }
    for opt in ("temperature", "max_tokens", "top_p", "system", "stream"):
        if opt in kwargs:
            inputs[opt] = kwargs[opt]

    start = datetime.now(timezone.utc)
    client.create_run(
        name=f"anthropic.messages.create:{model or 'unknown'}",
        inputs=inputs,
        run_type="llm",
        id=run_id,
        start_time=start,
        extra={"metadata": {"vendor": "anthropic", "wrap": True}},
    )
    try:
        result = fn(*args, **kwargs)
    except Exception as exc:
        client.update_run(
            run_id=run_id,
            end_time=datetime.now(timezone.utc),
            error=f"{type(exc).__name__}: {exc}",
        )
        raise

    outputs = _summarize_anthropic_response(result)
    client.update_run(
        run_id=run_id,
        end_time=datetime.now(timezone.utc),
        outputs=outputs,
    )
    return result


def _summarize_anthropic_response(result: Any) -> dict[str, Any]:
    if hasattr(result, "model_dump"):
        try:
            data = result.model_dump()
        except Exception:  # noqa: BLE001
            data = {}
    elif isinstance(result, dict):
        data = result
    else:
        data = {}

    text = ""
    blocks = data.get("content") or []
    for block in blocks:
        if isinstance(block, dict) and block.get("type") == "text":
            text += block.get("text", "")
    usage = data.get("usage") or {}
    return {
        "output": text,
        "prompt_tokens": usage.get("input_tokens"),
        "completion_tokens": usage.get("output_tokens"),
        "total_tokens": (
            (usage.get("input_tokens") or 0)
            + (usage.get("output_tokens") or 0)
            if usage
            else None
        ),
        "stop_reason": data.get("stop_reason"),
    }


class _AnthropicProxy(_Proxy):
    _traced_paths = {
        ("messages", "create"): _trace_anthropic_messages_create,
    }


def wrap_anthropic(client: Any, *, tracebility_client: Client | None = None) -> Any:
    """Wrap an Anthropic client so messages.create calls auto-trace.

    Usage::

        from anthropic import Anthropic
        from tracebility_langsmith_shim import wrap_anthropic

        client = wrap_anthropic(Anthropic())
        client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=512,
            messages=[{"role": "user", "content": "hi"}],
        )
        # → one tracebility run per invocation

    Same proxy mechanics as ``wrap_openai``; we don't import anthropic
    at module load, so the shim stays installable without the vendor
    SDK as a transitive dep.
    """
    return _AnthropicProxy(client, tracebility_client)
