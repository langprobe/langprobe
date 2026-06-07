"""ScopedClickHouse — pure SQL-injection-of-the-org-filter logic.

The point of this file is to pin the predicate-injection contract: every
caller-supplied SQL ends up with ``and org_id = {org_id:UUID}`` in the WHERE
chain, regardless of GROUP BY / ORDER BY / LIMIT shape."""

from __future__ import annotations

from uuid import UUID

import pytest
from tracebility_api.auth import Principal
from tracebility_api.tenant_scope import (
    ScopedClickHouse,
    TenantScope,
    _append_predicate,
)

_ORG = UUID("11111111-1111-1111-1111-111111111111")
_WS = UUID("22222222-2222-2222-2222-222222222222")
_PROJ = UUID("33333333-3333-3333-3333-333333333333")


def _scope() -> TenantScope:
    return TenantScope(
        org_id=_ORG,
        workspace_id=_WS,
        project_id=_PROJ,
        principal=Principal(
            user_id=UUID("44444444-4444-4444-4444-444444444444"),
            email="x@y.z",
            is_root=False,
        ),
    )


class _FakeCH:
    def __init__(self) -> None:
        self.last_sql: str | None = None
        self.last_params: dict | None = None

    async def query(self, sql, parameters=None):
        self.last_sql = sql
        self.last_params = parameters
        return []

    async def command(self, sql, parameters=None):
        self.last_sql = sql
        self.last_params = parameters


pytestmark = pytest.mark.asyncio


async def test_inject_appends_org_filter_when_missing() -> None:
    ch = _FakeCH()
    scope = ScopedClickHouse(ch, _scope())  # type: ignore[arg-type]
    await scope.query("select * from run where project_id = {project_id:UUID}")
    assert "org_id = {org_id:UUID}" in ch.last_sql
    assert ch.last_params["org_id"] == str(_ORG)
    assert ch.last_params["workspace_id"] == str(_WS)
    assert ch.last_params["project_id"] == str(_PROJ)


async def test_inject_respects_explicit_org_filter() -> None:
    """If the caller already filters on org_id we don't double-inject."""
    ch = _FakeCH()
    scope = ScopedClickHouse(ch, _scope())  # type: ignore[arg-type]
    sql = "select * from run where org_id = {org_id:UUID} and project_id = {project_id:UUID}"
    await scope.query(sql)
    # Exactly one occurrence
    assert ch.last_sql.lower().count("org_id =") == 1


async def test_inject_places_predicate_before_group_by() -> None:
    ch = _FakeCH()
    scope = ScopedClickHouse(ch, _scope())  # type: ignore[arg-type]
    await scope.query(
        "select kind, count(*) from span where project_id = {project_id:UUID} "
        "group by kind order by kind",
    )
    sql = ch.last_sql.lower()
    assert sql.index("org_id =") < sql.index("group by")


async def test_inject_places_predicate_before_order_by_and_limit() -> None:
    ch = _FakeCH()
    scope = ScopedClickHouse(ch, _scope())  # type: ignore[arg-type]
    await scope.query(
        "select * from run where project_id = {project_id:UUID} order by start_time desc limit 50",
    )
    sql = ch.last_sql.lower()
    assert sql.index("org_id =") < sql.index("order by")
    assert sql.index("org_id =") < sql.index("limit")


async def test_query_without_where_raises() -> None:
    """A SQL string with no WHERE is a programming error — fail loud."""
    ch = _FakeCH()
    scope = ScopedClickHouse(ch, _scope())  # type: ignore[arg-type]
    with pytest.raises(ValueError):
        await scope.query("select count(*) from run")


def test_append_predicate_no_trailing_clause() -> None:
    out = _append_predicate(
        "select * from run where project_id = {p:UUID}", "and org_id = {o:UUID}"
    )
    assert out.endswith("and org_id = {o:UUID}")


def test_append_predicate_with_having() -> None:
    out = _append_predicate(
        "select model, sum(total_tokens) from span where project_id = {p:UUID} "
        "group by model having sum(total_tokens) > 100",
        "and org_id = {o:UUID}",
    )
    assert "and org_id = {o:UUID} group by model" in out
