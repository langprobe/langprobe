import Link from "next/link";
import { Shell } from "@/components/Shell";
import {
  PlaygroundComposer,
  type PlaygroundSessionOut,
  type PromptOption,
} from "@/components/PlaygroundClient";
import { apiGet } from "@/lib/api";
import { resolveActiveProject } from "@/lib/projects";

/**
 * Playground — interactive prompt + model invocations.
 *
 * Server component. Fetches the prompt catalog (with versions for each
 * prompt) and the most recent playground sessions, then hands off to
 * the client composer for the interactive bits. Every run lands as a
 * trace in /runs/{id} so the loop closes from playground back to the
 * observability surfaces.
 *
 * v1 is sync (no streaming) and uses env-derived provider credentials
 * on the api service. Per-workspace encrypted credentials slot in a
 * later iteration without changing the URL surface.
 */

export const dynamic = "force-dynamic";

interface PromptRow {
  id: string;
  slug: string;
  name: string;
  version_count: number;
}

interface PromptVersionRow {
  id: string;
  version: number;
  template: string;
}

interface PromptVersionList {
  versions: PromptVersionRow[];
}

interface PlaygroundSessionList {
  items: PlaygroundSessionOut[];
}

export default async function PlaygroundPage() {
  const { active, all, reason } = await resolveActiveProject();
  if (!active) {
    return (
      <Shell active={null} projects={all}>
        <PageInterior>
          <PageHeader
            title="Playground"
            subtitle="prompt + model bench"
          />
          <UnconfiguredState reason={reason} />
        </PageInterior>
      </Shell>
    );
  }

  const [promptsRes, sessionsRes] = await Promise.all([
    apiGet<PromptRow[]>(
      `/v1/prompts?project_id=${encodeURIComponent(active.id)}`,
    ),
    apiGet<PlaygroundSessionList>(
      `/v1/playground/runs?project_id=${encodeURIComponent(active.id)}&limit=20`,
    ),
  ]);

  const prompts = promptsRes.data ?? [];
  const sessions = sessionsRes.data?.items ?? [];

  const promptOptions = await Promise.all(
    prompts.map(async (p): Promise<PromptOption> => {
      const versions = await apiGet<PromptVersionList>(
        `/v1/prompts/${encodeURIComponent(p.id)}/versions`,
      );
      return {
        id: p.id,
        slug: p.slug,
        name: p.name,
        versions: (versions.data?.versions ?? []).map((v) => ({
          id: v.id,
          version: v.version,
          template: v.template,
        })),
      };
    }),
  );

  return (
    <Shell active={active} projects={all}>
      <PageInterior>
        <PageHeader
          title="Playground"
          subtitle={`${active.slug} · ${promptOptions.length} ${promptOptions.length === 1 ? "prompt" : "prompts"} in catalog`}
        />
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 1fr) 360px",
            gap: 20,
            alignItems: "start",
          }}
        >
          <PlaygroundComposer
            projectId={active.id}
            prompts={promptOptions}
          />
          <RecentSessionsCard sessions={sessions} />
        </div>
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

function RecentSessionsCard({
  sessions,
}: {
  sessions: PlaygroundSessionOut[];
}) {
  return (
    <section
      className="card"
      style={{ overflow: "hidden", position: "sticky", top: 16 }}
    >
      <div className="card-head">
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <h2>Recent runs</h2>
          <span className="card-sub">last 20</span>
        </div>
      </div>
      {sessions.length === 0 ? (
        <div style={{ padding: 16 }}>
          <p
            style={{
              color: "var(--text-3)",
              margin: 0,
              fontSize: 13,
              lineHeight: 1.55,
            }}
          >
            Your runs will show up here. Each invocation also writes a
            trace under <Link href="/runs">/runs</Link>.
          </p>
        </div>
      ) : (
        <div
          style={{
            display: "grid",
            maxHeight: 600,
            overflow: "auto",
          }}
        >
          {sessions.map((s) => (
            <SessionRow key={s.id} session={s} />
          ))}
        </div>
      )}
    </section>
  );
}

function SessionRow({ session }: { session: PlaygroundSessionOut }) {
  return (
    <div
      style={{
        padding: 12,
        borderTop: "1px solid var(--border-2)",
        display: "grid",
        gap: 4,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 8,
        }}
      >
        <span className="mono" style={{ fontSize: 12 }}>
          {session.model}
        </span>
        <SessionStatusBadge status={session.status} />
      </div>
      {session.error ? (
        <div
          className="mono"
          style={{
            fontSize: 11,
            color: "var(--danger)",
            lineHeight: 1.45,
          }}
        >
          {truncate(session.error, 140)}
        </div>
      ) : (
        <div
          style={{
            fontSize: 12,
            color: "var(--text-2)",
            lineHeight: 1.45,
          }}
        >
          {truncate(session.output_text ?? "", 160)}
        </div>
      )}
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 8,
          fontSize: 11,
          color: "var(--text-3)",
        }}
      >
        <span className="mono">
          {session.latency_ms != null ? `${session.latency_ms} ms` : "—"} ·{" "}
          {session.total_tokens != null ? `${session.total_tokens} tok` : "—"}
        </span>
        {session.run_id ? (
          <Link
            href={`/runs/${session.run_id}`}
            className="mono"
            style={{ color: "var(--link)" }}
          >
            trace →
          </Link>
        ) : (
          <span className="mono">{fmtRelative(session.created_at)}</span>
        )}
      </div>
    </div>
  );
}

function SessionStatusBadge({
  status,
}: {
  status: PlaygroundSessionOut["status"];
}) {
  if (status === "done") {
    return <span className="badge badge-success">done</span>;
  }
  if (status === "failed") {
    return <span className="badge badge-danger">failed</span>;
  }
  return <span className="badge badge-warn">{status}</span>;
}

function UnconfiguredState({ reason }: { reason: string | null }) {
  return (
    <div className="card card-pad-lg">
      <h2 style={{ marginBottom: 8 }}>No project resolved</h2>
      <p style={{ color: "var(--text-2)", margin: 0, lineHeight: 1.55 }}>
        Run the setup wizard or create a project before opening the
        playground.
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

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return `${s.slice(0, n)}…`;
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
