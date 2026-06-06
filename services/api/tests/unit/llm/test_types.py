"""Provider-prefix mapping and DispatchError shape."""

from __future__ import annotations

import pytest

from tracebility_api.llm.types import (
    SUPPORTED_PROVIDERS,
    DispatchError,
    DispatchResult,
    Message,
    provider_from_model,
)


def test_message_is_frozen() -> None:
    m = Message(role="user", content="hi")
    with pytest.raises(Exception):
        m.content = "no"  # type: ignore[misc]


def test_provider_from_model_six_providers() -> None:
    assert provider_from_model("anthropic/claude-sonnet-4") == "anthropic"
    assert provider_from_model("openai/gpt-4o") == "openai"
    assert provider_from_model("gemini/gemini-1.5-pro") == "gemini"
    assert provider_from_model("mistral/mistral-large") == "mistral"
    assert provider_from_model("deepseek/deepseek-chat") == "deepseek"
    assert provider_from_model("groq/llama-3.1-70b") == "groq"


def test_provider_from_model_unknown_prefix_raises_bad_model() -> None:
    with pytest.raises(DispatchError) as exc:
        provider_from_model("bedrock/anthropic.claude-3")
    assert exc.value.code == "bad_model"
    assert exc.value.provider is None


def test_provider_from_model_no_prefix_raises_bad_model() -> None:
    with pytest.raises(DispatchError) as exc:
        provider_from_model("gpt-4o")
    assert exc.value.code == "bad_model"


def test_supported_providers_is_six() -> None:
    assert SUPPORTED_PROVIDERS == frozenset(
        ["anthropic", "openai", "gemini", "mistral", "deepseek", "groq"]
    )


def test_dispatch_result_construction() -> None:
    r = DispatchResult(
        text="hello",
        prompt_tokens=10,
        completion_tokens=2,
        cost_usd=0.0001,
        provider="openai",
        model="openai/gpt-4o",
        raw={},
    )
    assert r.text == "hello"
    assert r.cost_usd == 0.0001
