"""Stream shard router. ``hash(org_id) % N`` for v1; weighted-map deferred.

Per spec §5.6: replace single ``tracebility:ingest:v1`` with N shards
``tracebility:ingest:v1:{0..N-1}``. One runaway org fills its shard, not the
whole stream. Workers consume round-robin across shards with per-shard
fairness budget (the worker side lives in ingest-worker).

The hash MUST be stable across processes (so ingest-api and ingest-worker
agree on which shard a row lives in) and stable across deploys (so envelopes
already on the wire route the same way after a restart). UUID bytes hashed
through Python's stdlib ``hashlib.blake2b`` give us both.

# TODO (post-v1, multi-tenancy spec §5.6): when a single tenant saturates
# one shard for sustained periods, replace uniform hash with a weighted shard
# map (postgres ``org.shard_assignment text[]``) so big tenants get
# dedicated shards. Failure mode: persistent backlog skew on shard X with
# worker X CPU pinned.
"""

from __future__ import annotations

import hashlib
from typing import Final
from uuid import UUID

DEFAULT_SHARD_COUNT: Final = 16
STREAM_PREFIX: Final = "tracebility:ingest:v1"


class ShardRouter:
    def __init__(self, shard_count: int = DEFAULT_SHARD_COUNT) -> None:
        if shard_count < 1:
            raise ValueError("shard_count must be >= 1")
        self._n = shard_count

    @property
    def shard_count(self) -> int:
        return self._n

    def shard_for(self, org_id: UUID) -> int:
        # blake2b(16-byte UUID) -> first 8 bytes -> uint -> mod N. Stable
        # across CPython versions (unlike hash() / dict ordering) and
        # uniform enough for our purposes.
        digest = hashlib.blake2b(org_id.bytes, digest_size=8).digest()
        return int.from_bytes(digest, "big") % self._n

    def stream_key_for(self, org_id: UUID) -> str:
        return f"{STREAM_PREFIX}:{self.shard_for(org_id)}"

    def all_stream_keys(self) -> list[str]:
        """Worker-side: every stream key the consumer should read from."""
        return [f"{STREAM_PREFIX}:{i}" for i in range(self._n)]

    @staticmethod
    def legacy_stream_key() -> str:
        """The pre-shard single-stream key, retained for the dual-read window."""
        return STREAM_PREFIX
