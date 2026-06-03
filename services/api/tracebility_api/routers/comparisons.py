"""Side-by-side prompt comparisons (A/B v1).

A comparison pairs a dataset with two prompt versions and a judge, then
scores every dataset item under each variant. Per-item scores live in
ClickHouse `eval_score` — one row per side, with the side carried in
`judge_name` as `cmp:a` / `cmp:b` so the data plane schema stays the
same as evals/feedback. Aggregates (counters + averages per side) live
on postgres `comparison`.

V1 ships built-in judges only (echo / contains / exact). LLM-as-judge
swaps in next iteration; `_render_for_variant` is the single seam where
real generation lands. Storage shape is final: pairing per item is a
FULL OUTER JOIN on `run_id` (which carries `item_id` per the eval
convention) once both sides have at least one row.

Boundaries:
- POST inserts the queued row, kicks off `BackgroundTasks._run_comparison`,
  returns 202.
- The runner fetches dataset items, scores each on both sides, batches
  one ClickHouse insert with all rows, updates postgres counters per
  side. Failures bubble into `comparison.error` with status='failed';
  we never silently drop.
- Audit-fail-closed (ER-10) on every write.
- RBAC: list/get for any role; create for owner/admin/member; no
  destructive ops in v1 (a stuck row is fine).
"""

from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

import asyncpg
import structlog
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, Field

from .. import audit
from ..auth import Principal, assert_workspace_role, require_user
from ..clickhouse_client import ClickHouseQuery

log = structlog.get_logger("tracebility.api.comparisons")

router = APIRouter(prefix="/v1/comparisons", tags=["comparisons"])

_JUDGE_KINDS = {"echo", "contains", "exact"}


class ComparisonOut(BaseModel):
    id: UUID
    project_id: UUID
    dataset_id: UUID
    prompt_version_id_a: UUID
    prompt_version_id_b: UUID
    judge_kind: str
    name: str | None
    status: str
    item_total: int
    item_done_a: int
    item_done_b: int
    score_avg_a: float | None
    score_avg_b: float | None
    error: str | None
    started_at: datetime | None
    finished_at: datetime | None
    created_at: datetime
    updated_at: datetime


class ComparisonCreate(BaseModel):
    project_id: UUID
    dataset_id: UUID
    prompt_version_id_a: UUID
    prompt_version_id_b: UUID
    judge_kind: str = Field(min_length=1, max_length=32)
    name: str | None = Field(default=None, max_length=255)


class ComparisonItemRow(BaseModel):
    item_id: UUID | None
    score_a: float | None
    score_b: float | None
    label_a: str | None
    label_b: str | None
    rationale_a: str | None
    rationale_b: str | None
    judged_at: datetime | None


class ComparisonItemList(BaseModel):
    items: list[ComparisonItemRow]


@router.get("", response_model=list[ComparisonOut])
async def list_comparisons(
    request: Request,
    project_id: UUID = Query(...),
    principal: Principal = Depends(require_user),
) -> list[ComparisonOut]:
    pool: asyncpg.Pool = request.app.state.pg
    await _assert_project_role(
        pool, project_id, principal,
        allowed=("owner", "admin", "member", "viewer"),
    )
    rows = await pool.fetch(
        """
        select id, project_id, dataset_id,
               prompt_version_id_a, prompt_version_id_b,
               judge_kind, name, status,
               item_total, item_done_a, item_done_b,
               score_avg_a, score_avg_b,
               error, started_at, finished_at, created_at, updated_at
        from comparison
        where project_id = $1
        order by created_at desc
        """,
        project_id,
    )
    return [ComparisonOut(**dict(r)) for r in rows]


@router.post("", response_model=ComparisonOut, status_code=status.HTTP_202_ACCEPTED)
async def create_comparison(
    request: Request,
    body: ComparisonCreate,
    background: BackgroundTasks,
    principal: Principal = Depends(require_user),
) -> ComparisonOut:
    pool: asyncpg.Pool = request.app.state.pg
    workspace_id = await _assert_project_role(
        pool, body.project_id, principal,
        allowed=("owner", "admin", "member"),
    )
    if body.judge_kind not in _JUDGE_KINDS:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"judge_kind must be one of {sorted(_JUDGE_KINDS)}",
        )
    if body.prompt_version_id_a == body.prompt_version_id_b:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "prompt_version_id_a and prompt_version_id_b must differ",
        )

    dataset = await pool.fetchrow(
        """
        select id, project_id, item_count
        from dataset
        where id = $1 and deleted_at is null
        """,
        body.dataset_id,
    )
    if dataset is None or dataset["project_id"] != body.project_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "dataset not found")

    versions = await pool.fetch(
        """
        select pv.id, p.project_id
        from prompt_version pv
        join prompt p on p.id = pv.prompt_id
        where pv.id = any($1::uuid[])
          and p.deleted_at is null
        """,
        [body.prompt_version_id_a, body.prompt_version_id_b],
    )
    by_id = {r["id"]: r for r in versions}
    for vid in (body.prompt_version_id_a, body.prompt_version_id_b):
        v = by_id.get(vid)
        if v is None or v["project_id"] != body.project_id:
            raise HTTPException(
                status.HTTP_404_NOT_FOUND,
                f"prompt version not found in project: {vid}",
            )

    row = await pool.fetchrow(
        """
        insert into comparison (
            project_id, dataset_id,
            prompt_version_id_a, prompt_version_id_b,
            judge_kind, name, status, item_total, created_by
        )
        values ($1, $2, $3, $4, $5, $6, 'queued', $7, $8)
        returning id, project_id, dataset_id,
                  prompt_version_id_a, prompt_version_id_b,
                  judge_kind, name, status,
                  item_total, item_done_a, item_done_b,
                  score_avg_a, score_avg_b,
                  error, started_at, finished_at, created_at, updated_at
        """,
        body.project_id,
        body.dataset_id,
        body.prompt_version_id_a,
        body.prompt_version_id_b,
        body.judge_kind,
        body.name,
        dataset["item_count"],
        principal.user_id,
    )
    assert row is not None
    cmp_row = ComparisonOut(**dict(row))
    await audit.record(
        pool,
        principal=principal,
        action="comparison.create",
        target_kind="comparison",
        target_id=cmp_row.id,
        payload={
            "dataset_id": str(cmp_row.dataset_id),
            "judge_kind": cmp_row.judge_kind,
            "prompt_version_id_a": str(cmp_row.prompt_version_id_a),
            "prompt_version_id_b": str(cmp_row.prompt_version_id_b),
        },
        request=request,
        workspace_id=workspace_id,
        project_id=cmp_row.project_id,
    )

    ch = getattr(request.app.state, "clickhouse", None)
    if ch is None:
        await _mark_failed(pool, cmp_row.id, "clickhouse not configured")
    else:
        background.add_task(_run_comparison, pool, ch, cmp_row.id)
    return cmp_row


@router.get("/{comparison_id}", response_model=ComparisonOut)
async def get_comparison(
    request: Request,
    comparison_id: UUID,
    principal: Principal = Depends(require_user),
) -> ComparisonOut:
    pool: asyncpg.Pool = request.app.state.pg
    row = await _fetch_comparison(pool, comparison_id)
    await _assert_project_role(
        pool, row["project_id"], principal,
        allowed=("owner", "admin", "member", "viewer"),
    )
    return ComparisonOut(**dict(row))


@router.get("/{comparison_id}/items", response_model=ComparisonItemList)
async def list_items(
    request: Request,
    comparison_id: UUID,
    limit: int = Query(default=200, ge=1, le=2000),
    principal: Principal = Depends(require_user),
) -> ComparisonItemList:
    pool: asyncpg.Pool = request.app.state.pg
    row = await _fetch_comparison(pool, comparison_id)
    await _assert_project_role(
        pool, row["project_id"], principal,
        allowed=("owner", "admin", "member", "viewer"),
    )
    ch = _require_clickhouse(request)

    sql = """
        select
            coalesce(a.run_id, b.run_id) as item_id,
            a.score as score_a,
            b.score as score_b,
            a.label as label_a,
            b.label as label_b,
            a.rationale as rationale_a,
            b.rationale as rationale_b,
            greatest(coalesce(a.judged_at, toDateTime64(0,3)),
                     coalesce(b.judged_at, toDateTime64(0,3))) as judged_at
        from (
            select run_id, score, label, rationale, judged_at
            from eval_score
            where project_id = {project_id:UUID}
              and eval_config_id = {comparison_id:UUID}
              and judge_name = 'cmp:a'
        ) a
        full outer join (
            select run_id, score, label, rationale, judged_at
            from eval_score
            where project_id = {project_id:UUID}
              and eval_config_id = {comparison_id:UUID}
              and judge_name = 'cmp:b'
        ) b on a.run_id = b.run_id
        order by judged_at desc
        limit {limit:UInt32}
    """
    params = {
        "project_id": str(row["project_id"]),
        "comparison_id": str(comparison_id),
        "limit": limit,
    }
    try:
        rows = await ch.query(sql, parameters=params)
    except Exception as exc:  # noqa: BLE001
        log.warning("comparison items query failed", error=str(exc))
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE, "data plane unavailable"
        ) from exc

    items = [
        ComparisonItemRow(
            item_id=r.get("item_id"),
            score_a=_opt_float(r.get("score_a")),
            score_b=_opt_float(r.get("score_b")),
            label_a=_opt_str(r.get("label_a")),
            label_b=_opt_str(r.get("label_b")),
            rationale_a=_opt_str(r.get("rationale_a")),
            rationale_b=_opt_str(r.get("rationale_b")),
            judged_at=r.get("judged_at"),
        )
        for r in rows
    ]
    return ComparisonItemList(items=items)


# ----- background runner ---------------------------------------------------

async def _run_comparison(
    pool: asyncpg.Pool, ch: ClickHouseQuery, comparison_id: UUID
) -> None:
    """Score every dataset item on both sides, write paired ClickHouse rows.

    V1: no real LLM call yet — `_render_for_variant` returns the prompt
    template body unchanged, so the template itself is the "model output"
    being scored. This makes the storage shape and pairing logic real;
    swap `_render_for_variant` for actual generation when LLM execution
    lands and nothing else changes.
    """
    try:
        cmp_row = await pool.fetchrow(
            """
            select id, project_id, dataset_id, judge_kind,
                   prompt_version_id_a, prompt_version_id_b
            from comparison where id = $1
            """,
            comparison_id,
        )
        if cmp_row is None:
            return

        await pool.execute(
            "update comparison set status='running', started_at=now() where id=$1",
            comparison_id,
        )

        templates = await pool.fetch(
            """
            select id, template
            from prompt_version
            where id = any($1::uuid[])
            """,
            [cmp_row["prompt_version_id_a"], cmp_row["prompt_version_id_b"]],
        )
        tpl_by_id = {r["id"]: (r["template"] or "") for r in templates}
        template_a = tpl_by_id.get(cmp_row["prompt_version_id_a"], "")
        template_b = tpl_by_id.get(cmp_row["prompt_version_id_b"], "")

        items = await _fetch_dataset_items(
            ch, cmp_row["project_id"], cmp_row["dataset_id"]
        )
        await pool.execute(
            "update comparison set item_total=$2 where id=$1",
            comparison_id, len(items),
        )

        rows: list[tuple[Any, ...]] = []
        score_sum_a = 0.0
        score_sum_b = 0.0
        judged_at = datetime.utcnow()
        for item in items:
            output_a = _render_for_variant(template_a, item)
            output_b = _render_for_variant(template_b, item)
            score_a, label_a, rationale_a = _judge(
                cmp_row["judge_kind"], output_a, item["expected"]
            )
            score_b, label_b, rationale_b = _judge(
                cmp_row["judge_kind"], output_b, item["expected"]
            )
            score_sum_a += score_a
            score_sum_b += score_b
            rows.append(_score_row(
                cmp_row["project_id"], item["item_id"], comparison_id,
                "cmp:a", score_a, label_a, rationale_a, output_a, judged_at,
            ))
            rows.append(_score_row(
                cmp_row["project_id"], item["item_id"], comparison_id,
                "cmp:b", score_b, label_b, rationale_b, output_b, judged_at,
            ))

        if rows:
            try:
                await ch.insert(
                    "eval_score",
                    rows,
                    column_names=[
                        "project_id", "run_id", "span_id", "eval_config_id",
                        "judge_name", "judge_endpoint", "judge_version",
                        "score", "label", "rationale", "raw_output",
                        "outcome", "judged_at", "cost_usd",
                    ],
                )
            except Exception as exc:  # noqa: BLE001
                await _mark_failed(pool, comparison_id, f"clickhouse insert: {exc}")
                return

        n = len(items)
        avg_a = (score_sum_a / n) if n else None
        avg_b = (score_sum_b / n) if n else None
        await pool.execute(
            """
            update comparison
            set status='done',
                item_done_a=$2, item_done_b=$3,
                score_sum_a=$4, score_sum_b=$5,
                score_avg_a=$6, score_avg_b=$7,
                finished_at=now()
            where id=$1
            """,
            comparison_id, n, n, score_sum_a, score_sum_b, avg_a, avg_b,
        )
    except Exception as exc:  # noqa: BLE001
        log.warning(
            "comparison run failed",
            comparison_id=str(comparison_id), error=str(exc),
        )
        await _mark_failed(pool, comparison_id, str(exc))


def _score_row(
    project_id: UUID,
    item_id: UUID,
    comparison_id: UUID,
    side: str,
    score: float,
    label: str,
    rationale: str,
    raw_output: str,
    judged_at: datetime,
) -> tuple[Any, ...]:
    return (
        str(project_id),
        str(item_id),               # carry item_id in run_id slot
        None,                       # span_id
        str(comparison_id),         # eval_config_id = our comparison id
        side,                       # 'cmp:a' or 'cmp:b'
        "builtin",                  # judge_endpoint
        "v1",                       # judge_version
        float(score),
        label,
        rationale,
        raw_output[:8000],          # cap raw_output
        "ok",
        judged_at,
        0,                          # cost_usd
    )


def _render_for_variant(template: str, item: dict[str, Any]) -> str:
    """V1 stand-in for prompt execution.

    Returns the prompt template body so the template itself becomes the
    "model output" we judge against the dataset's `expected`. Real LLM
    generation lands here in the next iteration without changing the
    storage shape or pairing logic.
    """
    _ = item
    return template or ""


async def _fetch_dataset_items(
    ch: ClickHouseQuery, project_id: UUID, dataset_id: UUID
) -> list[dict[str, Any]]:
    sql = """
        select item_id, input, expected
        from dataset_item final
        where project_id = {project_id:UUID}
          and dataset_id = {dataset_id:UUID}
          and deleted_at is null
        order by created_at asc
        limit 5000
    """
    params = {
        "project_id": str(project_id),
        "dataset_id": str(dataset_id),
    }
    return await ch.query(sql, parameters=params)


def _judge(kind: str, output_text: str, expected: str) -> tuple[float, str, str]:
    """Built-in deterministic judges. No LLM call, no API key."""
    if kind == "echo":
        return (1.0, "pass", "echo: smoke-test, always 1.0")
    if kind == "exact":
        ok = output_text == expected
        return (
            1.0 if ok else 0.0,
            "pass" if ok else "fail",
            "exact match" if ok else "output != expected",
        )
    if kind == "contains":
        ok = bool(expected) and (expected in output_text)
        return (
            1.0 if ok else 0.0,
            "pass" if ok else "fail",
            "expected found in output" if ok else "expected not in output",
        )
    return (0.0, "fail", f"unknown judge kind: {kind}")


async def _mark_failed(pool: asyncpg.Pool, comparison_id: UUID, reason: str) -> None:
    await pool.execute(
        """
        update comparison
        set status='failed', error=$2, finished_at=now()
        where id=$1
        """,
        comparison_id, reason[:2000],
    )


# ----- helpers -------------------------------------------------------------

async def _fetch_comparison(pool: asyncpg.Pool, comparison_id: UUID) -> asyncpg.Record:
    row = await pool.fetchrow(
        """
        select id, project_id, dataset_id,
               prompt_version_id_a, prompt_version_id_b,
               judge_kind, name, status,
               item_total, item_done_a, item_done_b,
               score_avg_a, score_avg_b,
               error, started_at, finished_at, created_at, updated_at
        from comparison
        where id = $1
        """,
        comparison_id,
    )
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "comparison not found")
    return row


async def _assert_project_role(
    pool: asyncpg.Pool,
    project_id: UUID,
    principal: Principal,
    *,
    allowed: tuple[str, ...],
) -> UUID:
    workspace_id = await pool.fetchval(
        "select workspace_id from project where id = $1 and deleted_at is null",
        project_id,
    )
    if workspace_id is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "project not found")
    await assert_workspace_role(
        pool,
        user_id=principal.user_id,
        workspace_id=workspace_id,
        allowed=allowed,
    )
    return workspace_id


def _require_clickhouse(request: Request) -> ClickHouseQuery:
    ch: ClickHouseQuery | None = getattr(request.app.state, "clickhouse", None)
    if ch is None:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "clickhouse not configured (set TRACEBILITY_CLICKHOUSE_URL)",
        )
    return ch


def _opt_float(v: Any) -> float | None:
    if v is None:
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _opt_str(v: Any) -> str | None:
    if v is None:
        return None
    s = str(v)
    return s if s else None
