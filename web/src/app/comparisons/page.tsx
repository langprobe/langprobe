import Link from "next/link";
import { Shell } from "@/components/Shell";
import {
  NewComparisonButton,
  type ComparisonRow,
  type DatasetOption,
  type VersionOption,
} from "@/components/ComparisonsClient";
import type { DatasetRow } from "@/components/DatasetsClient";
import type { PromptRow } from "@/components/PromptsClient";
import { apiGet } from "@/lib/api";
import { resolveActiveProject, type Project } from "@/lib/projects";

/**
 * Comparisons — A/B two prompt versions on a dataset.
 *
 * Pairs a dataset with two `prompt_version` ids and a judge. The
 * background runner scores every dataset item on both sides and
 * writes one ClickHouse `eval_score` row per side per item, tagged
 * via `judge_name='cmp:a'` / `'cmp:b'`. Aggregates roll up to the
 * postgres `comparison` row so the list view stays cheap.
 *
 * v1 ships built-in judges only (echo / contains / exact); the
 * "model output" being scored is the prompt template body itself
 * until LLM execution lands. The storage shape and pairing logic
 * are final — only `_render_for_variant` swaps.
 */

export const dynamic = "force-dynamic";

interface PromptVersionWire {
  id: string;
  prompt_id: string;
  version: number;
  aliases: string[];
}

interface PromptVersionListWire {
  versions: PromptVersionWire[];
}

export default async function ComparisonsPage() {
  const { active, all, reason } = await resolveActiveProject();

  if (!active) {
    return (
      <Shell active={null} projects={all}>
        <PageInterior>
          <PageHeader title="Comparisons" subtitle="A/B two prompt versions" />
          <UnconfiguredState reason={reason} />
        </PageInterior>
      </Shell>
    );
  }

  const [comparisonsRes, datasetsRes, promptsRes] = await Promise.all([
    apiGet<ComparisonRow[]>(
      `/v1/comparisons?project_id=${encodeURIComponent(active.id)}`,
    ),
    apiGet<DatasetRow[]>(
      `/v1/datasets?project_id=${encodeURIComponent(active.id)}`,
    ),
    apiGet<PromptRow[]>(
      `/v1/prompts?project_id=${encodeURIComponent(active.id)}`,
    ),
  ]);

  const comparisons = comparisonsRes.data ?? [];
  const datasets: DatasetOption[] = (datasetsRes.data ?? []).map((d) => ({
    id: d.id,
    slug: d.slug,
    name: d.name,
    item_count: d.item_count,
  }));
  const datasetIndex = new Map(datasets.map((d) => [d.id, d.slug]));

  const prompts = promptsRes.data ?? [];
  const versionBatches = await Promise.all(
    prompts.map((p) =>
      apiGet<PromptVersionListWire>(`/v1/prompts/${p.id}/versions`),
    ),
  );
  const versions: VersionOption[] = [];
  versionBatches.forEach((res, idx) => {
    const slug = prompts[idx]?.slug ?? "";
    for (const v of res.data?.versions ?? []) {
      versions.push({
        id: v.id,
        prompt_slug: slug,
        version: v.version,
        aliases: v.aliases ?? [],
      });
    }
  });
  const versionIndex = new Map(versions.map((v) => [v.id, v]));

  return (
    <Shell active={active} projects={all}>
      <PageInterior>
        <PageHeader
          title="Comparisons"
          subtitle={`${active.slug} · ${comparisons.length} ${comparisons.length === 1 ? "comparison" : "comparisons"}`}
          right={
            <NewComparisonButton
              projectId={active.id}
              datasets={datasets}
              versions={versions}
            />
          }
        />
        <ComparisonsCard
          rows={comparisons}
          reason={comparisonsRes.error}
          project={active}
          datasetIndex={datasetIndex}
          versionIndex={versionIndex}
          hasDatasets={datasets.length > 0}
          hasVersions={versions.length >= 2}
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

function ComparisonsCard({
  rows,
  reason,
  project,
  datasetIndex,
  versionIndex,
  hasDatasets,
  hasVersions,
}: {
  rows: ComparisonRow[];
  reason: string | null;
  project: Project;
  datasetIndex: Map<string, string>;
  versionIndex: Map<string, VersionOption>;
  hasDatasets: boolean;
  hasVersions: boolean;
}) {
  return (
    <section className="card" style={{ overflow: "hidden" }}>
      <div className="card-head">
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <h2>All comparisons</h2>
          <span className="card-sub">
            scoped to <span className="mono">{project.slug}</span>
          </span>
        </div>
      </div>
      {rows.length === 0 ? (
        <EmptyState
          reason={reason}
          project={project}
          hasDatasets={hasDatasets}
          hasVersions={hasVersions}
        />
      ) : (
        <div style={{ overflow: "auto" }}>
          <table className="table">
            <thead>
              <tr>
                <th>Status</th>
                <th>Name</th>
                <th>Dataset</th>
                <th>Variant A</th>
                <th>Variant B</th>
                <th>Judge</th>
                <th style={{ textAlign: "right" }}>Avg A</th>
                <th style={{ textAlign: "right" }}>Avg B</th>
                <th style={{ textAlign: "right" }}>Δ</th>
                <th style={{ textAlign: "right" }}>Started</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
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
                    <VariantCell version={versionIndex.get(r.prompt_version_id_a)} fallback={r.prompt_version_id_a} />
                  </td>
                  <td>
                    <VariantCell version={versionIndex.get(r.prompt_version_id_b)} fallback={r.prompt_version_id_b} />
                  </td>
                  <td>
                    <span className="mono" style={{ fontSize: 12 }}>
                      {r.judge_kind}
                    </span>
                  </td>
                  <td className="num" style={{ textAlign: "right" }}>
                    <ScoreCell score={r.score_avg_a} />
                  </td>
                  <td className="num" style={{ textAlign: "right" }}>
                    <ScoreCell score={r.score_avg_b} />
                  </td>
                  <td className="num" style={{ textAlign: "right" }}>
                    <DeltaCell a={r.score_avg_a} b={r.score_avg_b} />
                  </td>
                  <td
                    className="num"
                    style={{ textAlign: "right", color: "var(--text-3)" }}
                  >
                    {fmtDateTime(r.started_at ?? r.created_at)}
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <Link
                      href={`/comparisons/${r.id}`}
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

function VariantCell({
  version,
  fallback,
}: {
  version: VersionOption | undefined;
  fallback: string;
}) {
  if (!version) {
    return (
      <span className="mono" style={{ fontSize: 12, color: "var(--text-3)" }}>
        {fallback.slice(0, 8)}
      </span>
    );
  }
  const aliasPart =
    version.aliases.length > 0 ? ` @${version.aliases[0]}` : "";
  return (
    <span className="mono" style={{ fontSize: 12 }}>
      {version.prompt_slug} v{version.version}
      {aliasPart ? (
        <span style={{ color: "var(--text-3)" }}>{aliasPart}</span>
      ) : null}
    </span>
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

function ScoreCell({ score }: { score: number | null }) {
  if (score === null) {
    return <span style={{ color: "var(--text-3)" }}>—</span>;
  }
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

function DeltaCell({ a, b }: { a: number | null; b: number | null }) {
  if (a === null || b === null) {
    return <span style={{ color: "var(--text-3)" }}>—</span>;
  }
  const delta = b - a;
  const pp = (delta * 100).toFixed(1);
  const color =
    delta > 0.0005
      ? "var(--success, #1f7a3a)"
      : delta < -0.0005
        ? "var(--danger)"
        : "var(--text-3)";
  const sign = delta > 0 ? "+" : "";
  return (
    <span className="mono" style={{ color, fontWeight: 500 }}>
      {sign}
      {pp}pp
    </span>
  );
}

function UsageCard() {
  return (
    <section className="card card-pad-lg">
      <h2 style={{ marginBottom: 8 }}>
        Did revision B beat revision A?
      </h2>
      <p
        style={{
          color: "var(--text-2)",
          margin: "0 0 12px",
          fontSize: 13,
          lineHeight: 1.55,
        }}
      >
        v1 pairs every dataset item against both prompt versions and
        scores each side with the same judge — the storage shape is
        identical to evals (one ClickHouse <code>eval_score</code> row
        per item per side, tagged <code>cmp:a</code> / <code>cmp:b</code>).
        Real LLM generation slots in next iteration without changing
        the diff table or aggregation; only the per-variant render
        function changes.
      </p>
      <pre style={{ margin: 0 }}>
        {`# python sdk (planned):
client.comparisons.run(
    project="prod",
    dataset="regressions/triage",
    variant_a={"prompt_version": "triage-router@production"},
    variant_b={"prompt_version": "triage-router@candidate"},
    judge="exact",          # built-in v1
)
# next iteration:
client.comparisons.run(
    project="prod",
    dataset="regressions/triage",
    variant_a={"prompt_version": "@production"},
    variant_b={"prompt_version": "@candidate"},
    judges=["claude-haiku-4-5", "gpt-5"],
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
        Run the setup wizard or create a project before running
        comparisons.
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
  hasVersions,
}: {
  reason: string | null;
  project: Project;
  hasDatasets: boolean;
  hasVersions: boolean;
}) {
  return (
    <div style={{ padding: 32 }}>
      <h3 style={{ marginBottom: 6 }}>
        No comparisons yet in <span className="mono">{project.slug}</span>.
      </h3>
      <p
        style={{
          color: "var(--text-2)",
          margin: 0,
          lineHeight: 1.55,
          maxWidth: 640,
        }}
      >
        {!hasDatasets ? (
          <>
            You need a <Link href="/datasets">dataset</Link> first — every
            item in the dataset is scored on both sides.
          </>
        ) : !hasVersions ? (
          <>
            You need at least two <Link href="/prompts">prompt versions</Link>{" "}
            to compare. Comparisons pair two versions of a prompt against the
            same dataset and judge.
          </>
        ) : (
          <>
            Click <strong>New comparison</strong> to score the same dataset
            on both prompt versions. The diff column on each row tells you
            which side won, by how much, on which inputs.
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
