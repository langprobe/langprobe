import { NextResponse } from "next/server";

/**
 * POST proxy → FastAPI /v1/auth/login.
 *
 * The api sets the session cookie on its response; we relay the
 * Set-Cookie header back to the browser so the cookie lands on the
 * web origin. Same posture as the SSO callback; nothing
 * web-specific happens here.
 */

function apiBase(): string {
  return (
    process.env.API_BASE_INTERNAL ||
    process.env.NEXT_PUBLIC_API_BASE ||
    "http://localhost:7081"
  );
}

export async function POST(req: Request): Promise<NextResponse> {
  const body = await req.text();
  const res = await fetch(`${apiBase()}/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
    cache: "no-store",
  });
  const text = await res.text();
  const headers = new Headers({ "content-type": "application/json" });
  const setCookie = res.headers.get("set-cookie");
  if (setCookie) headers.set("set-cookie", setCookie);
  return new NextResponse(text, { status: res.status, headers });
}
