/**
 * Native TypeScript SDK for tracebility.
 *
 * Tracebility-shaped client (not LangSmith-mimicking). Two surfaces:
 *
 *   - **Ingest** (write path): post traces to ingest-api's
 *     `POST /v1/runs` native envelope.
 *   - **Control** (read path): query the control-plane API for
 *     runs, threads, datasets, prompts, eval-runs, comparisons,
 *     poll-runs, playground sessions.
 *
 * For LangSmith-compat callers, use `tracebility-langsmith-shim`.
 * This package's surface is distinct — naming is tracebility-native,
 * no LangSmith concepts leak in.
 */

export { TracebilityClient } from "./client.js";
export type { TracebilityClientOptions } from "./client.js";
export { IngestClient } from "./ingest.js";
export type { IngestClientOptions } from "./ingest.js";
export { ControlClient } from "./control.js";
export type { ControlClientOptions } from "./control.js";
export { trace, span } from "./trace.js";
export type { TraceOptions } from "./trace.js";
export { TracebilityHTTPError, TracebilityError } from "./errors.js";
export type { IngestRun, IngestSpan, IngestBatch } from "./models.js";

export const VERSION = "0.0.1";
