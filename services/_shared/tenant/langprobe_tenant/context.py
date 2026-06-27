"""TenantContext: the tuple every authenticated request carries.

Frozen dataclass on purpose — it travels through middleware, request handlers,
and writer rows. Mutation would create cross-request leaks.
"""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID


@dataclass(frozen=True, slots=True)
class TenantContext:
    org_id: UUID
    workspace_id: UUID
    project_id: UUID
    api_key_id: UUID
    # Plan code (free | pro | enterprise | self_hosted). Drives rate-limit
    # bucket size and quota cap. Looked up via the resolver, not the request.
    plan: str
    # Frozen so the caller cannot accidentally widen scope.
    scopes: frozenset[str]

    def has_scope(self, scope: str) -> bool:
        # ``internal:*`` matches any internal:* scope (used by migrate-langsmith
        # bulk imports to bypass the rate limiter).
        if scope in self.scopes:
            return True
        prefix = scope.split(":", 1)[0] + ":*"
        return prefix in self.scopes
