"""ShardRouter — pure-function tests, no fixtures."""

from __future__ import annotations

from collections import Counter
from uuid import UUID, uuid4

import pytest
from langprobe_tenant.shard import DEFAULT_SHARD_COUNT, ShardRouter


def test_shard_for_is_stable() -> None:
    """Same UUID -> same shard, deterministically. The hash MUST survive
    process restarts; Python's built-in hash() doesn't (PYTHONHASHSEED)."""
    org = UUID("11111111-1111-1111-1111-111111111111")
    r = ShardRouter()
    seen = {r.shard_for(org) for _ in range(10)}
    assert len(seen) == 1


def test_shard_for_uses_blake2b_not_python_hash() -> None:
    """Pin the value so a regression in the hash function trips the test.

    Computed by running blake2b(uuid.bytes, digest_size=8) and reading the
    output — the point is to detect drift, not to derive it analytically."""
    org = UUID("11111111-1111-1111-1111-111111111111")
    assert ShardRouter(shard_count=16).shard_for(org) == 11


def test_shard_for_is_uniform_enough() -> None:
    """1k random UUIDs spread across 16 shards: no shard gets <30 or >100.
    Loose bound; if this fires we have a bias bug."""
    r = ShardRouter()
    counts = Counter(r.shard_for(uuid4()) for _ in range(1000))
    assert min(counts.values()) >= 30
    assert max(counts.values()) <= 100


def test_stream_key_for_matches_spec() -> None:
    r = ShardRouter()
    org = UUID("00000000-0000-0000-0000-000000000001")
    key = r.stream_key_for(org)
    assert key.startswith("langprobe:ingest:v1:")
    shard = int(key.rsplit(":", 1)[1])
    assert 0 <= shard < DEFAULT_SHARD_COUNT


def test_all_stream_keys() -> None:
    keys = ShardRouter(shard_count=4).all_stream_keys()
    assert keys == [
        "langprobe:ingest:v1:0",
        "langprobe:ingest:v1:1",
        "langprobe:ingest:v1:2",
        "langprobe:ingest:v1:3",
    ]


def test_legacy_stream_key() -> None:
    assert ShardRouter.legacy_stream_key() == "langprobe:ingest:v1"


def test_shard_count_validation() -> None:
    with pytest.raises(ValueError):
        ShardRouter(shard_count=0)
