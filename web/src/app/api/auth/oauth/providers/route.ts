import { NextResponse } from "next/server";

/**
 * GET proxy → FastAPI /v1/auth/oauth/providers.
 *
 * Returns `{google: bool, github: bool}` so the /login + /signup
 * UIs can decide which "Continue with X" buttons to show. No
 * secrets are leaked — just the configured-or-not bit per provider.
 */

function apiBase(): string {
  return (
    process.env.API_BASE_INTERNAL ||
    process.env.NEXT_PUBLIC_API_BASE ||
    "http://localhost:7081"
  );
}

export async function GET(): Promise<NextResponse> {
  const res = await fetch(`${apiBase()}/v1/auth/oauth/providers`, {
    cache: "no-store",
  });
  const text = await res.text();
  return new NextResponse(text, {
    status: res.status,
    headers: { "content-type": "application/json" },
  });
}
