import { cookies } from "next/headers";
import { NextResponse } from "next/server";

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
  _request: Request,
  { params }: { params: { workspace_id: string } },
): Promise<NextResponse> {
  const res = await fetch(
    `${apiBase()}/v1/workspaces/${params.workspace_id}/invitations`,
    { headers: { cookie: cookieHeader() }, cache: "no-store" },
  );
  const text = await res.text();
  return new NextResponse(text, {
    status: res.status,
    headers: { "content-type": "application/json" },
  });
}

export async function POST(
  request: Request,
  { params }: { params: { workspace_id: string } },
): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const res = await fetch(
    `${apiBase()}/v1/workspaces/${params.workspace_id}/invitations`,
    {
      method: "POST",
      headers: { "content-type": "application/json", cookie: cookieHeader() },
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
