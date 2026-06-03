import { Shell } from "@/components/Shell";
import {
  type AlertEventRow,
  type AlertRuleRow,
  DeleteAlertRuleButton,
  NewAlertRuleButton,
  ToggleAlertEnabledButton,
} from "@/components/AlertsClient";
import { apiGet } from "@/lib/api";
import { resolveActiveProject, type Project } from "@/lib/projects";

/**
 * Alerts — rules over the same ClickHouse `run` rollups Monitoring queries.
 *
 * Server component. Parallel-fetches the rules list and recent event
 * history from FastAPI; client controls (NewAlertRuleButton, snooze
 * toggle, delete) live in `AlertsClient.tsx`. The evaluator that
 * actually fires/resolves runs in-process from the API lifespan, so
 * by the time the page renders the rule's `last_evaluated_at` is
 * already up to date.
 */

export const dynamic = "force-dynamic";

interface AlertEventListWire {
  events: AlertEventRow[];
}

export default async function AlertsPage() {
  const { active, all, reason } = await resolveActiveProject();

  if (!active) {
    return (
      <Shell active={null} projects={all}>
        <PageInterior>
          <PageHeader title="Alerts" subtitle="rules + incident history" />
          <UnconfiguredState reason={reason} />
        </PageInterior>
      </Shell>
    );
  }

  const [rulesRes, eventsRes] = await Promise.all([
    apiGet<AlertRuleRow[]>(
      `/v1/alerts?project_id=${encodeURIComponent(active.id)}`,
    ),
    apiGet<AlertEventListWire>(
      `/v1/alerts/events?project_id=${encodeURIComponent(active.id)}&limit=200`,
    ),
  ]);

  const rules = rulesRes.data ?? [];
  const events = eventsRes.data?.events ?? [];

  const activeRules = rules.filter((r) => r.enabled).length;
  const openIncidents = rules.filter((r) => r.open_incident_id).length;
  const eventsLast24h = events.filter((e) => isWithin24h(e.occurred_at)).length;
  const longestOpenSeconds = computeLongestOpen(rules, events);

  return (
    <Shell active={active} projects={all}>
      <PageInterior>
        <PageHeader
          title="Alerts"
          subtitle={`${active.slug} · ${rules.length} ${rules.length === 1 ? "rule" : "rules"}`}
          right={<NewAlertRuleButton projectId={active.id} />}
        />
        <KpiStrip
          activeRules={activeRules}
          openIncidents={openIncidents}
          eventsLast24h={eventsLast24h}
          longestOpenSeconds={longestOpenSeconds}
        />
        <RulesCard
          rows={rules}
          reason={rulesRes.error}
          project={active}
        />
        <EventsCard rows={events} reason={eventsRes.error} />
      </PageInterior>
    </Shell>
  );
}

function PageInterior({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        padding: 24,
        display: "flex",
        flexDirection: "column",
        gap: 20,
        maxWidth: 1200,
      }}
    >
      {children}
    </div>
  );
}

function PageHeader({
  title,
  subtitle,
  right,
}: {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
}) {
  return (
    <header
      style={{
        display: "flex",
        alignItems: "baseline",
        justifyContent: "space-between",
        gap: 16,
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
        <h1>{title}</h1>
        {subtitle ? (
          <span
            className="mono"
            style={{ fontSize: 12, color: "var(--text-3)" }}
          >
            {subtitle}
          </span>
        ) : null}
      </div>
      {right}
    </header>
  );
}

function KpiStrip({
  activeRules,
  openIncidents,
  eventsLast24h,
  longestOpenSeconds,
}: {
  activeRules: number;
  openIncidents: number;
  eventsLast24h: number;
  longestOpenSeconds: number | null;
}) {
  return (
    <section
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
        gap: 12,
      }}
    >
      <KpiCard label="Active rules" value={String(activeRules)} />
      <KpiCard
        label="Open incidents"
        value={String(openIncidents)}
        tone={openIncidents > 0 ? "danger" : "neutral"}
      />
      <KpiCard label="Events 24h" value={String(eventsLast24h)} />
      <KpiCard
        label="Longest open"
        value={longestOpenSeconds === null ? "—" : fmtDuration(longestOpenSeconds)}
        tone={longestOpenSeconds && longestOpenSeconds > 3600 ? "warn" : "neutral"}
      />
    </section>
  );
}

function KpiCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "danger" | "warn" | "neutral";
}) {
  const color =
    tone === "danger"
      ? "var(--danger)"
      : tone === "warn"
        ? "var(--warn, #a36a14)"
        : "var(--text-1)";
  return (
    <div className="card card-pad-lg">
      <div
        style={{
          fontSize: 11,
          color: "var(--text-3)",
          textTransform: "uppercase",
          letterSpacing: 0.4,
          marginBottom: 6,
        }}
      >
        {label}
      </div>
      <div className="num" style={{ fontSize: 22, color, fontWeight: 500 }}>
        {value}
      </div>
    </div>
  );
}

function RulesCard({
  rows,
  reason,
  project,
}: {
  rows: AlertRuleRow[];
  reason: string | null;
  project: Project;
}) {
  return (
    <section className="card" style={{ overflow: "hidden" }}>
      <div className="card-head">
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <h2>Rules</h2>
          <span className="card-sub">
            scoped to <span className="mono">{project.slug}</span>
          </span>
        </div>
      </div>
      {rows.length === 0 ? (
        <EmptyRulesState reason={reason} project={project} />
      ) : (
        <div style={{ overflow: "auto" }}>
          <table className="table">
            <thead>
              <tr>
                <th>Status</th>
                <th>Name</th>
                <th>Condition</th>
                <th style={{ textAlign: "right" }}>Window</th>
                <th style={{ textAlign: "right" }}>Last value</th>
                <th>Routes</th>
                <th style={{ textAlign: "right" }}>Last evaluated</th>
                <th style={{ textAlign: "right" }} />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <RuleStatusBadge rule={r} />
                  </td>
                  <td>{r.name}</td>
                  <td>
                    <span className="mono" style={{ fontSize: 12 }}>
                      {r.metric} {r.comparator} {fmtThreshold(r.metric, r.threshold)}
                    </span>
                  </td>
                  <td className="num" style={{ textAlign: "right" }}>
                    {fmtDuration(r.window_seconds)}
                  </td>
                  <td className="num" style={{ textAlign: "right" }}>
                    <LastValueCell metric={r.metric} value={r.last_value} />
                  </td>
                  <td>
                    <RoutesCell routes={r.routes} />
                  </td>
                  <td
                    className="num"
                    style={{ textAlign: "right", color: "var(--text-3)" }}
                  >
                    {r.last_evaluated_at ? fmtDateTime(r.last_evaluated_at) : "—"}
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <div
                      style={{
                        display: "inline-flex",
                        gap: 4,
                        justifyContent: "flex-end",
                      }}
                    >
                      <ToggleAlertEnabledButton rule={r} />
                      <DeleteAlertRuleButton ruleId={r.id} name={r.name} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function RuleStatusBadge({ rule }: { rule: AlertRuleRow }) {
  if (!rule.enabled) {
    return <span className="badge badge-neutral">snoozed</span>;
  }
  if (rule.open_incident_id) {
    return <span className="badge badge-danger">firing</span>;
  }
  if (rule.last_evaluated_at) {
    return <span className="badge badge-success">ok</span>;
  }
  return <span className="badge badge-neutral">pending</span>;
}

function LastValueCell({
  metric,
  value,
}: {
  metric: string;
  value: number | null;
}) {
  if (value === null) {
    return <span style={{ color: "var(--text-3)" }}>—</span>;
  }
  return <span className="mono">{fmtMetricValue(metric, value)}</span>;
}

function RoutesCell({ routes }: { routes: AlertRuleRow["routes"] }) {
  if (!routes || routes.length === 0) {
    return <span style={{ color: "var(--text-3)", fontSize: 12 }}>none</span>;
  }
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
      {routes.map((r, i) => (
        <span
          key={`${r.kind}:${r.target}:${i}`}
          className="badge badge-neutral"
          style={{ fontSize: 11 }}
          title={`${r.kind}: ${r.target}`}
        >
          {r.kind}
        </span>
      ))}
    </div>
  );
}

function EventsCard({
  rows,
  reason,
}: {
  rows: AlertEventRow[];
  reason: string | null;
}) {
  return (
    <section className="card" style={{ overflow: "hidden" }}>
      <div className="card-head">
        <h2>Recent events</h2>
        <span className="card-sub">last 200, newest first</span>
      </div>
      {rows.length === 0 ? (
        <div style={{ padding: 24 }}>
          <p style={{ color: "var(--text-2)", margin: 0, lineHeight: 1.55 }}>
            No alert events yet.
            {reason ? (
              <span
                className="mono"
                style={{ marginLeft: 8, fontSize: 11, color: "var(--text-3)" }}
              >
                ({reason})
              </span>
            ) : null}
          </p>
        </div>
      ) : (
        <div style={{ overflow: "auto" }}>
          <table className="table">
            <thead>
              <tr>
                <th>Kind</th>
                <th>Rule</th>
                <th style={{ textAlign: "right" }}>Value</th>
                <th style={{ textAlign: "right" }}>Threshold</th>
                <th>Incident</th>
                <th style={{ textAlign: "right" }}>When</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => (
                <tr key={e.id}>
                  <td>
                    <EventKindBadge kind={e.kind} />
                  </td>
                  <td>
                    {e.rule_name ?? (
                      <span className="mono" style={{ color: "var(--text-3)" }}>
                        {e.rule_id.slice(0, 8)}
                      </span>
                    )}
                  </td>
                  <td className="num" style={{ textAlign: "right" }}>
                    {fmtNumber(e.value)}
                  </td>
                  <td
                    className="num"
                    style={{ textAlign: "right", color: "var(--text-3)" }}
                  >
                    {fmtNumber(e.threshold)}
                  </td>
                  <td>
                    <span
                      className="mono"
                      style={{ fontSize: 11, color: "var(--text-3)" }}
                    >
                      {e.incident_id.slice(0, 8)}
                    </span>
                  </td>
                  <td
                    className="num"
                    style={{ textAlign: "right", color: "var(--text-3)" }}
                  >
                    {fmtDateTime(e.occurred_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function EventKindBadge({ kind }: { kind: string }) {
  if (kind === "fired") {
    return <span className="badge badge-danger">fired</span>;
  }
  if (kind === "resolved") {
    return <span className="badge badge-success">resolved</span>;
  }
  return <span className="badge badge-neutral">{kind}</span>;
}

function UnconfiguredState({ reason }: { reason: string | null }) {
  return (
    <div className="card card-pad-lg">
      <h2 style={{ marginBottom: 8 }}>No project resolved</h2>
      <p style={{ color: "var(--text-2)", margin: 0, lineHeight: 1.55 }}>
        Run the setup wizard or create a project before defining alerts.
      </p>
      {reason ? (
        <p
          className="mono"
          style={{ marginTop: 12, fontSize: 11, color: "var(--text-3)" }}
        >
          ({reason})
        </p>
      ) : null}
    </div>
  );
}

function EmptyRulesState({
  reason,
  project,
}: {
  reason: string | null;
  project: Project;
}) {
  return (
    <div style={{ padding: 32 }}>
      <h3 style={{ marginBottom: 6 }}>
        No alert rules yet in <span className="mono">{project.slug}</span>.
      </h3>
      <p
        style={{
          color: "var(--text-2)",
          margin: 0,
          lineHeight: 1.55,
          maxWidth: 640,
        }}
      >
        Click <strong>New alert</strong> to define a threshold over the same
        ClickHouse rollups Monitoring queries. Routes are stored now; Slack and
        PagerDuty delivery slot in next iteration without changing the rule
        shape.
      </p>
      {reason ? (
        <p
          className="mono"
          style={{ marginTop: 12, fontSize: 11, color: "var(--text-3)" }}
        >
          ({reason})
        </p>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtMetricValue(metric: string, value: number): string {
  if (metric === "error_rate") return `${(value * 100).toFixed(2)}%`;
  if (metric === "latency_p95_ms") return `${value.toFixed(0)}ms`;
  if (metric === "runs_per_min") return `${value.toFixed(2)}/min`;
  if (metric === "cost_usd") return `$${value.toFixed(4)}`;
  return fmtNumber(value);
}

function fmtThreshold(metric: string, value: number): string {
  return fmtMetricValue(metric, value);
}

function fmtNumber(value: number): string {
  if (!Number.isFinite(value)) return "—";
  if (Math.abs(value) >= 100) return value.toFixed(0);
  if (Math.abs(value) >= 1) return value.toFixed(2);
  return value.toFixed(4);
}

function fmtDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  if (seconds < 86400) return `${(seconds / 3600).toFixed(1)}h`;
  return `${(seconds / 86400).toFixed(1)}d`;
}

function fmtDateTime(iso: string): string {
  try {
    return new Date(iso).toISOString().replace("T", " ").slice(0, 16);
  } catch {
    return iso;
  }
}

function isWithin24h(iso: string): boolean {
  try {
    return Date.now() - new Date(iso).getTime() <= 24 * 3600 * 1000;
  } catch {
    return false;
  }
}

function computeLongestOpen(
  rules: AlertRuleRow[],
  events: AlertEventRow[],
): number | null {
  const byEventId = new Map(events.map((e) => [e.id, e]));
  let longest: number | null = null;
  const now = Date.now();
  for (const r of rules) {
    if (!r.open_incident_id) continue;
    const ev = byEventId.get(r.open_incident_id);
    if (!ev) continue;
    const opened = new Date(ev.occurred_at).getTime();
    if (Number.isNaN(opened)) continue;
    const seconds = Math.max(0, Math.round((now - opened) / 1000));
    if (longest === null || seconds > longest) longest = seconds;
  }
  return longest;
}
