"""QuotaMeter — exercises Redis counter logic with real Redis."""

from __future__ import annotations

from uuid import uuid4

import pytest
from langprobe_tenant.quota import QuotaMeter, current_period

pytestmark = pytest.mark.asyncio


async def test_record_increments_and_reports_state(redis_client) -> None:
    qm = QuotaMeter(redis_client)
    org_id = uuid4()

    r1 = await qm.record(org_id=org_id, meter="span_ingested", amount=10, limit=100)
    assert r1.used == 10
    assert not r1.over and not r1.warn

    r2 = await qm.record(org_id=org_id, meter="span_ingested", amount=70, limit=100)
    assert r2.used == 80
    assert r2.warn and not r2.over  # 80% threshold

    r3 = await qm.record(org_id=org_id, meter="span_ingested", amount=25, limit=100)
    assert r3.used == 105
    assert r3.over and r3.warn


async def test_unlimited_sentinel(redis_client) -> None:
    """limit = -1 means unlimited; over/warn always False."""
    qm = QuotaMeter(redis_client)
    org_id = uuid4()
    r = await qm.record(org_id=org_id, meter="span_ingested", amount=10**12, limit=-1)
    assert r.used == 10**12
    assert not r.over
    assert not r.warn


async def test_per_org_isolation(redis_client) -> None:
    qm = QuotaMeter(redis_client)
    a, b = uuid4(), uuid4()
    await qm.record(org_id=a, meter="span_ingested", amount=50, limit=100)
    rb = await qm.peek(org_id=b, meter="span_ingested", limit=100)
    assert rb.used == 0


async def test_reset_to_authoritative(redis_client) -> None:
    """Reconciler hook: replace the live counter with the post-SUM value."""
    qm = QuotaMeter(redis_client)
    org_id = uuid4()
    await qm.record(org_id=org_id, meter="span_ingested", amount=37, limit=100)
    await qm.reset(org_id=org_id, meter="span_ingested", authoritative=10)
    r = await qm.peek(org_id=org_id, meter="span_ingested", limit=100)
    assert r.used == 10


async def test_period_format() -> None:
    p = current_period()
    assert len(p) == 6 and p.isdigit()
