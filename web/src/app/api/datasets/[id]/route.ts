import { cookies } from "next/headers";
import { NextResponse } from "next/server";

/**
 * Proxy to FastAPI PATCH/DELETE /v1/datasets/{id}.
 *
 * PATCH updates name/description. DELETE soft-deletes (server flips
 * deleted_at; rows in dataset_item stay for audit).
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

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const res = await fetch(`${apiBase()}/v1/datasets/${params.id}`, {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      cookie: cookieHeader(),
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const text = await res.text();
  return new NextResponse(text, {
    status: res.status,
    headers: { "content-type": "application/json" },
  });
}

export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const res = await fetch(`${apiBase()}/v1/datasets/${params.id}`, {
    method: "DELETE",
    headers: { cookie: cookieHeader() },
    cache: "no-store",
  });
  if (res.status === 204) return new NextResponse(null, { status: 204 });
  const text = await res.text();
  return new NextResponse(text, {
    status: res.status,
    headers: { "content-type": "application/json" },
  });
}
