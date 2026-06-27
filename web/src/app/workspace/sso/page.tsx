import Link from "next/link";
import { Shell } from "@/components/Shell";
import {
  type SSOConfigRow,
  SSOConfigForm,
} from "@/components/SSOClient";
import { apiGet } from "@/lib/api";
import { resolveActiveProject } from "@/lib/projects";

/**
 * Workspace SSO config (OIDC).
 *
 * Server component. Resolves the active project's workspace, loads
 * the existing config (if any), and hands off to the client form.
 * RBAC enforced server-side: owner/admin only — read-side returns
 * a 403 here for non-admins.
 */

export const dynamic = "force-dynamic";

interface WorkspaceRow {
  id: string;
  slug: string;
  name: string;
}

export default async function SSOPage() {
  const { active, all, reason } = await resolveActiveProject();
  if (!active) {
    return (
      <Shell active={null} projects={all}>
        <PageInterior>
          <PageHeader title="SSO" subtitle="OIDC sign-in" />
          <UnconfiguredState reason={reason} />
        </PageInterior>
      </Shell>
    );
  }

  const [wsRes, cfgRes] = await Promise.all([
    apiGet<WorkspaceRow[]>("/v1/workspaces"),
    apiGet<SSOConfigRow | null>(
      `/v1/auth/sso/config?workspace_id=${encodeURIComponent(active.workspace_id)}`,
    ),
  ]);
  const workspace = (wsRes.data ?? []).find((w) => w.id === active.workspace_id);
  const slug = workspace?.slug ?? "";

  return (
    <Shell active={active} projects={all}>
      <PageInterior>
        <PageHeader
          title="SSO"
          subtitle={`${active.slug} · OIDC sign-in for ${slug || "this workspace"}`}
        />
        {cfgRes.error && cfgRes.status === 403 ? (
          <ForbiddenState />
        ) : (
          <SSOConfigForm
            workspaceId={active.workspace_id}
            workspaceSlug={slug}
            initial={cfgRes.data && cfgRes.data.id ? cfgRes.data : null}
          />
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
      <Link href="/workspace" className="btn btn-ghost" style={{ fontSize: 12 }}>
        ← workspace settings
      </Link>
    </header>
  );
}

function UsageCard() {
  return (
    <section className="card card-pad-lg">
      <h2 style={{ marginBottom: 8 }}>How sign-in works</h2>
      <p
        style={{
          color: "var(--text-2)",
          margin: "0 0 12px",
          fontSize: 13,
          lineHeight: 1.55,
        }}
      >
        Authorization-code flow with PKCE. Discovery is automatic on
        first sign-in (cached after); the IdP returns an{" "}
        <code>id_token</code> with at least an <code>email</code> claim.
        We match-or-provision an <code>app_user</code> by email and
        attach a <code>workspace_member</code> at the configured
        default role.
      </p>
      <p
        style={{
          color: "var(--text-2)",
          margin: "0 0 12px",
          fontSize: 13,
          lineHeight: 1.55,
        }}
      >
        IdP-side configuration:
      </p>
      <ul
        style={{
          color: "var(--text-2)",
          margin: 0,
          paddingLeft: 20,
          fontSize: 13,
          lineHeight: 1.6,
        }}
      >
        <li>
          <strong>Allowed callback URI</strong>:{" "}
          <code>{`<your langprobe origin>`}/v1/auth/sso/callback</code>
        </li>
        <li>
          <strong>Required scope</strong>: <code>openid email profile</code>
        </li>
        <li>
          <strong>Token endpoint auth</strong>:{" "}
          <code>client_secret_post</code> (the form-encoded variant)
        </li>
      </ul>
    </section>
  );
}

function UnconfiguredState({ reason }: { reason: string | null }) {
  return (
    <div className="card card-pad-lg">
      <h2 style={{ marginBottom: 8 }}>No project resolved</h2>
      <p style={{ color: "var(--text-2)", margin: 0, lineHeight: 1.55 }}>
        Run the setup wizard or create a project before configuring
        SSO.
      </p>
      {reason ? (
        <p className="mono" style={{ marginTop: 12, fontSize: 11, color: "var(--text-3)" }}>
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
        SSO configuration is restricted to workspace owners and
        admins. Ask one to set this up; once enabled, every workspace
        member can sign in via the IdP.
      </p>
    </div>
  );
}
