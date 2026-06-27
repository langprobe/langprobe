"""Prompt-side `human` <-> dispatch-side `user`. System passes through.

Two Message types live in the codebase: the prompt-side pydantic model
(LangSmith vocabulary: system / human) and the dispatch-side dataclass
(provider vocabulary: system / user / assistant / tool). _to_dispatch_messages
bridges them. AI / tool roles are deferred (spec decision 2).
"""

from __future__ import annotations

from langprobe_api.llm import Message as DispatchMessage
from langprobe_api.routers.playground import (
    Message,
    _to_dispatch_messages,
)


def test_human_maps_to_user():
    out = _to_dispatch_messages([Message(role="human", content="hi")])
    assert out == [DispatchMessage(role="user", content="hi")]


def test_system_passes_through():
    out = _to_dispatch_messages([Message(role="system", content="be terse")])
    assert out == [DispatchMessage(role="system", content="be terse")]


def test_full_conversation_order_preserved():
    out = _to_dispatch_messages(
        [
            Message(role="system", content="be terse"),
            Message(role="human", content="hi"),
        ]
    )
    assert [m.role for m in out] == ["system", "user"]
    assert [m.content for m in out] == ["be terse", "hi"]


def test_empty_list_returns_empty_list():
    """Edge case: pydantic doesn't enforce non-empty at the prompt-side
    Message level; the API's xor validator does. The mapper itself is
    safe on empty input."""
    assert _to_dispatch_messages([]) == []


def test_constructs_dispatch_message_instances():
    """The mapper returns DispatchMessage objects, not the prompt-side
    Message it received. Locks in the return-type contract."""
    src = [Message(role="human", content="hi")]
    out = _to_dispatch_messages(src)
    assert isinstance(out[0], DispatchMessage)
