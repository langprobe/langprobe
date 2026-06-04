"""LangSmith-compat ``@traceable`` decorator.

The real LangSmith ``traceable`` wraps a function so each invocation
becomes a run. We mirror that behavior using our own ``Client``:

  - generate a run_id (UUID4)
  - POST /runs at entry with inputs (kwargs + positional args)
  - PATCH /runs/{id} at exit with outputs OR error
  - thread a parent_run_id through a contextvar so nested @traceable
    calls form the run tree LangSmith users expect

The decorator is sync-only in v1 — most LangSmith calls in application
code are sync. We'll add an async variant when an async caller hits
the path and asks for it.

This is intentionally lightweight: 90 lines of shim, no buffering, no
batching, one HTTP call at entry, one at exit. The ingest-api side is
where the heavy lifting (queueing, redaction, batching to ClickHouse)
happens.
"""

from __future__ import annotations

import contextvars
import functools
import inspect
import uuid
from datetime import datetime, timezone
from typing import Any, Callable, TypeVar

from .client import Client

F = TypeVar("F", bound=Callable[..., Any])

_PARENT_RUN_ID: contextvars.ContextVar[str | None] = contextvars.ContextVar(
    "tracebility_parent_run_id", default=None
)


def _build_inputs(func: Callable[..., Any], args: tuple, kwargs: dict) -> dict[str, Any]:
    """Build the inputs dict from the call site.

    Matches LangSmith's convention: positional args are keyed by
    their parameter names (using ``inspect.signature``); ``self``/``cls``
    are dropped to avoid serialization explosions.
    """
    try:
        sig = inspect.signature(func)
        bound = sig.bind_partial(*args, **kwargs)
    except (TypeError, ValueError):
        return {"args": list(args), "kwargs": dict(kwargs)}
    out: dict[str, Any] = {}
    for name, value in bound.arguments.items():
        if name in ("self", "cls"):
            continue
        out[name] = value
    return out


def _safe_outputs(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return value
    return {"output": value}


_DEFAULT_CLIENT: Client | None = None


def _get_client() -> Client:
    global _DEFAULT_CLIENT
    if _DEFAULT_CLIENT is None:
        _DEFAULT_CLIENT = Client()
    return _DEFAULT_CLIENT


def traceable(
    *args: Any,
    name: str | None = None,
    run_type: str = "chain",
    client: Client | None = None,
    project_name: str | None = None,
    tags: list[str] | None = None,
    metadata: dict[str, Any] | None = None,
) -> Any:
    """Decorator that turns a function call into a tracebility run.

    Use either::

        @traceable
        def step(x): ...

    or with keyword args::

        @traceable(run_type="llm", name="generate", tags=["prod"])
        def step(x): ...

    The decorator preserves async-ness: wrapping a coroutine function
    yields a coroutine function. Inputs/outputs are best-effort
    JSON-able; the ingest-api side accepts arbitrary nested data and
    stringifies on the way to ClickHouse.
    """

    def _decorate(func: F) -> F:
        is_coro = inspect.iscoroutinefunction(func)
        run_name = name or func.__name__

        if is_coro:

            @functools.wraps(func)
            async def async_wrapper(*call_args: Any, **call_kwargs: Any) -> Any:
                run_id = str(uuid.uuid4())
                token = _PARENT_RUN_ID.set(run_id)
                parent = _PARENT_RUN_ID.get()
                inputs = _build_inputs(func, call_args, call_kwargs)
                local_client = client or _get_client()
                start = datetime.now(timezone.utc)
                local_client.create_run(
                    name=run_name,
                    inputs=inputs,
                    run_type=run_type,
                    id=run_id,
                    parent_run_id=parent if parent != run_id else None,
                    start_time=start,
                    project_name=project_name,
                    tags=tags,
                    extra={"metadata": metadata or {}},
                )
                try:
                    result = await func(*call_args, **call_kwargs)
                except Exception as exc:
                    local_client.update_run(
                        run_id=run_id,
                        end_time=datetime.now(timezone.utc),
                        error=f"{type(exc).__name__}: {exc}",
                    )
                    _PARENT_RUN_ID.reset(token)
                    raise
                else:
                    local_client.update_run(
                        run_id=run_id,
                        end_time=datetime.now(timezone.utc),
                        outputs=_safe_outputs(result),
                    )
                    return result
                finally:
                    _PARENT_RUN_ID.reset(token)

            return async_wrapper  # type: ignore[return-value]

        @functools.wraps(func)
        def sync_wrapper(*call_args: Any, **call_kwargs: Any) -> Any:
            run_id = str(uuid.uuid4())
            token = _PARENT_RUN_ID.set(run_id)
            parent = _PARENT_RUN_ID.get()
            inputs = _build_inputs(func, call_args, call_kwargs)
            local_client = client or _get_client()
            start = datetime.now(timezone.utc)
            local_client.create_run(
                name=run_name,
                inputs=inputs,
                run_type=run_type,
                id=run_id,
                parent_run_id=parent if parent != run_id else None,
                start_time=start,
                project_name=project_name,
                tags=tags,
                extra={"metadata": metadata or {}},
            )
            try:
                result = func(*call_args, **call_kwargs)
            except Exception as exc:
                local_client.update_run(
                    run_id=run_id,
                    end_time=datetime.now(timezone.utc),
                    error=f"{type(exc).__name__}: {exc}",
                )
                _PARENT_RUN_ID.reset(token)
                raise
            else:
                local_client.update_run(
                    run_id=run_id,
                    end_time=datetime.now(timezone.utc),
                    outputs=_safe_outputs(result),
                )
                return result
            finally:
                _PARENT_RUN_ID.reset(token)

        return sync_wrapper  # type: ignore[return-value]

    # Handle bare @traceable usage (no parens).
    if len(args) == 1 and callable(args[0]) and not kwargs_supplied(
        name=name,
        run_type=run_type,
        client=client,
        project_name=project_name,
        tags=tags,
        metadata=metadata,
    ):
        return _decorate(args[0])
    return _decorate


def kwargs_supplied(**kwargs: Any) -> bool:
    return any(
        v is not None and not (k == "run_type" and v == "chain")
        for k, v in kwargs.items()
    )
