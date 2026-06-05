import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

/**
 * OAuth callback relay — same-origin cookie story.
 *
 * The IdP (Google / GitHub) redirects here, on the web origin. We
 * fetch the api's actual /v1/auth/oauth/<provider>/callback?<query>
 * server-side, then relay its Set-Cookie header onto the web origin
 * before redirecting the browser to the post-auth landing page.
 *
 * Why we need this hop: if the IdP redirected directly to the api,
 * the api would set the session cookie on its own origin (localhost:7081),
 * and the browser would then end up on the web origin (localhost:7090)
 * with NO session cookie attached — because cross-origin cookies are
 * not sent on navigation. By terminating the OAuth round-trip on the
 * web origin and relaying the cookie, the cookie ends up on the same
 * origin as the rest of the app.
 *
 * The api side stays the same; we just don't follow its 302
 * automatically. We read the Set-Cookie + the Location header it
 * returns, then issue our own 302 with the cookie scoped to web.
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
  const apiUrl = `${apiBase()}/v1/auth/oauth/${params.provider}/callback${url.search}`;

  // Don't follow the api's 302 automatically — we need to inspect
  // the Set-Cookie + Location headers and reissue them on this
  // origin.
  const apiRes = await fetch(apiUrl, { redirect: "manual", cache: "no-store" });

  // Successful OAuth callback returns 302 with Set-Cookie + Location.
  // 4xx / 5xx return JSON with `detail`.
  if (apiRes.status === 302) {
    const setCookie = apiRes.headers.get("set-cookie");
    const location = apiRes.headers.get("location") || "/";
    const headers = new Headers({ location });
    if (setCookie) headers.set("set-cookie", setCookie);
    return new NextResponse(null, { status: 302, headers });
  }

  // Error path: relay the body so the user sees the actual reason
  // (e.g. "google email not verified", "oauth state expired").
  const body = await apiRes.text();
  return new NextResponse(body, {
    status: apiRes.status,
    headers: { "content-type": apiRes.headers.get("content-type") || "text/plain" },
  });
}
