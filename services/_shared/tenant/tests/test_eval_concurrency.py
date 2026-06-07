"""EvalConcurrency — per-org Redis semaphore."""

from __future__ import annotations

from uuid import uuid4

import pytest

from tracebility_tenant import EvalConcurrency, EvalConcurrencyExhausted

pytestmark = pytest.mark.asyncio


async def test_acquire_up_to_cap_then_blocks(redis_client) -> None:
    sem = EvalConcurrency(redis_client)
    org = uuid4()
    for _ in range(3):
        assert await sem.acquire(org_id=org, cap=3) is True
    assert await sem.acquire(org_id=org, cap=3) is False
    assert await sem.in_flight(org) == 3


async def test_release_frees_slot(redis_client) -> None:
    sem = EvalConcurrency(redis_client)
    org = uuid4()
    await sem.acquire(org_id=org, cap=2)
    await sem.acquire(org_id=org, cap=2)
    assert await sem.acquire(org_id=org, cap=2) is False
    await sem.release(org_id=org)
    assert await sem.acquire(org_id=org, cap=2) is True


async def test_per_org_isolation(redis_client) -> None:
    sem = EvalConcurrency(redis_client)
    a, b = uuid4(), uuid4()
    await sem.acquire(org_id=a, cap=1)
    assert await sem.acquire(org_id=a, cap=1) is False
    assert await sem.acquire(org_id=b, cap=1) is True


async def test_zero_cap_never_acquires(redis_client) -> None:
    sem = EvalConcurrency(redis_client)
    org = uuid4()
    assert await sem.acquire(org_id=org, cap=0) is False


async def test_slot_context_manager_releases_on_exit(redis_client) -> None:
    sem = EvalConcurrency(redis_client)
    org = uuid4()
    async with sem.slot(org_id=org, cap=1):
        assert await sem.in_flight(org) == 1
    assert await sem.in_flight(org) == 0


async def test_slot_raises_when_exhausted(redis_client) -> None:
    sem = EvalConcurrency(redis_client)
    org = uuid4()
    await sem.acquire(org_id=org, cap=1)
    with pytest.raises(EvalConcurrencyExhausted):
        async with sem.slot(org_id=org, cap=1):
            pass


async def test_release_clamps_at_zero(redis_client) -> None:
    """Defensive: a buggy caller releasing more than they acquired must
    not produce negative counts."""
    sem = EvalConcurrency(redis_client)
    org = uuid4()
    await sem.release(org_id=org)
    assert await sem.in_flight(org) == 0
