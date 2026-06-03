import { Shell } from "@/components/Shell";
import {
  type Invitation,
  type Member,
  InviteButton,
  RemoveMemberButton,
  RevokeInviteButton,
  RoleSelect,
} from "@/components/MembersClient";
import { apiGet } from "@/lib/api";
import { resolveActiveProject } from "@/lib/projects";

/**
 * Members — workspace identity + RBAC management.
 *
 * Server-renders the members + active invitations tables for the active
 * project's workspace; client controls handle invite/role-change/revoke.
 * RBAC enforced server-side: invite/role/remove require admin. The plaintext
 * invitation token is shown ONCE on create (Stripe-style), never persisted.
 */

export const dynamic = "force-dynamic";

export default async function MembersPage() {
  const { active, all, reason } = await resolveActiveProject();

  if (!active) {
    return (
      <Shell active={null} projects={all}>
        <PageInterior>
          <PageHeader title="Members" subtitle="workspace identity" />
          <UnconfiguredState reason={reason} />
        </PageInterior>
      </Shell>
    );
  }

  const [membersRes, invitesRes] = await Promise.all([
    apiGet<Member[]>(
      `/v1/workspaces/${encodeURIComponent(active.workspace_id)}/members`,
    ),
    apiGet<Invitation[]>(
      `/v1/workspaces/${encodeURIComponent(active.workspace_id)}/invitations`,
    ),
  ]);

  const members = membersRes.data ?? [];
  const invitations = (invitesRes.data ?? []).filter(
    (i) => i.accepted_at === null && i.revoked_at === null,
  );

  return (
    <Shell active={active} projects={all}>
      <PageInterior>
        <PageHeader
          title="Members"
          subtitle={`${members.length} ${members.length === 1 ? "member" : "members"} · ${invitations.length} pending`}
          right={<InviteButton workspaceId={active.workspace_id} />}
        />
        <MembersCard
          members={members}
          reason={membersRes.error}
          workspaceId={active.workspace_id}
        />
        {invitations.length > 0 ? (
          <InvitationsCard
            invitations={invitations}
            workspaceId={active.workspace_id}
          />
        ) : null}
        <RbacCard />
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

function MembersCard({
  members,
  reason,
  workspaceId,
}: {
  members: Member[];
  reason: string | null;
  workspaceId: string;
}) {
  return (
    <section className="card" style={{ overflow: "hidden" }}>
      <div className="card-head">
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <h2>Members</h2>
          <span className="card-sub">
            workspace <span className="mono">{workspaceId.slice(0, 8)}</span>
          </span>
        </div>
      </div>
      {members.length === 0 ? (
        <EmptyState reason={reason} />
      ) : (
        <div style={{ overflow: "auto" }}>
          <table className="table">
            <thead>
              <tr>
                <th>Email</th>
                <th>Name</th>
                <th>Role</th>
                <th style={{ textAlign: "right" }}>Joined</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.user_id}>
                  <td className="mono">{m.email}</td>
                  <td>{m.name ?? "—"}</td>
                  <td>
                    <RoleSelect
                      workspaceId={workspaceId}
                      userId={m.user_id}
                      current={m.role}
                    />
                  </td>
                  <td
                    className="num"
                    style={{ textAlign: "right", color: "var(--text-3)" }}
                  >
                    {fmtDate(m.created_at)}
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <RemoveMemberButton
                      workspaceId={workspaceId}
                      userId={m.user_id}
                      email={m.email}
                    />
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

function InvitationsCard({
  invitations,
  workspaceId,
}: {
  invitations: Invitation[];
  workspaceId: string;
}) {
  return (
    <section className="card" style={{ overflow: "hidden" }}>
      <div className="card-head">
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <h2>Pending invitations</h2>
          <span className="card-sub">single-use, 7-day expiry</span>
        </div>
      </div>
      <div style={{ overflow: "auto" }}>
        <table className="table">
          <thead>
            <tr>
              <th>Email</th>
              <th>Role</th>
              <th>Token</th>
              <th style={{ textAlign: "right" }}>Sent</th>
              <th style={{ textAlign: "right" }}>Expires</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {invitations.map((i) => (
              <tr key={i.id}>
                <td className="mono">{i.email}</td>
                <td>
                  <span className="badge badge-neutral">{i.role}</span>
                </td>
                <td className="mono" style={{ color: "var(--text-3)" }}>
                  ti_{i.token_public_id}…
                </td>
                <td
                  className="num"
                  style={{ textAlign: "right", color: "var(--text-3)" }}
                >
                  {fmtDate(i.created_at)}
                </td>
                <td
                  className="num"
                  style={{ textAlign: "right", color: "var(--text-3)" }}
                >
                  {fmtDate(i.expires_at)}
                </td>
                <td style={{ textAlign: "right" }}>
                  <RevokeInviteButton
                    workspaceId={workspaceId}
                    invitationId={i.id}
                    email={i.email}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function RbacCard() {
  return (
    <section className="card card-pad-lg">
      <h2 style={{ marginBottom: 8 }}>Roles</h2>
      <p
        style={{
          color: "var(--text-2)",
          margin: "0 0 12px",
          fontSize: 13,
          lineHeight: 1.55,
        }}
      >
        Roles are checked server-side on every request. The last admin
        can&apos;t be demoted or removed; promote someone else first. SSO and
        SCIM ride on the same membership table when they ship.
      </p>
      <ul
        style={{
          margin: 0,
          paddingLeft: 18,
          color: "var(--text-2)",
          fontSize: 13,
          lineHeight: 1.7,
        }}
      >
        <li>
          <span className="mono">admin</span> — full control: invite, change
          roles, remove members, manage projects, rotate keys.
        </li>
        <li>
          <span className="mono">member</span> — read + write traces, run
          evals, manage their own projects.
        </li>
        <li>
          <span className="mono">viewer</span> — read-only access to traces
          and dashboards.
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
        Run the setup wizard or create a project before managing members.
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

function EmptyState({ reason }: { reason: string | null }) {
  return (
    <div style={{ padding: 32 }}>
      <h3 style={{ marginBottom: 6 }}>No members loaded.</h3>
      <p style={{ color: "var(--text-2)", margin: 0, lineHeight: 1.55 }}>
        This is unusual — the active workspace should always have at least the
        creator as an admin.
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

