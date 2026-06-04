/**
 * Write path: post traces to the ingest-api.
 *
 * Configuration env vars:
 *
 *   TRACEBILITY_INGEST_URL   → ingest-api host
 *   TRACEBILITY_INGEST_KEY   → bearer token
 */

import { HTTP, envFirst } from "./_http.js";
import type { IngestBatch, IngestRun, IngestSpan } from "./models.js";

export interface IngestClientOptions {
  apiUrl?: string;
  apiKey?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export interface IngestAck {
  accepted_runs: number;
  accepted_spans: number;
}

export class IngestClient {
  private readonly http: HTTP;

  constructor(opts: IngestClientOptions = {}) {
    const url =
      opts.apiUrl ??
      envFirst("TRACEBILITY_INGEST_URL", "LANGSMITH_ENDPOINT") ??
      "http://localhost:7080";
    const key =
      opts.apiKey ??
      envFirst("TRACEBILITY_INGEST_KEY", "LANGSMITH_API_KEY");
    this.http = new HTTP({
      baseUrl: url,
      apiKey: key,
      timeoutMs: opts.timeoutMs,
      fetchImpl: opts.fetchImpl,
    });
  }

  get baseUrl(): string {
    return this.http.base;
  }

  async submitBatch(batch: IngestBatch): Promise<IngestAck> {
    const payload: IngestBatch = {
      sdk: "tracebility-ts",
      sdk_version: "0.0.1",
      schema_version: 1,
      ...batch,
    };
    return this.http.post<IngestAck>("/v1/runs", payload);
  }

  async submitRun(run: IngestRun, spans?: IngestSpan[]): Promise<IngestAck> {
    if (spans !== undefined) {
      run = { ...run, spans };
    }
    return this.submitBatch({ runs: [run], spans: [] });
  }
}

export function newRunId(): string {
  return uuid4();
}

export function newSpanId(): string {
  return uuid4();
}

function uuid4(): string {
  const c: { randomUUID?: () => string } | undefined =
    typeof globalThis !== "undefined" && typeof globalThis.crypto !== "undefined"
      ? (globalThis.crypto as unknown as { randomUUID?: () => string })
      : undefined;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    const v = ch === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
