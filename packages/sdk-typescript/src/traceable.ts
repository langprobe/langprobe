/**
 * `traceable` — wrap a function so each invocation is one tracebility run.
 *
 * Mirrors LangSmith's JS `traceable`. We thread `parent_run_id`
 * through nested calls via AsyncLocalStorage when available (Node)
 * and fall back to a module-level stack everywhere else. The
 * fallback is fine for browser-only code that doesn't run nested
 * traceables across awaits.
 *
 * Sync and async functions are both supported. The wrapped result
 * preserves the original function's signature.
 */

import { Client } from "./client.js";

let als: { run: <T>(value: string, fn: () => T) => T; getStore: () => string | undefined } | null = null;
try {
  // Lazy import so this works in non-Node runtimes (browser).
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = await import("node:async_hooks");
  const storage = new mod.AsyncLocalStorage<string>();
  als = {
    run: (value, fn) => storage.run(value, fn),
    getStore: () => storage.getStore(),
  };
} catch {
  als = null;
}

let fallbackParentStack: string[] = [];

function currentParent(): string | undefined {
  if (als) return als.getStore();
  return fallbackParentStack[fallbackParentStack.length - 1];
}

function withParent<T>(runId: string, fn: () => T): T {
  if (als) return als.run(runId, fn);
  fallbackParentStack.push(runId);
  try {
    return fn();
  } finally {
    fallbackParentStack.pop();
  }
}

export interface TraceableOptions {
  /** Override the function name. */
  name?: string;
  /** LangSmith run_type — defaults to "chain". */
  runType?: string;
  /** Override the default Client (env-derived) for this wrapper. */
  client?: Client;
  /** Carried as session_name on every emitted run. */
  projectName?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

let defaultClient: Client | null = null;

function getClient(opt: TraceableOptions): Client {
  if (opt.client) return opt.client;
  if (defaultClient == null) defaultClient = new Client();
  return defaultClient;
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

function buildInputs(args: unknown[]): Record<string, unknown> {
  // We don't have parameter names at runtime in JS without metadata;
  // fall back to positional args (LangSmith JS does the same).
  return { args };
}

function safeOutputs(value: unknown): Record<string, unknown> {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return { output: value };
}

export function traceable<F extends (...args: never[]) => unknown>(
  fn: F,
  options: TraceableOptions = {},
): F {
  const runName = options.name ?? fn.name ?? "anonymous";
  const runType = options.runType ?? "chain";

  const wrapped = (...args: never[]): unknown => {
    const client = getClient(options);
    const runId = uuid4();
    const parentId = currentParent();
    const start = new Date();

    const startRun = (): void => {
      void client.createRun({
        id: runId,
        name: runName,
        runType,
        inputs: buildInputs(args),
        startTime: start,
        parentRunId: parentId,
        projectName: options.projectName,
        tags: options.tags,
        extra: { metadata: options.metadata ?? {} },
      });
    };

    return withParent(runId, () => {
      startRun();
      try {
        const result = fn(...args);
        if (result instanceof Promise) {
          return result
            .then((value) => {
              void client.updateRun(runId, {
                endTime: new Date(),
                outputs: safeOutputs(value),
              });
              return value;
            })
            .catch((err: unknown) => {
              const msg =
                err instanceof Error
                  ? `${err.name}: ${err.message}`
                  : String(err);
              void client.updateRun(runId, {
                endTime: new Date(),
                error: msg,
              });
              throw err;
            });
        }
        void client.updateRun(runId, {
          endTime: new Date(),
          outputs: safeOutputs(result),
        });
        return result;
      } catch (err) {
        const msg =
          err instanceof Error ? `${err.name}: ${err.message}` : String(err);
        void client.updateRun(runId, {
          endTime: new Date(),
          error: msg,
        });
        throw err;
      }
    });
  };

  // Preserve the function name for stack traces.
  Object.defineProperty(wrapped, "name", { value: runName });
  return wrapped as F;
}
