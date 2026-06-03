import { RoadmapSurface } from "@/components/RoadmapSurface";

export const dynamic = "force-dynamic";

/**
 * Members — workspace identity + RBAC management.
 *
 * Backend already enforces owner/admin/member roles per workspace
 * (see schemas/postgres/migrations/0003_users_and_membership.sql).
 * The UI to invite, change role, and revoke is on deck — until then,
 * use the CLI. SCIM and SSO ride on the same membership table.
 */

export default function MembersPage() {
  return (
    <RoadmapSurface
      title="Members"
      tagline="Invite teammates, manage roles, and revoke access. Owner / admin / member roles enforced server-side; SCIM and SSO ride on the same membership table."
      status="build"
      shipsIn="months 3–5"
      capabilities={[
        { label: "RBAC (owner / admin / member) enforced server-side", status: "shipped" },
        { label: "Invite by email with role selection", status: "in_build" },
        { label: "Change role (owner can promote/demote)", status: "in_build" },
        { label: "Revoke membership (immediate, audit-logged)", status: "planned" },
        { label: "SSO via OIDC (Okta, Auth0, Azure AD)", status: "planned" },
        { label: "SCIM 2.0 user provisioning", status: "planned" },
        { label: "Audit log of every role change", status: "shipped" },
      ]}
      dataShape={{
        name: "membership (Postgres)",
        rows: [
          { name: "membership.id", type: "uuid" },
          { name: "membership.workspace_id", type: "uuid", note: "FK workspaces" },
          { name: "membership.user_id", type: "uuid", note: "FK users" },
          { name: "membership.role", type: "text", note: "owner | admin | member" },
          { name: "membership.created_at", type: "timestamptz" },
          { name: "membership.revoked_at", type: "timestamptz", note: "nullable; non-null = revoked" },
          { name: "invitation.id", type: "uuid" },
          { name: "invitation.workspace_id", type: "uuid", note: "FK" },
          { name: "invitation.email", type: "text" },
          { name: "invitation.role", type: "text" },
          { name: "invitation.token_hash", type: "text", note: "Argon2id; one-time" },
          { name: "invitation.expires_at", type: "timestamptz", note: "default now() + 7 days" },
        ],
      }}
      preview={{
        kind: "shell",
        lang: "bash",
        body: `# Invite a teammate (until the UI ships).
$ tracebility members invite \\
    --workspace acme \\
    --email alice@acme.com \\
    --role admin

invitation sent to alice@acme.com (expires 2026-06-10)

# Change a role.
$ tracebility members set-role \\
    --workspace acme \\
    --email alice@acme.com \\
    --role owner

role changed: admin → owner (logged to audit_log)

# Revoke (immediate; sessions invalidated).
$ tracebility members revoke \\
    --workspace acme \\
    --email alice@acme.com
`,
      }}
    />
  );
}
