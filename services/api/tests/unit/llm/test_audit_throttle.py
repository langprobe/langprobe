"""Audit throttle: 1 event per (project, provider, code) per hour."""

from __future__ import annotations

import uuid
from unittest.mock import AsyncMock

import pytest
from langprobe_api.llm.audit_throttle import should_emit_audit

pytestmark = pytest.mark.asyncio


async def test_first_event_emits(fake_pool) -> None:
    fake_pool.fetchval = AsyncMock(return_value=None)
    emit = await should_emit_audit(
        fake_pool,
        project_id=uuid.uuid4(),
        provider="openai",
        action="dispatch.no_credential",
    )
    assert emit is True


async def test_within_window_suppresses(fake_pool, mocker) -> None:
    fake_pool.fetchval = AsyncMock(return_value=1)
    emit = await should_emit_audit(
        fake_pool,
        project_id=uuid.uuid4(),
        provider="openai",
        action="dispatch.no_credential",
    )
    assert emit is False


async def test_query_uses_one_hour_window(fake_pool) -> None:
    fake_pool.fetchval = AsyncMock(return_value=None)
    project_id = uuid.uuid4()
    await should_emit_audit(
        fake_pool,
        project_id=project_id,
        provider="anthropic",
        action="dispatch.ceiling_exceeded",
    )
    fake_pool.fetchval.assert_awaited_once()
    call_args = fake_pool.fetchval.await_args
    sql = call_args.args[0]
    assert "interval '1 hour'" in sql
    assert call_args.args[1] == project_id
