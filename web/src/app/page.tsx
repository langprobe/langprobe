import { cookies } from "next/headers";
import { Shell } from "@/components/Shell";

/**
 * Overview dashboard.
 *
 * Server-rendered: forwards the session cookie to /v1/runs and renders
 * the live list. Pre-setup or pre-login renders an empty state with a
 * pointer at the getting-started doc — no fake data, ever (per
 * DESIGN.md "Be a tool. Not a toy."). Stats tiles still use placeholder
 * values until we wire a roll-up endpoint; they're labelled visibly.
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

async function fetchRuns(): Promise<{ runs: Run[]; reason: string | null }> {
  const apiBase =
    process.env.API_BASE_INTERNAL ||
    process.env.NEXT_PUBLIC_API_BASE ||
    "http://localhost:7081";
  const projectId = process.env.NEXT_PUBLIC_DEFAULT_PROJECT_ID;
  if (!projectId) {
    return { runs: [], reason: "no project selected" };
  }
  const cookieStore = cookies();
  const cookieHeader = cookieStore
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");
  try {
    const res = await fetch(
      `${apiBase}/v1/runs?project_id=${encodeURIComponent(projectId)}&limit=100`,
      {
        cache: "no-store",
        headers: cookieHeader ? { cookie: cookieHeader } : {},
      },
    );
    if (!res.ok) {
      return { runs: [], reason: `api ${res.status}` };
    }
    const body = (await res.json()) as RunListResponse;
    return { runs: body.items ?? [], reason: null };
  } catch (err) {
    return { runs: [], reason: (err as Error).message };
  }
}

export default async function OverviewPage() {
  const { runs, reason } = await fetchRuns();
  return (
    <Shell>
      <Header />
      <Stats />
      <RunsTable runs={runs} reason={reason} />
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
  // Placeholder roll-ups until /v1/metrics lands. Labelled "—" so they
  // never look like real numbers.
  const stats: { label: string; value: string; tone?: "warn" | "fail" }[] = [
    { label: "runs", value: "—" },
    { label: "p50", value: "—" },
    { label: "p95", value: "—" },
    { label: "p99", value: "—" },
    { label: "errors", value: "—" },
    { label: "cost", value: "—" },
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

function RunsTable({ runs, reason }: { runs: Run[]; reason: string | null }) {
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
        <EmptyState reason={reason} />
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
                <Td>{r.run_id.slice(0, 8)}</Td>
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

function EmptyState({ reason }: { reason: string | null }) {
  return (
    <div
      style={{
        padding: "32px 16px",
        color: "var(--text-muted)",
        fontSize: 13,
        lineHeight: 1.5,
      }}
    >
      <div style={{ marginBottom: 8 }}>no runs yet.</div>
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

function fmtCost(usd: number): string {
  if (!usd) return "—";
  return `$ ${usd.toFixed(4)}`;
}

function fmtTime(iso: string): string {
  try {
    return new Date(iso).toISOString().slice(11, 19);
  } catch {
    return iso;
  }
}
