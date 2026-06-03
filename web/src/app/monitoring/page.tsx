import { RoadmapSurface } from "@/components/RoadmapSurface";

export const dynamic = "force-dynamic";

/**
 * Monitoring — time-series dashboards.
 *
 * The aggregate view: latency p50/p95/p99, cost per run, error rate,
 * eval score over time, broken down by model, prompt revision, tag.
 * Backs the Insights surface and feeds Alerts. Built on the same
 * ClickHouse runs_and_spans + eval_score tables — no extra writes.
 */

export default function MonitoringPage() {
  return (
    <RoadmapSurface
      title="Monitoring"
      tagline="Latency, cost, error rate, and eval score over time. Group by model, prompt revision, tag, or custom dimension. The aggregate view that surfaces drift before users complain."
      status="design"
      shipsIn="months 5–7"
      capabilities={[
        { label: "Latency: p50 / p95 / p99 over time", status: "planned" },
        { label: "Cost per run, per project, per day", status: "planned" },
        { label: "Error rate + drill-into-failing-runs", status: "planned" },
        { label: "Eval score over time (per judge, per dataset)", status: "planned" },
        { label: "Group-by: model, prompt revision, tag", status: "planned" },
        { label: "Custom dashboards saved per workspace", status: "planned" },
        { label: "Compare two time ranges (e.g. this week vs last)", status: "planned" },
      ]}
      dataShape={{
        name: "rollups (ClickHouse materialized views over runs_and_spans)",
        rows: [
          { name: "bucket_start", type: "DateTime64(0)", note: "1m / 5m / 1h granularities" },
          { name: "project_id", type: "String" },
          { name: "model", type: "LowCardinality(String)" },
          { name: "prompt_revision_id", type: "String", note: "nullable" },
          { name: "run_count", type: "UInt64" },
          { name: "error_count", type: "UInt64" },
          { name: "latency_p50_ms", type: "UInt32" },
          { name: "latency_p95_ms", type: "UInt32" },
          { name: "latency_p99_ms", type: "UInt32" },
          { name: "total_cost_usd", type: "Decimal(18, 6)" },
          { name: "avg_eval_score", type: "Float32" },
        ],
      }}
      preview={{
        kind: "shell",
        lang: "bash",
        body: `# Programmatic dashboards via the read API.
$ curl -H "Authorization: Bearer $TRACEBILITY_API_KEY" \\
    'https://tracability.local/v1/metrics?\\
project=prod&\\
metric=latency_p95_ms&\\
group_by=model&\\
range=24h&\\
bucket=5m'

{
  "buckets": [
    { "t": "2026-06-03T00:00:00Z", "claude-sonnet-4-6": 1240, "gpt-5": 980 },
    { "t": "2026-06-03T00:05:00Z", "claude-sonnet-4-6": 1180, "gpt-5": 1020 },
    ...
  ]
}
`,
      }}
    />
  );
}
