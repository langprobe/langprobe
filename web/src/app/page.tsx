import Link from "next/link";
import { Shell } from "@/components/Shell";
import { apiGet } from "@/lib/api";
import { resolveActiveProject, type Project } from "@/lib/projects";

/**
 * Overview dashboard.
 *
 * Server-rendered: resolves the active project from /v1/projects + a
 * cookie pin, then forwards the session cookie to /v1/runs + /v1/metrics
 * in parallel. Pre-setup or pre-login renders an empty state with a
 * pointer at the getting-started doc — no fake data, ever (per
 * DESIGN.md "Be a tool. Not a toy.").
 */

type Status = "ok" | "error" | "running" | string;

interface Run {
  run_id: string;
  name: string;
  kind: string;
  status: Status;
  start_time: string;
  latency_ms: number | null;
  total_tokens: number;
  cost_usd: number;
  sdk: string;
}

interface RunListResponse {
  items: Run[];
}

interface MetricsResponse {
  window_seconds: number;
  runs: number;
  p50_ms: number | null;
  p95_ms: number | null;
  p99_ms: number | null;
  error_count: number;
  error_rate: number;
  total_tokens: number;
  total_cost_usd: number;
}

const WINDOW_SECONDS = 3600;

export default async function OverviewPage() {
  const { active, all, reason } = await resolveActiveProject();
  if (!active) {
    return (
      <Shell active={null} projects={all}>
        <Header projectLabel={null} />
        <UnconfiguredState reason={reason} />
      </Shell>
    );
  }

  const [runsRes, metricsRes] = await Promise.all([
    apiGet<RunListResponse>(
      `/v1/runs?project_id=${encodeURIComponent(active.id)}&limit=100`,
    ),
    apiGet<MetricsResponse>(
      `/v1/metrics?project_id=${encodeURIComponent(active.id)}&window_seconds=${WINDOW_SECONDS}`,
    ),
  ]);

  const runs = runsRes.data?.items ?? [];
  const runsError = runsRes.error;
  const metrics = metricsRes.data;
  const metricsError = metricsRes.error;

  return (
    <Shell active={active} projects={all}>
      <Header projectLabel={active.slug} />
      <Stats metrics={metrics} error={metricsError} />
      <RunsTable runs={runs} reason={runsError} project={active} />
    </Shell>
  );
}

function Header({ projectLabel }: { projectLabel: string | null }) {
  return (
    <div
      style={{
        height: 48,
        display: "flex",
        alignItems: "center",
        padding: "0 16px",
        borderBottom: "1px solid var(--rule)",
        gap: 16,
      }}
    >
      <span style={{ fontSize: 13 }}>overview</span>
      <span style={{ color: "var(--text-muted)", fontSize: 13 }}>
        last 1h{projectLabel ? ` · ${projectLabel}` : ""}
      </span>
    </div>
  );
}

function Stats({
  metrics,
  error,
}: {
  metrics: MetricsResponse | null | undefined;
  error: string | null;
}) {
  const tiles: { label: string; value: string; tone?: "warn" | "fail" }[] =
    metrics
      ? [
          { label: "runs", value: fmtInt(metrics.runs) },
          { label: "p50", value: fmtMs(metrics.p50_ms) },
          { label: "p95", value: fmtMs(metrics.p95_ms) },
          { label: "p99", value: fmtMs(metrics.p99_ms) },
          {
            label: "errors",
            value:
              metrics.runs > 0
                ? `${(metrics.error_rate * 100).toFixed(1)}%`
                : "—",
            tone:
              metrics.error_rate >= 0.05
                ? "fail"
                : metrics.error_rate > 0
                  ? "warn"
                  : undefined,
          },
          { label: "cost", value: fmtCostTotal(metrics.total_cost_usd) },
        ]
      : [
          { label: "runs", value: "—" },
          { label: "p50", value: "—" },
          { label: "p95", value: "—" },
          { label: "p99", value: "—" },
          { label: "errors", value: "—" },
          { label: "cost", value: "—" },
        ];
  return (
    <div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${tiles.length}, 1fr)`,
          borderBottom: "1px solid var(--rule)",
        }}
      >
        {tiles.map((s, i) => (
          <div
            key={s.label}
            style={{
              padding: "16px",
              borderRight:
                i < tiles.length - 1 ? "1px solid var(--rule)" : "none",
            }}
          >
            <div
              style={{
                fontSize: 11,
                textTransform: "uppercase",
                letterSpacing: "0.04em",
                color: "var(--text-muted)",
                marginBottom: 6,
              }}
            >
              {s.label}
            </div>
            <div
              style={{
                fontSize: 19,
                color: toneColor(s.tone),
              }}
            >
              {s.value}
            </div>
          </div>
        ))}
      </div>
      {error ? (
        <div
          style={{
            padding: "6px 16px",
            color: "var(--fail)",
            fontSize: 11,
            borderBottom: "1px solid var(--rule)",
          }}
        >
          metrics unavailable: {error}
        </div>
      ) : null}
    </div>
  );
}

function RunsTable({
  runs,
  reason,
  project,
}: {
  runs: Run[];
  reason: string | null;
  project: Project;
}) {
  return (
    <div>
      <div
        style={{
          padding: "12px 16px 8px",
          fontSize: 11,
          textTransform: "uppercase",
          letterSpacing: "0.04em",
          color: "var(--text-muted)",
        }}
      >
        recent runs
      </div>
      {runs.length === 0 ? (
        <EmptyRunsState reason={reason} project={project} />
      ) : (
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            fontSize: 13,
          }}
        >
          <thead>
            <tr style={{ color: "var(--text-muted)", textAlign: "left" }}>
              <Th>id</Th>
              <Th>name</Th>
              <Th>kind</Th>
              <Th>status</Th>
              <Th align="right">latency</Th>
              <Th align="right">cost</Th>
              <Th align="right">started</Th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => (
              <tr
                key={r.run_id}
                style={{
                  height: "var(--row-h)",
                  borderTop: "1px solid var(--rule)",
                }}
              >
                <Td>
                  <Link
                    href={`/runs/${r.run_id}`}
                    style={{
                      color: "var(--text)",
                      textDecoration: "underline",
                      textDecorationColor: "var(--rule)",
                    }}
                  >
                    {r.run_id.slice(0, 8)}
                  </Link>
                </Td>
                <Td>{r.name}</Td>
                <Td muted>{r.kind}</Td>
                <Td>
                  <StatusPill status={r.status} />
                </Td>
                <Td align="right">{fmtLatency(r.latency_ms)}</Td>
                <Td align="right">{fmtCost(r.cost_usd)}</Td>
                <Td align="right" muted>
                  {fmtTime(r.start_time)}
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function UnconfiguredState({ reason }: { reason: string | null }) {
  return (
    <div
      style={{
        padding: "32px 16px",
        color: "var(--text-muted)",
        fontSize: 13,
        lineHeight: 1.5,
      }}
    >
      <div style={{ marginBottom: 8 }}>no project resolved.</div>
      <div>
        run the setup wizard, then point your SDK at this api — see{" "}
        <a
          href="https://github.com/gaurav0107/tracebility/blob/main/docs/getting-started.md"
          style={{ color: "var(--accent)", textDecoration: "underline" }}
        >
          docs/getting-started.md
        </a>
        .
      </div>
      {reason ? (
        <div style={{ marginTop: 12, fontSize: 11 }}>({reason})</div>
      ) : null}
    </div>
  );
}

function EmptyRunsState({
  reason,
  project,
}: {
  reason: string | null;
  project: Project;
}) {
  return (
    <div
      style={{
        padding: "32px 16px",
        color: "var(--text-muted)",
        fontSize: 13,
        lineHeight: 1.5,
      }}
    >
      <div style={{ marginBottom: 8 }}>no runs yet in {project.slug}.</div>
      <div>
        send your first trace — see{" "}
        <a
          href="https://github.com/gaurav0107/tracebility/blob/main/docs/getting-started.md"
          style={{ color: "var(--accent)", textDecoration: "underline" }}
        >
          docs/getting-started.md
        </a>
        .
      </div>
      {reason ? (
        <div style={{ marginTop: 12, fontSize: 11 }}>({reason})</div>
      ) : null}
    </div>
  );
}

function Th({
  children,
  align,
}: {
  children: React.ReactNode;
  align?: "left" | "right";
}) {
  return (
    <th
      style={{
        fontWeight: 400,
        padding: "6px 16px",
        textAlign: align ?? "left",
        fontSize: 11,
        textTransform: "uppercase",
        letterSpacing: "0.04em",
      }}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  align,
  muted,
}: {
  children: React.ReactNode;
  align?: "left" | "right";
  muted?: boolean;
}) {
  return (
    <td
      style={{
        padding: "0 16px",
        textAlign: align ?? "left",
        color: muted ? "var(--text-muted)" : "var(--text)",
      }}
    >
      {children}
    </td>
  );
}

function StatusPill({ status }: { status: Status }) {
  const color =
    status === "ok"
      ? "var(--pass)"
      : status === "error"
        ? "var(--fail)"
        : "var(--warn)";
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        fontSize: 11,
        color,
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: 9999,
          background: color,
        }}
      />
      {status}
    </span>
  );
}

function toneColor(tone?: "warn" | "fail"): string {
  if (tone === "warn") return "var(--warn)";
  if (tone === "fail") return "var(--fail)";
  return "var(--text)";
}

function fmtLatency(ms: number | null): string {
  if (ms === null) return "—";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

function fmtMs(ms: number | null): string {
  if (ms === null) return "—";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

function fmtInt(n: number): string {
  return n.toLocaleString("en-US");
}

function fmtCost(usd: number): string {
  if (!usd) return "—";
  return `$ ${usd.toFixed(4)}`;
}

function fmtCostTotal(usd: number): string {
  if (!usd) return "—";
  if (usd < 1) return `$ ${usd.toFixed(4)}`;
  return `$ ${usd.toFixed(2)}`;
}

function fmtTime(iso: string): string {
  try {
    return new Date(iso).toISOString().slice(11, 19);
  } catch {
    return iso;
  }
}
