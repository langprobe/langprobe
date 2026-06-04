import Link from "next/link";
import { Shell } from "@/components/Shell";
import { apiGet } from "@/lib/api";
import { resolveActiveProject, type Project } from "@/lib/projects";

/**
 * Replay launcher.
 *
 * Lists the most recently-captured runs for the active project.
 * "Captured" means the worker derived a `replay_capture` row for at
 * least one boundary span (llm/tool/retriever) on this run, so the
 * run is replayable.
 *
 * Each row links to /runs/{id} where the InspectorPane's Replay
 * panel renders the per-span captures and a "replay-ready" badge on
 * the selected span.
 *
 * Studio (the canvas for branching a captured run) lives at /studio
 * — clicking "Branch in Studio" on a capture row drops a draft
 * studio_branch with the source_run_id pre-filled.
 */

export const dynamic = "force-dynamic";

interface ReplayableRun {
  run_id: string;
  name: string;
  kind: string;
  status: string;
  start_time: string;
  capture_count: number;
  bytes_total: number;
  unique_hashes: number;
  by_kind: Record<string, number>;
}

interface ReplayableRunList {
  items: ReplayableRun[];
}

export default async function ReplayPage() {
  const { active, all, reason } = await resolveActiveProject();
  if (!active) {
    return (
      <Shell active={null} projects={all}>
        <PageInterior>
          <PageHeader title="Replay" subtitle="captured runs" />
          <UnconfiguredState reason={reason} />
        </PageInterior>
      </Shell>
    );
  }

  const res = await apiGet<ReplayableRunList>(
    `/v1/replays/runs?project_id=${encodeURIComponent(active.id)}&limit=100`,
  );
  const runs = res.data?.items ?? [];

  const totalCaptures = runs.reduce((acc, r) => acc + r.capture_count, 0);
  const totalBytes = runs.reduce((acc, r) => acc + r.bytes_total, 0);
  const totalUnique = runs.reduce((acc, r) => acc + r.unique_hashes, 0);

  return (
    <Shell active={active} projects={all}>
      <PageInterior>
        <PageHeader
          title="Replay"
          subtitle={`${active.slug} · ${runs.length} replayable ${runs.length === 1 ? "run" : "runs"}`}
        />
        <KpiStrip
          replayable={runs.length}
          captures={totalCaptures}
          unique={totalUnique}
          bytes={totalBytes}
        />
        <RunsCard
          rows={runs}
          reason={res.error}
          project={active}
        />
        <UsageCard />
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
        gap: 20,
        maxWidth: 1200,
      }}
    >
      {children}
    </div>
  );
}

function PageHeader({
  title,
  subtitle,
}: {
  title: string;
  subtitle?: string;
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
        {subtitle ? (
          <span
            className="mono"
            style={{ fontSize: 12, color: "var(--text-3)" }}
          >
            {subtitle}
          </span>
        ) : null}
      </div>
    </header>
  );
}

function KpiStrip({
  replayable,
  captures,
  unique,
  bytes,
}: {
  replayable: number;
  captures: number;
  unique: number;
  bytes: number;
}) {
  return (
    <section
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
        gap: 12,
      }}
    >
      <KpiCard label="Replayable runs" value={String(replayable)} />
      <KpiCard label="Captures" value={String(captures)} />
      <KpiCard label="Unique hashes" value={String(unique)} />
      <KpiCard label="Bytes" value={fmtBytes(bytes)} />
    </section>
  );
}

function KpiCard({ label, value }: { label: string; value: string }) {
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
      <div className="num" style={{ fontSize: 22, color: "var(--text-1)", fontWeight: 500 }}>
        {value}
      </div>
    </div>
  );
}

function RunsCard({
  rows,
  reason,
  project,
}: {
  rows: ReplayableRun[];
  reason: string | null;
  project: Project;
}) {
  return (
    <section className="card" style={{ overflow: "hidden" }}>
      <div className="card-head">
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <h2>Captured runs</h2>
          <span className="card-sub">most-recent capture first</span>
        </div>
      </div>
      {rows.length === 0 ? (
        <EmptyState reason={reason} project={project} />
      ) : (
        <div style={{ overflow: "auto" }}>
          <table className="table">
            <thead>
              <tr>
                <th>Status</th>
                <th>ID</th>
                <th>Name</th>
                <th>Kind mix</th>
                <th style={{ textAlign: "right" }}>Captures</th>
                <th style={{ textAlign: "right" }}>Unique</th>
                <th style={{ textAlign: "right" }}>Bytes</th>
                <th style={{ textAlign: "right" }}>Started</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.run_id}>
                  <td>
                    <StatusPill status={r.status} />
                  </td>
                  <td>
                    <Link
                      href={`/runs/${r.run_id}`}
                      className="mono"
                      style={{ color: "var(--link)", fontSize: 12 }}
                    >
                      {r.run_id.slice(0, 8)}
                    </Link>
                  </td>
                  <td>{r.name || <span style={{ color: "var(--text-3)" }}>—</span>}</td>
                  <td>
                    <KindMix mix={r.by_kind} />
                  </td>
                  <td className="num" style={{ textAlign: "right" }}>
                    {r.capture_count}
                  </td>
                  <td className="num" style={{ textAlign: "right" }}>
                    {r.unique_hashes}
                  </td>
                  <td
                    className="num"
                    style={{ textAlign: "right", color: "var(--text-3)" }}
                  >
                    {fmtBytes(r.bytes_total)}
                  </td>
                  <td
                    className="num"
                    style={{ textAlign: "right", color: "var(--text-3)" }}
                  >
                    {fmtRelative(r.start_time)}
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <div
                      style={{
                        display: "inline-flex",
                        gap: 4,
                        justifyContent: "flex-end",
                      }}
                    >
                      <Link
                        href={`/runs/${r.run_id}`}
                        className="btn btn-ghost"
                        style={{ fontSize: 12 }}
                      >
                        open →
                      </Link>
                      <Link
                        href={`/studio?source_run_id=${encodeURIComponent(r.run_id)}`}
                        className="btn btn-ghost"
                        style={{ fontSize: 12 }}
                        title="branch this run in Studio"
                      >
                        branch
                      </Link>
                    </div>
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

function KindMix({ mix }: { mix: Record<string, number> }) {
  const entries = Object.entries(mix).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) {
    return <span style={{ color: "var(--text-3)" }}>—</span>;
  }
  return (
    <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
      {entries.map(([k, n]) => (
        <span key={k} className="badge badge-neutral" style={{ fontSize: 11 }}>
          {k} <span className="num" style={{ marginLeft: 4 }}>{n}</span>
        </span>
      ))}
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const cls =
    status === "ok"
      ? "badge badge-success"
      : status === "error"
        ? "badge badge-danger"
        : "badge badge-warn";
  return <span className={cls}>{status || "unknown"}</span>;
}

function UsageCard() {
  return (
    <section className="card card-pad-lg">
      <h2 style={{ marginBottom: 8 }}>How replay works</h2>
      <p
        style={{
          color: "var(--text-2)",
          margin: "0 0 12px",
          fontSize: 13,
          lineHeight: 1.55,
        }}
      >
        The ingest worker derives a <code>replay_capture</code> row for
        every span of kind <code>llm</code> / <code>tool</code> /
        <code>retriever</code>. Captures are content-addressed by sha256
        over the boundary I/O — same bytes across runs collide on hash,
        so dedup is free at the object-store layer.
      </p>
      <p
        style={{
          color: "var(--text-2)",
          margin: 0,
          fontSize: 13,
          lineHeight: 1.55,
        }}
      >
        Click any run to open the debugger; the Replay panel on the
        run-detail page shows per-span captures, and the per-span
        inspector marks captured spans as <strong>replay-ready</strong>.
        Click <strong>branch</strong> to drop a Studio draft pre-filled
        with this run as the source.
      </p>
    </section>
  );
}

function UnconfiguredState({ reason }: { reason: string | null }) {
  return (
    <div className="card card-pad-lg">
      <h2 style={{ marginBottom: 8 }}>No project resolved</h2>
      <p style={{ color: "var(--text-2)", lineHeight: 1.55, margin: 0 }}>
        Run the setup wizard, then point your SDK at this API.
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

function EmptyState({
  reason,
  project,
}: {
  reason: string | null;
  project: Project;
}) {
  return (
    <div style={{ padding: 32 }}>
      <h3 style={{ marginBottom: 6 }}>
        No captured runs yet in <span className="mono">{project.slug}</span>.
      </h3>
      <p
        style={{
          color: "var(--text-2)",
          margin: 0,
          lineHeight: 1.55,
          maxWidth: 640,
        }}
      >
        Send traces with <code>llm</code> / <code>tool</code> /
        <code>retriever</code>-kind spans and the worker will derive
        captures automatically. Already-captured runs show up here
        ordered by most-recent capture.
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

function fmtBytes(bytes: number): string {
  if (!bytes) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function fmtRelative(iso: string): string {
  try {
    const then = new Date(iso).getTime();
    const seconds = Math.floor((Date.now() - then) / 1000);
    if (seconds < 60) return `${seconds}s ago`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    return `${Math.floor(seconds / 86400)}d ago`;
  } catch {
    return iso;
  }
}
