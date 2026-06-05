import Link from "next/link";
import { AuthClient, type OAuthProviders } from "@/components/AuthClient";
import { apiGet } from "@/lib/api";

/**
 * Public signup page.
 *
 * Public OAuth signup is the first-class personal-account path:
 * "Continue with Google" / "Continue with GitHub" auto-provisions
 * an app_user + a personal org/workspace/project so the user lands
 * somewhere usable on the first sign-in. Email+password signup is
 * intentionally not exposed here — that path runs through
 * `/v1/setup` for the operator-bootstrap root account, and is not
 * a self-service surface in v1.
 *
 * Workspace SSO (OIDC) is intentionally a separate path; this page
 * links to /workspace/sso for context but does not handle it.
 */

export const dynamic = "force-dynamic";

export default async function SignupPage({
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
          <h1 style={{ margin: 0, fontSize: 22 }}>Create your account</h1>
          <p
            style={{
              margin: 0,
              fontSize: 13,
              color: "var(--text-2)",
              lineHeight: 1.55,
            }}
          >
            Sign up with Google or GitHub. We&apos;ll auto-provision a
            personal workspace + first project so you can start sending
            traces in minutes. Workspace SSO (corporate IdP) is set up
            later from{" "}
            <Link href="/workspace/sso" style={{ color: "var(--link)" }}>
              workspace settings
            </Link>
            .
          </p>
        </header>
        <AuthClient mode="signup" providers={providers} returnTo={returnTo} />
      </div>
    </main>
  );
}

function sanitizeReturnTo(v: string | null): string | null {
  if (!v) return null;
  if (!v.startsWith("/") || v.startsWith("//")) return null;
  return v;
}
