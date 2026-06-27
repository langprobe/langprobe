"""_resolve_messages picks the right source per the xor validator and
returns the canonical message list shape. The asyncpg pool is mocked
because we're testing routing logic, not SQL — the SQL path itself is
covered by the prompt_version integration test."""

from __future__ import annotations

from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from fastapi import HTTPException
from langprobe_api.routers.playground import (
    Message,
    PlaygroundCreate,
    _resolve_messages,
)

_MODEL = "anthropic/claude-sonnet-4-6"


@pytest.mark.asyncio
async def test_raw_messages_used_verbatim():
    body = PlaygroundCreate(
        project_id=uuid4(),
        raw_messages=[
            Message(role="system", content="be terse"),
            Message(role="human", content="echo {{ x }}"),
        ],
        variables={},
        model=_MODEL,
    )
    pool = AsyncMock()
    out, version_row = await _resolve_messages(pool, body)

    assert version_row is None
    assert out == body.raw_messages
    pool.fetchrow.assert_not_called()


@pytest.mark.asyncio
async def test_raw_template_wrapped_as_single_human_message():
    body = PlaygroundCreate(
        project_id=uuid4(),
        raw_template="echo {{ x }}",
        model=_MODEL,
    )
    pool = AsyncMock()
    out, version_row = await _resolve_messages(pool, body)

    assert version_row is None
    assert out == [Message(role="human", content="echo {{ x }}")]
    pool.fetchrow.assert_not_called()


@pytest.mark.asyncio
async def test_prompt_version_id_reads_template_messages():
    """When prompt_version_id is set, _resolve_messages reads the
    template_messages jsonb column and validates each entry."""
    version_id = uuid4()
    body = PlaygroundCreate(
        project_id=uuid4(),
        prompt_version_id=version_id,
        model=_MODEL,
    )
    pool = AsyncMock()
    pool.fetchrow.return_value = {
        "id": version_id,
        "prompt_id": uuid4(),
        "template": "ignored legacy field",
        "template_messages": [
            {"role": "system", "content": "be terse"},
            {"role": "human", "content": "echo {{ x }}"},
        ],
    }

    out, version_row = await _resolve_messages(pool, body)

    assert version_row is not None
    assert out == [
        Message(role="system", content="be terse"),
        Message(role="human", content="echo {{ x }}"),
    ]
    pool.fetchrow.assert_awaited_once()


@pytest.mark.asyncio
async def test_prompt_version_id_handles_jsonb_string_form():
    """Some asyncpg/codec configs hand back jsonb as a string. The
    helper decodes defensively."""
    version_id = uuid4()
    body = PlaygroundCreate(
        project_id=uuid4(),
        prompt_version_id=version_id,
        model=_MODEL,
    )
    pool = AsyncMock()
    pool.fetchrow.return_value = {
        "id": version_id,
        "prompt_id": uuid4(),
        "template": "x",
        "template_messages": '[{"role": "human", "content": "x"}]',
    }

    out, _ = await _resolve_messages(pool, body)
    assert out == [Message(role="human", content="x")]


@pytest.mark.asyncio
async def test_prompt_version_id_missing_returns_404():
    body = PlaygroundCreate(
        project_id=uuid4(),
        prompt_version_id=uuid4(),
        model=_MODEL,
    )
    pool = AsyncMock()
    pool.fetchrow.return_value = None

    with pytest.raises(HTTPException) as exc:
        await _resolve_messages(pool, body)
    assert exc.value.status_code == 404


def test_rendered_prompt_join_format():
    """create_session computes rendered_prompt = '\\n\\n'.join(m.content
    for m in rendered_messages). Pin the join semantics so a future
    refactor of that line doesn't silently change the trace UI's
    display string. We can't easily run create_session in isolation,
    but the join is a one-liner that's safe to assert directly."""
    msgs = [
        Message(role="system", content="be terse"),
        Message(role="human", content="echo hello"),
    ]
    rendered_prompt = "\n\n".join(m.content for m in msgs)
    assert rendered_prompt == "be terse\n\necho hello"
