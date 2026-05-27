"use client";

import {
  Activity,
  Boxes,
  Database,
  FlaskConical,
  Home,
  KeyRound,
  Library,
  Settings,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

type NavItem = { label: string; href: string; icon: ReactNode };
type NavSection = { label: string; items: NavItem[] };

const SECTIONS: NavSection[] = [
  {
    label: "Observe",
    items: [
      { label: "Overview", href: "/", icon: <Home size={16} strokeWidth={1.5} /> },
      { label: "Traces", href: "/runs", icon: <Activity size={16} strokeWidth={1.5} /> },
      { label: "Replay", href: "/replay", icon: <Sparkles size={16} strokeWidth={1.5} /> },
    ],
  },
  {
    label: "Improve",
    items: [
      { label: "Evals", href: "/evals", icon: <FlaskConical size={16} strokeWidth={1.5} /> },
      { label: "Datasets", href: "/datasets", icon: <Database size={16} strokeWidth={1.5} /> },
      { label: "Prompts", href: "/prompts", icon: <Library size={16} strokeWidth={1.5} /> },
      { label: "Studio", href: "/studio", icon: <Boxes size={16} strokeWidth={1.5} /> },
    ],
  },
  {
    label: "Settings",
    items: [
      { label: "API keys", href: "/api-keys", icon: <KeyRound size={16} strokeWidth={1.5} /> },
      { label: "Workspace", href: "/workspace", icon: <Settings size={16} strokeWidth={1.5} /> },
    ],
  },
];

export function SidebarNav() {
  const pathname = usePathname() ?? "/";
  return (
    <>
      {SECTIONS.map((section) => (
        <div key={section.label} style={{ paddingBottom: 8 }}>
          <div className="nav-section-label">{section.label}</div>
          {section.items.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`nav-item${active ? " active" : ""}`}
              >
                <span className="nav-icon">{item.icon}</span>
                <span>{item.label}</span>
              </Link>
            );
          })}
        </div>
      ))}
    </>
  );
}

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}
