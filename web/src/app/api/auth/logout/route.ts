import { cookies } from "next/headers";
import { NextResponse } from "next/server";

/**
 * POST proxy → FastAPI /v1/auth/logout.
 *
 * Forwards cookies (so the api can audit who is logging out) and
 * always clears the local session + active-project cookies on the
 * web origin. We can't rely on the api's Set-Cookie alone: if the
 * session is already stale, the api returns 401 with no Set-Cookie,
 * which would leave the user "still signed in" in the browser even
 * though the server-side session is gone.
 *
 * Defensive: always overwrite the cookies with Max-Age=0 on the way
 * out, regardless of upstream status.
 */

const SESSION_COOKIE = "tracebility_session";
const ACTIVE_PROJECT_COOKIE = "tracebility_active_project";

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
  let upstreamStatus = 204;
  try {
    const res = await fetch(`${apiBase()}/v1/auth/logout`, {
      method: "POST",
      headers: { cookie: cookieHeader() },
      cache: "no-store",
    });
    upstreamStatus = res.status;
  } catch {
    // ignore — we still clear locally below
  }

  // Always treat logout as a success client-side. The user clicked
  // sign out; the cookie must be gone when they land on /login.
  const out = NextResponse.json(
    { ok: true, upstream: upstreamStatus },
    { status: 200 },
  );
  out.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
  out.cookies.set(ACTIVE_PROJECT_COOKIE, "", { path: "/", maxAge: 0 });
  return out;
}
