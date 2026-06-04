/**
 * Read path: query the control-plane API.
 *
 * Each surface (`runs`, `threads`, `datasets`, `prompts`, `evals`,
 * `comparisons`, `poll`, `playground`) is a thin namespace. Methods
 * return raw response objects (the server's pydantic JSON shape) — we
 * don't impose a parallel typed model since the wire shape evolves.
 */

import { HTTP, envFirst } from "./_http.js";

export interface ControlClientOptions {
  projectId: string;
  apiUrl?: string;
  apiKey?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

class _Surface {
  protected readonly http: HTTP;
  protected readonly projectId: string;
  constructor(http: HTTP, projectId: string) {
    this.http = http;
    this.projectId = projectId;
  }
}

class _Runs extends _Surface {
  list(opts: {
    status?: string;
    kind?: string;
    search?: string;
    window_seconds?: number;
    limit?: number;
    offset?: number;
  } = {}): Promise<{ items: Record<string, unknown>[] }> {
    return this.http.get("/v1/runs", {
      project_id: this.projectId,
      status: opts.status,
      kind: opts.kind,
      search: opts.search,
      window_seconds: opts.window_seconds,
      limit: opts.limit ?? 100,
      offset: opts.offset ?? 0,
    });
  }
  get(runId: string): Promise<Record<string, unknown>> {
    return this.http.get(`/v1/runs/${runId}`, { project_id: this.projectId });
  }
  spans(runId: string): Promise<{ items: Record<string, unknown>[] }> {
    return this.http.get(`/v1/runs/${runId}/spans`, { project_id: this.projectId });
  }
  replayCaptures(runId: string, opts: { limit?: number } = {}): Promise<Record<string, unknown>> {
    return this.http.get(`/v1/runs/${runId}/replay-captures`, {
      project_id: this.projectId,
      limit: opts.limit ?? 500,
    });
  }
}

class _Threads extends _Surface {
  list(): Promise<Record<string, unknown>[]> {
    return this.http.get("/v1/threads", { project_id: this.projectId });
  }
  get(sessionId: string): Promise<Record<string, unknown>> {
    return this.http.get(`/v1/threads/${sessionId}`, { project_id: this.projectId });
  }
}

class _Datasets extends _Surface {
  list(): Promise<Record<string, unknown>[]> {
    return this.http.get("/v1/datasets", { project_id: this.projectId });
  }
  get(datasetId: string): Promise<Record<string, unknown>> {
    return this.http.get(`/v1/datasets/${datasetId}`);
  }
  items(datasetId: string, opts: { limit?: number } = {}): Promise<{ items: Record<string, unknown>[] }> {
    return this.http.get(`/v1/datasets/${datasetId}/items`, {
      limit: opts.limit ?? 200,
    });
  }
  addItem(
    datasetId: string,
    body: {
      input: string;
      expected: string;
      metadata?: Record<string, unknown>;
      source_run_id?: string;
      source_span_id?: string;
    },
  ): Promise<Record<string, unknown>> {
    return this.http.post(`/v1/datasets/${datasetId}/items`, body);
  }
}

class _Prompts extends _Surface {
  list(): Promise<Record<string, unknown>[]> {
    return this.http.get("/v1/prompts", { project_id: this.projectId });
  }
  get(promptId: string): Promise<Record<string, unknown>> {
    return this.http.get(`/v1/prompts/${promptId}`);
  }
  versions(promptId: string): Promise<{ versions: Record<string, unknown>[] }> {
    return this.http.get(`/v1/prompts/${promptId}/versions`);
  }
  createVersion(
    promptId: string,
    body: {
      template: string;
      input_schema?: Record<string, unknown>;
      model_params?: Record<string, unknown>;
      aliases?: string[];
      commit_message?: string;
    },
  ): Promise<Record<string, unknown>> {
    return this.http.post(`/v1/prompts/${promptId}/versions`, body);
  }
}

class _Evals extends _Surface {
  list(): Promise<Record<string, unknown>[]> {
    return this.http.get("/v1/eval-runs", { project_id: this.projectId });
  }
  get(runId: string): Promise<Record<string, unknown>> {
    return this.http.get(`/v1/eval-runs/${runId}`);
  }
  scores(runId: string, opts: { limit?: number } = {}): Promise<{ scores: Record<string, unknown>[] }> {
    return this.http.get(`/v1/eval-runs/${runId}/scores`, { limit: opts.limit ?? 200 });
  }
  create(body: {
    dataset_id: string;
    judge_kind: string;
    name?: string;
    prompt_id?: string;
    prompt_version_id?: string;
  }): Promise<Record<string, unknown>> {
    return this.http.post("/v1/eval-runs", { project_id: this.projectId, ...body });
  }
}

class _Poll extends _Surface {
  list(): Promise<Record<string, unknown>[]> {
    return this.http.get("/v1/poll-runs", { project_id: this.projectId });
  }
  get(pollId: string): Promise<Record<string, unknown>> {
    return this.http.get(`/v1/poll-runs/${pollId}`);
  }
  items(pollId: string, opts: { limit?: number } = {}): Promise<{ items: Record<string, unknown>[] }> {
    return this.http.get(`/v1/poll-runs/${pollId}/items`, { limit: opts.limit ?? 500 });
  }
  create(body: {
    dataset_id: string;
    judges: string[];
    aggregation?: string;
    name?: string;
  }): Promise<Record<string, unknown>> {
    return this.http.post("/v1/poll-runs", {
      project_id: this.projectId,
      aggregation: "mean",
      ...body,
    });
  }
}

class _Comparisons extends _Surface {
  list(): Promise<Record<string, unknown>[]> {
    return this.http.get("/v1/comparisons", { project_id: this.projectId });
  }
  get(comparisonId: string): Promise<Record<string, unknown>> {
    return this.http.get(`/v1/comparisons/${comparisonId}`);
  }
  items(
    comparisonId: string,
    opts: { limit?: number } = {},
  ): Promise<{ items: Record<string, unknown>[] }> {
    return this.http.get(`/v1/comparisons/${comparisonId}/items`, { limit: opts.limit ?? 500 });
  }
}

class _Playground extends _Surface {
  list(opts: { limit?: number } = {}): Promise<{ items: Record<string, unknown>[] }> {
    return this.http.get("/v1/playground/runs", {
      project_id: this.projectId,
      limit: opts.limit ?? 50,
    });
  }
  get(sessionId: string): Promise<Record<string, unknown>> {
    return this.http.get(`/v1/playground/runs/${sessionId}`);
  }
  run(body: {
    model: string;
    prompt_version_id?: string;
    raw_template?: string;
    variables?: Record<string, unknown>;
    temperature?: number;
    max_tokens?: number;
  }): Promise<Record<string, unknown>> {
    return this.http.post("/v1/playground/runs", {
      project_id: this.projectId,
      variables: body.variables ?? {},
      ...body,
    });
  }
}

export class ControlClient {
  private readonly http: HTTP;
  readonly runs: _Runs;
  readonly threads: _Threads;
  readonly datasets: _Datasets;
  readonly prompts: _Prompts;
  readonly evals: _Evals;
  readonly poll: _Poll;
  readonly comparisons: _Comparisons;
  readonly playground: _Playground;

  constructor(opts: ControlClientOptions) {
    const url =
      opts.apiUrl ?? envFirst("TRACEBILITY_API_URL") ?? "http://localhost:7081";
    const key = opts.apiKey ?? envFirst("TRACEBILITY_API_KEY");
    this.http = new HTTP({
      baseUrl: url,
      apiKey: key,
      timeoutMs: opts.timeoutMs,
      fetchImpl: opts.fetchImpl,
    });
    const pid = opts.projectId;
    this.runs = new _Runs(this.http, pid);
    this.threads = new _Threads(this.http, pid);
    this.datasets = new _Datasets(this.http, pid);
    this.prompts = new _Prompts(this.http, pid);
    this.evals = new _Evals(this.http, pid);
    this.poll = new _Poll(this.http, pid);
    this.comparisons = new _Comparisons(this.http, pid);
    this.playground = new _Playground(this.http, pid);
  }

  get baseUrl(): string {
    return this.http.base;
  }
}
