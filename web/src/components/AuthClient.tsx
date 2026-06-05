"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

/**
 * Unified sign-in / sign-up form.
 *
 * Tab-toggled (Sign in | Create account); both tabs share the same
 * OAuth buttons and the same email+password form. The tab only
 * controls (a) which tab visually looks active, (b) which OAuth
 * `intent=` is sent to the api so first-time vs returning is
 * audited correctly, and (c) which submit copy ("Sign in" vs
 * "Create account") on the password form.
 *
 * Email+password is wired to /api/auth/login for both tabs because
 * v1 doesn't expose a self-service password-signup endpoint
 * (operators bootstrap via /v1/setup; everyone else uses OAuth).
 * Showing the password form on signup is a vestige worth keeping
 * for the operator who wants to test their root account from /signup.
 *
 * `LAST USED` badge: records the last-clicked OAuth provider in
 * localStorage so returning users see at a glance which one to
 * pick. Pure UX nicety, no privacy concern (no email, no token).
 */

export interface OAuthProviders {
  google: boolean;
  github: boolean;
}

type Tab = "login" | "signup";
const LAST_USED_KEY = "tracebility:auth:last-provider";

export function AuthClient({
  initialTab,
  providers,
  returnTo,
}: {
  initialTab: Tab;
  providers: OAuthProviders;
  returnTo: string | null;
}) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const anyOAuth = providers.google || providers.github;

  return (
    <div style={{ display: "grid", gap: 20, width: "100%" }}>
      <TabSwitch tab={tab} setTab={setTab} />

      {anyOAuth ? (
        <OAuthButtons tab={tab} providers={providers} returnTo={returnTo} />
      ) : null}

      {anyOAuth ? <Divider label="or continue with email" /> : null}

      <PasswordForm tab={tab} />

      <p
        style={{
          fontSize: 11,
          color: "var(--text-3)",
          margin: 0,
          lineHeight: 1.55,
        }}
      >
        By continuing, you agree to the{" "}
        <a href="/terms" style={{ color: "var(--link)" }}>
          terms of service
        </a>{" "}
        and{" "}
        <a href="/privacy" style={{ color: "var(--link)" }}>
          privacy policy
        </a>
        .
      </p>

      {!anyOAuth ? (
        <p
          className="mono"
          style={{
            margin: 0,
            fontSize: 11,
            color: "var(--text-3)",
            lineHeight: 1.55,
          }}
        >
          OAuth providers are not configured for this deployment. The
          operator can enable them by setting{" "}
          <code>OAUTH_GOOGLE_CLIENT_ID</code> /{" "}
          <code>OAUTH_GITHUB_CLIENT_ID</code> on the api service.
        </p>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab switcher
// ---------------------------------------------------------------------------

function TabSwitch({ tab, setTab }: { tab: Tab; setTab: (t: Tab) => void }) {
  // Sign in first, Create account second. Returning users are the
  // larger cohort and Sign in is the default landing tab; ordering
  // it first matches user fluency from peer products (Linear, Vercel,
  // Datadog) and reduces the friction of a tab swap on every visit.
  return (
    <div
      role="tablist"
      style={{
        display: "inline-flex",
        gap: 20,
        fontSize: 18,
        fontWeight: 500,
        letterSpacing: -0.01,
      }}
    >
      <TabButton active={tab === "login"} onClick={() => setTab("login")}>
        Sign in
      </TabButton>
      <TabButton active={tab === "signup"} onClick={() => setTab("signup")}>
        Create account
      </TabButton>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      style={{
        background: "none",
        border: "none",
        padding: "0 0 4px",
        cursor: "pointer",
        color: active ? "var(--text)" : "var(--text-3)",
        borderBottom: active
          ? "2px solid var(--accent)"
          : "2px solid transparent",
        fontSize: "inherit",
        fontWeight: "inherit",
        letterSpacing: "inherit",
        transition: "color 120ms",
      }}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// OAuth buttons
// ---------------------------------------------------------------------------

function OAuthButtons({
  tab,
  providers,
  returnTo,
}: {
  tab: Tab;
  providers: OAuthProviders;
  returnTo: string | null;
}) {
  const [lastUsed, setLastUsed] = useState<string | null>(null);
  useEffect(() => {
    try {
      setLastUsed(window.localStorage.getItem(LAST_USED_KEY));
    } catch {
      // localStorage unavailable (SSR / private mode); harmless
    }
  }, []);

  const params = new URLSearchParams({ intent: tab });
  if (returnTo) params.set("return_to", returnTo);
  // Always same-origin. The route handler at /api/auth/oauth/<provider>/start
  // 302s to the api's /v1/auth/oauth/<provider>/start, which 302s to the
  // IdP. This avoids depending on NEXT_PUBLIC_API_BASE being baked into
  // the client bundle at build time.
  const startUrl = (provider: string): string =>
    `/api/auth/oauth/${provider}/start?${params.toString()}`;

  function recordUsed(provider: string) {
    try {
      window.localStorage.setItem(LAST_USED_KEY, provider);
    } catch {
      // ignore
    }
  }

  const buttons: Array<{
    key: string;
    label: string;
    icon: React.ReactNode;
  }> = [];
  if (providers.google) {
    buttons.push({ key: "google", label: "Google", icon: <GoogleMark /> });
  }
  if (providers.github) {
    buttons.push({ key: "github", label: "GitHub", icon: <GithubMark /> });
  }

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${buttons.length}, minmax(0, 1fr))`,
        gap: 8,
      }}
    >
      {buttons.map((b) => (
        <a
          key={b.key}
          href={startUrl(b.key)}
          onClick={() => recordUsed(b.key)}
          className="btn"
          style={{
            position: "relative",
            justifyContent: "center",
            gap: 8,
            padding: "10px 12px",
            fontSize: 13,
          }}
        >
          {b.icon}
          {b.label}
          {lastUsed === b.key ? <LastUsedBadge /> : null}
        </a>
      ))}
    </div>
  );
}

function LastUsedBadge() {
  return (
    <span
      style={{
        position: "absolute",
        top: -8,
        right: -8,
        background: "var(--accent)",
        color: "var(--accent-fg)",
        fontSize: 9,
        fontWeight: 600,
        letterSpacing: 0.6,
        textTransform: "uppercase",
        padding: "2px 6px",
        borderRadius: "var(--r-1)",
        lineHeight: 1.2,
        pointerEvents: "none",
      }}
    >
      last used
    </span>
  );
}

// ---------------------------------------------------------------------------
// Password form
// ---------------------------------------------------------------------------

function PasswordForm({ tab }: { tab: Tab }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!email || !password) {
      setError("email and password are required");
      return;
    }
    startTransition(async () => {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        let detail = `request failed (${res.status})`;
        try {
          const body = (await res.json()) as { detail?: string };
          if (body.detail) detail = body.detail;
        } catch {
          // ignore
        }
        // Slightly nudge the message on signup tab so users know
        // password signup isn't self-service today.
        if (tab === "signup" && res.status === 401) {
          detail =
            "No account found. Use Google or GitHub to sign up. Password signup is operator-only in v1.";
        }
        setError(detail);
        return;
      }
      router.push("/");
      router.refresh();
    });
  }

  // The `aria-invalid` flag flips the input border red on submit
  // failure. We set it on both inputs when there's an error since
  // we don't currently know which one caused it; once the api
  // surfaces a `field` discriminator we can target precisely.
  const invalid = error !== null;

  return (
    <form onSubmit={submit} style={{ display: "grid", gap: 14 }}>
      <label className="field">
        <span className="field-label">Email</span>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          placeholder="you@example.com"
          aria-invalid={invalid}
          required
        />
      </label>
      <label className="field">
        <span className="field-label">
          Password
          {tab === "login" ? (
            <a
              href="/forgot"
              style={{
                marginLeft: "auto",
                fontSize: 11,
                color: "var(--text-3)",
                textDecoration: "none",
              }}
              onClick={(e) => {
                e.preventDefault();
                /* TODO: password-reset flow on roadmap */
              }}
            >
              forgot?
            </a>
          ) : null}
        </span>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete={
            tab === "signup" ? "new-password" : "current-password"
          }
          placeholder="••••••••"
          aria-invalid={invalid}
          required
        />
      </label>
      {error ? (
        <p className="field-error" role="alert" style={{ margin: 0 }}>
          {error}
        </p>
      ) : null}
      <button
        type="submit"
        className="btn btn-primary"
        disabled={pending}
        style={{ justifyContent: "center", padding: "10px 16px" }}
      >
        {pending
          ? tab === "signup"
            ? "Creating account…"
            : "Signing in…"
          : tab === "signup"
            ? "Create account"
            : "Sign in"}
      </button>
    </form>
  );
}

function Divider({ label }: { label: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        color: "var(--text-3)",
        fontSize: 11,
        letterSpacing: 0.4,
      }}
    >
      <span style={{ flex: 1, height: 1, background: "var(--border)" }} />
      <span>{label}</span>
      <span style={{ flex: 1, height: 1, background: "var(--border)" }} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Provider marks
// ---------------------------------------------------------------------------

function GoogleMark() {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden>
      <path
        fill="#FFC107"
        d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.5-5.9 7.5-11.3 7.5-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.7 1.1 7.8 3l5.7-5.7C34.2 5.5 29.4 3.5 24 3.5 12.7 3.5 3.5 12.7 3.5 24S12.7 44.5 24 44.5 44.5 35.3 44.5 24c0-1.2-.1-2.3-.3-3.5z"
      />
      <path
        fill="#FF3D00"
        d="M6.3 14.7l6.6 4.8C14.7 15 19 12 24 12c3 0 5.7 1.1 7.8 3l5.7-5.7C34.2 5.5 29.4 3.5 24 3.5 16.3 3.5 9.7 7.7 6.3 14.7z"
      />
      <path
        fill="#4CAF50"
        d="M24 44.5c5.3 0 10.1-2 13.8-5.4l-6.4-5.2c-2 1.4-4.6 2.2-7.4 2.2-5.4 0-9.6-3-11.3-7.5l-6.6 5.1C9.7 40.3 16.4 44.5 24 44.5z"
      />
      <path
        fill="#1976D2"
        d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.3 4.1-4.3 5.4l6.4 5.2c4.5-4.1 7.1-10.1 7.1-17.1 0-1.2-.1-2.3-.3-3.5z"
      />
    </svg>
  );
}

function GithubMark() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
      <path
        fill="currentColor"
        d="M8 0C3.6 0 0 3.6 0 8c0 3.5 2.3 6.5 5.5 7.6.4.1.5-.2.5-.4v-1.4c-2.2.5-2.7-1-2.7-1-.4-.9-.9-1.2-.9-1.2-.7-.5.1-.5.1-.5.8.1 1.2.8 1.2.8.7 1.2 1.9.9 2.4.7.1-.5.3-.9.5-1.1-1.8-.2-3.6-.9-3.6-4 0-.9.3-1.6.8-2.1-.1-.2-.4-1 .1-2.1 0 0 .7-.2 2.2.8.6-.2 1.3-.3 2-.3s1.4.1 2 .3c1.5-1 2.2-.8 2.2-.8.4 1.1.2 1.9.1 2.1.5.6.8 1.3.8 2.1 0 3.1-1.9 3.7-3.6 3.9.3.3.5.8.5 1.5v2.2c0 .2.1.5.5.4C13.7 14.5 16 11.5 16 8c0-4.4-3.6-8-8-8z"
      />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Logout
// ---------------------------------------------------------------------------

export function LogoutLink() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      className="btn btn-ghost"
      style={{ fontSize: 12 }}
      disabled={pending}
      onClick={() => {
        startTransition(async () => {
          await fetch("/api/auth/logout", { method: "POST" });
          router.push("/login");
          router.refresh();
        });
      }}
    >
      {pending ? "signing out…" : "sign out"}
    </button>
  );
}
