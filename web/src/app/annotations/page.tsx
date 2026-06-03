import Link from "next/link";
import { Shell } from "@/components/Shell";
import {
  type AnnotationQueueRow,
  DeleteAnnotationQueueButton,
  NewAnnotationQueueButton,
} from "@/components/AnnotationsClient";
import { apiGet } from "@/lib/api";
import { resolveActiveProject, type Project } from "@/lib/projects";

/**
 * Annotations — human-in-the-loop review queues.
 *
 * Server component. The list view fetches /v1/annotations from FastAPI
 * and renders a queues table with progress bars, status badges, and
 * per-row delete. Reviewers click into a queue to label items.
 *
 * The queue is materialized at creation: when a reviewer says "I have
 * 50 runs to label" that contract holds across sessions. A streaming
 * sampler that re-evaluates every render is a subtle source of
 * double-counting. A refresh action can come later.
 */

export const dynamic = "force-dynamic";

export default async function AnnotationsPage() {
  const { active, all, reason } = await resolveActiveProject();

  if (!active) {
    return (
      <Shell active={null} projects={all}>
        <PageInterior>
          <PageHeader
            title="Annotations"
            subtitle="human review queues"
          />
          <UnconfiguredState reason={reason} />
        </PageInterior>
      </Shell>
    );
  }

  const queuesRes = await apiGet<AnnotationQueueRow[]>(
    `/v1/annotations?project_id=${encodeURIComponent(active.id)}`,
  );
  const queues = queuesRes.data ?? [];

  const totalItems = queues.reduce((acc, q) => acc + q.item_total, 0);
  const totalDone = queues.reduce((acc, q) => acc + q.item_done, 0);
  const openQueues = queues.filter((q) => q.status === "open").length;

  return (
    <Shell active={active} projects={all}>
      <PageInterior>
        <PageHeader
          title="Annotations"
          subtitle={`${active.slug} · ${queues.length} ${queues.length === 1 ? "queue" : "queues"}`}
          right={<NewAnnotationQueueButton projectId={active.id} />}
        />
        <KpiStrip
          queues={queues.length}
          openQueues={openQueues}
          totalItems={totalItems}
          totalDone={totalDone}
        />
        <QueuesCard
          rows={queues}
          reason={queuesRes.error}
          project={active}
        />
        <UsageCard />
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
  queues,
  openQueues,
  totalItems,
  totalDone,
}: {
  queues: number;
  openQueues: number;
  totalItems: number;
  totalDone: number;
}) {
  const remaining = Math.max(0, totalItems - totalDone);
  const pct = totalItems === 0 ? 0 : Math.round((totalDone / totalItems) * 100);
  return (
    <section
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
        gap: 12,
      }}
    >
      <KpiCard label="Queues" value={String(queues)} />
      <KpiCard
        label="Open"
        value={String(openQueues)}
        tone={openQueues > 0 ? "warn" : "neutral"}
      />
      <KpiCard label="To review" value={String(remaining)} />
      <KpiCard label="Progress" value={`${pct}%`} />
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
  tone?: "warn" | "neutral";
}) {
  const color = tone === "warn" ? "var(--warn, #a36a14)" : "var(--text-1)";
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

function QueuesCard({
  rows,
  reason,
  project,
}: {
  rows: AnnotationQueueRow[];
  reason: string | null;
  project: Project;
}) {
  return (
    <section className="card" style={{ overflow: "hidden" }}>
      <div className="card-head">
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <h2>Queues</h2>
          <span className="card-sub">
            scoped to <span className="mono">{project.slug}</span>
          </span>
        </div>
      </div>
      {rows.length === 0 ? (
        <EmptyQueuesState reason={reason} project={project} />
      ) : (
        <div style={{ overflow: "auto" }}>
          <table className="table">
            <thead>
              <tr>
                <th>Status</th>
                <th>Name</th>
                <th>Rubric</th>
                <th>Sampling</th>
                <th style={{ textAlign: "right" }}>Progress</th>
                <th style={{ textAlign: "right" }}>Created</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((q) => (
                <tr key={q.id}>
                  <td>
                    <QueueStatusBadge status={q.status} />
                  </td>
                  <td>
                    <Link
                      href={`/annotations/${q.id}`}
                      style={{ textDecoration: "none" }}
                    >
                      <span style={{ color: "var(--link)" }}>{q.name}</span>
                    </Link>
                    {q.description ? (
                      <div
                        style={{
                          fontSize: 12,
                          color: "var(--text-3)",
                          marginTop: 2,
                        }}
                      >
                        {q.description}
                      </div>
                    ) : null}
                  </td>
                  <td>
                    <RubricCell rubric={q.rubric} />
                  </td>
                  <td>
                    <SamplingCell sampling={q.sampling} />
                  </td>
                  <td className="num" style={{ textAlign: "right", minWidth: 160 }}>
                    <ProgressBar done={q.item_done} total={q.item_total} />
                  </td>
                  <td
                    className="num"
                    style={{ textAlign: "right", color: "var(--text-3)" }}
                  >
                    {fmtDateTime(q.created_at)}
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <div
                      style={{
                        display: "inline-flex",
                        gap: 4,
                        justifyContent: "flex-end",
                      }}
                    >
                      <Link
                        href={`/annotations/${q.id}`}
                        className="btn btn-ghost"
                        style={{ fontSize: 12 }}
                      >
                        review →
                      </Link>
                      <DeleteAnnotationQueueButton
                        queueId={q.id}
                        name={q.name}
                      />
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

function QueueStatusBadge({
  status,
}: {
  status: AnnotationQueueRow["status"];
}) {
  if (status === "complete") {
    return <span className="badge badge-success">complete</span>;
  }
  if (status === "archived") {
    return <span className="badge badge-neutral">archived</span>;
  }
  return <span className="badge badge-warn">open</span>;
}

function RubricCell({ rubric }: { rubric: AnnotationQueueRow["rubric"] }) {
  const visible = rubric.labels.slice(0, 4);
  const more = rubric.labels.length - visible.length;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
      <span
        className="mono"
        style={{ fontSize: 11, color: "var(--text-3)" }}
      >
        {rubric.score}
      </span>
      {visible.map((l) => (
        <span key={l} className="badge badge-neutral" style={{ fontSize: 11 }}>
          {l}
        </span>
      ))}
      {more > 0 ? (
        <span style={{ fontSize: 11, color: "var(--text-3)" }}>+{more}</span>
      ) : null}
    </div>
  );
}

function SamplingCell({
  sampling,
}: {
  sampling: AnnotationQueueRow["sampling"];
}) {
  return (
    <span className="mono" style={{ fontSize: 12 }}>
      n={sampling.sample_size} · {fmtDuration(sampling.window_seconds)}
      {sampling.status !== "any" ? (
        <span style={{ color: "var(--text-3)" }}> · {sampling.status}</span>
      ) : null}
    </span>
  );
}

function ProgressBar({ done, total }: { done: number; total: number }) {
  if (total === 0) {
    return (
      <span style={{ color: "var(--text-3)" }}>
        0 / 0
      </span>
    );
  }
  const pct = Math.round((done / total) * 100);
  const color =
    pct >= 100
      ? "var(--success, #1f7a3a)"
      : pct >= 50
        ? "var(--warn, #a36a14)"
        : "var(--text-3)";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <div
        style={{
          flex: 1,
          height: 6,
          background: "var(--surface-3, #ececec)",
          borderRadius: 4,
          overflow: "hidden",
          maxWidth: 120,
        }}
      >
        <div
          style={{
            width: `${pct}%`,
            height: "100%",
            background: color,
          }}
        />
      </div>
      <span className="mono" style={{ fontSize: 12, color, minWidth: 56 }}>
        {done} / {total}
      </span>
    </div>
  );
}

function UsageCard() {
  return (
    <section className="card card-pad-lg">
      <h2 style={{ marginBottom: 8 }}>Why human labels go in the same store</h2>
      <p
        style={{
          color: "var(--text-2)",
          margin: "0 0 12px",
          fontSize: 13,
          lineHeight: 1.55,
        }}
      >
        Each submission writes one ClickHouse <code>eval_score</code> row
        tagged <code>judge_name=&apos;human&apos;</code>, <code>judge_endpoint=&apos;annotation&apos;</code>.
        That puts human labels on the same shelf as LLM-judge scores
        (echo / contains / exact / cmp:a / cmp:b) and end-user feedback
        (<code>judge_name=&apos;user&apos;</code>) — so calibration, agreement,
        and regression queries all hit one table. No second source of
        truth.
      </p>
      <pre style={{ margin: 0 }}>
        {`# python sdk (planned):
client.annotations.queue.create(
    project="prod",
    name="checkout-flow weekly review",
    sampling={"window_seconds": 86400, "sample_size": 50, "status": "error"},
    rubric={"labels": ["pass", "fail"], "score": "binary"},
)
# reviewers walk the queue in the UI; results land in the
# same eval_score table as judges and end-user feedback.
`}
      </pre>
    </section>
  );
}

function UnconfiguredState({ reason }: { reason: string | null }) {
  return (
    <div className="card card-pad-lg">
      <h2 style={{ marginBottom: 8 }}>No project resolved</h2>
      <p style={{ color: "var(--text-2)", margin: 0, lineHeight: 1.55 }}>
        Run the setup wizard or create a project before opening
        annotation queues.
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

function EmptyQueuesState({
  reason,
  project,
}: {
  reason: string | null;
  project: Project;
}) {
  return (
    <div style={{ padding: 32 }}>
      <h3 style={{ marginBottom: 6 }}>
        No annotation queues yet in <span className="mono">{project.slug}</span>.
      </h3>
      <p
        style={{
          color: "var(--text-2)",
          margin: 0,
          lineHeight: 1.55,
          maxWidth: 640,
        }}
      >
        Click <strong>New queue</strong> to sample N runs from a recent
        window and define a rubric. Each submission writes a row to the
        same <code>eval_score</code> store LLM judges and feedback use.
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
