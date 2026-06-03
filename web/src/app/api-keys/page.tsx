import { Shell } from "@/components/Shell";
import {
  type ApiKey,
  CreateKeyButton,
  RevokeButton,
} from "@/components/ApiKeysClient";
import { apiGet } from "@/lib/api";
import { resolveActiveProject, type Project } from "@/lib/projects";

/**
 * API keys — list, create, revoke.
 *
 * Server-renders the current key list for the active project; client
 * components handle the create/reveal/revoke flow. Plaintext is shown
 * exactly once and never persisted (Stripe-style). Workspace owner/admin
 * can create; member can list. Revoke takes effect on the next ingest call.
 */

export const dynamic = "force-dynamic";

export default async function ApiKeysPage() {
  const { active, all, reason } = await resolveActiveProject();

  if (!active) {
    return (
      <Shell active={null} projects={all}>
        <PageInterior>
          <PageHeader title="API keys" subtitle="ingest credentials" />
          <UnconfiguredState reason={reason} />
        </PageInterior>
      </Shell>
    );
  }

  const keysRes = await apiGet<ApiKey[]>(
    `/v1/api_keys?project_id=${encodeURIComponent(active.id)}`,
  );
  const keys = keysRes.data ?? [];

  return (
    <Shell active={active} projects={all}>
      <PageInterior>
        <PageHeader
          title="API keys"
          subtitle={`${active.slug} · ${keys.length} ${keys.length === 1 ? "key" : "keys"}`}
          right={<CreateKeyButton projectId={active.id} />}
        />
        <KeysCard keys={keys} reason={keysRes.error} project={active} />
        <SetupCard project={active} />
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

function KeysCard({
  keys,
  reason,
  project,
}: {
  keys: ApiKey[];
  reason: string | null;
  project: Project;
}) {
  return (
    <section className="card" style={{ overflow: "hidden" }}>
      <div className="card-head">
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <h2>Keys</h2>
          <span className="card-sub">
            scoped to <span className="mono">{project.slug}</span>
          </span>
        </div>
      </div>
      {keys.length === 0 ? (
        <EmptyKeysState reason={reason} project={project} />
      ) : (
        <div style={{ overflow: "auto" }}>
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Prefix</th>
                <th>Status</th>
                <th>Scopes</th>
                <th style={{ textAlign: "right" }}>Created</th>
                <th style={{ textAlign: "right" }}>Last used</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {keys.map((k) => {
                const status = k.revoked_at
                  ? "revoked"
                  : isExpired(k.expires_at)
                    ? "expired"
                    : "active";
                return (
                  <tr key={k.id}>
                    <td>{k.name}</td>
                    <td className="mono">lt_{k.public_id}…</td>
                    <td>
                      <StatusPill status={status} />
                    </td>
                    <td>
                      <span
                        style={{ display: "flex", gap: 4, flexWrap: "wrap" }}
                      >
                        {k.scopes.map((s) => (
                          <span key={s} className="badge badge-neutral">
                            {s}
                          </span>
                        ))}
                      </span>
                    </td>
                    <td
                      className="num"
                      style={{ textAlign: "right", color: "var(--text-3)" }}
                    >
                      {fmtDate(k.created_at)}
                    </td>
                    <td
                      className="num"
                      style={{ textAlign: "right", color: "var(--text-3)" }}
                    >
                      {k.last_used_at ? fmtDate(k.last_used_at) : "—"}
                    </td>
                    <td style={{ textAlign: "right" }}>
                      {status === "active" ? (
                        <RevokeButton keyId={k.id} name={k.name} />
                      ) : (
                        <span
                          className="mono"
                          style={{ color: "var(--text-4)", fontSize: 11 }}
                        >
                          —
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function SetupCard({ project }: { project: Project }) {
  return (
    <section className="card card-pad-lg">
      <h2 style={{ marginBottom: 8 }}>Use this key</h2>
      <p
        style={{
          color: "var(--text-2)",
          margin: "0 0 12px",
          fontSize: 13,
          lineHeight: 1.55,
        }}
      >
        Set <span className="mono">TRACEBILITY_API_KEY</span> in the
        environment of any process that ingests traces. The Python and JS SDKs
        pick it up automatically; the LangSmith shim does too.
      </p>
      <pre style={{ margin: 0 }}>
        {`export TRACEBILITY_API_KEY=lt_...
export TRACEBILITY_PROJECT=${project.slug}
export TRACEBILITY_BASE_URL=https://tracability.local

# LangSmith-compatible drop-in:
# pip install tracebility-langsmith-shim
# from tracebility_langsmith_shim import Client
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
        Run the setup wizard or create a project before issuing keys.
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

function EmptyKeysState({
  reason,
  project,
}: {
  reason: string | null;
  project: Project;
}) {
  return (
    <div style={{ padding: 32 }}>
      <h3 style={{ marginBottom: 6 }}>
        No keys yet for <span className="mono">{project.slug}</span>.
      </h3>
      <p style={{ color: "var(--text-2)", margin: 0, lineHeight: 1.55 }}>
        Click <strong>New key</strong> to issue one. The plaintext is shown
        once — copy it into your ingest environment immediately.
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
    status === "active"
      ? "badge badge-success"
      : status === "expired"
        ? "badge badge-warn"
        : "badge badge-danger";
  const dot =
    status === "active"
      ? "dot dot-success"
      : status === "expired"
        ? "dot dot-warn"
        : "dot dot-danger";
  return (
    <span className={cls}>
      <span className={dot} aria-hidden />
      {status}
    </span>
  );
}

function isExpired(expiresAt: string | null): boolean {
  if (!expiresAt) return false;
  try {
    return new Date(expiresAt).getTime() < Date.now();
  } catch {
    return false;
  }
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toISOString().slice(0, 10);
  } catch {
    return iso;
  }
}
