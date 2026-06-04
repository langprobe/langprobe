/**
 * Internal HTTP transport — shared between Ingest and Control clients.
 *
 * Uses `fetch` (Node 18+, browsers). Tests inject `fetchImpl`. We
 * never swallow non-2xx responses — they raise `TracebilityHTTPError`
 * with the response body so the caller can react.
 */

import { TracebilityHTTPError } from "./errors.js";

export function envFirst(...names: string[]): string | undefined {
  if (typeof process === "undefined" || process.env == null) return undefined;
  for (const n of names) {
    const v = process.env[n];
    if (v) return v;
  }
  return undefined;
}

export function normalizeHost(host: string): string {
  return host.replace(/\/+$/, "");
}

export interface HTTPOptions {
  baseUrl: string;
  apiKey?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  userAgent?: string;
}

export class HTTP {
  private readonly baseUrl: string;
  private readonly apiKey: string | undefined;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly userAgent: string;

  constructor(opts: HTTPOptions) {
    this.baseUrl = normalizeHost(opts.baseUrl);
    this.apiKey = opts.apiKey;
    this.timeoutMs = opts.timeoutMs ?? 10000;
    this.userAgent = opts.userAgent ?? "tracebility-ts/0.0.1";
    if (opts.fetchImpl) {
      this.fetchImpl = opts.fetchImpl;
    } else if (typeof fetch === "function") {
      this.fetchImpl = fetch.bind(globalThis);
    } else {
      throw new Error(
        "tracebility: fetch is not available; pass options.fetchImpl or upgrade to Node 18+",
      );
    }
  }

  get base(): string {
    return this.baseUrl;
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = {
      "content-type": "application/json",
      "user-agent": this.userAgent,
    };
    if (this.apiKey) {
      h["authorization"] = `Bearer ${this.apiKey}`;
      h["x-api-key"] = this.apiKey;
    }
    return h;
  }

  async get<T = unknown>(
    path: string,
    params?: Record<string, unknown>,
  ): Promise<T> {
    const qs = new URLSearchParams();
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        if (v === undefined || v === null) continue;
        qs.set(k, String(v));
      }
    }
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return this.send<T>("GET", `${path}${suffix}`);
  }

  async post<T = unknown>(path: string, body: unknown): Promise<T> {
    return this.send<T>("POST", path, body);
  }

  async patch<T = unknown>(path: string, body: unknown): Promise<T> {
    return this.send<T>("PATCH", path, body);
  }

  async delete(path: string): Promise<void> {
    await this.send<void>("DELETE", path);
  }

  private async send<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers: this.headers(),
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      if (res.status >= 400) {
        const text = await res.text().catch(() => "");
        throw new TracebilityHTTPError(res.status, text, `${this.baseUrl}${path}`);
      }
      if (res.status === 204 || res.headers.get("content-length") === "0") {
        return undefined as unknown as T;
      }
      const ct = res.headers.get("content-type") || "";
      if (ct.includes("application/json")) {
        return (await res.json()) as T;
      }
      const text = await res.text();
      try {
        return JSON.parse(text) as T;
      } catch {
        return text as unknown as T;
      }
    } finally {
      clearTimeout(timer);
    }
  }
}
