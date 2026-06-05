import Link from "next/link";
import { AuthClient, type OAuthProviders } from "@/components/AuthClient";
import { LoginScene } from "@/components/LoginScene";
import { apiGet } from "@/lib/api";

/**
 * Unified sign-in / sign-up page.
 *
 * Two-column layout:
 *   left  — animated "data converging on one entity" hero scene
 *   right — auth card with tab toggle, OAuth buttons, password form
 *
 * The left rail is the only place in the app that goes dark. The
 * scene visualises what tracebility actually does: traces, otel
 * envelopes, replays, evals, and feedback all flow into a single
 * observability surface (the central brand mark). The animated
 * pulse-beams literally illustrate the product's value pitch.
 *
 * `?tab=signup` defaults to the Sign up tab; otherwise lands on Sign in.
 * `?return_to=/some/path` is preserved through the OAuth round-trip.
 *
 * Workspace SSO (per-workspace OIDC) lives at /workspace/sso and is a
 * different surface — it requires a workspace slug and is for corporate
 * IdPs your workspace admin configured.
 */

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams?: { tab?: string; return_to?: string };
}) {
  const providersRes = await apiGet<OAuthProviders>("/v1/auth/oauth/providers");
  const providers: OAuthProviders = providersRes.data ?? {
    google: false,
    github: false,
  };
  const initialTab =
    searchParams?.tab === "signup" ? "signup" : "login";
  const returnTo = sanitizeReturnTo(searchParams?.return_to ?? null);

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
        background: "var(--bg)",
      }}
    >
      <LeftRail />
      <RightRail providers={providers} initialTab={initialTab} returnTo={returnTo} />
    </main>
  );
}

// ---------------------------------------------------------------------------
// Left rail — pulse-beams hero scene
// ---------------------------------------------------------------------------

function LeftRail() {
  return (
    <aside
      style={{
        display: "none",
        position: "relative",
        background: "var(--accent)",
        overflow: "hidden",
      }}
      // Hide on small screens — the auth card takes the full width.
      data-rail
    >
      <style>{`
        @media (min-width: 960px) {
          aside[data-rail] { display: block !important; }
        }
      `}</style>

      {/* The hero scene fills the rail; the eyebrow + footer overlay on
          top so the imagery feels framed by the chrome rather than
          floating in a void. */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <LoginScene />
      </div>

      {/* Bottom-left footer — posture-neutral so the same chrome reads
       * credibly under both deploy postures (self-hosted today,
       * SaaS roadmap per PRODUCT.md). The hero scene already
       * communicates "debugger for agents" via the labelled signal
       * sources, so we don't repeat that message in microcopy. */}
      <div
        className="stage-item"
        style={{
          position: "absolute",
          bottom: 32,
          left: 32,
          right: 32,
          display: "flex",
          gap: 16,
          fontFamily: "var(--f-mono)",
          fontSize: 11,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: "rgba(255, 255, 255, 0.42)",
          zIndex: 3,
          animationDelay: "700ms",
        }}
      >
        <span>open source</span>
        <span aria-hidden>·</span>
        <span>apache-2.0</span>
        <span aria-hidden>·</span>
        <span>your data, your call</span>
      </div>
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Right rail — auth card
// ---------------------------------------------------------------------------

function RightRail({
  providers,
  initialTab,
  returnTo,
}: {
  providers: OAuthProviders;
  initialTab: "login" | "signup";
  returnTo: string | null;
}) {
  return (
    <section
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "48px 24px",
        gap: 24,
        position: "relative",
      }}
    >
      {/* Mobile-only headline. Under 960px the dark hero is hidden,
       * so without this the auth card lands with no product context.
       * Visible only when the dark rail isn't. */}
      <MobileBrandHeader />

      <div
        className="card card-pad-lg stage-item"
        style={{
          width: "100%",
          maxWidth: 460,
          display: "grid",
          gap: 24,
          animationDelay: "300ms",
        }}
      >
        <AuthClient
          initialTab={initialTab}
          providers={providers}
          returnTo={returnTo}
        />
      </div>
    </section>
  );
}

function MobileBrandHeader() {
  return (
    <Link
      href="/"
      aria-label="tracebility home"
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 8,
        textDecoration: "none",
        color: "var(--text)",
        textAlign: "center",
      }}
      data-mobile-brand
    >
      <style>{`
        @media (min-width: 960px) {
          a[data-mobile-brand] { display: none !important; }
        }
      `}</style>
      <span
        aria-hidden
        style={{
          width: 36,
          height: 36,
          borderRadius: "var(--r-2)",
          background: "var(--accent)",
          color: "var(--accent-fg)",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "var(--f-mono)",
          fontSize: 18,
          fontWeight: 600,
          boxShadow: "inset 0 1px 0 rgba(255,255,255,0.08), var(--shadow-1)",
        }}
      >
        t
      </span>
      <div
        style={{
          fontSize: 22,
          fontWeight: 500,
          letterSpacing: "-0.022em",
          marginTop: 4,
        }}
      >
        tracebility
      </div>
      <div
        style={{
          fontSize: 13,
          color: "var(--text-2)",
          maxWidth: 320,
          lineHeight: 1.5,
        }}
      >
        The real debugger for agents.
      </div>
    </Link>
  );
}

function sanitizeReturnTo(v: string | null): string | null {
  if (!v) return null;
  if (!v.startsWith("/") || v.startsWith("//")) return null;
  return v;
}
