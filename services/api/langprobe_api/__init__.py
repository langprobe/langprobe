"""langprobe control-plane API.

Auth (sessions + API keys for users), RBAC, project/workspace/org CRUD,
prompts, datasets, eval configs, audit log read API. Talks Postgres only;
the data plane (ClickHouse) is read by a separate read-API in a later phase.
"""

__version__ = "0.0.0"
