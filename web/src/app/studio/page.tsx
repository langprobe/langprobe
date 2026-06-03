import { RoadmapSurface } from "@/components/RoadmapSurface";

export const dynamic = "force-dynamic";

/**
 * Studio — visual canvas for branching real traces.
 *
 * Studio depends on Replay shipping first: it's the UI that lets you
 * pick a node in a captured trace, edit it (prompt, model, tool args),
 * and replay the rest of the run from that point. Round-trips with
 * Prompts (save the edit as a candidate revision) and Evals (gate the
 * candidate before promoting). Latest of the surfaces — months 14–22.
 */

export default function StudioPage() {
  return (
    <RoadmapSurface
      title="Studio"
      tagline="Build and tune agent flows in a visual canvas. Branch on a real trace, edit a node, replay against the same fixture — round-trip with the prompts and evals views."
      status="design"
      shipsIn="months 14–22 (depends on Replay)"
      capabilities={[
        { label: "Open any captured run as an editable canvas", status: "planned" },
        { label: "Edit a node (prompt, model, tool args) in place", status: "planned" },
        { label: "Replay from edit point against same fixture", status: "planned" },
        { label: "Save edit as a candidate prompt revision", status: "planned" },
        { label: "Gate the candidate with one-click eval run", status: "planned" },
        { label: "Side-by-side: original vs branch divergence", status: "planned" },
      ]}
      bridges={[
        { name: "Replay (required dependency)", status: "planned" },
        { name: "Prompts revisions", status: "planned" },
        { name: "Evals rubrics", status: "planned" },
      ]}
      dataShape={{
        name: "studio_branch (Postgres)",
        rows: [
          { name: "branch.id", type: "uuid" },
          { name: "branch.source_run_id", type: "text", note: "the trace being branched" },
          { name: "branch.source_span_id", type: "text", note: "the node where edit starts" },
          { name: "branch.author_id", type: "uuid", note: "FK users" },
          { name: "branch.edits", type: "jsonb", note: "ordered list of node edits" },
          { name: "branch.replay_run_id", type: "text", note: "result of the branched replay" },
          { name: "branch.created_at", type: "timestamptz" },
        ],
      }}
      preview={{
        kind: "code",
        lang: "python",
        body: `# Studio is the UI on top of replay + prompts. Programmatically
# (which is what the canvas does under the hood):
from tracebility import studio

branch = studio.branch_from(
    run_id="01J9Z...QXR",
    at_span="4f2a",  # the llm_router node
    edits={
        "prompt": "Be more conservative — refuse if context is missing.",
        "model": "claude-sonnet-4-6",
    },
)

# Replay the rest of the run with the edit applied.
result = branch.replay()
print(result.diff_summary())
# 3 spans diverged from source run:
#   4f2a llm_router: route changed account_lookup → escalate
#   5c1b final_response: refused with citation request
#   5c1c (new) — clarification turn injected

# Save as a candidate; gate with evals before promoting.
branch.save_as_prompt_candidate(slug="triage-router")
`,
      }}
    />
  );
}
