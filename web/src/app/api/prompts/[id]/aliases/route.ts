import { cookies } from "next/headers";
import { NextResponse } from "next/server";

/**
 * Proxy to FastAPI POST /v1/prompts/{id}/aliases.
 *
 * Body: {alias, version}. Server moves the alias off any other version
 * on this prompt (aliases are unique-per-prompt) and adds it to the
 * target version. Idempotent — re-assigning the same (alias, version)
 * pair is a no-op.
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
  request: Request,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const res = await fetch(
    `${apiBase()}/v1/prompts/${params.id}/aliases`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: cookieHeader(),
      },
      body: JSON.stringify(body),
      cache: "no-store",
    },
  );
  const text = await res.text();
  return new NextResponse(text, {
    status: res.status,
    headers: { "content-type": "application/json" },
  });
}
