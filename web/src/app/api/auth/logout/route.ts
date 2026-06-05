import { cookies } from "next/headers";
import { NextResponse } from "next/server";

/**
 * POST proxy → FastAPI /v1/auth/logout. Forwards cookies (so the
 * api can audit which user is logging out) and relays the
 * cookie-deletion Set-Cookie header.
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

export async function POST(): Promise<NextResponse> {
  const res = await fetch(`${apiBase()}/v1/auth/logout`, {
    method: "POST",
    headers: { cookie: cookieHeader() },
    cache: "no-store",
  });
  const headers = new Headers();
  const setCookie = res.headers.get("set-cookie");
  if (setCookie) headers.set("set-cookie", setCookie);
  return new NextResponse(null, { status: res.status, headers });
}
