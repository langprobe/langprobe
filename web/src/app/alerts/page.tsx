import { RoadmapSurface } from "@/components/RoadmapSurface";

export const dynamic = "force-dynamic";

/**
 * Alerts — rules over monitoring rollups.
 *
 * Define a threshold (error rate > 2% for 5 min) or a delta (eval score
 * dropped > 5pp vs last week) and route to Slack, PagerDuty, webhook,
 * or email. Fires on the same ClickHouse rollups Monitoring queries —
 * single source of truth, no double-counting.
 */

export default function AlertsPage() {
  return (
    <RoadmapSurface
      title="Alerts"
      tagline="Rules over your monitoring metrics. Threshold and delta alerts on error rate, latency, eval score, or cost. Routes to Slack, PagerDuty, webhook, or email."
      status="design"
      shipsIn="months 6–8"
      capabilities={[
        { label: "Threshold alerts (error rate > X for Y minutes)", status: "planned" },
        { label: "Delta alerts (score dropped Z pp vs last period)", status: "planned" },
        { label: "Slack / PagerDuty / generic webhook / email", status: "planned" },
        { label: "Per-project alert routing", status: "planned" },
        { label: "Snooze / acknowledge from the UI", status: "planned" },
        { label: "Alert history with linked runs", status: "planned" },
      ]}
      dataShape={{
        name: "alerts (Postgres)",
        rows: [
          { name: "rule.id", type: "uuid" },
          { name: "rule.project_id", type: "uuid", note: "FK" },
          { name: "rule.name", type: "text" },
          { name: "rule.metric", type: "text", note: "error_rate | latency_p95 | eval_score | cost_per_hour" },
          { name: "rule.condition", type: "jsonb", note: "{op, threshold, window_seconds}" },
          { name: "rule.routes", type: "jsonb", note: "[{kind: slack|pd|webhook|email, target}]" },
          { name: "rule.enabled", type: "boolean" },
          { name: "incident.id", type: "uuid" },
          { name: "incident.rule_id", type: "uuid", note: "FK" },
          { name: "incident.opened_at", type: "timestamptz" },
          { name: "incident.resolved_at", type: "timestamptz", note: "nullable" },
          { name: "incident.peak_value", type: "numeric" },
        ],
      }}
      preview={{
        kind: "shell",
        lang: "bash",
        body: `# Define an alert via CLI (UI is coming).
$ tracebility alerts create \\
    --project prod \\
    --name "checkout error spike" \\
    --metric error_rate \\
    --where 'tag.flow="checkout"' \\
    --condition '> 0.02 for 5m' \\
    --route 'slack:#oncall' \\
    --route 'pagerduty:checkout-team'

rule_01J9ZK...QXR created (enabled)

# When it fires, the Slack message links straight to the failing runs:
# ⚠️ checkout error spike — 3.4% over 5m (was 0.6% yesterday)
#    See 28 affected runs: https://tracability.local/runs?incident=...
`,
      }}
    />
  );
}
