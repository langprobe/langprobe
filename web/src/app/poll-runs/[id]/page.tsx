import Link from "next/link";
import { notFound } from "next/navigation";
import { Shell } from "@/components/Shell";
import { type PollRunRow } from "@/components/PollRunsClient";
import { apiGet } from "@/lib/api";
import { resolveActiveProject } from "@/lib/projects";

/**
 * PoLL panel detail.
 *
 * Server component. Renders the run header + KPI strip + per-item
 * consensus breakdown. The items table is sorted ascending by
 * consensus so the most-disputed items surface first — those are the
 * rows where the panel disagreed and the rubric likely needs work.
 */

export const dynamic = "force-dynamic";

interface PollItemRow {
  item_id: string | null;
  consensus: number;
  scores: Record<string, number>;
  labels: Record<string, string>;
  rationales: Record<string, string>;
  judged_at: string | null;
}

interface PollItemList {
  items: PollItemRow[];
}

export default async function PollRunDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const { active, all, reason } = await resolveActiveProject();
  if (!active) {
    return (
      <Shell active={null} projects={all}>
        <div style={{ padding: 24 }}>
          <p style={{ color: "var(--text-2)", fontSize: 13 }}>
            no project resolved{reason ? ` (${reason})` : ""}.{" "}
            <Link href="/poll-runs">back to PoLL</Link>
          </p>
        </div>
      </Shell>
    );
  }

  const [runRes, itemsRes] = await Promise.all([
    apiGet<PollRunRow>(`/v1/poll-runs/${params.id}`),
    apiGet<PollItemList>(`/v1/poll-runs/${params.id}/items?limit=500`),
  ]);

  const run = runRes.data;
  if (!run) notFound();

  const items = itemsRes.data?.items ?? [];
  const disputed = items.filter((i) => isDisputed(i.scores)).length;

  return (
    <Shell active={active} projects={all}>
      <div
        style={{
          padding: 24,
          display: "flex",
          flexDirection: "column",
          gap: 20,
          maxWidth: 1200,
        }}
      >
        <Header run={run} />
        <KpiStrip run={run} disputed={disputed} />
        <ItemsCard run={run} items={items} reason={itemsRes.error} />
      </div>
    </Shell>
  );
}

function Header({ run }: { run: PollRunRow }) {
  return (
    <header style={{ display: "grid", gap: 6 }}>
      <div
        className="mono"
        style={{ fontSize: 11, color: "var(--text-3)" }}
      >
        <Link href="/poll-runs" style={{ color: "var(--text-3)" }}>
          poll panels
        </Link>{" "}
        / <span style={{ color: "var(--text-2)" }}>{run.id.slice(0, 8)}</span>
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
        <h1 style={{ margin: 0 }}>{run.name ?? "Untitled panel"}</h1>
        <StatusBadge status={run.status} />
        <span
          className="mono"
          style={{ fontSize: 12, color: "var(--text-3)" }}
        >
          {run.aggregation}
        </span>
      </div>
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
        {run.judges.map((j) => (
          <span key={j} className="badge badge-neutral">
            {j}
          </span>
        ))}
      </div>
      {run.error ? (
        <p
          className="mono"
          style={{
            color: "var(--danger)",
            fontSize: 12,
            margin: "8px 0 0",
            lineHeight: 1.45,
          }}
        >
          {run.error}
        </p>
      ) : null}
    </header>
  );
}

function StatusBadge({ status }: { status: PollRunRow["status"] }) {
  if (status === "done") {
    return <span className="badge badge-success">done</span>;
  }
  if (status === "failed") {
    return <span className="badge badge-danger">failed</span>;
  }
  if (status === "running") {
    return <span className="badge badge-warn">running</span>;
  }
  return <span className="badge badge-neutral">queued</span>;
}

function KpiStrip({
  run,
  disputed,
}: {
  run: PollRunRow;
  disputed: number;
}) {
  return (
    <section
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
        gap: 12,
      }}
    >
      <KpiCard label="Consensus" value={fmtPct(run.consensus_avg)} />
      <KpiCard
        label="Agreement"
        value={fmtPct(run.agreement)}
        tone={
          run.agreement != null && run.agreement < 0.7 ? "warn" : "neutral"
        }
      />
      <KpiCard label="Items" value={`${run.item_done} / ${run.item_total}`} />
      <KpiCard
        label="Disputed"
        value={String(disputed)}
        tone={disputed > 0 ? "warn" : "neutral"}
      />
    </section>
  );
}

function KpiCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "warn" | "neutral";
}) {
  const color = tone === "warn" ? "var(--warn, #a36a14)" : "var(--text-1)";
  return (
    <div className="card card-pad-lg">
      <div
        style={{
          fontSize: 11,
          color: "var(--text-3)",
          textTransform: "uppercase",
          letterSpacing: 0.4,
          marginBottom: 6,
        }}
      >
        {label}
      </div>
      <div className="num" style={{ fontSize: 22, color, fontWeight: 500 }}>
        {value}
      </div>
    </div>
  );
}

function ItemsCard({
  run,
  items,
  reason,
}: {
  run: PollRunRow;
  items: PollItemRow[];
  reason: string | null;
}) {
  return (
    <section className="card" style={{ overflow: "hidden" }}>
      <div className="card-head">
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <h2>Items</h2>
          <span className="card-sub">
            sorted by consensus (most-disputed first)
          </span>
        </div>
      </div>
      {items.length === 0 ? (
        <div style={{ padding: 32 }}>
          <p
            style={{ color: "var(--text-2)", margin: 0, lineHeight: 1.55 }}
          >
            No per-item scores yet. The run is{" "}
            <strong>{run.status}</strong>.
            {reason ? (
              <span
                className="mono"
                style={{ display: "block", marginTop: 12, fontSize: 11 }}
              >
                ({reason})
              </span>
            ) : null}
          </p>
        </div>
      ) : (
        <div style={{ overflow: "auto" }}>
          <table className="table">
            <thead>
              <tr>
                <th>Item</th>
                <th style={{ textAlign: "right" }}>Consensus</th>
                {run.judges.map((j) => (
                  <th key={j} style={{ textAlign: "right" }}>
                    {j}
                  </th>
                ))}
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, idx) => {
                const disputed = isDisputed(item.scores);
                const itemKey = item.item_id ?? `idx-${idx}`;
                return (
                  <tr key={itemKey}>
                    <td>
                      <span className="mono" style={{ fontSize: 12 }}>
                        {item.item_id ? item.item_id.slice(0, 8) : "—"}
                      </span>
                      {disputed ? (
                        <span
                          className="badge badge-warn"
                          style={{ marginLeft: 8, fontSize: 10 }}
                        >
                          disputed
                        </span>
                      ) : null}
                    </td>
                    <td
                      className="num"
                      style={{ textAlign: "right", fontWeight: 500 }}
                    >
                      {fmtPct(item.consensus)}
                    </td>
                    {run.judges.map((j) => (
                      <td
                        key={j}
                        className="num"
                        style={{
                          textAlign: "right",
                          color:
                            item.scores[j] >= 0.5
                              ? undefined
                              : "var(--text-3)",
                        }}
                      >
                        {item.scores[j] != null
                          ? fmtPct(item.scores[j])
                          : "—"}
                      </td>
                    ))}
                    <td
                      style={{
                        fontSize: 12,
                        color: "var(--text-3)",
                        maxWidth: 320,
                      }}
                    >
                      {pickRationale(item)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function isDisputed(scores: Record<string, number>): boolean {
  const values = Object.values(scores);
  if (values.length < 2) return false;
  let pos = 0;
  let neg = 0;
  for (const v of values) {
    if (v >= 0.5) pos += 1;
    else neg += 1;
  }
  return pos > 0 && neg > 0;
}

function pickRationale(item: PollItemRow): string {
  const entries = Object.entries(item.rationales);
  if (entries.length === 0) return "";
  const meaningful = entries.find(([, v]) => v && v.trim() !== "");
  return meaningful ? meaningful[1] : "";
}

function fmtPct(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return `${(value * 100).toFixed(0)}%`;
}
