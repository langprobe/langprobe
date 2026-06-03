import Link from "next/link";
import { Shell } from "@/components/Shell";
import {
  NewEvalRunButton,
  type DatasetOption,
  type EvalRunRow,
} from "@/components/EvalsClient";
import type { DatasetRow } from "@/components/DatasetsClient";
import { apiGet } from "@/lib/api";
import { resolveActiveProject, type Project } from "@/lib/projects";

/**
 * Evals — runs scored against a dataset.
 *
 * Built-in v1 judges (echo / contains / exact) score every dataset item
 * and write to ClickHouse `eval_score`; the postgres `eval_run` row
 * tracks lifecycle and average score. LLM-as-judge swaps in next
 * iteration with the same data path.
 */

export const dynamic = "force-dynamic";

export default async function EvalsPage() {
  const { active, all, reason } = await resolveActiveProject();

  if (!active) {
    return (
      <Shell active={null} projects={all}>
        <PageInterior>
          <PageHeader title="Evals" subtitle="scored runs against datasets" />
          <UnconfiguredState reason={reason} />
        </PageInterior>
      </Shell>
    );
  }

  const [runsRes, datasetsRes] = await Promise.all([
    apiGet<EvalRunRow[]>(
      `/v1/eval-runs?project_id=${encodeURIComponent(active.id)}`,
    ),
    apiGet<DatasetRow[]>(
      `/v1/datasets?project_id=${encodeURIComponent(active.id)}`,
    ),
  ]);

  const runs = runsRes.data ?? [];
  const datasets: DatasetOption[] = (datasetsRes.data ?? []).map((d) => ({
    id: d.id,
    slug: d.slug,
    name: d.name,
    item_count: d.item_count,
  }));
  const datasetIndex = new Map(datasets.map((d) => [d.id, d.slug]));

  return (
    <Shell active={active} projects={all}>
      <PageInterior>
        <PageHeader
          title="Evals"
          subtitle={`${active.slug} · ${runs.length} ${runs.length === 1 ? "run" : "runs"}`}
          right={<NewEvalRunButton projectId={active.id} datasets={datasets} />}
        />
        <RunsCard
          runs={runs}
          reason={runsRes.error}
          project={active}
          datasetIndex={datasetIndex}
          hasDatasets={datasets.length > 0}
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

function RunsCard({
  runs,
  reason,
  project,
  datasetIndex,
  hasDatasets,
}: {
  runs: EvalRunRow[];
  reason: string | null;
  project: Project;
  datasetIndex: Map<string, string>;
  hasDatasets: boolean;
}) {
  return (
    <section className="card" style={{ overflow: "hidden" }}>
      <div className="card-head">
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <h2>All eval runs</h2>
          <span className="card-sub">
            scoped to <span className="mono">{project.slug}</span>
          </span>
        </div>
      </div>
      {runs.length === 0 ? (
        <EmptyState
          reason={reason}
          project={project}
          hasDatasets={hasDatasets}
        />
      ) : (
        <div style={{ overflow: "auto" }}>
          <table className="table">
            <thead>
              <tr>
                <th>Status</th>
                <th>Name</th>
                <th>Dataset</th>
                <th>Judge</th>
                <th style={{ textAlign: "right" }}>Progress</th>
                <th style={{ textAlign: "right" }}>Avg score</th>
                <th style={{ textAlign: "right" }}>Started</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id}>
                  <td>
                    <StatusBadge status={r.status} />
                  </td>
                  <td>
                    {r.name ?? <span style={{ color: "var(--text-3)" }}>—</span>}
                  </td>
                  <td>
                    <span className="mono">
                      {datasetIndex.get(r.dataset_id) ?? r.dataset_id.slice(0, 8)}
                    </span>
                  </td>
                  <td>
                    <span className="mono" style={{ fontSize: 12 }}>
                      {r.judge_kind}
                    </span>
                  </td>
                  <td className="num" style={{ textAlign: "right" }}>
                    {r.item_done}
                    <span style={{ color: "var(--text-3)" }}>
                      {" "}
                      / {r.item_total}
                    </span>
                  </td>
                  <td className="num" style={{ textAlign: "right" }}>
                    {r.score_avg !== null ? (
                      <ScoreCell score={r.score_avg} />
                    ) : (
                      <span style={{ color: "var(--text-3)" }}>—</span>
                    )}
                  </td>
                  <td
                    className="num"
                    style={{ textAlign: "right", color: "var(--text-3)" }}
                  >
                    {fmtDateTime(r.started_at ?? r.created_at)}
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <Link
                      href={`/evals/${r.id}`}
                      className="btn btn-ghost"
                      style={{ fontSize: 12 }}
                    >
                      open →
                    </Link>
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

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    queued: "badge-neutral",
    running: "badge-warn",
    done: "badge-success",
    failed: "badge-danger",
  };
  const cls = map[status] ?? "badge-neutral";
  return <span className={`badge ${cls}`}>{status}</span>;
}

function ScoreCell({ score }: { score: number }) {
  const pct = Math.round(score * 100);
  const color =
    pct >= 90
      ? "var(--success, #1f7a3a)"
      : pct >= 70
        ? "var(--warn, #a36a14)"
        : "var(--danger)";
  return (
    <span className="mono" style={{ color, fontWeight: 500 }}>
      {(score * 100).toFixed(1)}%
    </span>
  );
}

function UsageCard() {
  return (
    <section className="card card-pad-lg">
      <h2 style={{ marginBottom: 8 }}>
        Run a regression suite, gate the merge
      </h2>
      <p
        style={{
          color: "var(--text-2)",
          margin: "0 0 12px",
          fontSize: 13,
          lineHeight: 1.55,
        }}
      >
        v1 ships built-in judges (no LLM key required) so the data path is
        live end-to-end. The next iteration swaps in <code>llm:single</code>{" "}
        and PoLL (3-judge majority); the storage shape doesn&apos;t change.
      </p>
      <pre style={{ margin: 0 }}>
        {`# python sdk (planned):
client.evals.run(
    project="prod",
    dataset="regressions/triage",
    judge="exact",          # built-in v1
)
# next iteration:
client.evals.run(
    project="prod",
    dataset="regressions/triage",
    judges=["claude-haiku-4-5", "gpt-5", "gemini-2.5-flash"],
    aggregator="majority",
)
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
        Run the setup wizard or create a project before running evals.
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

function EmptyState({
  reason,
  project,
  hasDatasets,
}: {
  reason: string | null;
  project: Project;
  hasDatasets: boolean;
}) {
  return (
    <div style={{ padding: 32 }}>
      <h3 style={{ marginBottom: 6 }}>
        No eval runs yet in <span className="mono">{project.slug}</span>.
      </h3>
      <p
        style={{
          color: "var(--text-2)",
          margin: 0,
          lineHeight: 1.55,
          maxWidth: 640,
        }}
      >
        {hasDatasets ? (
          <>
            Click <strong>New eval run</strong> to score a dataset with one of
            the built-in judges. <code>echo</code> is the smoke test;{" "}
            <code>exact</code> and <code>contains</code> are real checks.
          </>
        ) : (
          <>
            You need a <Link href="/datasets">dataset</Link> with at least one
            item before you can run an eval. Datasets carry the input +
            expected output pairs the judge scores against.
          </>
        )}
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

function fmtDateTime(iso: string): string {
  try {
    return new Date(iso).toISOString().replace("T", " ").slice(0, 16);
  } catch {
    return iso;
  }
}
