import { cookies } from "next/headers";
import { NextResponse } from "next/server";

/**
 * Proxy to FastAPI POST /v1/annotations.
 *
 * POST creates a queue and snapshots a sample of runs from ClickHouse
 * into annotation_item rows. List/get go server-side via apiGet from
 * the annotations page so this proxy only handles browser-driven
 * mutations.
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

export async function POST(request: Request): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const res = await fetch(`${apiBase()}/v1/annotations`, {
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
