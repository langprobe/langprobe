import { Shell } from "@/components/Shell";
import {
  ProjectSettingsForm,
  type ProjectSettings,
} from "@/components/ProjectSettingsClient";
import {
  NewProjectButton,
  type WorkspaceOption,
} from "@/components/NewProjectButton";
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
  const [projectsRes, wsRes] = await Promise.all([
    apiGet<ProjectSettings[]>("/v1/projects"),
    apiGet<WorkspaceOption[]>("/v1/workspaces"),
  ]);
  const projects = projectsRes.data ?? [];
  const workspaces = wsRes.data ?? [];
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
          right={<NewProjectButton workspaces={workspaces} />}
        />

        <ProjectListCard
          projects={projects}
          activeId={active?.id ?? null}
          workspaces={workspaces}
        />

        {activeFull ? (
          <SettingsCard project={activeFull} />
        ) : (
          <UnconfiguredState reason={reason} />
        )}

        <SubpageLinksCard />
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
  right,
}: {
  title: string;
  subtitle?: string;
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
        {subtitle ? (
          <span className="mono" style={{ fontSize: 12, color: "var(--text-3)" }}>
            {subtitle}
          </span>
        ) : null}
      </div>
      {right}
    </header>
  );
}

function ProjectListCard({
  projects,
  activeId,
  workspaces,
}: {
  projects: ProjectSettings[];
  activeId: string | null;
  workspaces: WorkspaceOption[];
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
        <div
          style={{
            padding: 32,
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-start",
            gap: 12,
          }}
        >
          <p style={{ margin: 0, color: "var(--text-2)" }}>
            No projects yet. Create one to start ingesting traces.
          </p>
          <NewProjectButton workspaces={workspaces} variant="empty-state" />
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
    <section className="card-section">
      <header className="card-section-head">
        <div className="card-section-head-text">
          <h2 className="card-section-title">
            <span className="mono" style={{ color: "var(--text-3)" }}>
              {project.slug}
            </span>{" "}
            settings
          </h2>
          <p className="card-section-desc">
            Changes apply on the next ingest call. Only owners and admins
            can save.
          </p>
        </div>
        <span className="badge badge-neutral">project</span>
      </header>
      <div className="card-section-body">
        <ProjectSettingsForm project={project} />
      </div>
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

function SubpageLinksCard() {
  return (
    <section className="card card-pad-lg">
      <h2 style={{ marginBottom: 8 }}>Workspace settings</h2>
      <p
        style={{
          color: "var(--text-2)",
          fontSize: 13,
          lineHeight: 1.55,
          margin: "0 0 12px",
        }}
      >
        Cross-project settings live on dedicated pages.
      </p>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: 12,
        }}
      >
        <SubpageLink
          href="/workspace/credentials"
          title="LLM credentials"
          desc="Anthropic / OpenAI keys used by playground, prompted-judges, and comparisons."
        />
        <SubpageLink
          href="/workspace/sso"
          title="SSO (OIDC)"
          desc="Configure an IdP so workspace members can sign in via your identity provider."
        />
        <SubpageLink
          href="/members"
          title="Members"
          desc="Invite, promote, or remove workspace members and pending invitations."
        />
        <SubpageLink
          href="/api-keys"
          title="API keys"
          desc="Tokens that SDKs and ingest clients use to authenticate."
        />
      </div>
    </section>
  );
}

function SubpageLink({
  href,
  title,
  desc,
}: {
  href: string;
  title: string;
  desc: string;
}) {
  return (
    <a
      href={href}
      className="card"
      style={{
        padding: 12,
        textDecoration: "none",
        color: "inherit",
        display: "grid",
        gap: 4,
      }}
    >
      <span style={{ fontSize: 14, fontWeight: 500, color: "var(--link)" }}>
        {title} →
      </span>
      <span
        style={{ fontSize: 12, color: "var(--text-3)", lineHeight: 1.45 }}
      >
        {desc}
      </span>
    </a>
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
