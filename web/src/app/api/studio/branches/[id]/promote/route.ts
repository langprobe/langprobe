import { cookies } from "next/headers";
import { NextResponse } from "next/server";

/**
 * Proxy to FastAPI POST /v1/studio/branches/{id}/promote.
 *
 * Marks a replayed branch as promoted. Wiring into Prompts revisions
 * lands in a later iteration; the status transition is the storage
 * contract this v1 ships.
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

export async function POST(
  _request: Request,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const res = await fetch(
    `${apiBase()}/v1/studio/branches/${params.id}/promote`,
    {
      method: "POST",
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
