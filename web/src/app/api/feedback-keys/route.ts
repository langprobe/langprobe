import { cookies } from "next/headers";
import { NextResponse } from "next/server";

/**
 * Proxy to FastAPI /v1/feedback-keys.
 *
 * GET lists keys for a project (server-side pages call `apiGet`
 * directly — this proxy mainly serves browser-driven mutations).
 * POST creates a new public key; the response carries `plaintext_key`
 * which the UI shows ONCE.
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

export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const qs = url.searchParams.toString();
  const target = qs
    ? `${apiBase()}/v1/feedback-keys?${qs}`
    : `${apiBase()}/v1/feedback-keys`;
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

export async function POST(request: Request): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const res = await fetch(`${apiBase()}/v1/feedback-keys`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: cookieHeader(),
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const text = await res.text();
  return new NextResponse(text, {
    status: res.status,
    headers: { "content-type": "application/json" },
  });
}
