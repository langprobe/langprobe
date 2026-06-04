"""tracebility LangSmith-compat shim.

Drop-in adapter for codebases that already call into the LangSmith
``Client`` surface. Point the shim at a tracebility ingest host and the
same code keeps working — runs land in tracebility's ClickHouse without
SDK rewrites.

Nominative fair use only: the package name is ``tracebility-langsmith-shim``
because the legal constraint says we must not ship a package named
``langsmith``. The import shape is intentionally close to the real
LangSmith client so the migration is::

    # before
    from langsmith import Client, traceable

    # after
    from tracebility_langsmith_shim import Client, traceable

This shim is small on purpose — it talks to ingest-api's LangSmith
parity endpoints (``POST /runs``, ``POST /runs/batch``, ``PATCH /runs/{id}``).
The ingest-api side does the translation into the native ``IngestBatch``.
We do not implement the read-side (``read_run``, ``list_runs``) because
the read API surface on tracebility is intentionally different — use
the tracebility-native Python SDK for queries.
"""

from .client import Client
from .traceable import traceable
from .wrappers import wrap_anthropic, wrap_openai

__all__ = ["Client", "traceable", "wrap_anthropic", "wrap_openai"]
__version__ = "0.0.2"
