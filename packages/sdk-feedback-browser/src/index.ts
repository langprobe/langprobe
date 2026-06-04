/**
 * Browser SDK for posting end-user feedback to a tracebility ingest host.
 *
 * The wire path is `POST /v1/feedback`. Auth is a public-prefix
 * `tbf_pub_*` key that the server validates against
 * `feedback_public_key` rows (project-scoped, with optional Origin
 * allowlist). The server writes one `eval_score` row per submission
 * tagged `judge_name='user'`, `judge_endpoint='browser'`.
 *
 * Design constraints:
 *   - Zero runtime deps. Bundled size target: ≤ 2KB minified.
 *   - **Never throws on network errors.** The browser is an unreliable
 *     transport; we return `{ok: false}` and let the caller decide.
 *     Throwing an unhandled rejection inside a thumbs-up button is a
 *     bad UX bargain.
 *   - **Never silent-drops** when the server says retry-later (503):
 *     we surface that to the caller via `{ok: false, retryable: true}`
 *     so they can buffer in localStorage and retry on next page load.
 *   - Fire-and-forget by default (Promise resolves before the response
 *     is read). Awaiting `ok` is opt-in.
 */

export interface FeedbackInit {
  /** Public key prefixed with `tbf_pub_`. Required. */
  key: string;
  /** ingest-api base URL, e.g. `https://traces.example.com`. Required. */
  endpoint: string;
  /** Per-request timeout (default 5s). */
  timeoutMs?: number;
  /** Inject a custom fetch (used in tests). */
  fetchImpl?: typeof fetch;
}

export interface FeedbackPayload {
  /** UUID of the run the user is rating. */
  run_id: string;
  /** 0..1; thumbs-up = 1.0, thumbs-down = 0.0. */
  score: number;
  /** Free-form bucket: "thumbs" / "rating" / "csat" / etc. */
  kind?: string;
  /** Optional categorical label override; defaults to score>=0.5 → "pass". */
  label?: string;
  /** Free-form user comment. */
  comment?: string;
  /** Stable per-end-user identifier. Hash on your side if PII. */
  end_user_id?: string;
}

export interface FeedbackResult {
  ok: boolean;
  /** Set true on transient failures (network / 5xx) where retry is meaningful. */
  retryable?: boolean;
  /** HTTP status if the server responded; -1 on transport error. */
  status?: number;
  /** Server error body (truncated) when ok is false. */
  error?: string;
}

export class FeedbackClient {
  private readonly key: string;
  private readonly endpoint: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(init: FeedbackInit) {
    if (!init.key || !init.key.startsWith("tbf_pub_")) {
      throw new Error(
        "tracebility-feedback: `key` must be a tbf_pub_* public key",
      );
    }
    if (!init.endpoint) {
      throw new Error("tracebility-feedback: `endpoint` is required");
    }
    this.key = init.key;
    this.endpoint = init.endpoint.replace(/\/+$/, "");
    this.timeoutMs = init.timeoutMs ?? 5000;
    this.fetchImpl =
      init.fetchImpl ??
      (typeof fetch === "function" ? fetch.bind(globalThis) : null!);
    if (!this.fetchImpl) {
      throw new Error(
        "tracebility-feedback: fetch is not available; pass init.fetchImpl",
      );
    }
  }

  async submit(payload: FeedbackPayload): Promise<FeedbackResult> {
    if (!payload.run_id) return { ok: false, error: "run_id required" };
    const score = payload.score;
    if (typeof score !== "number" || !(score >= 0 && score <= 1)) {
      return { ok: false, error: "score must be a number in [0, 1]" };
    }

    const body = {
      key: this.key,
      run_id: payload.run_id,
      score,
      kind: payload.kind ?? "thumbs",
      label: payload.label,
      comment: payload.comment,
      end_user_id: payload.end_user_id,
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl(`${this.endpoint}/v1/feedback`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
        // CORS in production: the server enforces allowed_origins
        // server-side based on the Origin header; we use 'cors' so the
        // browser actually sends one.
        mode: "cors",
        // No credentials by design — public-key auth, never carry cookies.
        credentials: "omit",
        keepalive: true,
      });
      if (res.status >= 200 && res.status < 300) {
        return { ok: true, status: res.status };
      }
      const text = (await safeText(res)).slice(0, 200);
      return {
        ok: false,
        status: res.status,
        error: text,
        // 503 = data plane not ready; 5xx generally retryable. 4xx is
        // a client problem (bad key, revoked, validation) and not
        // worth retrying.
        retryable: res.status >= 500,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        status: -1,
        error: msg,
        retryable: true,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  /** Convenience: thumbs-up. */
  thumbsUp(
    run_id: string,
    extra: Omit<FeedbackPayload, "run_id" | "score" | "kind"> = {},
  ): Promise<FeedbackResult> {
    return this.submit({ run_id, score: 1, kind: "thumbs", ...extra });
  }

  /** Convenience: thumbs-down. */
  thumbsDown(
    run_id: string,
    extra: Omit<FeedbackPayload, "run_id" | "score" | "kind"> = {},
  ): Promise<FeedbackResult> {
    return this.submit({ run_id, score: 0, kind: "thumbs", ...extra });
  }
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "";
  }
}

let _global: FeedbackClient | null = null;

/**
 * Initialize a process-global feedback client. Use this if you want
 * to wire up feedback in a single place and call `submit(...)` from
 * UI components without threading the client.
 */
export function init(opts: FeedbackInit): FeedbackClient {
  _global = new FeedbackClient(opts);
  return _global;
}

/**
 * Submit using the process-global client (set up via `init`). Throws
 * a friendly error if `init` hasn't been called.
 */
export function submit(payload: FeedbackPayload): Promise<FeedbackResult> {
  if (!_global) {
    return Promise.resolve({
      ok: false,
      error: "tracebility-feedback: call init({key, endpoint}) first",
    });
  }
  return _global.submit(payload);
}

export const VERSION = "0.0.1";
