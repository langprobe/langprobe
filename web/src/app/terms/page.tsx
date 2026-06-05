import Link from "next/link";

/**
 * Terms of service.
 *
 * V1: a short, plainspoken doc that links to the Apache-2.0 LICENSE
 * for the open-source side and explains the SaaS posture is roadmap.
 * When the SaaS gate ships, this page gets replaced with a real
 * customer-facing TOS reviewed by counsel.
 */

export const metadata = { title: "Terms of service · tracebility" };

export default function TermsPage() {
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        justifyContent: "center",
        padding: "64px 24px",
        background: "var(--bg)",
      }}
    >
      <article
        style={{
          width: "100%",
          maxWidth: 720,
          color: "var(--text)",
          lineHeight: 1.6,
        }}
      >
        <p
          className="mono"
          style={{
            fontSize: 11,
            color: "var(--text-3)",
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            margin: 0,
          }}
        >
          Tracebility
        </p>
        <h1
          className="display-sm"
          style={{ marginTop: 8, marginBottom: 24 }}
        >
          Terms of service
        </h1>

        <Section title="What you can do with the software">
          Tracebility is open source under the{" "}
          <a
            href="https://github.com/tracebility-ai/tracebility/blob/main/LICENSE"
            style={{ color: "var(--link)" }}
          >
            Apache License, Version 2.0
          </a>
          . You can run it, modify it, and redistribute it under the terms
          of that license. Self-hosted operators are bound by the LICENSE
          and nothing else.
        </Section>

        <Section title="Hosted service">
          The hosted (SaaS) tracebility instance is on the roadmap and
          not yet generally available. When it ships, this page will be
          replaced with a service agreement covering account creation,
          billing, data retention, support, and uptime commitments.
        </Section>

        <Section title="What we do not promise">
          The software is provided AS IS, without warranty of any kind.
          You are responsible for the data you send through it, the
          third-party LLM calls you make from your workspace, and the
          access controls you set up for your team.
        </Section>

        <Section title="Contact">
          Questions: file an issue at{" "}
          <a
            href="https://github.com/tracebility-ai/tracebility/issues"
            style={{ color: "var(--link)" }}
          >
            github.com/tracebility-ai/tracebility
          </a>
          .
        </Section>

        <p style={{ marginTop: 48, fontSize: 12, color: "var(--text-3)" }}>
          <Link href="/login" style={{ color: "var(--link)" }}>
            ← Back to sign in
          </Link>
        </p>
      </article>
    </main>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section style={{ marginBottom: 28 }}>
      <h2 style={{ marginBottom: 8 }}>{title}</h2>
      <p style={{ margin: 0, color: "var(--text-2)" }}>{children}</p>
    </section>
  );
}
