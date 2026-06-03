import Link from "next/link";
import { Shell } from "@/components/Shell";
import {
  CreatePromptButton,
  DeletePromptButton,
  type PromptRow,
} from "@/components/PromptsClient";
import { apiGet } from "@/lib/api";
import { resolveActiveProject, type Project } from "@/lib/projects";

/**
 * Prompts — versioned, content-addressed prompt templates.
 *
 * The catalog row lives in postgres `prompt`; immutable revisions live in
 * `prompt_version` and carry the unique-per-prompt alias array (`@prod`,
 * `@staging`). This page is the catalog view; click a row to manage
 * versions and move aliases.
 */

export const dynamic = "force-dynamic";

export default async function PromptsPage() {
  const { active, all, reason } = await resolveActiveProject();

  if (!active) {
    return (
      <Shell active={null} projects={all}>
        <PageInterior>
          <PageHeader title="Prompts" subtitle="versioned templates" />
          <UnconfiguredState reason={reason} />
        </PageInterior>
      </Shell>
    );
  }

  const promptsRes = await apiGet<PromptRow[]>(
    `/v1/prompts?project_id=${encodeURIComponent(active.id)}`,
  );
  const prompts = promptsRes.data ?? [];

  return (
    <Shell active={active} projects={all}>
      <PageInterior>
        <PageHeader
          title="Prompts"
          subtitle={`${active.slug} · ${prompts.length} ${prompts.length === 1 ? "prompt" : "prompts"}`}
          right={<CreatePromptButton projectId={active.id} />}
        />
        <PromptsCard
          prompts={prompts}
          reason={promptsRes.error}
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
          <span
            className="mono"
            style={{ fontSize: 12, color: "var(--text-3)" }}
          >
            {subtitle}
          </span>
        ) : null}
      </div>
      {right}
    </header>
  );
}

function PromptsCard({
  prompts,
  reason,
  project,
}: {
  prompts: PromptRow[];
  reason: string | null;
  project: Project;
}) {
  return (
    <section className="card" style={{ overflow: "hidden" }}>
      <div className="card-head">
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <h2>All prompts</h2>
          <span className="card-sub">
            scoped to <span className="mono">{project.slug}</span>
          </span>
        </div>
      </div>
      {prompts.length === 0 ? (
        <EmptyState reason={reason} project={project} />
      ) : (
        <div style={{ overflow: "auto" }}>
          <table className="table">
            <thead>
              <tr>
                <th>Slug</th>
                <th>Name</th>
                <th style={{ textAlign: "right" }}>Latest</th>
                <th style={{ textAlign: "right" }}>Versions</th>
                <th>Aliases</th>
                <th style={{ textAlign: "right" }}>Updated</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {prompts.map((p) => (
                <tr key={p.id}>
                  <td>
                    <Link href={`/prompts/${p.id}`} className="mono">
                      {p.slug}
                    </Link>
                  </td>
                  <td>{p.name}</td>
                  <td className="num" style={{ textAlign: "right" }}>
                    {p.latest_version !== null ? (
                      <span className="mono">v{p.latest_version}</span>
                    ) : (
                      <span style={{ color: "var(--text-3)" }}>—</span>
                    )}
                  </td>
                  <td className="num" style={{ textAlign: "right" }}>
                    {p.version_count}
                  </td>
                  <td>
                    <AliasList aliases={p.aliases} />
                  </td>
                  <td
                    className="num"
                    style={{ textAlign: "right", color: "var(--text-3)" }}
                  >
                    {fmtDate(p.updated_at)}
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <DeletePromptButton promptId={p.id} slug={p.slug} />
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

function AliasList({ aliases }: { aliases: string[] }) {
  if (!aliases.length) {
    return <span style={{ color: "var(--text-3)" }}>—</span>;
  }
  return (
    <span style={{ display: "inline-flex", gap: 4, flexWrap: "wrap" }}>
      {aliases.map((a) => (
        <span key={a} className="badge badge-neutral">
          @{a}
        </span>
      ))}
    </span>
  );
}

function UsageCard() {
  return (
    <section className="card card-pad-lg">
      <h2 style={{ marginBottom: 8 }}>Roll out a winner without redeploying</h2>
      <p
        style={{
          color: "var(--text-2)",
          margin: "0 0 12px",
          fontSize: 13,
          lineHeight: 1.55,
        }}
      >
        Save a new version, pin it with <code>@staging</code>, run evals, then
        move <code>@prod</code> onto it. Every run records the exact version
        id, so eval regressions blame the right edit.
      </p>
      <pre style={{ margin: 0 }}>
        {`# python sdk (planned):
client.prompts.pull("triage-router", alias="prod")
client.prompts.assign_alias(
    slug="triage-router",
    version=14,
    alias="prod",
)
`}
      </pre>
    </section>
  );
}

function UnconfiguredState({ reason }: { reason: string | null }) {
  return (
    <div className="card card-pad-lg">
      <h2 style={{ marginBottom: 8 }}>No project resolved</h2>
      <p style={{ color: "var(--text-2)", margin: 0, lineHeight: 1.55 }}>
        Run the setup wizard or create a project before adding prompts.
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
        No prompts yet in <span className="mono">{project.slug}</span>.
      </h3>
      <p
        style={{
          color: "var(--text-2)",
          margin: 0,
          lineHeight: 1.55,
          maxWidth: 640,
        }}
      >
        Click <strong>New prompt</strong> to create the catalog row, then add
        the first version. Aliases like <code>@prod</code> let you move
        traffic without a redeploy.
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

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toISOString().slice(0, 10);
  } catch {
    return iso;
  }
}
