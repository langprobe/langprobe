import Link from "next/link";
import { Shell } from "@/components/Shell";
import {
  type DatasetOption,
  NewPollRunButton,
  type PollRunRow,
} from "@/components/PollRunsClient";
import { apiGet } from "@/lib/api";
import { resolveActiveProject, type Project } from "@/lib/projects";

/**
 * Panel-of-LLM-Judges runs.
 *
 * Server component. Lists postgres `poll_run` rows for the active
 * project. Each panel run scores every dataset item with N built-in
 * judges; per-item scores live in ClickHouse `eval_score` tagged with
 * `eval_config_id=poll_run.id` and `judge_name=<kind>`.
 *
 * The list view shows the consensus score (per the chosen aggregation
 * strategy) and the pairwise agreement metric so reviewers can spot
 * "judges disagree" runs at a glance.
 */

export const dynamic = "force-dynamic";

interface DatasetListRow {
  id: string;
  slug: string;
  name: string;
  item_count: number;
}

export default async function PollRunsPage() {
  const { active, all, reason } = await resolveActiveProject();
  if (!active) {
    return (
      <Shell active={null} projects={all}>
        <PageInterior>
          <PageHeader title="PoLL panels" subtitle="panel-of-LLM-judges runs" />
          <UnconfiguredState reason={reason} />
        </PageInterior>
      </Shell>
    );
  }

  const [runsRes, datasetsRes] = await Promise.all([
    apiGet<PollRunRow[]>(
      `/v1/poll-runs?project_id=${encodeURIComponent(active.id)}`,
    ),
    apiGet<DatasetListRow[]>(
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

  const queued = runs.filter((r) => r.status === "queued" || r.status === "running").length;
  const failed = runs.filter((r) => r.status === "failed").length;
  const avgConsensus = mean(
    runs.filter((r) => r.consensus_avg != null).map((r) => r.consensus_avg ?? 0),
  );
  const avgAgreement = mean(
    runs.filter((r) => r.agreement != null).map((r) => r.agreement ?? 0),
  );

  return (
    <Shell active={active} projects={all}>
      <PageInterior>
        <PageHeader
          title="PoLL panels"
          subtitle={`${active.slug} · ${runs.length} ${runs.length === 1 ? "run" : "runs"}`}
          right={
            <NewPollRunButton projectId={active.id} datasets={datasets} />
          }
        />
        <KpiStrip
          total={runs.length}
          queued={queued}
          failed={failed}
          avgConsensus={avgConsensus}
          avgAgreement={avgAgreement}
        />
        <RunsCard rows={runs} project={active} />
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
  total,
  queued,
  failed,
  avgConsensus,
  avgAgreement,
}: {
  total: number;
  queued: number;
  failed: number;
  avgConsensus: number | null;
  avgAgreement: number | null;
}) {
  return (
    <section
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
        gap: 12,
      }}
    >
      <KpiCard label="Runs" value={String(total)} />
      <KpiCard
        label="In flight"
        value={String(queued)}
        tone={queued > 0 ? "warn" : "neutral"}
      />
      <KpiCard label="Consensus avg" value={fmtPct(avgConsensus)} />
      <KpiCard
        label="Agreement"
        value={fmtPct(avgAgreement)}
        tone={
          avgAgreement != null && avgAgreement < 0.7
            ? "warn"
            : "neutral"
        }
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

function RunsCard({
  rows,
  project,
}: {
  rows: PollRunRow[];
  project: Project;
}) {
  return (
    <section className="card" style={{ overflow: "hidden" }}>
      <div className="card-head">
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <h2>Runs</h2>
          <span className="card-sub">
            scoped to <span className="mono">{project.slug}</span>
          </span>
        </div>
      </div>
      {rows.length === 0 ? (
        <EmptyRunsState project={project} />
      ) : (
        <div style={{ overflow: "auto" }}>
          <table className="table">
            <thead>
              <tr>
                <th>Status</th>
                <th>Name</th>
                <th>Judges</th>
                <th>Strategy</th>
                <th style={{ textAlign: "right" }}>Consensus</th>
                <th style={{ textAlign: "right" }}>Agreement</th>
                <th style={{ textAlign: "right" }}>Items</th>
                <th style={{ textAlign: "right" }}>Created</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <StatusBadge status={r.status} />
                  </td>
                  <td>
                    <Link
                      href={`/poll-runs/${r.id}`}
                      style={{ textDecoration: "none" }}
                    >
                      <span style={{ color: "var(--link)" }}>
                        {r.name ?? <span className="mono">{r.id.slice(0, 8)}</span>}
                      </span>
                    </Link>
                  </td>
                  <td>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                      {r.judges.map((j) => (
                        <span key={j} className="badge badge-neutral">
                          {j}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td>
                    <span className="mono" style={{ fontSize: 12 }}>
                      {r.aggregation}
                    </span>
                  </td>
                  <td
                    className="num"
                    style={{ textAlign: "right" }}
                  >
                    {fmtPct(r.consensus_avg)}
                  </td>
                  <td
                    className="num"
                    style={{
                      textAlign: "right",
                      color:
                        r.agreement != null && r.agreement < 0.7
                          ? "var(--warn, #a36a14)"
                          : undefined,
                    }}
                  >
                    {fmtPct(r.agreement)}
                  </td>
                  <td
                    className="num"
                    style={{ textAlign: "right", color: "var(--text-3)" }}
                  >
                    {r.item_done}/{r.item_total}
                  </td>
                  <td
                    className="num"
                    style={{ textAlign: "right", color: "var(--text-3)" }}
                  >
                    {fmtDateTime(r.created_at)}
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

function UsageCard() {
  return (
    <section className="card card-pad-lg">
      <h2 style={{ marginBottom: 8 }}>Why a panel of judges</h2>
      <p
        style={{
          color: "var(--text-2)",
          margin: "0 0 12px",
          fontSize: 13,
          lineHeight: 1.55,
        }}
      >
        A single judge's bias is a single point of failure. A panel — even
        two or three deterministic judges — surfaces disagreement and lets
        you spot items where the rubric is ambiguous. Per-item scores
        land in the same <code>eval_score</code> store as single-judge
        evals (tagged <code>judge_name=&lt;kind&gt;</code>), so the
        analytic shape is identical and your existing dashboards still
        work.
      </p>
      <pre style={{ margin: 0 }}>
        {`# python sdk (planned):
client.poll_runs.create(
    project="prod",
    dataset_id="...",
    judges=["contains", "exact", "claude-judge-v1"],
    aggregation="majority",
)
# server scores every item with every judge, computes consensus +
# pairwise agreement, writes one eval_score row per (item, judge).`}
      </pre>
    </section>
  );
}

function StatusBadge({ status }: { status: PollRunRow["status"] }) {
  if (status === "done") {
    return <span className="badge badge-success">done</span>;
  }
  if (status === "failed") {
    return <span className="badge badge-danger">failed</span>;
  }
  if (status === "running") {
    return <span className="badge badge-warn">running</span>;
  }
  return <span className="badge badge-neutral">queued</span>;
}

function UnconfiguredState({ reason }: { reason: string | null }) {
  return (
    <div className="card card-pad-lg">
      <h2 style={{ marginBottom: 8 }}>No project resolved</h2>
      <p style={{ color: "var(--text-2)", margin: 0, lineHeight: 1.55 }}>
        Run the setup wizard or create a project before opening PoLL
        panels.
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

function EmptyRunsState({ project }: { project: Project }) {
  return (
    <div style={{ padding: 32 }}>
      <h3 style={{ marginBottom: 6 }}>
        No PoLL panel runs yet in{" "}
        <span className="mono">{project.slug}</span>.
      </h3>
      <p
        style={{
          color: "var(--text-2)",
          margin: 0,
          lineHeight: 1.55,
          maxWidth: 640,
        }}
      >
        Click <strong>New PoLL run</strong> to score a dataset with ≥2
        judges. You'll get a consensus score plus a pairwise agreement
        metric — when judges disagree, that's the row to look at.
      </p>
    </div>
  );
}

function mean(arr: number[]): number | null {
  if (arr.length === 0) return null;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function fmtPct(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return `${(value * 100).toFixed(0)}%`;
}

function fmtDateTime(iso: string): string {
  try {
    return new Date(iso).toISOString().replace("T", " ").slice(0, 16);
  } catch {
    return iso;
  }
}
