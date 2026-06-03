import { RoadmapSurface } from "@/components/RoadmapSurface";

export const dynamic = "force-dynamic";

/**
 * Comparisons — A/B experiments across runs, prompts, models.
 *
 * "Did revision B beat revision A on the regression dataset?" — a
 * single page that runs both against the same dataset, scores both
 * with the same judge, and shows pass/fail per row + cost/latency
 * deltas. The decision tool that closes the eval loop.
 */

export default function ComparisonsPage() {
  return (
    <RoadmapSurface
      title="Comparisons"
      tagline="A/B two prompt revisions, two models, or two experiments against the same dataset. Pass/fail per row, latency and cost deltas, statistical significance — the decision tool."
      status="design"
      shipsIn="months 7–10"
      capabilities={[
        { label: "Compare two prompt revisions on a dataset", status: "planned" },
        { label: "Compare two models on a dataset", status: "planned" },
        { label: "Per-row pass/fail diff (with rationale)", status: "planned" },
        { label: "Latency p50/p95 + cost delta", status: "planned" },
        { label: "Statistical significance (paired t-test, McNemar)", status: "planned" },
        { label: "Save winner as the new production tag", status: "planned" },
      ]}
      dataShape={{
        name: "experiment (Postgres) + run_pair (ClickHouse)",
        rows: [
          { name: "experiment.id", type: "uuid" },
          { name: "experiment.dataset_version_id", type: "uuid", note: "FK" },
          { name: "experiment.judge", type: "text", note: "judge slug" },
          { name: "experiment.arm_a", type: "jsonb", note: "{prompt_revision_id?, model?}" },
          { name: "experiment.arm_b", type: "jsonb" },
          { name: "experiment.created_at", type: "timestamptz" },
          { name: "run_pair.experiment_id", type: "String" },
          { name: "run_pair.dataset_row_id", type: "String" },
          { name: "run_pair.run_id_a", type: "String" },
          { name: "run_pair.run_id_b", type: "String" },
          { name: "run_pair.score_a", type: "Float32" },
          { name: "run_pair.score_b", type: "Float32" },
          { name: "run_pair.cost_diff_usd", type: "Decimal(18, 6)" },
          { name: "run_pair.latency_diff_ms", type: "Int32" },
        ],
      }}
      preview={{
        kind: "code",
        lang: "python",
        body: `from tracebility import comparisons

# Compare a candidate prompt against production on a dataset.
exp = comparisons.run(
    dataset="regressions/triage-2026-q2",
    judge="claude-haiku-4-5",
    arm_a={"prompt": "triage-router@production"},
    arm_b={"prompt": "triage-router@candidate"},
)

print(exp.summary())
# arm_b beat arm_a:
#   pass rate: 0.927 → 0.953 (+2.6pp, p=0.018, McNemar)
#   median latency: 1240ms → 1180ms (-60ms)
#   median cost: $0.0042 → $0.0048 (+$0.0006)
# 4 rows regressed; 8 rows fixed; 138 unchanged.

# Promote candidate → production.
exp.promote(arm="b", as_tag="production")
`,
      }}
    />
  );
}
