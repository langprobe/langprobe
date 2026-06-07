"""Gateway happy path: returns DispatchResult, writes one dispatch_cost row."""

from __future__ import annotations

import uuid
from unittest.mock import AsyncMock, MagicMock

import pytest
from tracebility_api.llm import dispatch
from tracebility_api.llm.types import Message

pytestmark = pytest.mark.asyncio


def _fake_litellm_response(text: str = "hello") -> MagicMock:
    resp = MagicMock()
    resp.choices = [MagicMock(message=MagicMock(content=text))]
    resp.usage = {"prompt_tokens": 12, "completion_tokens": 5}
    resp.model = "openai/gpt-4o"
    resp.model_dump = MagicMock(return_value={"choices": [{"message": {"content": text}}]})
    return resp


async def test_happy_path_returns_normalized_result(fake_pool, mocker) -> None:
    fake_pool.fetchrow = AsyncMock(return_value={"secret_encrypted": "sk-test"})
    fake_pool.fetchval = AsyncMock(return_value=None)

    fake_resp = _fake_litellm_response()
    mocker.patch(
        "tracebility_api.llm.gateway.litellm.acompletion",
        new=AsyncMock(return_value=fake_resp),
    )
    mocker.patch(
        "tracebility_api.llm.gateway.litellm.completion_cost",
        return_value=0.00042,
    )
    mocker.patch(
        "tracebility_api.llm.gateway._workspace_id_for_project",
        new=AsyncMock(return_value=uuid.uuid4()),
    )

    result = await dispatch(
        fake_pool,
        project_id=uuid.uuid4(),
        surface="playground",
        surface_ref_id=uuid.uuid4(),
        model="openai/gpt-4o",
        messages=[Message(role="user", content="hi")],
    )

    assert result.text == "hello"
    assert result.prompt_tokens == 12
    assert result.completion_tokens == 5
    assert result.cost_usd == pytest.approx(0.00042)
    assert result.provider == "openai"

    insert_calls = [
        c for c in fake_pool.execute.await_args_list if "insert into dispatch_cost" in c.args[0]
    ]
    assert len(insert_calls) == 1
    args = insert_calls[0].args
    assert "playground" in args
    assert "openai" in args
    assert "openai/gpt-4o" in args


async def test_messages_pass_through_to_litellm(fake_pool, mocker) -> None:
    fake_pool.fetchrow = AsyncMock(
        side_effect=[
            {"ceiling": None, "spent": 0},
            {"secret_encrypted": "sk"},
        ]
    )
    fake_pool.fetchval = AsyncMock(return_value=None)
    mocker.patch("tracebility_api.llm.gateway.litellm.completion_cost", return_value=0)
    mocker.patch(
        "tracebility_api.llm.gateway._workspace_id_for_project",
        new=AsyncMock(return_value=uuid.uuid4()),
    )

    spy = mocker.patch(
        "tracebility_api.llm.gateway.litellm.acompletion",
        new=AsyncMock(return_value=_fake_litellm_response()),
    )
    await dispatch(
        fake_pool,
        project_id=uuid.uuid4(),
        surface="luna",
        surface_ref_id=uuid.uuid4(),
        model="anthropic/claude-sonnet-4",
        messages=[
            Message(role="system", content="you are precise"),
            Message(role="user", content="rate this"),
        ],
        temperature=0.2,
        max_tokens=512,
    )
    kwargs = spy.await_args.kwargs
    assert kwargs["model"] == "anthropic/claude-sonnet-4"
    assert kwargs["messages"] == [
        {"role": "system", "content": "you are precise"},
        {"role": "user", "content": "rate this"},
    ]
    assert kwargs["api_key"] == "sk"
    assert kwargs["temperature"] == 0.2
    assert kwargs["max_tokens"] == 512
    assert kwargs["num_retries"] == 0
