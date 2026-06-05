import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

/**
 * Same-origin OAuth start.
 *
 * The browser navigates to `/api/auth/oauth/<provider>/start?...` (a
 * relative URL on the web origin). We fetch the api's actual start
 * endpoint server-side (using the docker-internal DNS), read the IdP
 * Location it returns, and re-issue that 302 to the browser.
 *
 * Why server-side and not a browser-followed 302 to the api: the api
 * runs on a different host inside docker (`http://api:7081`) which
 * the user's browser can't reach. We can't redirect the browser to
 * that internal name; we'd have to use the public api origin, which
 * means baking it into the bundle at build time. Server-side fetch
 * + reissued redirect avoids the need.
 *
 * The api's /v1/auth/oauth/<provider>/start endpoint sets up the
 * oauth_state row (PKCE verifier + return_to + intent) and returns
 * a 302 with the IdP URL in Location. We just hand that URL back.
 */

function apiBase(): string {
  return (
    process.env.API_BASE_INTERNAL ||
    process.env.NEXT_PUBLIC_API_BASE ||
    "http://localhost:7081"
  );
}

export async function GET(
  req: NextRequest,
  { params }: { params: { provider: string } },
): Promise<Response> {
  const url = new URL(req.url);
  const apiUrl = `${apiBase()}/v1/auth/oauth/${params.provider}/start${url.search}`;

  const apiRes = await fetch(apiUrl, { redirect: "manual", cache: "no-store" });

  if (apiRes.status === 302) {
    const idpUrl = apiRes.headers.get("location") || "/login";
    return new NextResponse(null, {
      status: 302,
      headers: { location: idpUrl },
    });
  }

  // Error path — the api returned an error (e.g. 503 "google oauth
  // not configured"). Relay it as a JSON response so the user sees
  // the actual reason.
  const body = await apiRes.text();
  return new NextResponse(body, {
    status: apiRes.status,
    headers: { "content-type": apiRes.headers.get("content-type") || "text/plain" },
  });
}
