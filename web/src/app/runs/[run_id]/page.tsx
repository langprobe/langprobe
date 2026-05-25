import Link from "next/link";
import { notFound } from "next/navigation";
import { Shell } from "@/components/Shell";
import { apiGet } from "@/lib/api";
import { resolveActiveProject } from "@/lib/projects";

/**
 * Run detail.
 *
 * Server-rendered. Resolves the active project, then fetches the run
 * row + the full span list in parallel. Span tree is built client-side
 * (well, server-side here, but with no DB roundtrip per node) from
 * parent_span_id chains. Orphan spans become roots so a missing parent
 * never silently drops data.
 *
 * Selection is driven by ?span=<span_id> so the inspector survives
 * deep-linking and reload.
 */

type Status = "ok" | "error" | "running" | string;

interface Run {
  run_id: string;
  project_id: string;
  parent_run_id: string | null;
  name: string;
  kind: string;
  status: Status;
  start_time: string;
  end_time: string | null;
  latency_ms: number | null;
  inputs: string;
  outputs: string;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  cost_usd: number;
  sdk: string;
  sdk_version: string;
  session_id: string | null;
  user_id: string | null;
  tags: string[];
  metadata: string;
  error_kind: string;
  error_message: string;
}

interface Span {
  span_id: string;
  parent_span_id: string | null;
  name: string;
  kind: string;
  status: Status;
  start_time: string;
  end_time: string | null;
  latency_ms: number | null;
  inputs: string;
  outputs: string;
  model: string;
  temperature: number | null;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  cost_usd: number;
  error_kind: string;
  error_message: string;
  attributes: string;
}

interface SpanListResponse {
  items: Span[];
}

interface SpanNode {
  span: Span;
  depth: number;
}

export default async function RunDetailPage({
  params,
  searchParams,
}: {
  params: { run_id: string };
  searchParams: { span?: string };
}) {
  const { active, all, reason } = await resolveActiveProject();
  if (!active) {
    return (
      <Shell active={null} projects={all}>
        <div
          style={{
            padding: "32px 16px",
            color: "var(--text-muted)",
            fontSize: 13,
          }}
        >
          no project resolved{reason ? ` (${reason})` : ""}.{" "}
          <Link href="/" style={{ color: "var(--accent)" }}>
            back to overview
          </Link>
        </div>
      </Shell>
    );
  }

  const projectQuery = `project_id=${encodeURIComponent(active.id)}`;
  const [runRes, spansRes] = await Promise.all([
    apiGet<Run>(`/v1/runs/${encodeURIComponent(params.run_id)}?${projectQuery}`),
    apiGet<SpanListResponse>(
      `/v1/runs/${encodeURIComponent(params.run_id)}/spans?${projectQuery}`,
    ),
  ]);

  if (runRes.status === 404) {
    notFound();
  }

  if (!runRes.data) {
    return (
      <Shell active={active} projects={all}>
        <div
          style={{ padding: "32px 16px", color: "var(--fail)", fontSize: 13 }}
        >
          run unavailable: {runRes.error ?? "unknown error"}
        </div>
      </Shell>
    );
  }

  const run = runRes.data;
  const spans = spansRes.data?.items ?? [];
  const flat = flatten(buildTree(spans));
  const selectedSpan =
    spans.find((s) => s.span_id === searchParams.span) ?? null;

  return (
    <Shell
      active={active}
      projects={all}
      inspector={<Inspector run={run} span={selectedSpan} />}
    >
      <RunHeader run={run} />
      <SpanTree
        runId={run.run_id}
        nodes={flat}
        selectedSpanId={selectedSpan?.span_id ?? null}
      />
      {spansRes.error ? (
        <div
          style={{
            padding: "8px 16px",
            color: "var(--fail)",
            fontSize: 11,
            borderTop: "1px solid var(--rule)",
          }}
        >
          spans unavailable: {spansRes.error}
        </div>
      ) : null}
    </Shell>
  );
}

function RunHeader({ run }: { run: Run }) {
  return (
    <div style={{ borderBottom: "1px solid var(--rule)" }}>
      <div
        style={{
          height: 48,
          display: "flex",
          alignItems: "center",
          padding: "0 16px",
          gap: 12,
          fontSize: 13,
        }}
      >
        <Link
          href="/"
          style={{ color: "var(--text-muted)", textDecoration: "none" }}
        >
          overview
        </Link>
        <span style={{ color: "var(--text-muted)" }}>/</span>
        <span>{run.name || "(unnamed)"}</span>
        <StatusPill status={run.status} />
        <span style={{ color: "var(--text-muted)", marginLeft: "auto" }}>
          {run.run_id}
        </span>
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(6, 1fr)",
          borderTop: "1px solid var(--rule)",
        }}
      >
        <Stat label="kind" value={run.kind} />
        <Stat label="started" value={fmtIso(run.start_time)} />
        <Stat label="latency" value={fmtLatency(run.latency_ms)} />
        <Stat
          label="tokens"
          value={`${run.total_tokens.toLocaleString("en-US")}`}
        />
        <Stat label="cost" value={fmtCost(run.cost_usd)} />
        <Stat
          label="sdk"
          value={
            run.sdk
              ? `${run.sdk}${run.sdk_version ? ` ${run.sdk_version}` : ""}`
              : "—"
          }
        />
      </div>
      {run.error_kind || run.error_message ? (
        <div
          style={{
            padding: "8px 16px",
            color: "var(--fail)",
            fontSize: 11,
            borderTop: "1px solid var(--rule)",
            display: "flex",
            gap: 12,
          }}
        >
          <span style={{ textTransform: "uppercase", letterSpacing: "0.04em" }}>
            {run.error_kind || "error"}
          </span>
          <span style={{ color: "var(--text)" }}>{run.error_message}</span>
        </div>
      ) : null}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        padding: "12px 16px",
        borderRight: "1px solid var(--rule)",
      }}
    >
      <div
        style={{
          fontSize: 11,
          textTransform: "uppercase",
          letterSpacing: "0.04em",
          color: "var(--text-muted)",
          marginBottom: 4,
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: 13 }}>{value}</div>
    </div>
  );
}

function SpanTree({
  runId,
  nodes,
  selectedSpanId,
}: {
  runId: string;
  nodes: SpanNode[];
  selectedSpanId: string | null;
}) {
  if (nodes.length === 0) {
    return (
      <div
        style={{
          padding: "32px 16px",
          color: "var(--text-muted)",
          fontSize: 13,
        }}
      >
        no spans recorded for this run.
      </div>
    );
  }
  return (
    <div>
      <SectionLabel>span tree</SectionLabel>
      <div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 80px 100px 80px",
            color: "var(--text-muted)",
            fontSize: 11,
            textTransform: "uppercase",
            letterSpacing: "0.04em",
            padding: "0 16px",
            height: 24,
            alignItems: "center",
            borderBottom: "1px solid var(--rule)",
          }}
        >
          <span>name</span>
          <span>kind</span>
          <span style={{ textAlign: "right" }}>latency</span>
          <span style={{ textAlign: "right" }}>tokens</span>
        </div>
        {nodes.map(({ span, depth }) => {
          const selected = span.span_id === selectedSpanId;
          return (
            <Link
              key={span.span_id}
              href={`/runs/${runId}?span=${span.span_id}`}
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 80px 100px 80px",
                alignItems: "center",
                height: "var(--row-h)",
                padding: "0 16px",
                borderBottom: "1px solid var(--rule)",
                background: selected ? "var(--accent-soft)" : "transparent",
                color: "var(--text)",
                textDecoration: "none",
                fontSize: 13,
              }}
            >
              <span
                style={{
                  paddingLeft: depth * 16,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                <StatusDot status={span.status} />
                <span>{span.name || "(unnamed)"}</span>
              </span>
              <span style={{ color: "var(--text-muted)", fontSize: 11 }}>
                {span.kind}
              </span>
              <span style={{ textAlign: "right" }}>
                {fmtLatency(span.latency_ms)}
              </span>
              <span style={{ textAlign: "right", color: "var(--text-muted)" }}>
                {span.total_tokens
                  ? span.total_tokens.toLocaleString("en-US")
                  : "—"}
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

function Inspector({ run, span }: { run: Run; span: Span | null }) {
  if (span) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div>
          <div style={{ fontSize: 13, color: "var(--text)" }}>{span.name}</div>
          <div
            style={{ color: "var(--text-muted)", fontSize: 11, marginTop: 2 }}
          >
            {span.span_id}
          </div>
        </div>
        <Kv k="kind" v={span.kind} />
        <Kv k="status" v={span.status} />
        {span.model ? <Kv k="model" v={span.model} /> : null}
        {span.temperature !== null ? (
          <Kv k="temperature" v={String(span.temperature)} />
        ) : null}
        <Kv k="latency" v={fmtLatency(span.latency_ms)} />
        <Kv
          k="tokens"
          v={
            span.total_tokens
              ? `${span.prompt_tokens}+${span.completion_tokens}=${span.total_tokens}`
              : "—"
          }
        />
        <Kv k="cost" v={fmtCost(span.cost_usd)} />
        {span.error_message ? (
          <div style={{ color: "var(--fail)", fontSize: 12 }}>
            {span.error_kind || "error"}: {span.error_message}
          </div>
        ) : null}
        <Section label="inputs">
          <Pre value={span.inputs} />
        </Section>
        <Section label="outputs">
          <Pre value={span.outputs} />
        </Section>
        {span.attributes ? (
          <Section label="attributes">
            <Pre value={span.attributes} />
          </Section>
        ) : null}
      </div>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ fontSize: 13, color: "var(--text)" }}>{run.name}</div>
      <Kv
        k="tokens"
        v={
          run.total_tokens
            ? `${run.prompt_tokens}+${run.completion_tokens}=${run.total_tokens}`
            : "—"
        }
      />
      {run.session_id ? <Kv k="session" v={run.session_id} /> : null}
      {run.user_id ? <Kv k="user" v={run.user_id} /> : null}
      {run.tags.length > 0 ? <Kv k="tags" v={run.tags.join(", ")} /> : null}
      <Section label="inputs">
        <Pre value={run.inputs} />
      </Section>
      <Section label="outputs">
        <Pre value={run.outputs} />
      </Section>
      {run.metadata ? (
        <Section label="metadata">
          <Pre value={run.metadata} />
        </Section>
      ) : null}
    </div>
  );
}

function Section({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div
        style={{
          fontSize: 11,
          textTransform: "uppercase",
          letterSpacing: "0.04em",
          color: "var(--text-muted)",
          marginBottom: 4,
        }}
      >
        {label}
      </div>
      {children}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        padding: "12px 16px 6px",
        fontSize: 11,
        textTransform: "uppercase",
        letterSpacing: "0.04em",
        color: "var(--text-muted)",
      }}
    >
      {children}
    </div>
  );
}

function Kv({ k, v }: { k: string; v: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
      <span
        style={{
          fontSize: 11,
          textTransform: "uppercase",
          letterSpacing: "0.04em",
          color: "var(--text-muted)",
        }}
      >
        {k}
      </span>
      <span
        style={{
          fontSize: 12,
          color: "var(--text)",
          maxWidth: "70%",
          textAlign: "right",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {v}
      </span>
    </div>
  );
}

function Pre({ value }: { value: string }) {
  if (!value) {
    return (
      <div style={{ color: "var(--text-muted)", fontSize: 12 }}>—</div>
    );
  }
  let pretty = value;
  try {
    pretty = JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    // not JSON, render raw
  }
  return (
    <pre
      style={{
        fontSize: 11,
        lineHeight: 1.5,
        color: "var(--text)",
        background: "var(--bg-soft, transparent)",
        border: "1px solid var(--rule)",
        padding: 8,
        margin: 0,
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
      }}
    >
      {pretty}
    </pre>
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
      <StatusDot status={status} />
      {status}
    </span>
  );
}

function StatusDot({ status }: { status: Status }) {
  const color =
    status === "ok"
      ? "var(--pass)"
      : status === "error"
        ? "var(--fail)"
        : "var(--warn)";
  return (
    <span
      style={{
        width: 6,
        height: 6,
        borderRadius: 9999,
        background: color,
        flex: "0 0 auto",
      }}
    />
  );
}

function buildTree(spans: Span[]): SpanNode[] {
  const byId = new Map<string, Span>();
  for (const s of spans) byId.set(s.span_id, s);
  const childrenOf = new Map<string | null, Span[]>();
  for (const s of spans) {
    const key = s.parent_span_id && byId.has(s.parent_span_id)
      ? s.parent_span_id
      : null;
    const arr = childrenOf.get(key) ?? [];
    arr.push(s);
    childrenOf.set(key, arr);
  }
  for (const arr of childrenOf.values()) {
    arr.sort((a, b) => {
      if (a.start_time === b.start_time) {
        return a.span_id < b.span_id ? -1 : 1;
      }
      return a.start_time < b.start_time ? -1 : 1;
    });
  }
  const roots = childrenOf.get(null) ?? [];
  return walk(roots, 0, childrenOf);
}

function walk(
  spans: Span[],
  depth: number,
  childrenOf: Map<string | null, Span[]>,
): SpanNode[] {
  const out: SpanNode[] = [];
  for (const s of spans) {
    out.push({ span: s, depth });
    const kids = childrenOf.get(s.span_id);
    if (kids) out.push(...walk(kids, depth + 1, childrenOf));
  }
  return out;
}

function flatten(nodes: SpanNode[]): SpanNode[] {
  return nodes;
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

function fmtIso(iso: string): string {
  try {
    return new Date(iso).toISOString().replace("T", " ").slice(0, 19);
  } catch {
    return iso;
  }
}
