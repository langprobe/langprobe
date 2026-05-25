/**
 * Three-pane debugger shell (DESIGN.md:102):
 *   nav (240px) | main | inspector (360px)
 * 1px --rule dividers, no shadows. Skeletons are flat, not shimmer.
 *
 * Active project + project list come from server props; the page
 * resolves them once and threads them through here so the picker can
 * render without an extra round-trip.
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
import type { Project } from "@/lib/projects";
import { ProjectSwitcher } from "./ProjectSwitcher";

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

export function Shell({
  children,
  active,
  projects,
  inspector,
}: {
  children: ReactNode;
  active: Project | null;
  projects: Project[];
  inspector?: ReactNode;
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "var(--pane-nav) 1fr var(--pane-inspector)",
        height: "100vh",
        background: "var(--bg)",
      }}
    >
      <NavPane active={active} projects={projects} />
      <main
        style={{
          overflow: "auto",
          borderLeft: "1px solid var(--rule)",
          borderRight: "1px solid var(--rule)",
        }}
      >
        {children}
      </main>
      <InspectorPane>{inspector}</InspectorPane>
    </div>
  );
}

function NavPane({
  active,
  projects,
}: {
  active: Project | null;
  projects: Project[];
}) {
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
          display: "flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        <span style={{ color: "var(--accent)" }}>tracebility</span>
        <span style={{ color: "var(--text-muted)" }}>/</span>
        <ProjectSwitcher active={active} projects={projects} />
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

function InspectorPane({ children }: { children?: ReactNode }) {
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
      {children ?? (
        <div style={{ fontSize: 13, color: "var(--text-muted)" }}>
          Select a run to inspect inputs, outputs, span tree, eval scores.
        </div>
      )}
    </aside>
  );
}
