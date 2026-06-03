import { cookies } from "next/headers";
import { NextResponse } from "next/server";

/**
 * Proxy to FastAPI DELETE /v1/datasets/{id}/items/{item_id}.
 * Server flips `deleted_at` on the ClickHouse row (soft delete).
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

export async function DELETE(
  _request: Request,
  { params }: { params: { id: string; item_id: string } },
): Promise<NextResponse> {
  const res = await fetch(
    `${apiBase()}/v1/datasets/${params.id}/items/${params.item_id}`,
    {
      method: "DELETE",
      headers: { cookie: cookieHeader() },
      cache: "no-store",
    },
  );
  if (res.status === 204) return new NextResponse(null, { status: 204 });
  const text = await res.text();
  return new NextResponse(text, {
    status: res.status,
    headers: { "content-type": "application/json" },
  });
}
