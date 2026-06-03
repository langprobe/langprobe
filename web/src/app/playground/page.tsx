import { RoadmapSurface } from "@/components/RoadmapSurface";

export const dynamic = "force-dynamic";

/**
 * Playground — interactive prompt + model testing.
 *
 * Pick a prompt revision (or paste raw), pick a model, fill the input
 * variables, run side-by-side against multiple models. Results write
 * to the trace store like any other run, so you can promote a winner
 * straight to a candidate prompt revision. The "open this run in the
 * playground" affordance closes the loop from production to iteration.
 */

export default function PlaygroundPage() {
  return (
    <RoadmapSurface
      title="Playground"
      tagline="Run any prompt revision against any model with custom inputs. Side-by-side comparison, traced like production, one click to promote a winner to a candidate revision."
      status="design"
      shipsIn="months 7–10"
      capabilities={[
        { label: "Pick prompt revision or paste raw template", status: "planned" },
        { label: "Side-by-side multi-model comparison", status: "planned" },
        { label: "Fill input variables (typed against schema)", status: "planned" },
        { label: "Stream tokens live in the UI", status: "planned" },
        { label: "Save run as candidate revision (one click)", status: "planned" },
        { label: '"Open in playground" from any production trace', status: "planned" },
      ]}
      dataShape={{
        name: "playground_session (Postgres)",
        rows: [
          { name: "session.id", type: "uuid" },
          { name: "session.user_id", type: "uuid", note: "FK users" },
          { name: "session.project_id", type: "uuid", note: "FK projects" },
          { name: "session.prompt_revision_id", type: "uuid", note: "FK prompt_revision (nullable for raw)" },
          { name: "session.raw_template", type: "text", note: "if not bound to a revision" },
          { name: "session.inputs", type: "jsonb", note: "the variable values" },
          { name: "session.models", type: "text[]", note: "models compared in this session" },
          { name: "session.run_ids", type: "text[]", note: "FK to runs (one per model)" },
          { name: "session.created_at", type: "timestamptz" },
        ],
      }}
      preview={{
        kind: "code",
        lang: "python",
        body: `from tracebility import playground

# Programmatic playground (UI is the visual version of this).
session = playground.run(
    prompt="triage-router@candidate",
    inputs={
        "user_message": "I want a refund for order #12345",
        "history": [{"role": "user", "content": "..."}],
    },
    models=["claude-sonnet-4-6", "gpt-5", "gemini-2.5-pro"],
)

for r in session.results:
    print(r.model, r.latency_ms, r.cost_usd)
    print(r.output[:200])

# Promote the winner.
playground.promote(
    session_id=session.id,
    winner_model="claude-sonnet-4-6",
    as_tag="candidate",
)
`,
      }}
    />
  );
}
