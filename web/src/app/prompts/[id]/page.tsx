import Link from "next/link";
import { Shell } from "@/components/Shell";
import {
  AssignAliasButton,
  NewVersionButton,
} from "@/components/PromptVersionsClient";
import type { PromptRow } from "@/components/PromptsClient";
import { apiGet } from "@/lib/api";
import { resolveActiveProject } from "@/lib/projects";

/**
 * Prompt detail — versions list with alias controls.
 *
 * Catalog row from postgres (`/v1/prompts/{id}`); versions from postgres
 * (`/v1/prompts/{id}/versions`). New version + assign alias are client
 * components that hit the local /api proxy and refresh the server tree.
 */

export const dynamic = "force-dynamic";

interface PromptVersion {
  id: string;
  prompt_id: string;
  version: number;
  template: string;
  input_schema: Record<string, unknown> | null;
  model_params: Record<string, unknown> | null;
  aliases: string[];
  commit_message: string | null;
  created_at: string;
}

interface PromptVersionList {
  versions: PromptVersion[];
}

export default async function PromptDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const promptId = decodeURIComponent(params.id);
  const { active, all, reason } = await resolveActiveProject();

  if (!active) {
    return (
      <Shell active={null} projects={all}>
        <PageInterior>
          <BreadcrumbBar />
          <PageHeader title="Prompt" subtitle={promptId} />
          <UnconfiguredState reason={reason} />
        </PageInterior>
      </Shell>
    );
  }

  const detailRes = await apiGet<PromptRow>(`/v1/prompts/${promptId}`);
  const detail = detailRes.data;

  if (!detail) {
    return (
      <Shell active={active} projects={all}>
        <PageInterior>
          <BreadcrumbBar />
          <PageHeader title="Prompt" subtitle={promptId} />
          <NotFoundState reason={detailRes.error} status={detailRes.status} />
        </PageInterior>
      </Shell>
    );
  }

  const versionsRes = await apiGet<PromptVersionList>(
    `/v1/prompts/${promptId}/versions`,
  );
  const versions = versionsRes.data?.versions ?? [];

  return (
    <Shell active={active} projects={all}>
      <PageInterior>
        <BreadcrumbBar />
        <PageHeader
          title={detail.name}
          subtitle={
            <span className="mono" style={{ color: "var(--text-3)" }}>
              {detail.slug}
            </span>
          }
          right={<NewVersionButton promptId={detail.id} />}
        />
        <SummaryGrid detail={detail} />
        {detail.description ? (
          <DescriptionCard description={detail.description} />
        ) : null}
        <VersionsCard
          promptId={detail.id}
          versions={versions}
          reason={versionsRes.error}
          status={versionsRes.status}
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
      <Link href="/prompts" style={{ color: "var(--text-3)" }}>
        ← all prompts
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

function SummaryGrid({ detail }: { detail: PromptRow }) {
  return (
    <section
      className="card"
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
        gap: 0,
        overflow: "hidden",
      }}
    >
      <KpiCell
        label="Latest"
        value={
          detail.latest_version !== null ? `v${detail.latest_version}` : "—"
        }
      />
      <KpiCell label="Versions" value={detail.version_count.toString()} />
      <KpiCell
        label="Aliases"
        value={detail.aliases.length.toString()}
        sub={
          detail.aliases.length
            ? detail.aliases.map((a) => `@${a}`).join(", ")
            : undefined
        }
      />
      <KpiCell label="Created" value={fmtDate(detail.created_at)} />
    </section>
  );
}

function KpiCell({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
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
        className="num"
        style={{ fontSize: 22, fontWeight: 500, color: "var(--text)" }}
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

function DescriptionCard({ description }: { description: string }) {
  return (
    <section className="card card-pad-lg">
      <p
        style={{
          margin: 0,
          color: "var(--text-2)",
          lineHeight: 1.55,
          whiteSpace: "pre-wrap",
        }}
      >
        {description}
      </p>
    </section>
  );
}

function VersionsCard({
  promptId,
  versions,
  reason,
  status,
}: {
  promptId: string;
  versions: PromptVersion[];
  reason: string | null;
  status: number;
}) {
  return (
    <section className="card" style={{ overflow: "hidden" }}>
      <div className="card-head">
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <h2>Versions</h2>
          <span className="card-sub">
            newest first; revisions are immutable
          </span>
        </div>
      </div>
      {reason && versions.length === 0 ? (
        <VersionsErrorState reason={reason} status={status} />
      ) : versions.length === 0 ? (
        <EmptyVersionsState />
      ) : (
        <div style={{ display: "flex", flexDirection: "column" }}>
          {versions.map((v) => (
            <VersionRow key={v.id} promptId={promptId} version={v} />
          ))}
        </div>
      )}
    </section>
  );
}

function VersionRow({
  promptId,
  version,
}: {
  promptId: string;
  version: PromptVersion;
}) {
  return (
    <div
      style={{
        padding: "16px 20px",
        borderTop: "1px solid var(--border)",
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
          <span
            className="mono"
            style={{
              fontSize: 14,
              color: "var(--text)",
              fontWeight: 500,
            }}
          >
            v{version.version}
          </span>
          {version.aliases.length ? (
            <span style={{ display: "inline-flex", gap: 4, flexWrap: "wrap" }}>
              {version.aliases.map((a) => (
                <span key={a} className="badge badge-success">
                  @{a}
                </span>
              ))}
            </span>
          ) : null}
          {version.commit_message ? (
            <span style={{ color: "var(--text-2)", fontSize: 13 }}>
              {version.commit_message}
            </span>
          ) : null}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span
            className="mono"
            style={{ fontSize: 11, color: "var(--text-3)" }}
          >
            {fmtDateTime(version.created_at)}
          </span>
          <AssignAliasButton promptId={promptId} version={version.version} />
        </div>
      </div>
      <pre
        style={{
          margin: 0,
          maxHeight: 240,
          overflow: "auto",
          fontSize: 12,
          background: "var(--surface-2)",
          padding: "10px 12px",
          border: "1px solid var(--border)",
          borderRadius: 8,
          whiteSpace: "pre-wrap",
        }}
      >
        {version.template}
      </pre>
      {version.input_schema || version.model_params ? (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 8,
          }}
        >
          {version.input_schema ? (
            <KvBlock label="input schema" value={version.input_schema} />
          ) : (
            <span />
          )}
          {version.model_params ? (
            <KvBlock label="model params" value={version.model_params} />
          ) : (
            <span />
          )}
        </div>
      ) : null}
    </div>
  );
}

function KvBlock({
  label,
  value,
}: {
  label: string;
  value: Record<string, unknown>;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
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
      <pre
        className="mono"
        style={{
          margin: 0,
          fontSize: 11,
          background: "var(--surface-2)",
          padding: "8px 10px",
          border: "1px solid var(--border)",
          borderRadius: 8,
          color: "var(--text-2)",
          maxHeight: 160,
          overflow: "auto",
        }}
      >
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}

function EmptyVersionsState() {
  return (
    <div style={{ padding: 32 }}>
      <h3 style={{ marginBottom: 6 }}>No versions yet.</h3>
      <p
        style={{
          color: "var(--text-2)",
          margin: 0,
          lineHeight: 1.55,
          maxWidth: 640,
        }}
      >
        Click <strong>New version</strong> to save the first revision. Tag it
        with an alias like <code>@staging</code> to pull it from the SDK.
      </p>
    </div>
  );
}

function VersionsErrorState({
  reason,
  status,
}: {
  reason: string | null;
  status: number;
}) {
  return (
    <div style={{ padding: 32 }}>
      <h3 style={{ marginBottom: 6 }}>Unable to load versions</h3>
      <p
        style={{
          color: "var(--text-2)",
          margin: 0,
          lineHeight: 1.55,
          maxWidth: 640,
        }}
      >
        {status === 503
          ? "The control plane is unreachable."
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
        {status === 404 ? "Prompt not found" : "Unable to load prompt"}
      </h2>
      <p style={{ color: "var(--text-2)", lineHeight: 1.55, margin: 0 }}>
        {status === 404
          ? "No prompt matches this id in the active project."
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
        Run the setup wizard or create a project before viewing prompts.
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

function fmtDateTime(iso: string): string {
  try {
    return new Date(iso).toISOString().replace("T", " ").slice(0, 19);
  } catch {
    return iso;
  }
}
