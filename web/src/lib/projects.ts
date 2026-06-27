import { cookies } from "next/headers";
import { apiGet } from "./api";

export interface Project {
  id: string;
  workspace_id: string;
  slug: string;
  name: string;
}

export const ACTIVE_PROJECT_COOKIE = "langprobe_active_project";

export interface ResolvedProject {
  active: Project | null;
  all: Project[];
  reason: string | null;
}

/**
 * Resolve the active project for the current session.
 *
 * Order: (1) cookie pin, (2) first project from /v1/projects, (3) null.
 * Reason is non-null when we can't resolve — empty states render it so
 * the operator sees why ("not authenticated", "no projects yet"),
 * never a silent blank page.
 */
export async function resolveActiveProject(): Promise<ResolvedProject> {
  const res = await apiGet<Project[]>("/v1/projects");
  if (res.error) {
    return {
      active: null,
      all: [],
      reason: res.status === 401 ? "not authenticated" : res.error,
    };
  }
  const all = res.data ?? [];
  if (all.length === 0) {
    return { active: null, all, reason: "no projects yet" };
  }
  const pinned = cookies().get(ACTIVE_PROJECT_COOKIE)?.value;
  const active = (pinned && all.find((p) => p.id === pinned)) || all[0];
  return { active, all, reason: null };
}
