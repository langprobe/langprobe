import { cookies } from "next/headers";
import { NextResponse } from "next/server";

/**
 * Proxy to FastAPI POST /v1/annotations/{queue_id}/items/{item_id}/submit.
 *
 * Reviewers POST {label, score?, rationale?} to record a judgment.
 * The upstream router validates label against the rubric, computes
 * score per rubric.score type, flips item -> done, and writes one
 * ClickHouse eval_score row tagged judge_name='human' so labels
 * aggregate alongside LLM judges and end-user feedback.
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
  request: Request,
  { params }: { params: { id: string; itemId: string } },
): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const res = await fetch(
    `${apiBase()}/v1/annotations/${params.id}/items/${params.itemId}/submit`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: cookieHeader(),
      },
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
