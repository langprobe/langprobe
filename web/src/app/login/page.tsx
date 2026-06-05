import Link from "next/link";
import { AuthClient, type OAuthProviders } from "@/components/AuthClient";
import { apiGet } from "@/lib/api";

/**
 * Public sign-in page.
 *
 * Three sign-in paths land here:
 *   1) Email + password (the original setup-wizard root account, or
 *      anyone who arrived via password — currently only the wizard).
 *   2) Continue with Google / GitHub (public OAuth signup; anyone
 *      can self-onboard if the operator has set OAUTH_*_CLIENT_ID
 *      env vars on the api service).
 *   3) Workspace SSO (per-workspace OIDC): the link points to
 *      /workspace/sso for context, but actual SSO sign-in is
 *      `/v1/auth/sso/<slug>/start` and lives outside this page since
 *      it requires a workspace slug.
 *
 * Server component: hits the api once for which OAuth providers are
 * configured, so the buttons render only when actually wired up.
 * Forwards `?return_to=` through to the OAuth start URL so a deep
 * link that bounced through /login lands the user back where they
 * were going.
 */

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams?: { return_to?: string };
}) {
  const providersRes = await apiGet<OAuthProviders>("/v1/auth/oauth/providers");
  const providers: OAuthProviders = providersRes.data ?? {
    google: false,
    github: false,
  };
  const returnTo = sanitizeReturnTo(searchParams?.return_to ?? null);

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <div
        className="card card-pad-lg"
        style={{ width: "100%", maxWidth: 420, display: "grid", gap: 16 }}
      >
        <header style={{ display: "grid", gap: 4 }}>
          <Link
            href="/"
            className="mono"
            style={{
              fontSize: 11,
              color: "var(--text-3)",
              textDecoration: "none",
              letterSpacing: 0.4,
              textTransform: "uppercase",
            }}
          >
            tracebility
          </Link>
          <h1 style={{ margin: 0, fontSize: 22 }}>Sign in</h1>
          <p
            style={{
              margin: 0,
              fontSize: 13,
              color: "var(--text-2)",
              lineHeight: 1.55,
            }}
          >
            Use Google or GitHub for personal accounts. Corporate users
            with workspace SSO configured can sign in via their IdP at
            their workspace's <Link href="/workspace/sso" style={{ color: "var(--link)" }}>SSO page</Link>.
          </p>
        </header>
        <AuthClient mode="login" providers={providers} returnTo={returnTo} />
      </div>
    </main>
  );
}

function sanitizeReturnTo(v: string | null): string | null {
  if (!v) return null;
  if (!v.startsWith("/") || v.startsWith("//")) return null;
  return v;
}
