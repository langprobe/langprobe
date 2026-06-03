import { cookies } from "next/headers";
import { NextResponse } from "next/server";

/**
 * Proxy to FastAPI GET /v1/eval-runs/{id}/scores.
 *
 * Per-item ClickHouse rows backing the run. The detail page uses these
 * to render the scores table; we forward the optional `limit` query so
 * a future "load more" can deepen the slice without a schema change.
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
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const url = new URL(request.url);
  const qs = url.searchParams.toString();
  const target = qs
    ? `${apiBase()}/v1/eval-runs/${params.id}/scores?${qs}`
    : `${apiBase()}/v1/eval-runs/${params.id}/scores`;
  const res = await fetch(target, {
    method: "GET",
    headers: { cookie: cookieHeader() },
    cache: "no-store",
  });
  const text = await res.text();
  return new NextResponse(text, {
    status: res.status,
    headers: { "content-type": "application/json" },
  });
}
