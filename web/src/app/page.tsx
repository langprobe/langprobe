import { Shell } from "@/components/Shell";

/**
 * Overview dashboard — Phase 6 stub.
 * Wired to fixtures so the page renders before the read-side API exists.
 * The numeric columns use tabular-nums via globals.css (font-feature-settings).
 *
 * Once the read API is up, replace SAMPLE_RUNS with a fetch into ClickHouse
 * via a server action / route handler.
 */

type Status = "ok" | "error" | "running";

interface SampleRun {
  id: string;
  name: string;
  kind: "agent" | "chain" | "llm" | "tool";
  status: Status;
  latencyMs: number;
  costUsd: number;
  receivedAt: string;
}

const SAMPLE_RUNS: SampleRun[] = [
  {
    id: "01HXY-9c3a",
    name: "support_triage_agent",
    kind: "agent",
    status: "ok",
    latencyMs: 2841,
    costUsd: 0.0123,
    receivedAt: "12:04:21",
  },
  {
    id: "01HXY-9c39",
    name: "rag.retrieve",
    kind: "chain",
    status: "error",
    latencyMs: 612,
    costUsd: 0.0021,
    receivedAt: "12:04:18",
  },
  {
    id: "01HXY-9c38",
    name: "openai.chat.completions",
    kind: "llm",
    status: "ok",
    latencyMs: 943,
    costUsd: 0.0086,
    receivedAt: "12:04:16",
  },
  {
    id: "01HXY-9c37",
    name: "tools.search_kb",
    kind: "tool",
    status: "running",
    latencyMs: 0,
    costUsd: 0,
    receivedAt: "12:04:15",
  },
];

export default function OverviewPage() {
  return (
    <Shell>
      <Header />
      <Stats />
      <RunsTable />
    </Shell>
  );
}

function Header() {
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
        last 1h · production
      </span>
    </div>
  );
}

function Stats() {
  const stats: { label: string; value: string; tone?: "warn" | "fail" }[] = [
    { label: "runs", value: "4 217" },
    { label: "p50", value: "612 ms" },
    { label: "p95", value: "2 841 ms" },
    { label: "p99", value: "5 904 ms", tone: "warn" },
    { label: "errors", value: "0.4 %", tone: "fail" },
    { label: "cost", value: "$ 4.81" },
  ];
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${stats.length}, 1fr)`,
        borderBottom: "1px solid var(--rule)",
      }}
    >
      {stats.map((s, i) => (
        <div
          key={s.label}
          style={{
            padding: "16px",
            borderRight:
              i < stats.length - 1 ? "1px solid var(--rule)" : "none",
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
  );
}

function RunsTable() {
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
            <Th align="right">received</Th>
          </tr>
        </thead>
        <tbody>
          {SAMPLE_RUNS.map((r) => (
            <tr
              key={r.id}
              style={{
                height: "var(--row-h)",
                borderTop: "1px solid var(--rule)",
              }}
            >
              <Td>{r.id}</Td>
              <Td>{r.name}</Td>
              <Td muted>{r.kind}</Td>
              <Td>
                <StatusPill status={r.status} />
              </Td>
              <Td align="right">{fmtLatency(r.latencyMs)}</Td>
              <Td align="right">{fmtCost(r.costUsd)}</Td>
              <Td align="right" muted>
                {r.receivedAt}
              </Td>
            </tr>
          ))}
        </tbody>
      </table>
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
  const map: Record<Status, { label: string; color: string }> = {
    ok: { label: "ok", color: "var(--pass)" },
    error: { label: "error", color: "var(--fail)" },
    running: { label: "running", color: "var(--warn)" },
  };
  const { label, color } = map[status];
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
      {label}
    </span>
  );
}

function toneColor(tone?: "warn" | "fail"): string {
  if (tone === "warn") return "var(--warn)";
  if (tone === "fail") return "var(--fail)";
  return "var(--text)";
}

function fmtLatency(ms: number): string {
  if (ms === 0) return "—";
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

function fmtCost(usd: number): string {
  if (usd === 0) return "—";
  return `$ ${usd.toFixed(4)}`;
}
