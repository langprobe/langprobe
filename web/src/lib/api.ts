import { cookies } from "next/headers";

/**
 * Server-side fetch helpers.
 *
 * apiBase: server containers reach the API by container DNS
 * (API_BASE_INTERNAL=http://api:7081); local dev falls back to
 * localhost. NEXT_PUBLIC_API_BASE is the browser-visible base, never
 * used here (we never call the api from the client directly).
 */

export function apiBase(): string {
  return (
    process.env.API_BASE_INTERNAL ||
    process.env.NEXT_PUBLIC_API_BASE ||
    "http://localhost:7081"
  );
}

export function cookieHeader(): string {
  return cookies()
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");
}

export interface ApiResult<T> {
  data: T | null;
  status: number;
  error: string | null;
}

export async function apiGet<T>(path: string): Promise<ApiResult<T>> {
  const headers: Record<string, string> = {};
  const ck = cookieHeader();
  if (ck) headers.cookie = ck;
  try {
    const res = await fetch(`${apiBase()}${path}`, {
      cache: "no-store",
      headers,
    });
    if (!res.ok) {
      return { data: null, status: res.status, error: `api ${res.status}` };
    }
    const data = (await res.json()) as T;
    return { data, status: res.status, error: null };
  } catch (err) {
    return { data: null, status: 0, error: (err as Error).message };
  }
}
