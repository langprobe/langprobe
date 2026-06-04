"""High-level ``trace`` decorator and ``span`` context manager.

The common case: capture inputs/outputs of a function as one
tracebility run + spans. The decorator builds a trace tree by
threading ``run_id`` / ``parent_span_id`` through a contextvar.

This is purposely thin — production-grade buffering, batching, and
disk-buffer durability live on the ingest-api server. The SDK
flushes per-call via ``IngestClient.submit_run`` and lets the
ingest-api do the heavy lifting.

If you want LangSmith-shaped semantics (``@traceable``,
``Client.create_run`` / ``update_run``, ``parent_run_id``), use
``tracebility-langsmith-shim``.
"""

from __future__ import annotations

import contextvars
import functools
import inspect
import json as _json
from datetime import datetime, timezone
from typing import Any, Callable, TypeVar
from uuid import uuid4

from .ingest import IngestClient
from .models import IngestRun, IngestSpan

F = TypeVar("F", bound=Callable[..., Any])


_CURRENT_RUN: contextvars.ContextVar["_RunCtx | None"] = contextvars.ContextVar(
    "tracebility_native_run", default=None
)


class _RunCtx:
    __slots__ = ("run_id", "spans", "parent_span_id")

    def __init__(self, run_id: str) -> None:
        self.run_id: str = run_id
        self.spans: list[IngestSpan] = []
        self.parent_span_id: str | None = None


_DEFAULT_INGEST: IngestClient | None = None


def _get_ingest(client: IngestClient | None) -> IngestClient:
    global _DEFAULT_INGEST
    if client is not None:
        return client
    if _DEFAULT_INGEST is None:
        _DEFAULT_INGEST = IngestClient()
    return _DEFAULT_INGEST


def _serialize(value: Any) -> str:
    try:
        return _json.dumps(value, default=str)
    except (TypeError, ValueError):
        return str(value)


def trace(
    *args: Any,
    name: str | None = None,
    kind: str = "chain",
    client: IngestClient | None = None,
    tags: list[str] | None = None,
    metadata: dict[str, Any] | None = None,
) -> Any:
    """Decorate a function so each call emits one run.

    Bare or parameterized usage::

        @trace
        def step(x): ...

        @trace(kind="llm", name="generate", tags=["prod"])
        def step(x): ...
    """

    def _decorate(func: F) -> F:
        is_coro = inspect.iscoroutinefunction(func)
        run_name = name or func.__name__

        @functools.wraps(func)
        def sync_wrapper(*call_args: Any, **call_kwargs: Any) -> Any:
            ingest = _get_ingest(client)
            run_id = str(uuid4())
            ctx = _RunCtx(run_id)
            token = _CURRENT_RUN.set(ctx)
            inputs = _build_inputs(func, call_args, call_kwargs)
            start = datetime.now(timezone.utc)
            try:
                result = func(*call_args, **call_kwargs)
                end = datetime.now(timezone.utc)
                run = IngestRun(
                    run_id=run_id,
                    name=run_name,
                    kind=kind,
                    status="ok",
                    start_time=start,
                    end_time=end,
                    inputs=_serialize(inputs),
                    outputs=_serialize(_outputs(result)),
                    tags=tags or [],
                    metadata=metadata or {},
                    spans=list(ctx.spans),
                )
                ingest.submit_run(run)
                return result
            except Exception as exc:  # noqa: BLE001
                end = datetime.now(timezone.utc)
                run = IngestRun(
                    run_id=run_id,
                    name=run_name,
                    kind=kind,
                    status="error",
                    start_time=start,
                    end_time=end,
                    inputs=_serialize(inputs),
                    outputs=None,
                    tags=tags or [],
                    metadata=metadata or {},
                    error_kind=type(exc).__name__,
                    error_message=str(exc),
                    spans=list(ctx.spans),
                )
                ingest.submit_run(run)
                raise
            finally:
                _CURRENT_RUN.reset(token)

        @functools.wraps(func)
        async def async_wrapper(*call_args: Any, **call_kwargs: Any) -> Any:
            ingest = _get_ingest(client)
            run_id = str(uuid4())
            ctx = _RunCtx(run_id)
            token = _CURRENT_RUN.set(ctx)
            inputs = _build_inputs(func, call_args, call_kwargs)
            start = datetime.now(timezone.utc)
            try:
                result = await func(*call_args, **call_kwargs)
                end = datetime.now(timezone.utc)
                ingest.submit_run(
                    IngestRun(
                        run_id=run_id,
                        name=run_name,
                        kind=kind,
                        status="ok",
                        start_time=start,
                        end_time=end,
                        inputs=_serialize(inputs),
                        outputs=_serialize(_outputs(result)),
                        tags=tags or [],
                        metadata=metadata or {},
                        spans=list(ctx.spans),
                    )
                )
                return result
            except Exception as exc:  # noqa: BLE001
                end = datetime.now(timezone.utc)
                ingest.submit_run(
                    IngestRun(
                        run_id=run_id,
                        name=run_name,
                        kind=kind,
                        status="error",
                        start_time=start,
                        end_time=end,
                        inputs=_serialize(inputs),
                        outputs=None,
                        tags=tags or [],
                        metadata=metadata or {},
                        error_kind=type(exc).__name__,
                        error_message=str(exc),
                        spans=list(ctx.spans),
                    )
                )
                raise
            finally:
                _CURRENT_RUN.reset(token)

        return async_wrapper if is_coro else sync_wrapper  # type: ignore[return-value]

    if len(args) == 1 and callable(args[0]):
        return _decorate(args[0])
    return _decorate


class span:  # noqa: N801 — context manager API style
    """Open a span inside the current ``trace`` run.

    Usage::

        @trace
        def handler(query):
            with span("retrieve", kind="retriever") as s:
                docs = retrieve(query)
                s.set_output(docs)
            return summarize(docs)
    """

    def __init__(
        self,
        name: str,
        *,
        kind: str = "chain",
        model: str | None = None,
        temperature: float | None = None,
    ) -> None:
        self._name = name
        self._kind = kind
        self._model = model
        self._temperature = temperature
        self._span_id = str(uuid4())
        self._inputs: Any = None
        self._outputs: Any = None
        self._start = datetime.now(timezone.utc)
        self._end: datetime | None = None
        self._error: Exception | None = None
        self._parent_token: contextvars.Token[_RunCtx | None] | None = None

    def set_input(self, value: Any) -> None:
        self._inputs = value

    def set_output(self, value: Any) -> None:
        self._outputs = value

    def __enter__(self) -> "span":
        return self

    def __exit__(self, exc_type: type[BaseException] | None, exc: BaseException | None, _tb: Any) -> None:
        self._end = datetime.now(timezone.utc)
        ctx = _CURRENT_RUN.get()
        if ctx is None:
            # span used outside of @trace; silently no-op (don't crash
            # production code just because a context wasn't wired up).
            return
        s = IngestSpan(
            span_id=self._span_id,
            run_id=ctx.run_id,
            parent_span_id=ctx.parent_span_id,
            name=self._name,
            kind=self._kind,
            status="error" if exc is not None else "ok",
            start_time=self._start,
            end_time=self._end,
            model=self._model,
            temperature=self._temperature,
            inputs=_serialize(self._inputs) if self._inputs is not None else None,
            outputs=_serialize(self._outputs) if self._outputs is not None else None,
            error_kind=type(exc).__name__ if exc is not None else None,
            error_message=str(exc) if exc is not None else None,
        )
        ctx.spans.append(s)


def _build_inputs(
    func: Callable[..., Any], args: tuple, kwargs: dict
) -> dict[str, Any]:
    try:
        sig = inspect.signature(func)
        bound = sig.bind_partial(*args, **kwargs)
    except (TypeError, ValueError):
        return {"args": list(args), "kwargs": dict(kwargs)}
    out: dict[str, Any] = {}
    for k, v in bound.arguments.items():
        if k in ("self", "cls"):
            continue
        out[k] = v
    return out


def _outputs(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return value
    return {"output": value}
