import Link from "next/link";
import { Shell } from "@/components/Shell";
import type { EvalRunRow } from "@/components/EvalsClient";
import { apiGet } from "@/lib/api";
import { resolveActiveProject } from "@/lib/projects";

/**
 * Eval run detail — KPI strip, optional error card, scores table.
 *
 * The runner writes one ClickHouse `eval_score` row per dataset item; we
 * render those alongside the postgres lifecycle row so a stuck or failed
 * run is obvious at a glance. Score color thresholds match the list view.
 */

export const dynamic = "force-dynamic";

interface EvalScoreRow {
  item_id: string | null;
  score: number;
  label: string;
  rationale: string;
  outcome: string;
  judged_at: string;
}

interface EvalScoreList {
  scores: EvalScoreRow[];
}

export default async function EvalRunDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const runId = decodeURIComponent(params.id);
  const { active, all, reason } = await resolveActiveProject();

  if (!active) {
    return (
      <Shell active={null} projects={all}>
        <PageInterior>
          <BreadcrumbBar />
          <PageHeader title="Eval run" subtitle={runId} />
          <UnconfiguredState reason={reason} />
        </PageInterior>
      </Shell>
    );
  }

  const detailRes = await apiGet<EvalRunRow>(`/v1/eval-runs/${runId}`);
  const detail = detailRes.data;

  if (!detail) {
    return (
      <Shell active={active} projects={all}>
        <PageInterior>
          <BreadcrumbBar />
          <PageHeader title="Eval run" subtitle={runId} />
          <NotFoundState reason={detailRes.error} status={detailRes.status} />
        </PageInterior>
      </Shell>
    );
  }

  const scoresRes = await apiGet<EvalScoreList>(
    `/v1/eval-runs/${runId}/scores?limit=500`,
  );
  const scores = scoresRes.data?.scores ?? [];

  return (
    <Shell active={active} projects={all}>
      <PageInterior>
        <BreadcrumbBar />
        <PageHeader
          title={detail.name ?? "(unnamed run)"}
          subtitle={
            <span className="mono" style={{ color: "var(--text-3)" }}>
              {detail.id.slice(0, 8)}
            </span>
          }
          right={<StatusBadge status={detail.status} />}
        />
        <KpiStrip run={detail} />
        {detail.error ? <ErrorCard message={detail.error} /> : null}
        <ScoresCard
          scores={scores}
          reason={scoresRes.error}
          status={scoresRes.status}
          run={detail}
        />
      </PageInterior>
    </Shell>
  );
}

function PageInterior({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        padding: 24,
        display: "flex",
        flexDirection: "column",
        gap: 16,
        maxWidth: 1400,
      }}
    >
      {children}
    </div>
  );
}

function BreadcrumbBar() {
  return (
    <div style={{ fontSize: 12, color: "var(--text-3)" }}>
      <Link href="/evals" style={{ color: "var(--text-3)" }}>
        ← all eval runs
      </Link>
    </div>
  );
}

function PageHeader({
  title,
  subtitle,
  right,
}: {
  title: string;
  subtitle: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <header
      style={{
        display: "flex",
        alignItems: "baseline",
        justifyContent: "space-between",
        gap: 16,
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
        <h1>{title}</h1>
        {subtitle}
      </div>
      {right}
    </header>
  );
}

function KpiStrip({ run }: { run: EvalRunRow }) {
  const progress =
    run.item_total > 0 ? `${run.item_done} / ${run.item_total}` : "—";
  const avg =
    run.score_avg !== null ? `${(run.score_avg * 100).toFixed(1)}%` : "—";
  const avgColor =
    run.score_avg === null
      ? "var(--text-3)"
      : run.score_avg >= 0.9
        ? "var(--success, #1f7a3a)"
        : run.score_avg >= 0.7
          ? "var(--warn, #a36a14)"
          : "var(--danger)";
  const duration = fmtDuration(run.started_at, run.finished_at);

  return (
    <section
      className="card"
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
        gap: 0,
        overflow: "hidden",
      }}
    >
      <KpiCell label="Judge" value={run.judge_kind} mono />
      <KpiCell label="Progress" value={progress} mono />
      <KpiCell label="Avg score" value={avg} valueColor={avgColor} />
      <KpiCell label="Duration" value={duration} mono />
    </section>
  );
}

function KpiCell({
  label,
  value,
  mono,
  valueColor,
}: {
  label: string;
  value: string;
  mono?: boolean;
  valueColor?: string;
}) {
  return (
    <div
      style={{
        padding: "16px 20px",
        borderRight: "1px solid var(--border)",
        display: "flex",
        flexDirection: "column",
        gap: 4,
      }}
    >
      <span
        style={{
          fontSize: 11,
          color: "var(--text-3)",
          textTransform: "uppercase",
          letterSpacing: 0.4,
        }}
      >
        {label}
      </span>
      <span
        className={mono ? "mono" : "num"}
        style={{
          fontSize: 22,
          fontWeight: 500,
          color: valueColor ?? "var(--text)",
        }}
      >
        {value}
      </span>
    </div>
  );
}

function ErrorCard({ message }: { message: string }) {
  return (
    <section
      className="card card-pad-lg"
      style={{ borderColor: "var(--danger)" }}
    >
      <h2 style={{ marginBottom: 8, color: "var(--danger)" }}>Run failed</h2>
      <pre
        className="mono"
        style={{
          margin: 0,
          fontSize: 12,
          color: "var(--text-2)",
          whiteSpace: "pre-wrap",
          maxHeight: 200,
          overflow: "auto",
        }}
      >
        {message}
      </pre>
    </section>
  );
}

function ScoresCard({
  scores,
  reason,
  status,
  run,
}: {
  scores: EvalScoreRow[];
  reason: string | null;
  status: number;
  run: EvalRunRow;
}) {
  return (
    <section className="card" style={{ overflow: "hidden" }}>
      <div className="card-head">
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <h2>Per-item scores</h2>
          <span className="card-sub">
            one row per dataset item; newest first
          </span>
        </div>
      </div>
      {reason && scores.length === 0 ? (
        <ScoresErrorState reason={reason} status={status} />
      ) : scores.length === 0 ? (
        <EmptyScoresState run={run} />
      ) : (
        <div style={{ overflow: "auto" }}>
          <table className="table">
            <thead>
              <tr>
                <th>Item</th>
                <th style={{ textAlign: "right" }}>Score</th>
                <th>Label</th>
                <th>Outcome</th>
                <th>Rationale</th>
                <th style={{ textAlign: "right" }}>Judged</th>
              </tr>
            </thead>
            <tbody>
              {scores.map((s, i) => (
                <tr key={`${s.item_id ?? "row"}-${i}`}>
                  <td>
                    <span className="mono" style={{ fontSize: 12 }}>
                      {s.item_id ? s.item_id.slice(0, 8) : "—"}
                    </span>
                  </td>
                  <td className="num" style={{ textAlign: "right" }}>
                    <ScoreCell score={s.score} />
                  </td>
                  <td>
                    <LabelBadge label={s.label} />
                  </td>
                  <td>
                    <span
                      className="mono"
                      style={{ fontSize: 12, color: "var(--text-2)" }}
                    >
                      {s.outcome}
                    </span>
                  </td>
                  <td
                    style={{
                      maxWidth: 360,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      color: "var(--text-2)",
                      fontSize: 13,
                    }}
                    title={s.rationale}
                  >
                    {s.rationale || "—"}
                  </td>
                  <td
                    className="num"
                    style={{ textAlign: "right", color: "var(--text-3)" }}
                  >
                    {fmtDateTime(s.judged_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    queued: "badge-neutral",
    running: "badge-warn",
    done: "badge-success",
    failed: "badge-danger",
  };
  const cls = map[status] ?? "badge-neutral";
  return <span className={`badge ${cls}`}>{status}</span>;
}

function LabelBadge({ label }: { label: string }) {
  if (!label) return <span style={{ color: "var(--text-3)" }}>—</span>;
  const cls =
    label === "pass"
      ? "badge-success"
      : label === "fail"
        ? "badge-danger"
        : "badge-neutral";
  return <span className={`badge ${cls}`}>{label}</span>;
}

function ScoreCell({ score }: { score: number }) {
  const pct = Math.round(score * 100);
  const color =
    pct >= 90
      ? "var(--success, #1f7a3a)"
      : pct >= 70
        ? "var(--warn, #a36a14)"
        : "var(--danger)";
  return (
    <span className="mono" style={{ color, fontWeight: 500 }}>
      {(score * 100).toFixed(1)}%
    </span>
  );
}

function EmptyScoresState({ run }: { run: EvalRunRow }) {
  return (
    <div style={{ padding: 32 }}>
      <h3 style={{ marginBottom: 6 }}>No scores yet.</h3>
      <p
        style={{
          color: "var(--text-2)",
          margin: 0,
          lineHeight: 1.55,
          maxWidth: 640,
        }}
      >
        {run.status === "queued"
          ? "The runner hasn't started this run yet. Refresh in a moment."
          : run.status === "running"
            ? "Items are still being scored. Reload to see fresh rows."
            : "This run finished without writing any per-item rows. Check the dataset has items."}
      </p>
    </div>
  );
}

function ScoresErrorState({
  reason,
  status,
}: {
  reason: string | null;
  status: number;
}) {
  return (
    <div style={{ padding: 32 }}>
      <h3 style={{ marginBottom: 6 }}>Unable to load scores</h3>
      <p
        style={{
          color: "var(--text-2)",
          margin: 0,
          lineHeight: 1.55,
          maxWidth: 640,
        }}
      >
        {status === 503
          ? "The data plane (ClickHouse) is unreachable."
          : "The control plane returned an error."}
      </p>
      {reason ? (
        <p
          className="mono"
          style={{ marginTop: 12, fontSize: 11, color: "var(--text-3)" }}
        >
          ({reason})
        </p>
      ) : null}
    </div>
  );
}

function NotFoundState({
  reason,
  status,
}: {
  reason: string | null;
  status: number;
}) {
  return (
    <div className="card card-pad-lg">
      <h2 style={{ marginBottom: 8 }}>
        {status === 404 ? "Eval run not found" : "Unable to load eval run"}
      </h2>
      <p style={{ color: "var(--text-2)", lineHeight: 1.55, margin: 0 }}>
        {status === 404
          ? "No eval run matches this id in the active project."
          : "The control plane returned an error."}
      </p>
      {reason ? (
        <p
          className="mono"
          style={{ marginTop: 12, fontSize: 11, color: "var(--text-3)" }}
        >
          ({reason})
        </p>
      ) : null}
    </div>
  );
}

function UnconfiguredState({ reason }: { reason: string | null }) {
  return (
    <div className="card card-pad-lg">
      <h2 style={{ marginBottom: 8 }}>No project resolved</h2>
      <p style={{ color: "var(--text-2)", lineHeight: 1.55, margin: 0 }}>
        Run the setup wizard or create a project before viewing eval runs.
      </p>
      {reason ? (
        <p
          className="mono"
          style={{ marginTop: 12, fontSize: 11, color: "var(--text-3)" }}
        >
          ({reason})
        </p>
      ) : null}
    </div>
  );
}

function fmtDateTime(iso: string): string {
  try {
    return new Date(iso).toISOString().replace("T", " ").slice(0, 19);
  } catch {
    return iso;
  }
}

function fmtDuration(start: string | null, end: string | null): string {
  if (!start) return "—";
  const startMs = new Date(start).getTime();
  const endMs = end ? new Date(end).getTime() : Date.now();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return "—";
  const ms = Math.max(0, endMs - startMs);
  if (ms < 1000) return `${ms}ms`;
  const sec = ms / 1000;
  if (sec < 60) return `${sec.toFixed(1)}s`;
  const min = Math.floor(sec / 60);
  const rem = Math.floor(sec % 60);
  return `${min}m ${rem}s`;
}
