"""Live-network sanity for each provider in the matrix.

Skipped by default. Run with PROVIDER_LIVE_TEST=1 and the per-provider
keys set. One 5-token 'say hi' per provider; confirms LiteLLM hasn't
broken against the live API.
"""

from __future__ import annotations

import os

import litellm
import pytest

pytestmark = [
    pytest.mark.live,
    pytest.mark.asyncio,
    pytest.mark.skipif(
        os.environ.get("PROVIDER_LIVE_TEST") != "1",
        reason="set PROVIDER_LIVE_TEST=1 to run",
    ),
]

CASES = [
    ("openai/gpt-4o-mini", "OPENAI_API_KEY"),
    ("anthropic/claude-3-5-haiku-20241022", "ANTHROPIC_API_KEY"),
    ("gemini/gemini-1.5-flash", "GEMINI_API_KEY"),
    ("mistral/mistral-small-latest", "MISTRAL_API_KEY"),
    ("deepseek/deepseek-chat", "DEEPSEEK_API_KEY"),
    ("groq/llama-3.1-8b-instant", "GROQ_API_KEY"),
]


@pytest.mark.parametrize("model,env_key", CASES)
async def test_live_provider_returns_text_and_cost(model: str, env_key: str) -> None:
    api_key = os.environ.get(env_key)
    if not api_key:
        pytest.skip(f"{env_key} not set")
    resp = await litellm.acompletion(
        model=model, api_key=api_key,
        messages=[{"role": "user", "content": "say hi"}],
        max_tokens=8, num_retries=0,
    )
    assert resp.choices[0].message.content
    cost = float(litellm.completion_cost(completion_response=resp) or 0)
    assert cost >= 0
