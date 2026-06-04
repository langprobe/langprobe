"""Native Python SDK for tracebility.

Tracebility-shaped client (not LangSmith-mimicking). Two surfaces:

  - **Ingest** (write path): post traces to ingest-api's
    ``POST /v1/runs`` native envelope.
  - **Control** (read path): query the control-plane API for runs,
    traces, threads, datasets, prompts, eval-runs, comparisons,
    poll-runs, playground sessions.

For LangSmith-compat callers, use ``tracebility-langsmith-shim`` —
that package matches the LangSmith ``Client`` / ``traceable`` shape
verbatim. This package is the tracebility-native surface.
"""

from .client import TracebilityClient
from .errors import TracebilityError, TracebilityHTTPError
from .ingest import IngestClient
from .models import IngestSpan, IngestRun, IngestBatch
from .trace import trace, span

__all__ = [
    "TracebilityClient",
    "TracebilityError",
    "TracebilityHTTPError",
    "IngestClient",
    "IngestRun",
    "IngestSpan",
    "IngestBatch",
    "trace",
    "span",
]
__version__ = "0.0.1"
