import { cookies } from "next/headers";
import { NextResponse } from "next/server";

/**
 * Proxy to FastAPI POST /v1/prompts/{id}/versions.
 *
 * Body: {template, input_schema?, model_params?, aliases?, commit_message?}.
 * Server inserts an immutable `prompt_version` row and (optionally) moves
 * any aliases off prior versions to land on this one.
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
    `${apiBase()}/v1/prompts/${params.id}/versions`,
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
