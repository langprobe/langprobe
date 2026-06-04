/**
 * Wire-shape interfaces for the SDK.
 *
 * These mirror the ingest-api's pydantic schemas in TypeScript without
 * a runtime validator. Fields are snake_case to match the wire — the
 * code that builds these is responsible for honoring the shape; the
 * server-side pydantic does the validation.
 */

export interface IngestSpan {
  span_id: string;
  run_id: string;
  parent_span_id?: string | null;
  name: string;
  kind: string;
  status?: string;
  start_time?: string;
  end_time?: string | null;
  model?: string | null;
  temperature?: number | null;
  inputs?: string | null;
  outputs?: string | null;
  prompt_tokens?: number | null;
  completion_tokens?: number | null;
  total_tokens?: number | null;
  cost_usd?: number | null;
  error_kind?: string | null;
  error_message?: string | null;
  attributes?: Record<string, unknown>;
}

export interface IngestRun {
  run_id: string;
  parent_run_id?: string | null;
  name: string;
  kind: string;
  status?: string;
  sdk?: string;
  start_time?: string;
  end_time?: string | null;
  inputs?: string | null;
  outputs?: string | null;
  prompt_tokens?: number | null;
  completion_tokens?: number | null;
  total_tokens?: number | null;
  cost_usd?: number | null;
  session_id?: string | null;
  user_id?: string | null;
  tags?: string[];
  metadata?: Record<string, unknown>;
  error_kind?: string | null;
  error_message?: string | null;
  spans?: IngestSpan[];
}

export interface IngestBatch {
  runs?: IngestRun[];
  spans?: IngestSpan[];
  sdk?: string;
  sdk_version?: string;
  schema_version?: number;
}
