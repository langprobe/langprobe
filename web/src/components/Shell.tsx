/**
 * App chrome (DESIGN.md v2 — mock-as-truth):
 *   topbar        topbar
 *   sidebar (232) main
 *
 * Topbar = 48px sticky brand + crumbs + flexible spacer + search.
 * Sidebar = 232px column with project switcher card, nav-section labels,
 *           nav-items, footer user-row.
 *
 * The page renders inside <main>; pages may opt into a custom topbar or
 * supply a `crumbs` prop. Children get the full interior — no inner padding,
 * pages decide their own pad.
 */

import { Search } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import type { Project } from "@/lib/projects";
import { ProjectSwitcher } from "./ProjectSwitcher";
import { SidebarNav } from "./SidebarNav";

export function Shell({
  children,
  active,
  projects,
  crumbs,
  inspector,
}: {
  children: ReactNode;
  active: Project | null;
  projects: Project[];
  crumbs?: ReactNode;
  inspector?: ReactNode;
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "var(--sidebar-w) 1fr",
        gridTemplateRows: "var(--topbar-h) 1fr",
        gridTemplateAreas: `"topbar topbar" "sidebar main"`,
        height: "100vh",
        background: "var(--bg)",
      }}
    >
      <Topbar crumbs={crumbs} active={active} />
      <Sidebar active={active} projects={projects} />
      <main
        style={{
          gridArea: "main",
          overflow: "auto",
          background: "var(--bg)",
        }}
      >
        {children}
        {inspector}
      </main>
    </div>
  );
}

function Topbar({
  crumbs,
  active,
}: {
  crumbs?: ReactNode;
  active: Project | null;
}) {
  return (
    <header
      style={{
        gridArea: "topbar",
        display: "flex",
        alignItems: "center",
        gap: 16,
        padding: "0 16px",
        borderBottom: "1px solid var(--border)",
        background: "var(--surface)",
      }}
    >
      <BrandMark />
      <div className="crumbs">
        {crumbs ?? (
          <>
            <Link href="/">tracability</Link>
            <span className="sep">/</span>
            <span className="last">overview</span>
            {active ? (
              <>
                <span className="sep">/</span>
                <span className="mono" style={{ color: "var(--text-3)" }}>
                  {active.slug}
                </span>
              </>
            ) : null}
          </>
        )}
      </div>
      <div style={{ flex: 1 }} />
      <SearchBox />
    </header>
  );
}

function BrandMark() {
  return (
    <Link
      href="/"
      aria-label="tracability home"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        textDecoration: "none",
        color: "var(--text)",
      }}
    >
      <span
        aria-hidden
        style={{
          width: 22,
          height: 22,
          borderRadius: "var(--r-1)",
          background: "var(--accent)",
          color: "var(--accent-fg)",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "var(--f-mono)",
          fontSize: 13,
          fontWeight: 600,
        }}
      >
        t
      </span>
    </Link>
  );
}

function SearchBox() {
  return (
    <label className="search-box" htmlFor="topbar-search">
      <Search size={14} strokeWidth={1.5} />
      <input
        id="topbar-search"
        type="search"
        placeholder="Search runs, evals, prompts…"
        aria-label="Search"
      />
      <span className="kbd" aria-hidden>
        ⌘K
      </span>
    </label>
  );
}

function Sidebar({
  active,
  projects,
}: {
  active: Project | null;
  projects: Project[];
}) {
  return (
    <aside
      style={{
        gridArea: "sidebar",
        background: "var(--surface-2)",
        borderRight: "1px solid var(--border)",
        display: "flex",
        flexDirection: "column",
        overflow: "auto",
      }}
    >
      <div style={{ padding: "12px 12px 8px" }}>
        <div
          className="card"
          style={{
            padding: "10px 12px",
            display: "flex",
            flexDirection: "column",
            gap: 6,
          }}
        >
          <div
            style={{
              fontSize: 11,
              color: "var(--text-3)",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
            }}
          >
            Project
          </div>
          <ProjectSwitcher active={active} projects={projects} />
        </div>
      </div>

      <SidebarNav />

      <div style={{ flex: 1 }} />

      <SidebarFooter />
    </aside>
  );
}

function SidebarFooter() {
  return (
    <div
      style={{
        padding: 12,
        borderTop: "1px solid var(--border)",
        display: "flex",
        alignItems: "center",
        gap: 10,
      }}
    >
      <span
        aria-hidden
        style={{
          width: 28,
          height: 28,
          borderRadius: 9999,
          background: "var(--surface-3)",
          color: "var(--text)",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 12,
          fontWeight: 500,
        }}
      >
        m
      </span>
      <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
        <span style={{ fontSize: 13, color: "var(--text)" }}>self-hosted</span>
        <span
          className="mono"
          style={{
            fontSize: 11,
            color: "var(--text-3)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          tracability.local
        </span>
      </div>
    </div>
  );
}
