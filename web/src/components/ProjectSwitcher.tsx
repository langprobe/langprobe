"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import type { Project } from "@/lib/projects";

/**
 * Native <select>. No combobox, no portal, no fake floating panel — keep
 * it boring and accessible until the project count crosses ~50, at which
 * point we add search. (DESIGN.md: native form controls preferred.)
 */
export function ProjectSwitcher({
  active,
  projects,
}: {
  active: Project | null;
  projects: Project[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  if (projects.length === 0) {
    return (
      <span style={{ color: "var(--text-3)", fontSize: 13 }}>no projects</span>
    );
  }

  return (
    <select
      aria-label="Active project"
      disabled={pending}
      value={active?.id ?? ""}
      onChange={(e) => {
        const projectId = e.target.value;
        startTransition(async () => {
          await fetch("/api/active-project", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ project_id: projectId }),
          });
          router.refresh();
        });
      }}
      style={{
        font: "inherit",
        color: "var(--text)",
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: "var(--r-2)",
        padding: "4px 8px",
        fontSize: 13,
        maxWidth: "100%",
      }}
    >
      {projects.map((p) => (
        <option key={p.id} value={p.id}>
          {p.slug}
        </option>
      ))}
    </select>
  );
}
