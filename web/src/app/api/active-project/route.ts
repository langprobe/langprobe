import { NextResponse } from "next/server";
import { ACTIVE_PROJECT_COOKIE } from "@/lib/projects";

/**
 * Pin the active project for this session by setting an http-only cookie.
 * The picker (client component) POSTs here; we don't validate ownership —
 * downstream API calls do, because the API re-checks workspace role on
 * every request anyway. Bad cookie = empty results, not a leak.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: Request): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const projectId =
    body && typeof body === "object" && "project_id" in body
      ? String((body as { project_id: unknown }).project_id)
      : "";
  if (!UUID_RE.test(projectId)) {
    return NextResponse.json({ error: "invalid project_id" }, { status: 400 });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set({
    name: ACTIVE_PROJECT_COOKIE,
    value: projectId,
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  return res;
}
