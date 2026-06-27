"""Native ingest endpoints.

POST /v1/runs accepts an ``IngestBatch`` (OTel GenAI-aligned). We do not validate
deeply or write to ClickHouse here. The path is: auth, wrap with tenant
identifiers, hand to ``IngestEnqueue``, return 202. The worker drains Redis and
performs schema-validation + ClickHouse writes. Keeping this thin is the whole
point of the accept-and-202 contract (per ER-01, ER-21, ER-23).
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

import structlog
from fastapi import APIRouter, Depends, Request, status
from langprobe_tenant import QuotaMeter, TenantContext

from ..enqueue import IngestEnqueue, serialize_batch
from ..limits import INGEST_GATING_METER, enforce_quota
from ..redactor import Redactor
from ..schemas import IngestAck, IngestBatch

log = structlog.get_logger("langprobe.ingest.runs")

router = APIRouter(prefix="/v1", tags=["ingest"])


def _envelope(batch: IngestBatch, ctx: TenantContext) -> dict[str, Any]:
    """Wrap SDK payload with tenant identifiers the worker trusts.

    Tenant fields come from authenticated request state, not from SDK input.
    """
    return {
        "org_id": str(ctx.org_id),
        "workspace_id": str(ctx.workspace_id),
        "project_id": str(ctx.project_id),
        "api_key_id": str(ctx.api_key_id),
        "received_at": datetime.now(UTC).isoformat(),
        "payload": batch.model_dump(mode="json"),
    }


@router.post(
    "/runs",
    status_code=status.HTTP_202_ACCEPTED,
    response_model=IngestAck,
)
async def ingest_runs(
    request: Request,
    batch: IngestBatch,
    ctx: TenantContext = Depends(enforce_quota),
) -> IngestAck:
    enqueue: IngestEnqueue = request.app.state.enqueue
    redactor: Redactor = request.app.state.redactor
    envelope = _envelope(batch, ctx)
    counts = redactor.redact_envelope(envelope)
    if counts:
        log.info(
            "redacted",
            project_id=envelope["project_id"],
            counts=dict(counts),
        )
    serialized = serialize_batch(envelope)
    await enqueue.enqueue(serialized, org_id=ctx.org_id)

    span_count = len(batch.spans) + sum(len(r.spans) for r in batch.runs)
    # Optimistic quota: increment after successful enqueue. The reconciler
    # corrects against the authoritative ClickHouse billing_meter SUM every
    # 60s; ingest never blocks on the increment.
    quota_meter: QuotaMeter = request.app.state.quota_meter
    bytes_in = len(serialized)
    try:
        await quota_meter.record(
            org_id=ctx.org_id, meter=INGEST_GATING_METER, amount=span_count, limit=-1
        )
        await quota_meter.record(org_id=ctx.org_id, meter="span_bytes", amount=bytes_in, limit=-1)
    except Exception:  # noqa: BLE001 — quota counter is best-effort; reconciler corrects
        log.warning("quota record failed", org_id=str(ctx.org_id))

    return IngestAck(
        accepted_runs=len(batch.runs),
        accepted_spans=span_count,
    )
