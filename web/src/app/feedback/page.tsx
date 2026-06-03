import { RoadmapSurface } from "@/components/RoadmapSurface";

export const dynamic = "force-dynamic";

/**
 * Feedback — end-user signal capture.
 *
 * The thumbs-up/down on the chat reply, the star rating on the
 * generated email — write that signal back against the run that
 * produced it. End users use a public scoped key; internal raters
 * use the Annotations queue. Both flow into the same eval_score
 * table so dashboards see one truth.
 */

export default function FeedbackPage() {
  return (
    <RoadmapSurface
      title="Feedback"
      tagline="Capture thumbs-up/down, ratings, or free-text from your end users — tied directly to the run that generated the response. Same store as eval scores; same dashboards."
      status="design"
      shipsIn="months 4–6"
      capabilities={[
        { label: "Public scoped keys (write-only, per-project)", status: "planned" },
        { label: "Submit feedback by run_id from any client", status: "planned" },
        { label: "Categorical (👍/👎), scalar (1–5), free-text", status: "planned" },
        { label: "Aggregated in Monitoring as feedback_score", status: "planned" },
        { label: "JS snippet for browser-side capture", status: "planned" },
        { label: "Mobile SDKs (iOS/Android) feedback helpers", status: "planned" },
      ]}
      dataShape={{
        name: "eval_score (ClickHouse — shared with Evals)",
        rows: [
          { name: "eval_id", type: "String", note: "ULID" },
          { name: "run_id", type: "String", note: "FK runs_and_spans.run_id" },
          { name: "judge", type: "LowCardinality(String)", note: "'user' for end-user feedback" },
          { name: "score", type: "Float32", note: "0=down, 1=up; or 0.0–1.0 scalar" },
          { name: "verdict", type: "Enum8", note: "pass | fail | unknown" },
          { name: "rationale", type: "String", note: "free-text comment, optional" },
          { name: "metadata", type: "JSON", note: "{end_user_id?, kind: 'thumbs'|'rating'|'text'}" },
          { name: "created_at", type: "DateTime64(6)" },
        ],
      }}
      preview={{
        kind: "code",
        lang: "javascript",
        body: `// Browser snippet — public scoped key, write-only.
import { Tracebility } from "@tracebility/feedback";

const tb = new Tracebility({ publicKey: "tbf_pub_..." });

// In your UI when the user clicks 👍 / 👎:
function onThumbs(runId, isUp) {
  tb.feedback({
    runId,
    score: isUp ? 1 : 0,
    kind: "thumbs",
    endUserId: currentUser.id,
  });
}

// Or scalar:
tb.feedback({ runId, score: 0.8, kind: "rating", rationale: "useful but slow" });
`,
      }}
    />
  );
}
