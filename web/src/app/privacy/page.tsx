import Link from "next/link";

/**
 * Privacy.
 *
 * V1: an honest, short doc that explains what data tracebility holds
 * and how OAuth signup uses third-party identity. When the SaaS gate
 * ships, this gets a counsel-reviewed customer-facing privacy policy
 * with data-residency, retention, and processor-list sections.
 */

export const metadata = { title: "Privacy · tracebility" };

export default function PrivacyPage() {
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
          Privacy
        </h1>

        <Section title="Self-hosted (default)">
          When you run tracebility yourself, your data stays on your
          infrastructure. The product does not phone home, does not
          ship telemetry, and does not relay traces to any tracebility
          server. Your ClickHouse, your Postgres, your retention.
        </Section>

        <Section title="OAuth sign-in">
          If your operator has configured Google or GitHub OAuth, signing
          in sends a redirect to that provider so they can authenticate
          you. Tracebility receives only your verified email, your name
          (if you share it), and a stable identifier. Nothing else is
          shared with the OAuth provider beyond what they already know
          about you. We do not store your provider password or token
          beyond the one-time exchange.
        </Section>

        <Section title="Hosted service">
          The hosted (SaaS) instance is on the roadmap. When it ships,
          this page will document data residency, retention, processor
          list, and DPA terms for hosted customers. Until then, all
          tracebility deployments are operator-run and operator-owned.
        </Section>

        <Section title="LLM credentials">
          Anthropic / OpenAI keys you save under workspace settings are
          stored hashed; the plaintext is shown once on creation and
          never again. Rotation is revoke-and-create, not edit-in-place.
        </Section>

        <Section title="Contact">
          Questions or requests: file an issue at{" "}
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
