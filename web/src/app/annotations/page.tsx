import { RoadmapSurface } from "@/components/RoadmapSurface";

export const dynamic = "force-dynamic";

/**
 * Annotations — human review queue.
 *
 * Sample runs into a queue, route by tag/score/random, present a side-
 * by-side labeling UI for human raters, and turn agreement into ground
 * truth for the eval system. LangSmith calls this "annotation queues" —
 * it's the bridge between hand-labeled examples and automated judges.
 */

export default function AnnotationsPage() {
  return (
    <RoadmapSurface
      title="Annotations"
      tagline="Send sampled runs to human reviewers. Build queues, define rubrics, capture judgments — and use the result to calibrate your LLM judges or seed regression datasets."
      status="design"
      shipsIn="months 8–11"
      capabilities={[
        { label: "Define annotation queues with sampling rules", status: "planned" },
        { label: "Custom rubrics (categorical, scalar, free-text)", status: "planned" },
        { label: "Reviewer assignment + load balancing", status: "planned" },
        { label: "Inter-rater agreement reporting (Cohen's κ)", status: "planned" },
        { label: "Promote labeled rows to a dataset version", status: "planned" },
        { label: "Calibrate LLM judges against human consensus", status: "planned" },
      ]}
      dataShape={{
        name: "annotations (Postgres)",
        rows: [
          { name: "queue.id", type: "uuid" },
          { name: "queue.slug", type: "text", note: "e.g. triage-quality-q2" },
          { name: "queue.sampling_rule", type: "jsonb", note: "filter + rate" },
          { name: "queue.rubric_id", type: "uuid", note: "FK rubrics" },
          { name: "rubric.fields", type: "jsonb", note: "list of {key, type, options}" },
          { name: "annotation.id", type: "uuid" },
          { name: "annotation.queue_id", type: "uuid", note: "FK" },
          { name: "annotation.run_id", type: "text", note: "FK runs" },
          { name: "annotation.reviewer_id", type: "uuid", note: "FK users" },
          { name: "annotation.values", type: "jsonb", note: "rubric responses" },
          { name: "annotation.created_at", type: "timestamptz" },
        ],
      }}
      preview={{
        kind: "shell",
        lang: "bash",
        body: `# Create a queue that samples 5% of error runs from the last day.
$ tracebility annotations queue create \\
    --slug triage-errors-2026-q2 \\
    --rubric is_user_error_handled_well \\
    --filter 'status=error AND start_time>=now()-1d' \\
    --sample-rate 0.05 \\
    --reviewers alice,bob,carol

# Reviewers see a queue card in the UI; programmatic export:
$ tracebility annotations export \\
    --queue triage-errors-2026-q2 \\
    --format jsonl > labels.jsonl

# Roll up to ground truth + agreement.
$ tracebility annotations agreement triage-errors-2026-q2
Cohen's κ (alice ↔ bob): 0.78
Cohen's κ (alice ↔ carol): 0.71
Cohen's κ (bob ↔ carol): 0.74
N=240, all-three-agree on 81%
`,
      }}
    />
  );
}
