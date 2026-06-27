"""Shared pytest fixtures for the api test suite.

The unit layer never touches Postgres — it mocks asyncpg.Pool. The
integration layer uses a real local Postgres database; the test runner
is responsible for running migrations against it.
"""

from __future__ import annotations

import os

import pytest

# Required-by-config env vars. Set defaults so unit tests don't have to
# pass them and config.load() doesn't raise at import time.
os.environ.setdefault("LANGPROBE_PG_DSN", "postgres://test/test")
os.environ.setdefault("LANGPROBE_SESSION_SECRET", "x" * 40)


@pytest.fixture
def fake_pool(mocker):
    """An asyncpg.Pool double whose execute/fetch/fetchrow/fetchval are AsyncMocks."""
    pool = mocker.MagicMock(name="pool")
    pool.execute = mocker.AsyncMock(return_value="INSERT 0 1")
    pool.fetch = mocker.AsyncMock(return_value=[])
    pool.fetchrow = mocker.AsyncMock(return_value=None)
    pool.fetchval = mocker.AsyncMock(return_value=None)
    return pool


@pytest.fixture
def integration_dsn() -> str:
    dsn = os.environ.get("LANGPROBE_TEST_DSN")
    if not dsn:
        pytest.skip("set LANGPROBE_TEST_DSN to run integration tests")
    return dsn
