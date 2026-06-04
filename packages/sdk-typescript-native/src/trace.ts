/**
 * `trace` — wrap a function so each call emits one tracebility run.
 * `span` — context-managed sub-span inside a `trace` run.
 *
 * Threads `run_id` and `parent_span_id` through nested calls via
 * `AsyncLocalStorage` (Node) with a module-level fallback for browser
 * use.
 */

import { IngestClient, newRunId, newSpanId } from "./ingest.js";
import type { IngestRun, IngestSpan } from "./models.js";

interface RunCtx {
  runId: string;
  spans: IngestSpan[];
  parentSpanId: string | null;
}

let als: { run: <T>(ctx: RunCtx, fn: () => T) => T; getStore: () => RunCtx | undefined } | null = null;
try {
  const mod = await import("node:async_hooks");
  const storage = new mod.AsyncLocalStorage<RunCtx>();
  als = {
    run: (ctx, fn) => storage.run(ctx, fn),
    getStore: () => storage.getStore(),
  };
} catch {
  als = null;
}
const fallbackStack: RunCtx[] = [];

function currentCtx(): RunCtx | undefined {
  if (als) return als.getStore();
  return fallbackStack[fallbackStack.length - 1];
}

function withCtx<T>(ctx: RunCtx, fn: () => T): T {
  if (als) return als.run(ctx, fn);
  fallbackStack.push(ctx);
  try {
    return fn();
  } finally {
    fallbackStack.pop();
  }
}

let defaultIngest: IngestClient | null = null;
function getIngest(client?: IngestClient): IngestClient {
  if (client) return client;
  if (!defaultIngest) defaultIngest = new IngestClient();
  return defaultIngest;
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, (_k, v) => {
      if (typeof v === "bigint") return v.toString();
      if (v instanceof Date) return v.toISOString();
      return v;
    });
  } catch {
    return String(value);
  }
}

function safeOutputs(value: unknown): unknown {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return value;
  }
  return { output: value };
}

export interface TraceOptions {
  name?: string;
  kind?: string;
  client?: IngestClient;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export function trace<F extends (...args: never[]) => unknown>(
  fn: F,
  options: TraceOptions = {},
): F {
  const runName = options.name ?? fn.name ?? "anonymous";
  const runKind = options.kind ?? "chain";

  const wrapped = (...args: never[]): unknown => {
    const ingest = getIngest(options.client);
    const runId = newRunId();
    const ctx: RunCtx = { runId, spans: [], parentSpanId: null };
    const start = new Date().toISOString();

    return withCtx(ctx, () => {
      let outcome: unknown;
      try {
        outcome = fn(...args);
      } catch (err) {
        const end = new Date().toISOString();
        const run: IngestRun = {
          run_id: runId,
          name: runName,
          kind: runKind,
          status: "error",
          sdk: "tracebility-ts",
          start_time: start,
          end_time: end,
          inputs: safeStringify({ args }),
          tags: options.tags,
          metadata: options.metadata,
          error_kind: errName(err),
          error_message: errMsg(err),
          spans: [...ctx.spans],
        };
        void ingest.submitRun(run);
        throw err;
      }

      if (outcome instanceof Promise) {
        return outcome
          .then((value) => {
            const end = new Date().toISOString();
            const run: IngestRun = {
              run_id: runId,
              name: runName,
              kind: runKind,
              status: "ok",
              sdk: "tracebility-ts",
              start_time: start,
              end_time: end,
              inputs: safeStringify({ args }),
              outputs: safeStringify(safeOutputs(value)),
              tags: options.tags,
              metadata: options.metadata,
              spans: [...ctx.spans],
            };
            void ingest.submitRun(run);
            return value;
          })
          .catch((err: unknown) => {
            const end = new Date().toISOString();
            const run: IngestRun = {
              run_id: runId,
              name: runName,
              kind: runKind,
              status: "error",
              sdk: "tracebility-ts",
              start_time: start,
              end_time: end,
              inputs: safeStringify({ args }),
              tags: options.tags,
              metadata: options.metadata,
              error_kind: errName(err),
              error_message: errMsg(err),
              spans: [...ctx.spans],
            };
            void ingest.submitRun(run);
            throw err;
          });
      }

      const end = new Date().toISOString();
      const run: IngestRun = {
        run_id: runId,
        name: runName,
        kind: runKind,
        status: "ok",
        sdk: "tracebility-ts",
        start_time: start,
        end_time: end,
        inputs: safeStringify({ args }),
        outputs: safeStringify(safeOutputs(outcome)),
        tags: options.tags,
        metadata: options.metadata,
        spans: [...ctx.spans],
      };
      void ingest.submitRun(run);
      return outcome;
    });
  };

  Object.defineProperty(wrapped, "name", { value: runName });
  return wrapped as F;
}

export interface SpanOptions {
  kind?: string;
  model?: string;
  temperature?: number;
}

export class span {
  private readonly name: string;
  private readonly kind: string;
  private readonly model: string | null;
  private readonly temperature: number | null;
  private readonly spanId: string;
  private readonly start: string;
  private inputs: unknown = undefined;
  private outputs: unknown = undefined;
  private end: string | null = null;

  constructor(name: string, opts: SpanOptions = {}) {
    this.name = name;
    this.kind = opts.kind ?? "chain";
    this.model = opts.model ?? null;
    this.temperature = opts.temperature ?? null;
    this.spanId = newSpanId();
    this.start = new Date().toISOString();
  }

  setInput(value: unknown): void {
    this.inputs = value;
  }
  setOutput(value: unknown): void {
    this.outputs = value;
  }

  finish(error?: unknown): void {
    this.end = new Date().toISOString();
    const ctx = currentCtx();
    if (!ctx) return; // No active trace; silently no-op.
    const s: IngestSpan = {
      span_id: this.spanId,
      run_id: ctx.runId,
      parent_span_id: ctx.parentSpanId,
      name: this.name,
      kind: this.kind,
      status: error ? "error" : "ok",
      start_time: this.start,
      end_time: this.end,
      model: this.model,
      temperature: this.temperature,
      inputs:
        this.inputs !== undefined ? safeStringify(this.inputs) : null,
      outputs:
        this.outputs !== undefined ? safeStringify(this.outputs) : null,
      error_kind: error ? errName(error) : null,
      error_message: error ? errMsg(error) : null,
    };
    ctx.spans.push(s);
  }

  /** Sugar: `using s = span(...)` style isn't quite there yet in TS;
   * for now use try/finally or `await using` once the explicit-resource-
   * management proposal lands. */
  static around<T>(name: string, opts: SpanOptions, fn: (s: span) => T): T {
    const s = new span(name, opts);
    try {
      const out = fn(s);
      if (out instanceof Promise) {
        return out
          .then((v) => {
            s.finish();
            return v;
          })
          .catch((e: unknown) => {
            s.finish(e);
            throw e;
          }) as unknown as T;
      }
      s.finish();
      return out;
    } catch (e) {
      s.finish(e);
      throw e;
    }
  }
}

function errName(err: unknown): string {
  if (err instanceof Error) return err.name;
  return "Error";
}
function errMsg(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
