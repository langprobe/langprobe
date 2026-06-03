import Link from "next/link";
import { Shell } from "@/components/Shell";
import type { ComparisonRow } from "@/components/ComparisonsClient";
import { apiGet } from "@/lib/api";
import { resolveActiveProject } from "@/lib/projects";

/**
 * Comparison detail — KPI strip with per-side averages + delta, and a
 * paired diff table where each row is one dataset item with its score
 * on side A and side B.
 *
 * Pairing comes from the FULL OUTER JOIN the API performs on `run_id`
 * (which carries `item_id`); a row with only A or only B means the
 * runner hasn't reached that item yet on the missing side, or that
 * side's insert failed mid-run.
 */

export const dynamic = "force-dynamic";

interface ComparisonItemRow {
  item_id: string | null;
  score_a: number | null;
  score_b: number | null;
  label_a: string | null;
  label_b: string | null;
  rationale_a: string | null;
  rationale_b: string | null;
  judged_at: string | null;
}

interface ComparisonItemList {
  items: ComparisonItemRow[];
}

export default async function ComparisonDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const comparisonId = decodeURIComponent(params.id);
  const { active, all, reason } = await resolveActiveProject();

  if (!active) {
    return (
      <Shell active={null} projects={all}>
        <PageInterior>
          <BreadcrumbBar />
          <PageHeader title="Comparison" subtitle={comparisonId} />
          <UnconfiguredState reason={reason} />
        </PageInterior>
      </Shell>
    );
  }

  const detailRes = await apiGet<ComparisonRow>(
    `/v1/comparisons/${comparisonId}`,
  );
  const detail = detailRes.data;

  if (!detail) {
    return (
      <Shell active={active} projects={all}>
        <PageInterior>
          <BreadcrumbBar />
          <PageHeader title="Comparison" subtitle={comparisonId} />
          <NotFoundState reason={detailRes.error} status={detailRes.status} />
        </PageInterior>
      </Shell>
    );
  }

  const itemsRes = await apiGet<ComparisonItemList>(
    `/v1/comparisons/${comparisonId}/items?limit=500`,
  );
  const items = itemsRes.data?.items ?? [];

  return (
    <Shell active={active} projects={all}>
      <PageInterior>
        <BreadcrumbBar />
        <PageHeader
          title={detail.name ?? "(unnamed comparison)"}
          subtitle={
            <span className="mono" style={{ color: "var(--text-3)" }}>
              {detail.id.slice(0, 8)}
            </span>
          }
          right={<StatusBadge status={detail.status} />}
        />
        <KpiStrip row={detail} />
        {detail.error ? <ErrorCard message={detail.error} /> : null}
        <ItemsCard
          items={items}
          reason={itemsRes.error}
          status={itemsRes.status}
          row={detail}
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
      <Link href="/comparisons" style={{ color: "var(--text-3)" }}>
        ← all comparisons
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

function KpiStrip({ row }: { row: ComparisonRow }) {
  const progress =
    row.item_total > 0
      ? `${row.item_done_a + row.item_done_b} / ${row.item_total * 2}`
      : "—";
  const avgA =
    row.score_avg_a !== null
      ? `${(row.score_avg_a * 100).toFixed(1)}%`
      : "—";
  const avgB =
    row.score_avg_b !== null
      ? `${(row.score_avg_b * 100).toFixed(1)}%`
      : "—";
  const avgAColor = scoreColor(row.score_avg_a);
  const avgBColor = scoreColor(row.score_avg_b);
  const delta =
    row.score_avg_a !== null && row.score_avg_b !== null
      ? row.score_avg_b - row.score_avg_a
      : null;
  const deltaText =
    delta === null
      ? "—"
      : `${delta > 0 ? "+" : ""}${(delta * 100).toFixed(1)}pp`;
  const deltaColor =
    delta === null
      ? "var(--text-3)"
      : delta > 0.0005
        ? "var(--success, #1f7a3a)"
        : delta < -0.0005
          ? "var(--danger)"
          : "var(--text-3)";
  const duration = fmtDuration(row.started_at, row.finished_at);

  return (
    <section
      className="card"
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(5, minmax(0, 1fr))",
        gap: 0,
        overflow: "hidden",
      }}
    >
      <KpiCell label="Judge" value={row.judge_kind} mono />
      <KpiCell label="Avg A" value={avgA} valueColor={avgAColor} />
      <KpiCell label="Avg B" value={avgB} valueColor={avgBColor} />
      <KpiCell
        label="Δ (B − A)"
        value={deltaText}
        valueColor={deltaColor}
        mono
      />
      <KpiCell
        label="Progress"
        value={progress}
        mono
        sub={`duration ${duration}`}
      />
    </section>
  );
}

function KpiCell({
  label,
  value,
  mono,
  valueColor,
  sub,
}: {
  label: string;
  value: string;
  mono?: boolean;
  valueColor?: string;
  sub?: string;
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
      {sub ? (
        <span
          className="mono"
          style={{ fontSize: 11, color: "var(--text-3)" }}
        >
          {sub}
        </span>
      ) : null}
    </div>
  );
}

function ErrorCard({ message }: { message: string }) {
  return (
    <section
      className="card card-pad-lg"
      style={{ borderColor: "var(--danger)" }}
    >
      <h2 style={{ marginBottom: 8, color: "var(--danger)" }}>
        Comparison failed
      </h2>
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

function ItemsCard({
  items,
  reason,
  status,
  row,
}: {
  items: ComparisonItemRow[];
  reason: string | null;
  status: number;
  row: ComparisonRow;
}) {
  return (
    <section className="card" style={{ overflow: "hidden" }}>
      <div className="card-head">
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <h2>Per-item diff</h2>
          <span className="card-sub">
            one row per dataset item; A vs B side-by-side
          </span>
        </div>
      </div>
      {reason && items.length === 0 ? (
        <ItemsErrorState reason={reason} status={status} />
      ) : items.length === 0 ? (
        <EmptyItemsState row={row} />
      ) : (
        <div style={{ overflow: "auto" }}>
          <table className="table">
            <thead>
              <tr>
                <th>Item</th>
                <th style={{ textAlign: "right" }}>A</th>
                <th style={{ textAlign: "right" }}>B</th>
                <th style={{ textAlign: "right" }}>Δ</th>
                <th>Label A</th>
                <th>Label B</th>
                <th>Rationale (winner)</th>
                <th style={{ textAlign: "right" }}>Judged</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it, i) => (
                <tr key={`${it.item_id ?? "row"}-${i}`}>
                  <td>
                    <span className="mono" style={{ fontSize: 12 }}>
                      {it.item_id ? it.item_id.slice(0, 8) : "—"}
                    </span>
                  </td>
                  <td className="num" style={{ textAlign: "right" }}>
                    <ScoreCell score={it.score_a} />
                  </td>
                  <td className="num" style={{ textAlign: "right" }}>
                    <ScoreCell score={it.score_b} />
                  </td>
                  <td className="num" style={{ textAlign: "right" }}>
                    <DeltaCell a={it.score_a} b={it.score_b} />
                  </td>
                  <td>
                    <LabelBadge label={it.label_a} />
                  </td>
                  <td>
                    <LabelBadge label={it.label_b} />
                  </td>
                  <td
                    style={{
                      maxWidth: 420,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      color: "var(--text-2)",
                      fontSize: 13,
                    }}
                    title={pickWinnerRationale(it) ?? "—"}
                  >
                    {pickWinnerRationale(it) ?? "—"}
                  </td>
                  <td
                    className="num"
                    style={{ textAlign: "right", color: "var(--text-3)" }}
                  >
                    {it.judged_at ? fmtDateTime(it.judged_at) : "—"}
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

function pickWinnerRationale(it: ComparisonItemRow): string | null {
  const a = it.score_a ?? -1;
  const b = it.score_b ?? -1;
  if (b > a) return it.rationale_b || it.rationale_a;
  if (a > b) return it.rationale_a || it.rationale_b;
  return it.rationale_a || it.rationale_b;
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

function LabelBadge({ label }: { label: string | null }) {
  if (!label) return <span style={{ color: "var(--text-3)" }}>—</span>;
  const cls =
    label === "pass"
      ? "badge-success"
      : label === "fail"
        ? "badge-danger"
        : "badge-neutral";
  return <span className={`badge ${cls}`}>{label}</span>;
}

function ScoreCell({ score }: { score: number | null }) {
  if (score === null) {
    return <span style={{ color: "var(--text-3)" }}>—</span>;
  }
  return (
    <span
      className="mono"
      style={{ color: scoreColor(score), fontWeight: 500 }}
    >
      {(score * 100).toFixed(1)}%
    </span>
  );
}

function DeltaCell({ a, b }: { a: number | null; b: number | null }) {
  if (a === null || b === null) {
    return <span style={{ color: "var(--text-3)" }}>—</span>;
  }
  const delta = b - a;
  const pp = (delta * 100).toFixed(1);
  const color =
    delta > 0.0005
      ? "var(--success, #1f7a3a)"
      : delta < -0.0005
        ? "var(--danger)"
        : "var(--text-3)";
  const sign = delta > 0 ? "+" : "";
  return (
    <span className="mono" style={{ color, fontWeight: 500 }}>
      {sign}
      {pp}pp
    </span>
  );
}

function scoreColor(score: number | null): string {
  if (score === null) return "var(--text-3)";
  if (score >= 0.9) return "var(--success, #1f7a3a)";
  if (score >= 0.7) return "var(--warn, #a36a14)";
  return "var(--danger)";
}

function EmptyItemsState({ row }: { row: ComparisonRow }) {
  return (
    <div style={{ padding: 32 }}>
      <h3 style={{ marginBottom: 6 }}>No paired items yet.</h3>
      <p
        style={{
          color: "var(--text-2)",
          margin: 0,
          lineHeight: 1.55,
          maxWidth: 640,
        }}
      >
        {row.status === "queued"
          ? "The runner hasn't started yet. Refresh in a moment."
          : row.status === "running"
            ? "Items are still being scored. Reload to see fresh rows."
            : "This comparison finished without any per-item rows. Check the dataset has items."}
      </p>
    </div>
  );
}

function ItemsErrorState({
  reason,
  status,
}: {
  reason: string | null;
  status: number;
}) {
  return (
    <div style={{ padding: 32 }}>
      <h3 style={{ marginBottom: 6 }}>Unable to load items</h3>
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
        {status === 404 ? "Comparison not found" : "Unable to load comparison"}
      </h2>
      <p style={{ color: "var(--text-2)", lineHeight: 1.55, margin: 0 }}>
        {status === 404
          ? "No comparison matches this id in the active project."
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
        Run the setup wizard or create a project before viewing
        comparisons.
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
