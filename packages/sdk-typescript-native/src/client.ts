/**
 * `TracebilityClient` — bundles ingest + control under one object.
 *
 * Use this when your service does both write and read.
 *
 * Configuration:
 *   TRACEBILITY_INGEST_URL / TRACEBILITY_INGEST_KEY  → write path
 *   TRACEBILITY_API_URL    / TRACEBILITY_API_KEY     → read path
 *
 * In production these typically point at different hosts (ingest on
 * a public host with API-key auth, control on an internal/admin host
 * with cookie + workspace key auth) so we keep two transports rather
 * than one shared fetch.
 */

import { ControlClient } from "./control.js";
import { IngestClient } from "./ingest.js";
import type { IngestBatch, IngestRun, IngestSpan } from "./models.js";

export interface TracebilityClientOptions {
  projectId: string;
  ingestUrl?: string;
  ingestKey?: string;
  apiUrl?: string;
  apiKey?: string;
  timeoutMs?: number;
  ingestFetch?: typeof fetch;
  apiFetch?: typeof fetch;
}

export class TracebilityClient {
  readonly projectId: string;
  readonly ingest: IngestClient;
  readonly control: ControlClient;

  // Convenience aliases — let callers do `client.runs.list()` without
  // going through `.control.runs`.
  readonly runs: ControlClient["runs"];
  readonly threads: ControlClient["threads"];
  readonly datasets: ControlClient["datasets"];
  readonly prompts: ControlClient["prompts"];
  readonly evals: ControlClient["evals"];
  readonly poll: ControlClient["poll"];
  readonly comparisons: ControlClient["comparisons"];
  readonly playground: ControlClient["playground"];

  constructor(opts: TracebilityClientOptions) {
    this.projectId = opts.projectId;
    this.ingest = new IngestClient({
      apiUrl: opts.ingestUrl,
      apiKey: opts.ingestKey,
      timeoutMs: opts.timeoutMs,
      fetchImpl: opts.ingestFetch,
    });
    this.control = new ControlClient({
      projectId: opts.projectId,
      apiUrl: opts.apiUrl,
      apiKey: opts.apiKey,
      timeoutMs: opts.timeoutMs,
      fetchImpl: opts.apiFetch,
    });
    this.runs = this.control.runs;
    this.threads = this.control.threads;
    this.datasets = this.control.datasets;
    this.prompts = this.control.prompts;
    this.evals = this.control.evals;
    this.poll = this.control.poll;
    this.comparisons = this.control.comparisons;
    this.playground = this.control.playground;
  }

  submitBatch(batch: IngestBatch): Promise<unknown> {
    return this.ingest.submitBatch(batch);
  }

  submitRun(run: IngestRun, spans?: IngestSpan[]): Promise<unknown> {
    return this.ingest.submitRun(run, spans);
  }
}
