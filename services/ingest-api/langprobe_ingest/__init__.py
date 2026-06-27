"""langprobe ingest API.

Accepts trace/span ingest from SDKs and the LangSmith-shim, enqueues batches
to Redis for the ingest-worker to drain into ClickHouse.
"""

__version__ = "0.0.0"
