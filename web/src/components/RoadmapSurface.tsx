import { Shell } from "@/components/Shell";
import { resolveActiveProject } from "@/lib/projects";

/**
 * Roadmap surface — the proper version of what used to be ComingSoon.
 *
 * Every surface area in the sidebar has a sidebar entry because the locked
 * plan says it ships. Until the data path lands, the page renders the full
 * chrome plus: a hero with build status, the capability list (what the
 * surface will let you do), the data shape (what gets persisted), and a
 * code/API preview so an SDK author can wire the right hooks today.
 *
 * This is not a stub — it's a contract. If the page lies (claims a feature
 * we won't ship), update it on this same page.
 */

export type BuildStatus = "design" | "build" | "alpha";

export interface RoadmapSurfaceProps {
  title: string;
  tagline: string;
  status: BuildStatus;
  shipsIn: string;
  capabilities: { label: string; status: "planned" | "in_build" | "shipped" }[];
  dataShape?: {
    name: string;
    rows: { name: string; type: string; note?: string }[];
  };
  preview?: { kind: "code" | "shell"; lang: string; body: string };
  bridges?: { name: string; status: "planned" | "in_build" | "shipped" }[];
}

export async function RoadmapSurface(props: RoadmapSurfaceProps) {
  const { active, all } = await resolveActiveProject();
  return (
    <Shell active={active} projects={all}>
      <div
        style={{
          padding: 24,
          display: "flex",
          flexDirection: "column",
          gap: 20,
          maxWidth: 1100,
        }}
      >
        <Hero
          title={props.title}
          tagline={props.tagline}
          status={props.status}
          shipsIn={props.shipsIn}
        />
        <Capabilities items={props.capabilities} />
        {props.bridges ? <Bridges items={props.bridges} /> : null}
        {props.dataShape ? <DataShape shape={props.dataShape} /> : null}
        {props.preview ? <Preview preview={props.preview} /> : null}
      </div>
    </Shell>
  );
}

function Hero({
  title,
  tagline,
  status,
  shipsIn,
}: {
  title: string;
  tagline: string;
  status: BuildStatus;
  shipsIn: string;
}) {
  return (
    <header
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 12,
        paddingBottom: 4,
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
        <h1>{title}</h1>
        <StatusPill status={status} />
        <span
          className="mono"
          style={{ fontSize: 12, color: "var(--text-3)" }}
        >
          ships {shipsIn}
        </span>
      </div>
      <p
        style={{
          margin: 0,
          color: "var(--text-2)",
          fontSize: 14,
          lineHeight: 1.55,
          maxWidth: 720,
        }}
      >
        {tagline}
      </p>
    </header>
  );
}

function StatusPill({ status }: { status: BuildStatus }) {
  if (status === "alpha") {
    return (
      <span className="badge badge-info">
        <span className="dot dot-info" aria-hidden />
        alpha
      </span>
    );
  }
  if (status === "build") {
    return (
      <span className="badge badge-warn">
        <span className="dot dot-warn" aria-hidden />
        in build
      </span>
    );
  }
  return (
    <span className="badge badge-neutral">
      <span className="dot" aria-hidden />
      design
    </span>
  );
}

function Capabilities({
  items,
}: {
  items: RoadmapSurfaceProps["capabilities"];
}) {
  return (
    <section className="card" style={{ overflow: "hidden" }}>
      <div className="card-head">
        <h2>What this surface does</h2>
      </div>
      <ul style={{ margin: 0, padding: "8px 0", listStyle: "none" }}>
        {items.map((it) => (
          <li
            key={it.label}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "10px 16px",
              borderBottom: "1px solid var(--border)",
            }}
          >
            <CapStatus status={it.status} />
            <span
              style={{
                color:
                  it.status === "shipped" ? "var(--text)" : "var(--text-2)",
              }}
            >
              {it.label}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function CapStatus({
  status,
}: {
  status: "planned" | "in_build" | "shipped";
}) {
  if (status === "shipped") {
    return (
      <span
        aria-label="shipped"
        style={{
          width: 14,
          height: 14,
          borderRadius: 9999,
          background: "var(--success-soft)",
          color: "var(--success)",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 10,
          fontWeight: 600,
        }}
      >
        ✓
      </span>
    );
  }
  if (status === "in_build") {
    return (
      <span
        aria-label="in build"
        style={{
          width: 14,
          height: 14,
          borderRadius: 9999,
          background: "var(--warn-soft)",
          color: "var(--warn)",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 10,
          fontWeight: 600,
        }}
      >
        …
      </span>
    );
  }
  return (
    <span
      aria-label="planned"
      style={{
        width: 14,
        height: 14,
        borderRadius: 9999,
        background: "var(--surface-3)",
      }}
    />
  );
}

function Bridges({
  items,
}: {
  items: NonNullable<RoadmapSurfaceProps["bridges"]>;
}) {
  return (
    <section className="card" style={{ overflow: "hidden" }}>
      <div className="card-head">
        <h2>SDK bridges</h2>
        <span className="card-sub">drop-in compatibility shims</span>
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
          gap: 0,
        }}
      >
        {items.map((b) => (
          <div
            key={b.name}
            style={{
              padding: "12px 16px",
              borderRight: "1px solid var(--border)",
              borderBottom: "1px solid var(--border)",
              display: "flex",
              alignItems: "center",
              gap: 10,
            }}
          >
            <CapStatus status={b.status} />
            <span
              className="mono"
              style={{ fontSize: 13, color: "var(--text)" }}
            >
              {b.name}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

function DataShape({
  shape,
}: {
  shape: NonNullable<RoadmapSurfaceProps["dataShape"]>;
}) {
  return (
    <section className="card" style={{ overflow: "hidden" }}>
      <div className="card-head">
        <h2>Data shape</h2>
        <span className="card-sub mono">{shape.name}</span>
      </div>
      <table className="table">
        <thead>
          <tr>
            <th>Field</th>
            <th>Type</th>
            <th>Note</th>
          </tr>
        </thead>
        <tbody>
          {shape.rows.map((r) => (
            <tr key={r.name}>
              <td className="mono">{r.name}</td>
              <td className="mono" style={{ color: "var(--text-2)" }}>
                {r.type}
              </td>
              <td style={{ color: "var(--text-3)" }}>{r.note ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function Preview({
  preview,
}: {
  preview: NonNullable<RoadmapSurfaceProps["preview"]>;
}) {
  return (
    <section className="card" style={{ overflow: "hidden" }}>
      <div className="card-head">
        <h2>Preview</h2>
        <span className="card-sub mono">{preview.lang}</span>
      </div>
      <pre style={{ margin: 0, borderRadius: 0, border: 0 }}>
        {preview.body}
      </pre>
    </section>
  );
}
