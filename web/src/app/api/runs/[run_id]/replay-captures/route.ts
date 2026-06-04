import { cookies } from "next/headers";
import { NextResponse } from "next/server";

/**
 * Proxy to FastAPI GET /v1/runs/{run_id}/replay-captures.
 *
 * Forwards `project_id` and optional `limit` from the request URL.
 * The replay-capture index is per-run; the FastAPI side enforces
 * RBAC against the project's workspace.
 */

function apiBase(): string {
  return (
    process.env.API_BASE_INTERNAL ||
    process.env.NEXT_PUBLIC_API_BASE ||
    "http://localhost:7081"
  );
}

function cookieHeader(): string {
  return cookies()
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");
}

export async function GET(
  request: Request,
  { params }: { params: { run_id: string } },
): Promise<NextResponse> {
  const url = new URL(request.url);
  const projectId = url.searchParams.get("project_id");
  if (!projectId) {
    return NextResponse.json(
      { error: "project_id is required" },
      { status: 400 },
    );
  }
  const qs = new URLSearchParams({ project_id: projectId });
  const limit = url.searchParams.get("limit");
  if (limit) qs.set("limit", limit);
  const res = await fetch(
    `${apiBase()}/v1/runs/${encodeURIComponent(params.run_id)}/replay-captures?${qs.toString()}`,
    {
      method: "GET",
      headers: { cookie: cookieHeader() },
      cache: "no-store",
    },
  );
  const text = await res.text();
  return new NextResponse(text, {
    status: res.status,
    headers: { "content-type": "application/json" },
  });
}
