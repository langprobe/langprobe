"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

/**
 * /login + /signup form.
 *
 * One component for both because the inputs are identical; the
 * difference is which submit endpoint we hit and which OAuth intent
 * we pass. Email+password posts to /api/auth/login (the only
 * password-auth surface today — signup with password is not exposed
 * yet because /v1/setup is the operator-bootstrap path; OAuth is
 * the public signup path). When `mode='signup'` the email+password
 * card is hidden and the OAuth buttons are the primary action.
 *
 * SSO (per-workspace OIDC) lives at /workspace/sso and is a
 * different surface — that's for a corporate IdP your workspace
 * admin configures. The OAuth buttons here are the personal-account
 * path.
 */

export interface OAuthProviders {
  google: boolean;
  github: boolean;
}

export function AuthClient({
  mode,
  providers,
  returnTo,
}: {
  mode: "login" | "signup";
  providers: OAuthProviders;
  returnTo: string | null;
}) {
  const isSignup = mode === "signup";
  const showPassword = !isSignup;
  const anyOAuth = providers.google || providers.github;

  return (
    <div
      style={{
        display: "grid",
        gap: 16,
        maxWidth: 380,
        width: "100%",
      }}
    >
      {anyOAuth ? (
        <OAuthButtons mode={mode} providers={providers} returnTo={returnTo} />
      ) : null}

      {anyOAuth && showPassword ? <Divider label="or" /> : null}

      {showPassword ? <PasswordForm /> : null}

      {isSignup ? (
        <p style={{ fontSize: 12, color: "var(--text-3)", margin: 0 }}>
          Already have an account?{" "}
          <a href="/login" style={{ color: "var(--link)" }}>
            Sign in
          </a>
          .
        </p>
      ) : (
        <p style={{ fontSize: 12, color: "var(--text-3)", margin: 0 }}>
          New here?{" "}
          <a href="/signup" style={{ color: "var(--link)" }}>
            Create an account
          </a>
          .
        </p>
      )}

      {!anyOAuth && !showPassword ? (
        <div className="card card-pad-lg" style={{ marginTop: 8 }}>
          <p
            style={{
              margin: 0,
              fontSize: 13,
              color: "var(--text-2)",
              lineHeight: 1.55,
            }}
          >
            No public sign-in providers are configured for this deployment.
            The operator can enable Google and/or GitHub by setting{" "}
            <code className="mono">OAUTH_GOOGLE_CLIENT_ID</code> /{" "}
            <code className="mono">OAUTH_GITHUB_CLIENT_ID</code> on the api
            service. Existing accounts can still sign in at{" "}
            <a href="/login" style={{ color: "var(--link)" }}>
              /login
            </a>
            , and corporate users can use workspace SSO once their admin
            configures it.
          </p>
        </div>
      ) : null}
    </div>
  );
}

function OAuthButtons({
  mode,
  providers,
  returnTo,
}: {
  mode: "login" | "signup";
  providers: OAuthProviders;
  returnTo: string | null;
}) {
  const intent = mode;
  const params = new URLSearchParams({ intent });
  if (returnTo) params.set("return_to", returnTo);
  const apiBase = process.env.NEXT_PUBLIC_API_BASE || "";
  // The /start endpoint issues a 302 to the IdP, so we need a
  // top-level navigation. Falling back to a same-origin /v1/...
  // path means we'd need a Next.js proxy that emits a 302 — easier
  // and more correct to just navigate to the api directly when
  // NEXT_PUBLIC_API_BASE is set, otherwise rely on the api being
  // on the same host (single-port self-host).
  const startUrl = (provider: string): string => {
    const path = `/v1/auth/oauth/${provider}/start?${params.toString()}`;
    return apiBase ? `${apiBase}${path}` : path;
  };
  return (
    <div style={{ display: "grid", gap: 8 }}>
      {providers.google ? (
        <a
          href={startUrl("google")}
          className="btn"
          style={{
            justifyContent: "center",
            gap: 8,
            padding: "10px 16px",
            fontSize: 13,
          }}
        >
          <GoogleMark />
          Continue with Google
        </a>
      ) : null}
      {providers.github ? (
        <a
          href={startUrl("github")}
          className="btn"
          style={{
            justifyContent: "center",
            gap: 8,
            padding: "10px 16px",
            fontSize: 13,
          }}
        >
          <GithubMark />
          Continue with GitHub
        </a>
      ) : null}
    </div>
  );
}

function PasswordForm() {
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
          // ignore — keep generic message
        }
        setError(detail);
        return;
      }
      router.push("/");
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} style={{ display: "grid", gap: 8 }}>
      <Field label="Email">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          placeholder="you@example.com"
          required
        />
      </Field>
      <Field label="Password">
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          placeholder="••••••••"
          required
        />
      </Field>
      {error ? (
        <p
          className="mono"
          style={{ color: "var(--danger)", margin: 0, fontSize: 12 }}
        >
          {error}
        </p>
      ) : null}
      <button
        type="submit"
        className="btn btn-primary"
        disabled={pending}
        style={{ justifyContent: "center", padding: "10px 16px" }}
      >
        {pending ? "signing in…" : "Sign in"}
      </button>
    </form>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label style={{ display: "grid", gap: 4 }}>
      <span
        style={{
          fontSize: 11,
          color: "var(--text-3)",
          textTransform: "uppercase",
          letterSpacing: 0.4,
        }}
      >
        {label}
      </span>
      {children}
    </label>
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
        textTransform: "uppercase",
        letterSpacing: 0.4,
        margin: "4px 0",
      }}
    >
      <span style={{ flex: 1, height: 1, background: "var(--border)" }} />
      <span>{label}</span>
      <span style={{ flex: 1, height: 1, background: "var(--border)" }} />
    </div>
  );
}

function GoogleMark() {
  // Use the official 4-color G; rendered inline as svg so it
  // doesn't pull in an icon dep. Sized to match Lucide icons (16px).
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
