"""Exception types for the native SDK."""

from __future__ import annotations


class TracebilityError(Exception):
    """Base class for all tracebility SDK errors."""


class TracebilityHTTPError(TracebilityError):
    """An HTTP request to a tracebility endpoint returned a non-2xx response."""

    def __init__(self, status_code: int, body: str, url: str) -> None:
        super().__init__(f"{status_code} from {url}: {body[:200]}")
        self.status_code = status_code
        self.body = body
        self.url = url
