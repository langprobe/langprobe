/**
 * Client mirroring the LangSmith JS `Client` write surface.
 *
 * The methods we ship are the ones LangSmith users actually call
 * from application code:
 *   - createRun     → POST /runs
 *   - updateRun     → PATCH /runs/{id}
 *   - batchIngestRuns → POST /runs/batch
 *
 * Read methods (`readRun`, `listRuns`, `readProject`) deliberately
 * not implemented; tracebility's read shapes differ from LangSmith's.
 *
 * Configuration honors the LangSmith env vars so an existing setup
 * migrates without code changes:
 *
 *   LANGSMITH_ENDPOINT  (or LANGCHAIN_ENDPOINT) → host
 *   LANGSMITH_API_KEY   (or LANGCHAIN_API_KEY)  → bearer token
 *   LANGSMITH_PROJECT   (or LANGCHAIN_PROJECT)  → default project
 *                                                  (carried as
 *                                                  session_name)
 *
 * Constructor args override env. We use the global `fetch` (Node 18+)
 * so we don't add a runtime dep. Tests inject a `fetchImpl` so they
 * never hit the network.
 */

export interface ClientOptions {
  apiUrl?: string;
  apiKey?: string;
  projectName?: string;
  /** Per-request timeout in milliseconds (default 10000). */
  timeoutMs?: number;
  /** Inject a custom fetch (used in tests). */
  fetchImpl?: typeof fetch;
}

export interface RunCreate {
  id?: string;
  name: string;
  runType?: string;
  inputs?: Record<string, unknown>;
  outputs?: Record<string, unknown>;
  startTime?: Date | string;
  endTime?: Date | string | null;
  parentRunId?: string;
  projectName?: string;
  tags?: string[];
  extra?: Record<string, unknown>;
  error?: string;
  /** Anything else is folded into `extra.metadata`. */
  [extra: string]: unknown;
}

export interface RunUpdate {
  endTime?: Date | string | null;
  outputs?: Record<string, unknown>;
  error?: string;
  events?: Array<Record<string, unknown>>;
  extra?: Record<string, unknown>;
  [extra: string]: unknown;
}

/** Wire-shape sent on the network — snake_case to match the server. */
export interface RunPayload {
  id?: string;
  name?: string;
  run_type?: string;
  inputs?: Record<string, unknown>;
  outputs?: Record<string, unknown>;
  start_time?: string;
  end_time?: string | null;
  parent_run_id?: string;
  session_name?: string;
  tags?: string[];
  extra?: Record<string, unknown>;
  error?: string;
}

const KNOWN_RUN_KEYS = new Set([
  "id",
  "name",
  "runType",
  "inputs",
  "outputs",
  "startTime",
  "endTime",
  "parentRunId",
  "projectName",
  "tags",
  "extra",
  "error",
]);

function envFirst(...names: string[]): string | undefined {
  if (typeof process === "undefined" || process.env == null) return undefined;
  for (const n of names) {
    const v = process.env[n];
    if (v) return v;
  }
  return undefined;
}

function isoOrUndef(value: Date | string | null | undefined): string | null | undefined {
  if (value === null) return null;
  if (value === undefined) return undefined;
  if (value instanceof Date) return value.toISOString();
  return value;
}

function uuid4(): string {
  // RFC 4122 v4 — we use Crypto.randomUUID when available; otherwise
  // a Math.random fallback. Modern Node + the browser both have
  // crypto.randomUUID; the fallback is for old Node test runners.
  const c: { randomUUID?: () => string } | undefined =
    typeof globalThis !== "undefined" && typeof globalThis.crypto !== "undefined"
      ? (globalThis.crypto as unknown as { randomUUID?: () => string })
      : undefined;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  // Fallback (not crypto-secure, but the only callers here are tests).
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    const v = ch === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export class Client {
  private readonly apiUrl: string;
  private readonly apiKey: string | undefined;
  public readonly projectName: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: ClientOptions = {}) {
    const url =
      options.apiUrl ??
      envFirst("LANGSMITH_ENDPOINT", "LANGCHAIN_ENDPOINT") ??
      "http://localhost:7080";
    this.apiUrl = url.replace(/\/+$/, "");
    this.apiKey =
      options.apiKey ?? envFirst("LANGSMITH_API_KEY", "LANGCHAIN_API_KEY");
    this.projectName =
      options.projectName ??
      envFirst("LANGSMITH_PROJECT", "LANGCHAIN_PROJECT") ??
      "default";
    this.timeoutMs = options.timeoutMs ?? 10000;
    if (options.fetchImpl) {
      this.fetchImpl = options.fetchImpl;
    } else if (typeof fetch === "function") {
      this.fetchImpl = fetch.bind(globalThis);
    } else {
      throw new Error(
        "tracebility-langsmith-shim: fetch is not available. Pass options.fetchImpl or upgrade to Node 18+.",
      );
    }
  }

  get apiBase(): string {
    return this.apiUrl;
  }

  // ---------------------------------------------------------------
  // create
  // ---------------------------------------------------------------

  async createRun(run: RunCreate): Promise<RunPayload> {
    const payload: RunPayload = {
      id: run.id ?? uuid4(),
      name: run.name,
      run_type: run.runType ?? "chain",
      inputs: run.inputs ?? {},
      session_name: run.projectName ?? this.projectName,
    };
    const startStr = isoOrUndef(run.startTime ?? new Date());
    if (typeof startStr === "string") payload.start_time = startStr;
    const endStr = isoOrUndef(run.endTime);
    if (endStr !== undefined) payload.end_time = endStr;
    if (run.parentRunId) payload.parent_run_id = run.parentRunId;
    if (run.outputs !== undefined) payload.outputs = run.outputs;
    if (run.error !== undefined) payload.error = run.error;
    if (run.tags !== undefined) payload.tags = [...run.tags];
    const merged: Record<string, unknown> = { ...(run.extra ?? {}) };
    const metadata: Record<string, unknown> = {
      ...((merged.metadata as Record<string, unknown>) ?? {}),
    };
    for (const [k, v] of Object.entries(run)) {
      if (!KNOWN_RUN_KEYS.has(k) && k !== "id") metadata[k] = v;
    }
    if (Object.keys(metadata).length > 0) merged.metadata = metadata;
    if (Object.keys(merged).length > 0) payload.extra = merged;

    await this.post("/runs", payload);
    return payload;
  }

  // ---------------------------------------------------------------
  // update
  // ---------------------------------------------------------------

  async updateRun(runId: string, update: RunUpdate): Promise<void> {
    const payload: RunPayload = {};
    const endStr = isoOrUndef(update.endTime);
    if (endStr !== undefined) payload.end_time = endStr;
    if (update.outputs !== undefined) payload.outputs = update.outputs;
    if (update.error !== undefined) payload.error = update.error;
    const merged: Record<string, unknown> = { ...(update.extra ?? {}) };
    const metadata: Record<string, unknown> = {
      ...((merged.metadata as Record<string, unknown>) ?? {}),
    };
    for (const [k, v] of Object.entries(update)) {
      if (
        k !== "endTime" &&
        k !== "outputs" &&
        k !== "error" &&
        k !== "extra" &&
        k !== "events"
      ) {
        metadata[k] = v;
      }
    }
    if (Object.keys(metadata).length > 0) merged.metadata = metadata;
    if (Object.keys(merged).length > 0) payload.extra = merged;
    if (update.events !== undefined) {
      (payload as Record<string, unknown>).events = [...update.events];
    }

    await this.patch(`/runs/${encodeURIComponent(runId)}`, payload);
  }

  // ---------------------------------------------------------------
  // batch
  // ---------------------------------------------------------------

  async batchIngestRuns(args: {
    create?: RunCreate[];
    update?: Array<{ runId: string; update: RunUpdate }>;
  }): Promise<void> {
    const create = (args.create ?? []).map((r) => this.normalizeCreate(r));
    const update = (args.update ?? []).map(({ runId, update }) =>
      this.normalizeUpdate(runId, update),
    );
    if (create.length === 0 && update.length === 0) return;
    await this.post("/runs/batch", {
      post: create,
      patch: update,
    });
  }

  private normalizeCreate(run: RunCreate): RunPayload {
    return {
      id: run.id ?? uuid4(),
      name: run.name,
      run_type: run.runType ?? "chain",
      inputs: run.inputs ?? {},
      session_name: run.projectName ?? this.projectName,
      start_time: isoOrUndef(run.startTime ?? new Date()) as string | undefined,
      ...(run.parentRunId ? { parent_run_id: run.parentRunId } : {}),
      ...(run.outputs ? { outputs: run.outputs } : {}),
      ...(run.error ? { error: run.error } : {}),
      ...(run.tags ? { tags: [...run.tags] } : {}),
      ...(run.extra ? { extra: run.extra } : {}),
    };
  }

  private normalizeUpdate(runId: string, update: RunUpdate): RunPayload {
    return {
      id: runId,
      ...(isoOrUndef(update.endTime) !== undefined
        ? { end_time: isoOrUndef(update.endTime) }
        : {}),
      ...(update.outputs ? { outputs: update.outputs } : {}),
      ...(update.error ? { error: update.error } : {}),
      ...(update.extra ? { extra: update.extra } : {}),
    };
  }

  // ---------------------------------------------------------------
  // HTTP plumbing
  // ---------------------------------------------------------------

  private headers(): Record<string, string> {
    const h: Record<string, string> = {
      "content-type": "application/json",
      "user-agent": `tracebility-langsmith-shim/0.0.1`,
    };
    if (this.apiKey) {
      h["authorization"] = `Bearer ${this.apiKey}`;
      h["x-api-key"] = this.apiKey;
    }
    return h;
  }

  private async post(path: string, body: unknown): Promise<void> {
    await this.send("POST", path, body);
  }

  private async patch(path: string, body: unknown): Promise<void> {
    await this.send("PATCH", path, body);
  }

  private async send(method: string, path: string, body: unknown): Promise<void> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl(`${this.apiUrl}${path}`, {
        method,
        headers: this.headers(),
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!res.ok) {
        const text = (await res.text().catch(() => "")).slice(0, 500);
        throw new Error(
          `tracebility ingest returned ${res.status}: ${text}`,
        );
      }
    } finally {
      clearTimeout(timer);
    }
  }
}
