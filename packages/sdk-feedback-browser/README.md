# tracebility-feedback-browser

Tiny browser SDK for posting end-user feedback (thumbs / scores /
comments) to a self-hosted tracebility ingest host. Zero runtime
deps; targeting ~2KB minified.

The wire path is `POST /v1/feedback`. Auth is a public-prefix
`tbf_pub_*` key (created in the tracebility UI under Feedback → New
key). The server writes one `eval_score` row per submission tagged
`judge_name='user'`, so end-user feedback aggregates alongside LLM
judges, comparisons, and human annotations in the same store.

## Install

```bash
npm install tracebility-feedback-browser
```

## Use

```ts
import { init, submit } from "tracebility-feedback-browser";

init({
  key: "tbf_pub_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  endpoint: "https://traces.example.com",
});

// Thumbs-up on a captured run
await submit({
  run_id: "01J9...QXR",
  score: 1,
  kind: "thumbs",
  comment: "exactly what I wanted",
});
```

Or instantiate per-component:

```ts
import { FeedbackClient } from "tracebility-feedback-browser";

const fb = new FeedbackClient({ key: "tbf_pub_...", endpoint: "..." });
await fb.thumbsUp(runId, { end_user_id: hashedUser });
await fb.thumbsDown(runId, { comment: "irrelevant" });
```

## Design

- **Never throws on network errors.** The browser is an unreliable
  transport; throwing inside a thumbs-up handler is bad UX. All
  failures resolve as `{ok: false}` with `.retryable` set when retry
  is meaningful (network / 5xx). 4xx (bad key, revoked, validation)
  is `retryable: false`.
- **Public-key auth, never carries cookies.** The fetch uses
  `credentials: 'omit'` so a misconfigured CORS allow-credentials
  doesn't accidentally leak session state to the ingest host.
- **CORS allowlist enforced server-side.** The tracebility key row
  carries `allowed_origins`; if your origin isn't on the list the
  server returns 403 and you'll see it in the result.
- `keepalive: true` so a `submit(...)` issued during page unload
  has a fighting chance of completing.
