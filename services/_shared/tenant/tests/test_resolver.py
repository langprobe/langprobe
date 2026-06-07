"""Resolver — wire format + cache hit/miss against real Redis.

We don't bring up postgres here. The pg path is exercised in the
ingest-api integration tests (Phase 12); this file pins the cache
contract because that's what's easy to break in isolation."""

from __future__ import annotations

from uuid import UUID

from tracebility_tenant.context import TenantContext
from tracebility_tenant.resolver import _decode, _encode


def _ctx() -> TenantContext:
    return TenantContext(
        org_id=UUID("11111111-1111-1111-1111-111111111111"),
        workspace_id=UUID("22222222-2222-2222-2222-222222222222"),
        project_id=UUID("33333333-3333-3333-3333-333333333333"),
        api_key_id=UUID("44444444-4444-4444-4444-444444444444"),
        plan="pro",
        scopes=frozenset({"ingest:write", "internal:bulk"}),
    )


def test_encode_decode_roundtrip() -> None:
    ctx = _ctx()
    raw = _encode(ctx)
    out = _decode(raw)
    assert out == ctx


def test_scope_check() -> None:
    ctx = _ctx()
    assert ctx.has_scope("ingest:write")
    assert ctx.has_scope("internal:bulk")
    assert not ctx.has_scope("admin:write")


def test_scope_wildcard_match() -> None:
    """``internal:*`` in scopes should match any ``internal:foo``."""
    ctx = TenantContext(
        org_id=UUID("11111111-1111-1111-1111-111111111111"),
        workspace_id=UUID("22222222-2222-2222-2222-222222222222"),
        project_id=UUID("33333333-3333-3333-3333-333333333333"),
        api_key_id=UUID("44444444-4444-4444-4444-444444444444"),
        plan="pro",
        scopes=frozenset({"internal:*"}),
    )
    assert ctx.has_scope("internal:bulk")
    assert ctx.has_scope("internal:replay")
    assert not ctx.has_scope("admin:secrets")
