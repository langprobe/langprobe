/**
 * Three-pane debugger shell (DESIGN.md:102):
 *   nav (240px) | main | inspector (360px)
 * 1px --rule dividers, no shadows. Skeletons are flat, not shimmer.
 *
 * Sample data is stubbed inline so the dashboard renders before the
 * api/ClickHouse plumbing lands. Replace these with /v1/runs queries
 * once the read-side service exists (Phase 11+).
 */

import {
  Activity,
  CircleDot,
  Database,
  FlaskConical,
  Home,
  KeyRound,
  Library,
  Settings,
} from "lucide-react";
import type { ReactNode } from "react";

const NAV: { label: string; icon: ReactNode }[] = [
  { label: "Overview", icon: <Home size={16} strokeWidth={1.5} /> },
  { label: "Traces", icon: <Activity size={16} strokeWidth={1.5} /> },
  { label: "Replay", icon: <CircleDot size={16} strokeWidth={1.5} /> },
  { label: "Evals", icon: <FlaskConical size={16} strokeWidth={1.5} /> },
  { label: "Datasets", icon: <Database size={16} strokeWidth={1.5} /> },
  { label: "Prompts", icon: <Library size={16} strokeWidth={1.5} /> },
  { label: "API keys", icon: <KeyRound size={16} strokeWidth={1.5} /> },
  { label: "Settings", icon: <Settings size={16} strokeWidth={1.5} /> },
];

export function Shell({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "var(--pane-nav) 1fr var(--pane-inspector)",
        height: "100vh",
        background: "var(--bg)",
      }}
    >
      <NavPane />
      <main
        style={{
          overflow: "auto",
          borderLeft: "1px solid var(--rule)",
          borderRight: "1px solid var(--rule)",
        }}
      >
        {children}
      </main>
      <InspectorPane />
    </div>
  );
}

function NavPane() {
  return (
    <aside
      style={{
        display: "flex",
        flexDirection: "column",
        padding: "12px 8px",
        gap: 2,
      }}
    >
      <div
        style={{
          padding: "4px 8px 14px",
          fontSize: 13,
          letterSpacing: "-0.005em",
        }}
      >
        <span style={{ color: "var(--accent)" }}>tracebility</span>
        <span style={{ color: "var(--text-muted)", marginLeft: 6 }}>
          / acme
        </span>
      </div>
      {NAV.map((item, i) => (
        <button
          key={item.label}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            border: 0,
            borderRadius: 4,
            padding: "0 8px",
            height: "var(--row-h)",
            color: i === 0 ? "var(--text)" : "var(--text-muted)",
            background: i === 0 ? "var(--accent-soft)" : "transparent",
            justifyContent: "flex-start",
            textAlign: "left",
          }}
        >
          {item.icon}
          <span>{item.label}</span>
        </button>
      ))}
    </aside>
  );
}

function InspectorPane() {
  return (
    <aside
      style={{
        overflow: "auto",
        padding: "12px 16px",
        color: "var(--text-muted)",
      }}
    >
      <div
        style={{
          fontSize: 11,
          textTransform: "uppercase",
          letterSpacing: "0.04em",
          color: "var(--text-muted)",
          marginBottom: 8,
        }}
      >
        Inspector
      </div>
      <div style={{ fontSize: 13, color: "var(--text-muted)" }}>
        Select a run to inspect inputs, outputs, span tree, eval scores.
      </div>
    </aside>
  );
}
