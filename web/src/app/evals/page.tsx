import { RoadmapSurface } from "@/components/RoadmapSurface";

export const dynamic = "force-dynamic";

/**
 * Evals — the rigor half of LLM dev.
 *
 * Single-judge LLM scoring lands first; PoLL aggregation (multi-judge
 * majority) and Luna prompted-judges follow. Cost ceiling lives on the
 * project — see Workspace settings. Eval rows persist to ClickHouse so
 * regressions show up in the Insights surface alongside latency/cost.
 */

export default function EvalsPage() {
  return (
    <RoadmapSurface
      title="Evals"
      tagline="Run scored evaluations against your agents. LLM-as-judge, custom checkers, and pass/fail rubrics — versioned alongside the prompt that produced them."
      status="build"
      shipsIn="months 6–9"
      capabilities={[
        { label: "Single-judge LLM scoring (Claude / GPT / Gemini)", status: "in_build" },
        { label: "Custom Python checkers (pytest-style)", status: "in_build" },
        { label: "Pass/fail rubrics tied to a prompt revision", status: "planned" },
        { label: "PoLL aggregation (3-judge majority vote)", status: "planned" },
        { label: "Luna prompted-judges (hallucination, faithfulness)", status: "planned" },
        { label: "Cost ceiling per project (kills runaway evals)", status: "shipped" },
        { label: "Score history charted in Insights", status: "planned" },
      ]}
      dataShape={{
        name: "eval_score (ClickHouse)",
        rows: [
          { name: "eval_id", type: "String", note: "ULID" },
          { name: "run_id", type: "String", note: "FK to runs_and_spans.run_id" },
          { name: "judge", type: "LowCardinality(String)", note: "e.g. claude-haiku-4-5, luna-hallucination-v2" },
          { name: "score", type: "Float32", note: "0.0–1.0 normalized" },
          { name: "verdict", type: "Enum8", note: "pass | fail | unknown" },
          { name: "rationale", type: "String", note: "judge's chain-of-reasoning" },
          { name: "cost_usd", type: "Decimal(18, 6)", note: "for ceiling enforcement" },
          { name: "created_at", type: "DateTime64(6)" },
        ],
      }}
      preview={{
        kind: "code",
        lang: "python",
        body: `from tracebility import evals

# Single-judge: cheap, fast, default for CI.
results = evals.run(
    project="prod",
    judge="claude-haiku-4-5",
    dataset="regressions/triage-2026-q2",
    rubric="answer_is_grounded_in_context",
)

# PoLL: 3-judge majority for higher-stakes gating.
results = evals.run(
    project="prod",
    judges=["claude-haiku-4-5", "gpt-5", "gemini-2.5-flash"],
    dataset="regressions/triage-2026-q2",
    aggregator="majority",
)

print(results.summary())
# 142/150 passed (94.7%) — 3 regressions vs main:
#   row 0073: hallucinated SKU not in context
#   row 0091: refused valid request
#   row 0124: wrong tool selected
`,
      }}
    />
  );
}
