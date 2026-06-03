import { cookies } from "next/headers";
import { NextResponse } from "next/server";

/**
 * Proxy to FastAPI POST /v1/annotations/{queue_id}/items/{item_id}/skip.
 *
 * Reviewer marks an item skipped (the run is unreviewable, e.g. a
 * malformed trace). The atomic UPDATE only succeeds when the item is
 * still pending; already-actioned items return 404 so the UI can
 * refresh and show the existing decision.
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
  { params }: { params: { id: string; itemId: string } },
): Promise<NextResponse> {
  const res = await fetch(
    `${apiBase()}/v1/annotations/${params.id}/items/${params.itemId}/skip`,
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
