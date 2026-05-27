import { Shell } from "@/components/Shell";
import { resolveActiveProject } from "@/lib/projects";

/**
 * Stub page for surface areas that have a sidebar entry but no UI yet.
 * Renders the full app chrome + a single card explaining what this view
 * will eventually be — never a 404 just because we haven't shipped it.
 */
export async function ComingSoon({
  title,
  blurb,
}: {
  title: string;
  blurb: string;
}) {
  const { active, all } = await resolveActiveProject();
  return (
    <Shell active={active} projects={all}>
      <div
        style={{
          padding: 24,
          display: "flex",
          flexDirection: "column",
          gap: 20,
          maxWidth: 1400,
        }}
      >
        <header
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: 12,
          }}
        >
          <h1>{title}</h1>
          <span
            className="mono"
            style={{ fontSize: 12, color: "var(--text-3)" }}
          >
            in development
          </span>
        </header>
        <section className="card card-pad-lg">
          <h2 style={{ marginBottom: 8 }}>Coming soon</h2>
          <p
            style={{
              color: "var(--text-2)",
              lineHeight: 1.55,
              margin: 0,
              maxWidth: 640,
            }}
          >
            {blurb}
          </p>
        </section>
      </div>
    </Shell>
  );
}
