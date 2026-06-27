"""AuditWriter: append-only writer to ClickHouse ``audit_log``.

Spec §5.7 lists what gets written:

- Identity events:  login | logout | api_key.create | api_key.revoke |
                    role.change
- Egress events:    export.run | export.span | share_link.create |
                    webhook.dispatch | read_api.inputs_outputs
- Quota signals:    quota.warn | quota.block

Every authenticated route in the api service writes here; the postgres
``audit_log`` from migration 0005 is read-only after this lands.

ER-10 from the CEO plan still applies: a write that should have happened but
didn't is a security incident. Failures raise; the caller turns them into
500s and the request fails closed.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Final
from uuid import UUID

import clickhouse_connect
import orjson
import structlog
from clickhouse_connect.driver import AsyncClient

log = structlog.get_logger("langprobe.tenant.audit")


class EventType:
    """String constants for the ``event_type`` column. Use these instead of
    free-form strings so the lexicon is greppable."""

    LOGIN: Final = "login"
    LOGOUT: Final = "logout"
    API_KEY_CREATE: Final = "api_key.create"
    API_KEY_REVOKE: Final = "api_key.revoke"
    ROLE_CHANGE: Final = "role.change"

    EXPORT_RUN: Final = "export.run"
    EXPORT_SPAN: Final = "export.span"
    SHARE_LINK_CREATE: Final = "share_link.create"
    WEBHOOK_DISPATCH: Final = "webhook.dispatch"
    READ_API_INPUTS_OUTPUTS: Final = "read_api.inputs_outputs"

    QUOTA_WARN: Final = "quota.warn"
    QUOTA_BLOCK: Final = "quota.block"


_VALID_EVENT_TYPES: Final = frozenset(
    v for k, v in EventType.__dict__.items() if not k.startswith("_") and isinstance(v, str)
)


@dataclass(frozen=True, slots=True)
class AuditEvent:
    org_id: UUID
    event_type: str
    target_kind: str = ""
    workspace_id: UUID | None = None
    actor_user_id: UUID | None = None
    actor_api_key_id: UUID | None = None
    target_id: UUID | None = None
    attributes: dict[str, Any] | None = None
    event_time: datetime | None = None  # default: now() at write time

    def __post_init__(self) -> None:
        if self.event_type not in _VALID_EVENT_TYPES:
            # We allow unknown events through with a structured warning rather
            # than blocking, so a new event class lit up in code lands in
            # ClickHouse for forensics even before someone updates this list.
            log.warning("unknown audit event_type", event_type=self.event_type)


class AuditWriter:
    def __init__(self, client: AsyncClient, *, table: str = "audit_log") -> None:
        self._client = client
        self._table = table

    @classmethod
    async def from_url(
        cls,
        url: str,
        *,
        table: str = "audit_log",
    ) -> AuditWriter:
        # Pass the full DSN through. Credentials and database are encoded
        # in the URL (http://user:pass@host:port/db). Earlier versions
        # accepted username/password/database kwargs, but that turned out
        # to override the DSN's embedded credentials when callers passed
        # default values — yielding cryptic AUTHENTICATION_FAILED errors
        # in deployed environments where the helm chart only ships the
        # DSN as a single secret.
        client = await clickhouse_connect.get_async_client(dsn=url)
        return cls(client, table=table)

    async def write(self, event: AuditEvent) -> None:
        ts = event.event_time or datetime.now(UTC)
        attributes_json = orjson.dumps(event.attributes).decode() if event.attributes else "{}"
        try:
            await self._client.insert(
                self._table,
                [
                    [
                        event.org_id,
                        event.workspace_id,
                        event.actor_user_id,
                        event.actor_api_key_id,
                        event.event_type,
                        event.target_kind,
                        event.target_id,
                        attributes_json,
                        ts,
                    ]
                ],
                column_names=[
                    "org_id",
                    "workspace_id",
                    "actor_user_id",
                    "actor_api_key_id",
                    "event_type",
                    "target_kind",
                    "target_id",
                    "attributes",
                    "event_time",
                ],
            )
        except Exception as exc:  # noqa: BLE001 — propagate per ER-10
            log.error(
                "audit_log write failed",
                org_id=str(event.org_id),
                event_type=event.event_type,
                error=str(exc),
            )
            raise

    async def write_many(self, events: list[AuditEvent]) -> None:
        if not events:
            return
        rows = []
        for ev in events:
            ts = ev.event_time or datetime.now(UTC)
            attrs = orjson.dumps(ev.attributes).decode() if ev.attributes else "{}"
            rows.append(
                [
                    ev.org_id,
                    ev.workspace_id,
                    ev.actor_user_id,
                    ev.actor_api_key_id,
                    ev.event_type,
                    ev.target_kind,
                    ev.target_id,
                    attrs,
                    ts,
                ]
            )
        await self._client.insert(
            self._table,
            rows,
            column_names=[
                "org_id",
                "workspace_id",
                "actor_user_id",
                "actor_api_key_id",
                "event_type",
                "target_kind",
                "target_id",
                "attributes",
                "event_time",
            ],
        )
