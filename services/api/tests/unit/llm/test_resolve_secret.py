"""resolve_secret: project link → env → None."""

from __future__ import annotations

import uuid
from unittest.mock import AsyncMock

import pytest

from tracebility_api.routers.llm_credentials import resolve_secret

pytestmark = pytest.mark.asyncio


async def test_returns_project_linked_credential(fake_pool, monkeypatch) -> None:
    project_id = uuid.uuid4()
    fake_pool.fetchrow = AsyncMock(return_value={"secret_encrypted": "sk-from-link"})
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    got = await resolve_secret(fake_pool, project_id=project_id, provider="openai")
    assert got == "sk-from-link"


async def test_falls_back_to_env_when_no_link(fake_pool, monkeypatch) -> None:
    project_id = uuid.uuid4()
    fake_pool.fetchrow = AsyncMock(return_value=None)
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-from-env")
    got = await resolve_secret(fake_pool, project_id=project_id, provider="anthropic")
    assert got == "sk-from-env"


async def test_returns_none_when_neither(fake_pool, monkeypatch) -> None:
    project_id = uuid.uuid4()
    fake_pool.fetchrow = AsyncMock(return_value=None)
    for var in ("OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY",
                "MISTRAL_API_KEY", "DEEPSEEK_API_KEY", "GROQ_API_KEY"):
        monkeypatch.delenv(var, raising=False)
    got = await resolve_secret(fake_pool, project_id=project_id, provider="gemini")
    assert got is None


async def test_env_var_per_provider_mapping(fake_pool, monkeypatch) -> None:
    project_id = uuid.uuid4()
    fake_pool.fetchrow = AsyncMock(return_value=None)
    cases = [
        ("openai", "OPENAI_API_KEY"),
        ("anthropic", "ANTHROPIC_API_KEY"),
        ("gemini", "GEMINI_API_KEY"),
        ("mistral", "MISTRAL_API_KEY"),
        ("deepseek", "DEEPSEEK_API_KEY"),
        ("groq", "GROQ_API_KEY"),
    ]
    for provider, env_name in cases:
        for _, env_var in cases:
            monkeypatch.delenv(env_var, raising=False)
        monkeypatch.setenv(env_name, f"sk-{provider}")
        got = await resolve_secret(fake_pool, project_id=project_id, provider=provider)
        assert got == f"sk-{provider}", f"{provider} resolution wrong"


async def test_project_id_none_skips_db_lookup(fake_pool, monkeypatch) -> None:
    monkeypatch.setenv("OPENAI_API_KEY", "sk-env-only")
    fake_pool.fetchrow = AsyncMock(return_value={"secret_encrypted": "should-not-see"})
    got = await resolve_secret(fake_pool, project_id=None, provider="openai")
    assert got == "sk-env-only"
    fake_pool.fetchrow.assert_not_called()
