"""Shared pytest fixtures for the api test suite.

The unit layer never touches Postgres — it mocks asyncpg.Pool. The
integration layer uses a real local Postgres database; the test runner
is responsible for running migrations against it.
"""

from __future__ import annotations

import os

import pytest


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
    dsn = os.environ.get("TRACEBILITY_TEST_DSN")
    if not dsn:
        pytest.skip("set TRACEBILITY_TEST_DSN to run integration tests")
    return dsn
