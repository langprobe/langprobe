import { Shell } from "@/components/Shell";
import {
  ProjectSettingsForm,
  type ProjectSettings,
} from "@/components/ProjectSettingsClient";
import { apiGet } from "@/lib/api";
import { resolveActiveProject } from "@/lib/projects";

/**
 * Workspace settings.
 *
 * Lists every project the user can see and lets them edit settings on the
 * active one. Editing is gated server-side by workspace role (owner/admin
 * for writes); the form just renders, the API rejects.
 */

export const dynamic = "force-dynamic";

export default async function WorkspacePage() {
  const { active, all, reason } = await resolveActiveProject();
  const projectsRes = await apiGet<ProjectSettings[]>("/v1/projects");
  const projects = projectsRes.data ?? [];
  const activeFull = active
    ? (projects.find((p) => p.id === active.id) ?? null)
    : null;

  return (
    <Shell active={active} projects={all}>
      <PageInterior>
        <PageHeader
          title="Workspace"
          subtitle={
            activeFull
              ? `${activeFull.slug} · project settings`
              : "no project resolved"
          }
        />

        <ProjectListCard projects={projects} activeId={active?.id ?? null} />

        {activeFull ? (
          <SettingsCard project={activeFull} />
        ) : (
          <UnconfiguredState reason={reason} />
        )}

        <RetentionCard />
        <DangerCard />
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
        maxWidth: 920,
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
    <header style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
      <h1>{title}</h1>
      {subtitle ? (
        <span className="mono" style={{ fontSize: 12, color: "var(--text-3)" }}>
          {subtitle}
        </span>
      ) : null}
    </header>
  );
}

function ProjectListCard({
  projects,
  activeId,
}: {
  projects: ProjectSettings[];
  activeId: string | null;
}) {
  return (
    <section className="card" style={{ overflow: "hidden" }}>
      <div className="card-head">
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <h2>Projects</h2>
          <span className="card-sub">
            {projects.length} {projects.length === 1 ? "project" : "projects"}
          </span>
        </div>
      </div>
      {projects.length === 0 ? (
        <div style={{ padding: 32, color: "var(--text-2)" }}>
          No projects yet — run the setup wizard to create one.
        </div>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Slug</th>
              <th>Name</th>
              <th style={{ textAlign: "right" }}>Sample</th>
              <th>PII</th>
              <th>RCA</th>
              <th style={{ textAlign: "right" }}>Cost ceiling / day</th>
            </tr>
          </thead>
          <tbody>
            {projects.map((p) => (
              <tr
                key={p.id}
                style={p.id === activeId ? activeRowStyle : undefined}
              >
                <td className="mono">{p.slug}</td>
                <td>{p.name}</td>
                <td className="num" style={{ textAlign: "right" }}>
                  {(p.sample_rate * 100).toFixed(0)}%
                </td>
                <td>
                  {p.pii_redaction ? (
                    <span className="badge badge-success">on</span>
                  ) : (
                    <span className="badge badge-warn">off</span>
                  )}
                </td>
                <td className="mono" style={{ color: "var(--text-2)" }}>
                  {p.rca_mode}
                </td>
                <td className="num" style={{ textAlign: "right" }}>
                  {p.eval_cost_ceiling_usd_per_day
                    ? `$${p.eval_cost_ceiling_usd_per_day}`
                    : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

const activeRowStyle = {
  background: "var(--surface-2)",
} as const;

function SettingsCard({ project }: { project: ProjectSettings }) {
  return (
    <section className="card card-pad-lg">
      <div style={{ marginBottom: 16 }}>
        <h2>{project.slug} settings</h2>
        <p
          style={{
            margin: "4px 0 0",
            color: "var(--text-3)",
            fontSize: 12,
          }}
        >
          Changes apply on the next ingest call. Only owners and admins can
          save.
        </p>
      </div>
      <ProjectSettingsForm project={project} />
    </section>
  );
}

function RetentionCard() {
  return (
    <section className="card card-pad-lg">
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <h2>Retention</h2>
        <span className="badge badge-neutral">infra-managed</span>
      </div>
      <p
        style={{
          color: "var(--text-2)",
          fontSize: 13,
          lineHeight: 1.55,
          margin: "8px 0 0",
        }}
      >
        Trace and span retention is configured per ClickHouse table TTL on
        your self-hosted instance — see{" "}
        <span className="mono">schemas/clickhouse/0001_runs_and_spans.sql</span>
        . Default is 90 days for runs, 30 days for spans. To change, edit the
        TTL clause and run the schema migration; we don&apos;t expose this in
        the UI to prevent accidental data loss.
      </p>
    </section>
  );
}

function DangerCard() {
  return (
    <section className="card card-pad-lg">
      <h2>Danger zone</h2>
      <p
        style={{
          color: "var(--text-2)",
          fontSize: 13,
          lineHeight: 1.55,
          margin: "8px 0 12px",
        }}
      >
        Project deletion and workspace deletion are intentionally not
        reachable from the UI yet. Stripe-style soft-delete with operator CLI
        ships in the next phase.
      </p>
      <button type="button" className="btn" disabled>
        Delete project (CLI only)
      </button>
    </section>
  );
}

function UnconfiguredState({ reason }: { reason: string | null }) {
  return (
    <div className="card card-pad-lg">
      <h2 style={{ marginBottom: 8 }}>No project resolved</h2>
      <p style={{ color: "var(--text-2)", margin: 0, lineHeight: 1.55 }}>
        Pick a project from the sidebar switcher, or run the setup wizard to
        create one.
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
