import Link from "next/link";
import { Shell } from "@/components/Shell";
import {
  type LLMCredentialRow,
  NewLLMCredentialButton,
  RevokeLLMCredentialButton,
} from "@/components/LLMCredentialsClient";
import { apiGet } from "@/lib/api";
import { resolveActiveProject } from "@/lib/projects";

/**
 * Workspace LLM credentials.
 *
 * Server component. Lists active + revoked credentials; offers
 * create + revoke. Server enforces owner/admin via cookie; non-
 * admins see a forbidden state.
 *
 * Once you save a credential here, every LLM-dispatching surface
 * (playground, luna prompted-judges, comparisons, studio replay)
 * reads from this store automatically. Env fallback
 * (ANTHROPIC_API_KEY / OPENAI_API_KEY) still works for self-host
 * single-tenant.
 */

export const dynamic = "force-dynamic";

export default async function CredentialsPage() {
  const { active, all, reason } = await resolveActiveProject();
  if (!active) {
    return (
      <Shell active={null} projects={all}>
        <PageInterior>
          <PageHeader title="LLM credentials" subtitle="provider keys" />
          <UnconfiguredState reason={reason} />
        </PageInterior>
      </Shell>
    );
  }

  const res = await apiGet<LLMCredentialRow[]>(
    `/v1/llm-credentials?workspace_id=${encodeURIComponent(active.workspace_id)}`,
  );
  const credentials = res.data ?? [];
  const isForbidden = res.error !== null && res.status === 403;
  const activeCount = credentials.filter((c) => c.revoked_at === null).length;

  return (
    <Shell active={active} projects={all}>
      <PageInterior>
        <PageHeader
          title="LLM credentials"
          subtitle={`${active.slug} · ${activeCount} active`}
          right={
            isForbidden ? null : (
              <NewLLMCredentialButton workspaceId={active.workspace_id} />
            )
          }
        />
        {isForbidden ? (
          <ForbiddenState />
        ) : (
          <CredentialsCard rows={credentials} />
        )}
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
        maxWidth: 1000,
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
      <Link
        href="/workspace"
        className="btn btn-ghost"
        style={{ fontSize: 12 }}
      >
        ← workspace
      </Link>
    </header>
  );
}

function CredentialsCard({ rows }: { rows: LLMCredentialRow[] }) {
  if (rows.length === 0) {
    return (
      <section className="card" style={{ overflow: "hidden" }}>
        <div style={{ padding: 32 }}>
          <h3 style={{ marginBottom: 6 }}>No credentials yet</h3>
          <p
            style={{
              color: "var(--text-2)",
              margin: 0,
              lineHeight: 1.55,
              maxWidth: 640,
            }}
          >
            Add an Anthropic or OpenAI key to enable real LLM dispatch from
            the playground, prompted-judges, and comparisons. Without one
            here, those surfaces fall back to the api service's env
            (<code>ANTHROPIC_API_KEY</code> /{" "}
            <code>OPENAI_API_KEY</code>) — fine for self-host single-tenant.
          </p>
        </div>
      </section>
    );
  }
  return (
    <section className="card" style={{ overflow: "hidden" }}>
      <div className="card-head">
        <h2>Credentials</h2>
      </div>
      <div style={{ overflow: "auto" }}>
        <table className="table">
          <thead>
            <tr>
              <th>Provider</th>
              <th>Name</th>
              <th>Last 4</th>
              <th>Status</th>
              <th style={{ textAlign: "right" }}>Created</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id}>
                <td>
                  <span className="badge badge-neutral">{c.provider}</span>
                </td>
                <td className="mono" style={{ fontSize: 12 }}>
                  {c.name}
                </td>
                <td className="mono" style={{ fontSize: 12 }}>
                  …{c.secret_last4}
                </td>
                <td>
                  {c.revoked_at ? (
                    <span className="badge badge-danger">revoked</span>
                  ) : (
                    <span className="badge badge-success">active</span>
                  )}
                </td>
                <td
                  className="num"
                  style={{ textAlign: "right", color: "var(--text-3)" }}
                >
                  {fmtDateTime(c.created_at)}
                </td>
                <td style={{ textAlign: "right" }}>
                  {c.revoked_at ? (
                    <span style={{ color: "var(--text-3)", fontSize: 12 }}>
                      revoked {fmtDateTime(c.revoked_at)}
                    </span>
                  ) : (
                    <RevokeLLMCredentialButton
                      credentialId={c.id}
                      label={`${c.provider}/${c.name}`}
                    />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function UsageCard() {
  return (
    <section className="card card-pad-lg">
      <h2 style={{ marginBottom: 8 }}>How resolution works</h2>
      <p
        style={{
          color: "var(--text-2)",
          margin: "0 0 12px",
          fontSize: 13,
          lineHeight: 1.55,
        }}
      >
        Every LLM-dispatching surface resolves credentials in this order:
      </p>
      <ol
        style={{
          color: "var(--text-2)",
          margin: 0,
          paddingLeft: 20,
          fontSize: 13,
          lineHeight: 1.6,
        }}
      >
        <li>
          The most-recently-created active credential here for this
          workspace + provider.
        </li>
        <li>
          The api service's env (<code>ANTHROPIC_API_KEY</code> /{" "}
          <code>OPENAI_API_KEY</code>) — kept for self-host single-tenant.
        </li>
        <li>
          None — the dispatch fails with{" "}
          <code className="mono">no &lt;provider&gt; credential resolved</code>{" "}
          and the calling surface (playground / luna / comparisons) records
          the failure on the row.
        </li>
      </ol>
      <p
        className="mono"
        style={{
          color: "var(--text-3)",
          fontSize: 11,
          marginTop: 12,
          marginBottom: 0,
          lineHeight: 1.55,
        }}
      >
        Secrets are stored hashed; rotation requires a new credential
        (revoke the old one first to free the name slot).
      </p>
    </section>
  );
}

function UnconfiguredState({ reason }: { reason: string | null }) {
  return (
    <div className="card card-pad-lg">
      <h2 style={{ marginBottom: 8 }}>No project resolved</h2>
      <p style={{ color: "var(--text-2)", margin: 0, lineHeight: 1.55 }}>
        Create a project from <Link href="/workspace">/workspace</Link>{" "}
        first; LLM credentials are scoped to a workspace.
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

function ForbiddenState() {
  return (
    <div className="card card-pad-lg">
      <h2 style={{ marginBottom: 8 }}>Owner/admin only</h2>
      <p style={{ color: "var(--text-2)", margin: 0, lineHeight: 1.55 }}>
        LLM credentials are restricted to workspace owners and admins.
        Ask one to add your provider keys; once saved they're available
        to every workspace member's playground / eval runs.
      </p>
    </div>
  );
}

function fmtDateTime(iso: string): string {
  try {
    return new Date(iso).toISOString().replace("T", " ").slice(0, 16);
  } catch {
    return iso;
  }
}
