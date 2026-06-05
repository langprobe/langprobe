import Link from "next/link";
import { AuthClient, type OAuthProviders } from "@/components/AuthClient";
import { apiGet } from "@/lib/api";

/**
 * Unified sign-in / sign-up page.
 *
 * Two-column layout:
 *   left  — product positioning (brand mark + tagline)
 *   right — auth card with tab toggle, OAuth buttons, password form
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
// Left rail — product positioning
// ---------------------------------------------------------------------------

function LeftRail() {
  return (
    <aside
      style={{
        display: "none",
        position: "relative",
        background: "var(--surface-2)",
        borderRight: "1px solid var(--border)",
      }}
      // Hide on small screens — the auth card takes the full width.
      // Tailwind would be `hidden lg:flex`; here we do it via media
      // query on the data-attr.
      data-rail
    >
      <style>{`
        @media (min-width: 960px) {
          aside[data-rail] { display: flex !important; }
        }
      `}</style>
      <div
        style={{
          padding: "56px 64px",
          display: "flex",
          flexDirection: "column",
          gap: 48,
          width: "100%",
          maxWidth: 560,
          margin: "0 auto",
          position: "relative",
        }}
      >
        <BrandMark />
        <Headline />
        <FeatureList />
        <Footnote />
      </div>
    </aside>
  );
}

function BrandMark() {
  return (
    <Link
      href="/"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 10,
        textDecoration: "none",
        color: "var(--text)",
      }}
      aria-label="tracebility home"
    >
      <span
        aria-hidden
        style={{
          width: 28,
          height: 28,
          borderRadius: "var(--r-1)",
          background: "var(--accent)",
          color: "var(--accent-fg)",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "var(--f-mono)",
          fontSize: 15,
          fontWeight: 600,
        }}
      >
        t
      </span>
      <span
        style={{
          fontSize: 14,
          fontWeight: 500,
          letterSpacing: -0.01,
        }}
      >
        tracebility
      </span>
    </Link>
  );
}

function Headline() {
  return (
    <div style={{ display: "grid", gap: 12 }}>
      <h1
        style={{
          margin: 0,
          fontSize: 40,
          lineHeight: 1.1,
          fontWeight: 500,
          letterSpacing: -0.02,
          color: "var(--text)",
        }}
      >
        The real debugger
        <br />
        for agents.
      </h1>
      <p
        style={{
          margin: 0,
          fontSize: 15,
          lineHeight: 1.55,
          color: "var(--text-2)",
          maxWidth: 440,
        }}
      >
        Self-hosted observability, eval-rigor, and agent-replay. The one
        you reach for at 2 a.m. when an agent goes sideways.
      </p>
    </div>
  );
}

function FeatureList() {
  const items = [
    {
      title: "Trace every run",
      desc: "Spans, prompts, completions, tools — written to your ClickHouse, not ours.",
    },
    {
      title: "Replay & branch",
      desc: "Re-execute any past run with edits applied. Compare the new trace against the old.",
    },
    {
      title: "Eval with rigor",
      desc: "Built-in judges, LLM-as-judge, PoLL multi-judge, A/B comparisons, human review queues.",
    },
  ];
  return (
    <ul
      style={{
        listStyle: "none",
        margin: 0,
        padding: 0,
        display: "grid",
        gap: 18,
      }}
    >
      {items.map((item) => (
        <li
          key={item.title}
          style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: 12 }}
        >
          <span
            aria-hidden
            style={{
              width: 6,
              height: 6,
              borderRadius: 9999,
              background: "var(--accent)",
              marginTop: 8,
            }}
          />
          <div>
            <div
              style={{
                fontSize: 14,
                fontWeight: 500,
                color: "var(--text)",
                marginBottom: 2,
              }}
            >
              {item.title}
            </div>
            <div
              style={{
                fontSize: 13,
                color: "var(--text-2)",
                lineHeight: 1.55,
              }}
            >
              {item.desc}
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

function Footnote() {
  return (
    <div
      style={{
        marginTop: "auto",
        display: "flex",
        gap: 16,
        fontSize: 11,
        color: "var(--text-3)",
        letterSpacing: 0.4,
        textTransform: "uppercase",
      }}
    >
      <span>self-hosted</span>
      <span aria-hidden>·</span>
      <span>apache-2.0</span>
      <span aria-hidden>·</span>
      <span>your data, your vpc</span>
    </div>
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
        alignItems: "center",
        justifyContent: "center",
        padding: "48px 24px",
      }}
    >
      <div
        className="card card-pad-lg"
        style={{
          width: "100%",
          maxWidth: 420,
          display: "grid",
          gap: 24,
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

function sanitizeReturnTo(v: string | null): string | null {
  if (!v) return null;
  if (!v.startsWith("/") || v.startsWith("//")) return null;
  return v;
}
