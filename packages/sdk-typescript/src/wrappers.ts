/**
 * wrapOpenAI / wrapAnthropic — auto-tracing client wrappers.
 *
 * Hand us a vendor SDK client; we return a Proxy that intercepts the
 * calls we care about and emits one tracebility run per invocation.
 * Everything else passes through.
 *
 * We do NOT import the vendor SDKs; the proxy inspects whatever you
 * hand it. That keeps the shim installable without `openai` /
 * `@anthropic-ai/sdk` as transitive deps.
 *
 * Async support is built in — JS chat-completion calls are async,
 * so the return is awaited and the run is finalized after the
 * promise settles.
 */

import { Client } from "./client.js";

let defaultClient: Client | null = null;

function getClient(custom?: Client): Client {
  if (custom) return custom;
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

interface SubPathConfig {
  client: Client;
  vendor: string;
  pathPrefix: string[];
  tracedAt: string[];
  summarize: (result: unknown) => Record<string, unknown>;
}

function makeSubPath(target: unknown, cfg: SubPathConfig): unknown {
  return new Proxy(target as object, {
    get(t, prop, recv) {
      if (typeof prop !== "string") {
        return Reflect.get(t, prop, recv);
      }
      const newPath = [...cfg.pathPrefix, prop];
      const value = (t as Record<string, unknown>)[prop];

      // Are we at a fully-traced path?
      const isTraced =
        newPath.length === cfg.tracedAt.length &&
        newPath.every((seg, i) => seg === cfg.tracedAt[i]);

      if (isTraced) {
        if (typeof value !== "function") return value;
        const fn = value as (...args: unknown[]) => unknown;
        const bound = fn.bind(t);
        return (...args: unknown[]) =>
          tracedCall(cfg, bound, args);
      }

      // Are we still on a prefix of a traced path?
      const isPrefix =
        newPath.length < cfg.tracedAt.length &&
        newPath.every((seg, i) => seg === cfg.tracedAt[i]);

      if (isPrefix && value !== null && typeof value === "object") {
        return makeSubPath(value, { ...cfg, pathPrefix: newPath });
      }

      return value;
    },
  });
}

function tracedCall(
  cfg: SubPathConfig,
  fn: (...args: unknown[]) => unknown,
  args: unknown[],
): unknown {
  const kwargs = (args[0] ?? {}) as Record<string, unknown>;
  const runId = uuid4();
  const start = new Date();
  const inputs: Record<string, unknown> = {
    model: kwargs.model,
    messages: kwargs.messages,
  };
  for (const opt of [
    "temperature",
    "max_tokens",
    "top_p",
    "stream",
    "system",
  ]) {
    if (opt in kwargs) inputs[opt] = kwargs[opt];
  }

  void cfg.client.createRun({
    id: runId,
    name: `${cfg.vendor}.${cfg.tracedAt.join(".")}:${
      typeof kwargs.model === "string" ? kwargs.model : "unknown"
    }`,
    runType: "llm",
    inputs,
    startTime: start,
    extra: { metadata: { vendor: cfg.vendor, wrap: true } },
  });

  const finalize = (result: unknown): void => {
    void cfg.client.updateRun(runId, {
      endTime: new Date(),
      outputs: cfg.summarize(result),
    });
  };

  const failed = (err: unknown): void => {
    const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    void cfg.client.updateRun(runId, {
      endTime: new Date(),
      error: msg,
    });
  };

  let out: unknown;
  try {
    out = fn(...args);
  } catch (err) {
    failed(err);
    throw err;
  }

  if (out instanceof Promise) {
    return out
      .then((value) => {
        finalize(value);
        return value;
      })
      .catch((err: unknown) => {
        failed(err);
        throw err;
      });
  }
  finalize(out);
  return out;
}

// ---------------------------------------------------------------------------
// OpenAI
// ---------------------------------------------------------------------------

function summarizeOpenAI(result: unknown): Record<string, unknown> {
  const data = (result ?? {}) as Record<string, unknown>;
  const choices = (data.choices ?? []) as Array<Record<string, unknown>>;
  let text = "";
  let finishReason: string | undefined;
  if (choices.length > 0) {
    const first = choices[0] ?? {};
    const msg = (first.message ?? {}) as Record<string, unknown>;
    text =
      typeof msg.content === "string"
        ? msg.content
        : typeof first.text === "string"
          ? (first.text as string)
          : "";
    if (typeof first.finish_reason === "string") {
      finishReason = first.finish_reason as string;
    }
  }
  const usage = (data.usage ?? {}) as Record<string, unknown>;
  return {
    output: text,
    prompt_tokens: usage.prompt_tokens,
    completion_tokens: usage.completion_tokens,
    total_tokens: usage.total_tokens,
    finish_reason: finishReason,
  };
}

export function wrapOpenAI<T extends object>(
  client: T,
  options: { tracebilityClient?: Client } = {},
): T {
  const cfg: SubPathConfig = {
    client: getClient(options.tracebilityClient),
    vendor: "openai",
    pathPrefix: [],
    tracedAt: ["chat", "completions", "create"],
    summarize: summarizeOpenAI,
  };
  return makeSubPath(client, cfg) as T;
}

// ---------------------------------------------------------------------------
// Anthropic
// ---------------------------------------------------------------------------

function summarizeAnthropic(result: unknown): Record<string, unknown> {
  const data = (result ?? {}) as Record<string, unknown>;
  const blocks = (data.content ?? []) as Array<Record<string, unknown>>;
  let text = "";
  for (const block of blocks) {
    if (block && typeof block === "object" && block.type === "text") {
      text += typeof block.text === "string" ? (block.text as string) : "";
    }
  }
  const usage = (data.usage ?? {}) as Record<string, unknown>;
  const inputTok = typeof usage.input_tokens === "number" ? usage.input_tokens : 0;
  const outputTok =
    typeof usage.output_tokens === "number" ? usage.output_tokens : 0;
  return {
    output: text,
    prompt_tokens: usage.input_tokens,
    completion_tokens: usage.output_tokens,
    total_tokens: usage.input_tokens != null ? inputTok + outputTok : undefined,
    stop_reason: data.stop_reason,
  };
}

export function wrapAnthropic<T extends object>(
  client: T,
  options: { tracebilityClient?: Client } = {},
): T {
  const cfg: SubPathConfig = {
    client: getClient(options.tracebilityClient),
    vendor: "anthropic",
    pathPrefix: [],
    tracedAt: ["messages", "create"],
    summarize: summarizeAnthropic,
  };
  return makeSubPath(client, cfg) as T;
}
