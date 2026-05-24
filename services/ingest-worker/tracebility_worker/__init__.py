"""tracebility ingest worker.

Drains the Redis Stream ``tracebility:ingest:v1`` (consumer group: ``ingest``)
and writes batches to ClickHouse ``run``/``span`` tables. Failed batches land
in a dead-letter stream rather than being silently dropped (ER-23).
"""

__version__ = "0.0.0"
