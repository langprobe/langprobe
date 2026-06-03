import Link from "next/link";
import { Shell } from "@/components/Shell";
import { apiGet } from "@/lib/api";
import { resolveActiveProject, type Project } from "@/lib/projects";

/**
 * Threads — multi-turn session view.
 *
 * Server-renders a list of sessions (runs grouped by session_id) with
 * turn count, last activity, total cost, p95 latency, and error rate.
 * The session_id link goes to /threads/[session_id] for the chronological
 * turn-by-turn detail.
 */

export const dynamic = "force-dynamic";

interface ThreadListItem {
  session_id: string;
  turn_count: number;
  first_run_at: string;
  last_run_at: string;
  total_cost_usd: number;
  total_tokens: number;
  error_count: number;
  latency_p95_ms: number | null;
  last_run_id: string;
  last_status: string;
}

interface ThreadListResponse {
  items: ThreadListItem[];
}

const DEFAULT_LIMIT = 200;

export default async function ThreadsPage() {
  const { active, all, reason } = await resolveActiveProject();

  if (!active) {
    return (
      <Shell active={null} projects={all}>
        <PageInterior>
          <PageHeader title="Threads" subtitle="multi-turn sessions" />
          <UnconfiguredState reason={reason} />
        </PageInterior>
      </Shell>
    );
  }

  const threadsRes = await apiGet<ThreadListResponse>(
    `/v1/threads?project_id=${encodeURIComponent(active.id)}&limit=${DEFAULT_LIMIT}`,
  );
  const threads = threadsRes.data?.items ?? [];

  return (
    <Shell active={active} projects={all}>
      <PageInterior>
        <PageHeader
          title="Threads"
          subtitle={`${active.slug} · ${threads.length} ${threads.length === 1 ? "session" : "sessions"}`}
        />
        <ThreadsCard
          threads={threads}
          reason={threadsRes.error}
          project={active}
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

function ThreadsCard({
  threads,
  reason,
  project,
}: {
  threads: ThreadListItem[];
  reason: string | null;
  project: Project;
}) {
  return (
    <section className="card" style={{ overflow: "hidden" }}>
      <div className="card-head">
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <h2>Sessions</h2>
          <span className="card-sub">grouped by session_id</span>
        </div>
      </div>
      {threads.length === 0 ? (
        <EmptyState reason={reason} project={project} />
      ) : (
        <div style={{ overflow: "auto" }}>
          <table className="table">
            <thead>
              <tr>
                <th>Session</th>
                <th style={{ textAlign: "right" }}>Turns</th>
                <th>Last status</th>
                <th style={{ textAlign: "right" }}>Errors</th>
                <th style={{ textAlign: "right" }}>p95 latency</th>
                <th style={{ textAlign: "right" }}>Tokens</th>
                <th style={{ textAlign: "right" }}>Cost</th>
                <th style={{ textAlign: "right" }}>Last activity</th>
              </tr>
            </thead>
            <tbody>
              {threads.map((t) => (
                <tr key={t.session_id}>
                  <td>
                    <Link
                      href={`/threads/${encodeURIComponent(t.session_id)}`}
                      className="mono"
                    >
                      {t.session_id.length > 24
                        ? `${t.session_id.slice(0, 24)}…`
                        : t.session_id}
                    </Link>
                  </td>
                  <td className="num" style={{ textAlign: "right" }}>
                    {t.turn_count.toLocaleString("en-US")}
                  </td>
                  <td>
                    <StatusPill status={t.last_status} />
                  </td>
                  <td
                    className="num"
                    style={{
                      textAlign: "right",
                      color:
                        t.error_count > 0 ? "var(--danger)" : "var(--text-3)",
                    }}
                  >
                    {t.error_count > 0 ? t.error_count : "—"}
                  </td>
                  <td className="num" style={{ textAlign: "right" }}>
                    {fmtLatency(t.latency_p95_ms)}
                  </td>
                  <td className="num" style={{ textAlign: "right" }}>
                    {t.total_tokens
                      ? t.total_tokens.toLocaleString("en-US")
                      : "—"}
                  </td>
                  <td className="num" style={{ textAlign: "right" }}>
                    {fmtCost(t.total_cost_usd)}
                  </td>
                  <td
                    className="num"
                    style={{ textAlign: "right", color: "var(--text-3)" }}
                  >
                    {fmtRelative(t.last_run_at)}
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
        Run the setup wizard or create a project before viewing sessions.
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
        No sessions yet in <span className="mono">{project.slug}</span>.
      </h3>
      <p
        style={{
          color: "var(--text-2)",
          margin: 0,
          lineHeight: 1.55,
          maxWidth: 640,
        }}
      >
        A session is a set of runs that share a <span className="mono">session_id</span>.
        Tag your runs with the same id across turns and they&apos;ll roll up
        here. Single-turn calls (no session_id) stay on{" "}
        <Link href="/runs">/runs</Link>.
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

function StatusPill({ status }: { status: string }) {
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
      {status || "running"}
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

function fmtRelative(iso: string): string {
  try {
    const d = new Date(iso);
    const diff = (Date.now() - d.getTime()) / 1000;
    if (diff < 60) return `${Math.floor(diff)}s ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}d ago`;
    return d.toISOString().slice(0, 10);
  } catch {
    return iso;
  }
}
