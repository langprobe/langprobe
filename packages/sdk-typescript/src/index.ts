/**
 * tracebility LangSmith-compat shim (TypeScript port).
 *
 * Drop-in adapter for codebases that already call into the LangSmith
 * `Client` surface. Point this at a tracebility ingest host and the
 * same code keeps working — runs land in tracebility's ClickHouse
 * without SDK rewrites.
 *
 * Nominative fair use only. The package name is
 * `tracebility-langsmith-shim`; we do not ship a package named
 * `langsmith`. The import is intentionally close to the real
 * LangSmith JS client so the migration is one line:
 *
 *   - import { Client, traceable } from "langsmith";
 *   + import { Client, traceable } from "tracebility-langsmith-shim";
 *
 * This shim covers the WRITE path. The read API surface
 * (`readRun`, `listRuns`, `readProject`) lives on the native
 * tracebility JS SDK because the read shapes meaningfully differ
 * between LangSmith and tracebility — pretending otherwise would
 * mask bugs.
 */

export { Client } from "./client.js";
export type { ClientOptions, RunCreate, RunUpdate, RunPayload } from "./client.js";
export { traceable } from "./traceable.js";
export type { TraceableOptions } from "./traceable.js";
export { wrapOpenAI, wrapAnthropic } from "./wrappers.js";

export const VERSION = "0.0.1";
