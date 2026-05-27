import Link from "next/link";
import { Shell } from "@/components/Shell";
import { apiGet } from "@/lib/api";
import { resolveActiveProject, type Project } from "@/lib/projects";

/**
 * Traces — full runs list.
 *
 * Server-rendered list of recent runs for the active project. Mirrors the
 * shape used on Overview but without the KPI grid; this is the
 * "production debugger surface area" view (DESIGN.md mock).
 */

type Status = "ok" | "error" | "running" | string;

interface Run {
  run_id: string;
  name: string;
  kind: string;
  status: Status;
  start_time: string;
  latency_ms: number | null;
  total_tokens: number;
  cost_usd: number;
  sdk: string;
}

interface RunListResponse {
  items: Run[];
}

const DEFAULT_LIMIT = 200;

export default async function TracesPage() {
  const { active, all, reason } = await resolveActiveProject();

  if (!active) {
    return (
      <Shell active={null} projects={all}>
        <PageInterior>
          <PageHeader title="Traces" subtitle="all runs" />
          <UnconfiguredState reason={reason} />
        </PageInterior>
      </Shell>
    );
  }

  const runsRes = await apiGet<RunListResponse>(
    `/v1/runs?project_id=${encodeURIComponent(active.id)}&limit=${DEFAULT_LIMIT}`,
  );
  const runs = runsRes.data?.items ?? [];

  return (
    <Shell active={active} projects={all}>
      <PageInterior>
        <PageHeader
          title="Traces"
          subtitle={`${active.slug} · last ${DEFAULT_LIMIT}`}
        />
        <RunsCard runs={runs} reason={runsRes.error} project={active} />
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
        maxWidth: 1400,
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

function RunsCard({
  runs,
  reason,
  project,
}: {
  runs: Run[];
  reason: string | null;
  project: Project;
}) {
  return (
    <section className="card" style={{ overflow: "hidden" }}>
      <div className="card-head">
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <h2>All runs</h2>
          <span className="card-sub">
            {runs.length} {runs.length === 1 ? "run" : "runs"}
          </span>
        </div>
      </div>
      {runs.length === 0 ? (
        <EmptyRunsState reason={reason} project={project} />
      ) : (
        <div style={{ overflow: "auto" }}>
          <table className="table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Name</th>
                <th>Kind</th>
                <th>Status</th>
                <th style={{ textAlign: "right" }}>Latency</th>
                <th style={{ textAlign: "right" }}>Tokens</th>
                <th style={{ textAlign: "right" }}>Cost</th>
                <th style={{ textAlign: "right" }}>Started</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.run_id}>
                  <td>
                    <Link href={`/runs/${r.run_id}`} className="mono">
                      {r.run_id.slice(0, 8)}
                    </Link>
                  </td>
                  <td>{r.name}</td>
                  <td>
                    <KindBadge kind={r.kind} />
                  </td>
                  <td>
                    <StatusPill status={r.status} />
                  </td>
                  <td className="num" style={{ textAlign: "right" }}>
                    {fmtLatency(r.latency_ms)}
                  </td>
                  <td className="num" style={{ textAlign: "right" }}>
                    {r.total_tokens
                      ? r.total_tokens.toLocaleString("en-US")
                      : "—"}
                  </td>
                  <td className="num" style={{ textAlign: "right" }}>
                    {fmtCost(r.cost_usd)}
                  </td>
                  <td
                    className="num"
                    style={{ textAlign: "right", color: "var(--text-3)" }}
                  >
                    {fmtTime(r.start_time)}
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

function UnconfiguredState({ reason }: { reason: string | null }) {
  return (
    <div className="card card-pad-lg">
      <h2 style={{ marginBottom: 8 }}>No project resolved</h2>
      <p style={{ color: "var(--text-2)", lineHeight: 1.55, margin: 0 }}>
        Run the setup wizard, then point your SDK at this API. See{" "}
        <a href="https://github.com/gaurav0107/tracebility/blob/main/docs/getting-started.md">
          docs/getting-started.md
        </a>
        .
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

function EmptyRunsState({
  reason,
  project,
}: {
  reason: string | null;
  project: Project;
}) {
  return (
    <div style={{ padding: 32 }}>
      <h3 style={{ marginBottom: 6 }}>
        No runs yet in <span className="mono">{project.slug}</span>.
      </h3>
      <p style={{ color: "var(--text-2)", margin: 0, lineHeight: 1.55 }}>
        Send your first trace — see{" "}
        <a href="https://github.com/gaurav0107/tracebility/blob/main/docs/getting-started.md">
          docs/getting-started.md
        </a>
        .
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

function KindBadge({ kind }: { kind: string }) {
  const k = (kind || "").toLowerCase();
  const cls =
    k === "llm"
      ? "kind-llm"
      : k === "tool"
        ? "kind-tool"
        : k === "retriever" || k === "retr"
          ? "kind-retr"
          : "kind-chain";
  return <span className={`kind-badge ${cls}`}>{kind || "chain"}</span>;
}

function StatusPill({ status }: { status: Status }) {
  const cls =
    status === "ok"
      ? "badge badge-success"
      : status === "error"
        ? "badge badge-danger"
        : "badge badge-warn";
  const dot =
    status === "ok"
      ? "dot dot-success"
      : status === "error"
        ? "dot dot-danger"
        : "dot dot-warn";
  return (
    <span className={cls}>
      <span className={dot} aria-hidden />
      {status}
    </span>
  );
}

function fmtLatency(ms: number | null): string {
  if (ms === null) return "—";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

function fmtCost(usd: number): string {
  if (!usd) return "—";
  return `$${usd.toFixed(4)}`;
}

function fmtTime(iso: string): string {
  try {
    return new Date(iso).toISOString().slice(11, 19);
  } catch {
    return iso;
  }
}
