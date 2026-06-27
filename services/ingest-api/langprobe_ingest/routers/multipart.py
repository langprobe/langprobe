"""Multipart ingest — large I/O attachments alongside the JSON envelope.

The JSON path (`POST /v1/runs`) caps individual span/run inputs at
``inline_blob_max_bytes`` so the Redis envelope stays small. When a
caller has genuinely large payloads (file uploads, multi-megabyte tool
outputs, embedded screenshots) they hit that ceiling.

This endpoint accepts ``multipart/form-data``:

  envelope:    one part, ``application/json``, an IngestBatch
  attachments: zero or more parts, any content-type; the server
               hashes each (sha256), writes to
               ``<disk_buffer_path>/attachments/<hash>``, and
               returns a content-addressed ``attachment://<hash>``
               ref. Callers reference attachments from the envelope's
               ``inputs_obj_ref`` / ``outputs_obj_ref`` fields.

The disk buffer is used as the attachment store in v1 — that path
already has a PVC in the Helm chart and a host volume in compose.
When the dedicated object-store backend lands, attachments will move
to ``s3://...`` without changing the URL or the worker contract.

ER-23: never silent-drop. If we fail to persist an attachment, the
endpoint returns 503 (and the caller can retry; content-addressing
makes retries idempotent — same bytes hash to the same path).
"""

from __future__ import annotations

import hashlib
import json as _json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import structlog
from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile, status
from langprobe_tenant import QuotaMeter, TenantContext

from ..enqueue import IngestEnqueue, serialize_batch
from ..limits import INGEST_GATING_METER, enforce_quota
from ..redactor import Redactor
from ..schemas import IngestAck, IngestBatch

log = structlog.get_logger("langprobe.ingest.multipart")

router = APIRouter(tags=["ingest-multipart"])


_ATTACHMENT_PREFIX = "attachment://"


def _attachment_dir(buffer_path: str) -> Path:
    return Path(buffer_path) / "attachments"


def _hash_path(buffer_path: str, content_hash: str) -> Path:
    # sha256 hex is 64 chars; we shard by the first 2 to keep
    # directory entries reasonable on extremely large stores.
    return _attachment_dir(buffer_path) / content_hash[:2] / content_hash


@router.post(
    "/v1/runs/multipart",
    status_code=status.HTTP_202_ACCEPTED,
    response_model=IngestAck,
)
async def ingest_runs_multipart(
    request: Request,
    envelope: str = Form(..., description="IngestBatch JSON"),
    attachments: list[UploadFile] = File(default=[]),
    ctx: TenantContext = Depends(enforce_quota),
) -> IngestAck:
    """Accept a JSON envelope plus N binary attachments.

    Attachments are persisted content-addressed; the envelope can
    reference them via ``attachment://<hash>`` in any ``*_obj_ref``
    field, and the worker resolves the path at write time.
    """

    # Parse + validate the envelope. We reuse the existing pydantic
    # model so the wire shape is identical to the JSON path.
    try:
        body = _json.loads(envelope)
    except _json.JSONDecodeError as exc:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"envelope is not valid JSON: {exc.msg}",
        ) from exc
    try:
        batch = IngestBatch.model_validate(body)
    except Exception as exc:  # noqa: BLE001 — pydantic raises a descriptive error
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"envelope failed validation: {exc}",
        ) from exc

    settings = request.app.state.settings if hasattr(request.app.state, "settings") else None
    buffer_path = (
        getattr(settings, "disk_buffer_path", None) if settings is not None else None
    ) or "/var/lib/langprobe/ingest-buffer"

    written: list[dict[str, Any]] = []
    total_bytes = 0
    for upload in attachments:
        # Stream-hash so we don't OOM on multi-GB uploads.
        sha = hashlib.sha256()
        size = 0
        chunks: list[bytes] = []
        try:
            while True:
                chunk = await upload.read(64 * 1024)
                if not chunk:
                    break
                sha.update(chunk)
                chunks.append(chunk)
                size += len(chunk)
        finally:
            await upload.close()
        content_hash = sha.hexdigest()

        target = _hash_path(buffer_path, content_hash)
        try:
            target.parent.mkdir(parents=True, exist_ok=True)
            if not target.exists():
                # Atomic-ish write: tmp + rename. Two concurrent
                # writers of the same hash race for the rename;
                # rename(2) is atomic on POSIX so the loser ends up
                # overwriting with byte-identical contents — safe.
                tmp = target.with_suffix(".tmp")
                with open(tmp, "wb") as fh:
                    for c in chunks:
                        fh.write(c)
                tmp.replace(target)
        except OSError as exc:
            log.warning(
                "attachment write failed",
                content_hash=content_hash,
                error=str(exc),
            )
            raise HTTPException(
                status.HTTP_503_SERVICE_UNAVAILABLE,
                "attachment store unavailable",
            ) from exc

        written.append(
            {
                "filename": upload.filename or content_hash,
                "content_type": upload.content_type or "application/octet-stream",
                "size_bytes": size,
                "content_hash": content_hash,
                "ref": f"{_ATTACHMENT_PREFIX}{content_hash}",
            }
        )
        total_bytes += size

    if written:
        log.info(
            "multipart attachments persisted",
            count=len(written),
            bytes=total_bytes,
            project_id=str(ctx.project_id),
        )

    # Wrap with tenant identifiers + the attachments manifest. The
    # worker treats `attachments` as resolution metadata: when it sees
    # an `inputs_obj_ref` / `outputs_obj_ref` of the form
    # `attachment://<hash>`, it can read the bytes off the disk
    # buffer at the canonical path. We don't rewrite the envelope
    # here — refs travel verbatim.
    payload_envelope: dict[str, Any] = {
        "org_id": str(ctx.org_id),
        "workspace_id": str(ctx.workspace_id),
        "project_id": str(ctx.project_id),
        "api_key_id": str(ctx.api_key_id),
        "received_at": datetime.now(UTC).isoformat(),
        "source": "multipart",
        "attachments": written,
        "payload": batch.model_dump(mode="json"),
    }

    enqueue: IngestEnqueue = request.app.state.enqueue
    redactor: Redactor = request.app.state.redactor
    counts = redactor.redact_envelope(payload_envelope)
    if counts:
        log.info(
            "redacted",
            project_id=payload_envelope["project_id"],
            counts=dict(counts),
        )

    serialized = serialize_batch(payload_envelope)
    await enqueue.enqueue(serialized, org_id=ctx.org_id)

    accepted_spans = len(batch.spans) + sum(len(r.spans) for r in batch.runs)
    quota_meter: QuotaMeter = request.app.state.quota_meter
    try:
        await quota_meter.record(
            org_id=ctx.org_id, meter=INGEST_GATING_METER, amount=accepted_spans, limit=-1
        )
        await quota_meter.record(
            org_id=ctx.org_id, meter="span_bytes", amount=len(serialized) + total_bytes, limit=-1
        )
    except Exception:  # noqa: BLE001
        log.warning("quota record failed", org_id=str(ctx.org_id))
    return IngestAck(
        accepted_runs=len(batch.runs),
        accepted_spans=accepted_spans,
    )
