import Link from "next/link";
import { Shell } from "@/components/Shell";
import {
  NewProjectButton,
  type WorkspaceOption,
} from "@/components/NewProjectButton";
import { apiGet } from "@/lib/api";
import { resolveActiveProject, type Project } from "@/lib/projects";

/**
 * Overview dashboard.
 *
 * Server-rendered: resolves active project from /v1/projects + cookie pin,
 * forwards the session cookie to /v1/runs + /v1/metrics in parallel.
 * Pre-setup or pre-login renders an empty state pointing at getting-started —
 * no fake data, ever (DESIGN.md "Be a tool, not a toy.").
 *
 * Visual direction: mock-as-truth (DESIGN.md v2). KPI grid at top, recent-runs
 * table below, both inside a 24px gutter on var(--bg).
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

interface MetricsResponse {
  window_seconds: number;
  runs: number;
  p50_ms: number | null;
  p95_ms: number | null;
  p99_ms: number | null;
  error_count: number;
  error_rate: number;
  total_tokens: number;
  total_cost_usd: number;
}

const WINDOW_SECONDS = 3600;

export default async function OverviewPage() {
  const { active, all, reason } = await resolveActiveProject();
  if (!active) {
    // Pre-fetch workspaces so the "create your first project" CTA in
    // the empty state actually has somewhere to put the project.
    // Falls back to an empty list if the user isn't authenticated yet.
    const wsRes = await apiGet<WorkspaceOption[]>("/v1/workspaces");
    const workspaces = wsRes.data ?? [];
    return (
      <Shell active={null} projects={all}>
        <PageInterior>
          <PageHeader title="Overview" subtitle="last 1h" />
          <UnconfiguredState reason={reason} workspaces={workspaces} />
        </PageInterior>
      </Shell>
    );
  }

  const [runsRes, metricsRes] = await Promise.all([
    apiGet<RunListResponse>(
      `/v1/runs?project_id=${encodeURIComponent(active.id)}&limit=100`,
    ),
    apiGet<MetricsResponse>(
      `/v1/metrics?project_id=${encodeURIComponent(active.id)}&window_seconds=${WINDOW_SECONDS}`,
    ),
  ]);

  const runs = runsRes.data?.items ?? [];
  const runsError = runsRes.error;
  const metrics = metricsRes.data;
  const metricsError = metricsRes.error;

  return (
    <Shell active={active} projects={all}>
      <PageInterior>
        <PageHeader title="Overview" subtitle={`last 1h · ${active.slug}`} />
        <KpiGrid metrics={metrics} error={metricsError} />
        <RunsCard runs={runs} reason={runsError} project={active} />
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
      <div style={{ display: "flex", gap: 8 }}>
        <button className="btn btn-sm btn-ghost" type="button">
          1h
        </button>
        <button className="btn btn-sm btn-ghost" type="button">
          24h
        </button>
        <button className="btn btn-sm btn-ghost" type="button">
          7d
        </button>
        <button className="btn btn-sm btn-primary" type="button">
          New run
        </button>
      </div>
    </header>
  );
}

function KpiGrid({
  metrics,
  error,
}: {
  metrics: MetricsResponse | null | undefined;
  error: string | null;
}) {
  const tiles: {
    label: string;
    value: string;
    delta?: string;
    tone?: "up" | "down";
  }[] = metrics
    ? [
        { label: "Runs", value: fmtInt(metrics.runs) },
        { label: "p50", value: fmtMs(metrics.p50_ms) },
        { label: "p95", value: fmtMs(metrics.p95_ms) },
        { label: "p99", value: fmtMs(metrics.p99_ms) },
        {
          label: "Error rate",
          value:
            metrics.runs > 0
              ? `${(metrics.error_rate * 100).toFixed(1)}%`
              : "—",
          tone: metrics.error_rate >= 0.05 ? "down" : undefined,
        },
        { label: "Cost", value: fmtCostTotal(metrics.total_cost_usd) },
      ]
    : [
        { label: "Runs", value: "—" },
        { label: "p50", value: "—" },
        { label: "p95", value: "—" },
        { label: "p99", value: "—" },
        { label: "Error rate", value: "—" },
        { label: "Cost", value: "—" },
      ];

  return (
    <div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(6, 1fr)",
          gap: 12,
        }}
      >
        {tiles.map((t) => (
          <div key={t.label} className="kpi">
            <span className="kpi-label">{t.label}</span>
            <span className="kpi-value">{t.value}</span>
            <span
              className={`kpi-delta${
                t.tone === "up"
                  ? " kpi-delta-up"
                  : t.tone === "down"
                    ? " kpi-delta-down"
                    : ""
              }`}
            >
              {t.delta ?? "last 1h"}
            </span>
          </div>
        ))}
      </div>
      {error ? (
        <div
          style={{
            marginTop: 12,
            padding: "8px 12px",
            color: "var(--danger)",
            fontSize: 12,
            background: "var(--danger-soft)",
            border: "1px solid var(--border)",
            borderRadius: "var(--r-2)",
          }}
        >
          metrics unavailable: {error}
        </div>
      ) : null}
    </div>
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
          <h2>Recent runs</h2>
          <span className="card-sub">last 100</span>
        </div>
        <Link href="/runs" className="btn btn-sm btn-ghost">
          View all →
        </Link>
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

function UnconfiguredState({
  reason,
  workspaces,
}: {
  reason: string | null;
  workspaces: WorkspaceOption[];
}) {
  // Three distinct cases land here, and each needs a different CTA:
  //   1) Not authenticated → reason='not authenticated'; we send to login.
  //   2) Authenticated, no workspaces → wizard / invite path.
  //   3) Authenticated with a workspace, no projects → CREATE project here.
  // Most pre-launch users hit case 3; that's the path that makes the
  // app usable end-to-end without the operator running curl.
  const isNotAuth = reason === "not authenticated";
  const hasWorkspace = workspaces.length > 0;

  return (
    <div className="card card-pad-lg" style={{ display: "grid", gap: 16 }}>
      <div>
        <h2 style={{ marginBottom: 8 }}>
          {isNotAuth
            ? "Create your account"
            : hasWorkspace
              ? "Create your first project"
              : "Run the setup wizard"}
        </h2>
        <p style={{ color: "var(--text-2)", lineHeight: 1.55, margin: 0 }}>
          {isNotAuth ? (
            <>
              Sign up with Google or GitHub — we&apos;ll auto-provision a
              personal workspace and first project so you can start sending
              traces in minutes. Already have an account? Sign in.
            </>
          ) : hasWorkspace ? (
            <>
              A project is the unit of tenancy: every trace, eval, and
              dataset belongs to one. Create one to start ingesting data.
              You can add more later from <Link href="/workspace">workspace settings</Link>.
            </>
          ) : (
            <>
              Run the setup wizard to create the root account and
              workspace. See{" "}
              <a href="https://github.com/gaurav0107/tracebility/blob/main/docs/getting-started.md">
                docs/getting-started.md
              </a>
              .
            </>
          )}
        </p>
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        {hasWorkspace && !isNotAuth ? (
          <NewProjectButton workspaces={workspaces} variant="empty-state" />
        ) : null}
        {isNotAuth ? (
          <>
            <Link href="/login?tab=signup" className="btn btn-primary">
              Create account
            </Link>
            <Link href="/login" className="btn btn-ghost" style={{ fontSize: 12 }}>
              Sign in
            </Link>
          </>
        ) : null}
        <Link
          href="https://github.com/gaurav0107/tracebility/blob/main/docs/getting-started.md"
          className="btn btn-ghost"
          style={{ fontSize: 12 }}
        >
          Getting started →
        </Link>
      </div>

      {reason ? (
        <p
          className="mono"
          style={{ marginTop: 0, fontSize: 11, color: "var(--text-3)" }}
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
  const k = kind.toLowerCase();
  const cls =
    k === "llm"
      ? "kind-llm"
      : k === "tool"
        ? "kind-tool"
        : k === "retriever" || k === "retr"
          ? "kind-retr"
          : "kind-chain";
  return <span className={`kind-badge ${cls}`}>{kind}</span>;
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

function fmtMs(ms: number | null): string {
  if (ms === null) return "—";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

function fmtInt(n: number): string {
  return n.toLocaleString("en-US");
}

function fmtCost(usd: number): string {
  if (!usd) return "—";
  return `$${usd.toFixed(4)}`;
}

function fmtCostTotal(usd: number): string {
  if (!usd) return "$0.00";
  if (usd < 1) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

function fmtTime(iso: string): string {
  try {
    return new Date(iso).toISOString().slice(11, 19);
  } catch {
    return iso;
  }
}
