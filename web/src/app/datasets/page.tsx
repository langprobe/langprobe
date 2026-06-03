import Link from "next/link";
import { Shell } from "@/components/Shell";
import {
  CreateDatasetButton,
  DeleteDatasetButton,
  type DatasetRow,
} from "@/components/DatasetsClient";
import { apiGet } from "@/lib/api";
import { resolveActiveProject, type Project } from "@/lib/projects";

/**
 * Datasets — input side of evaluation.
 *
 * A dataset is a named collection of items (input + optional reference
 * output) used for offline eval and regression tests. The catalog lives
 * in postgres; the rows in ClickHouse. This page is the catalog view.
 *
 * Server-rendered list of datasets for the active project; client
 * components handle the create/delete flow. Members can create; only
 * owner/admin can hard-delete.
 */

export const dynamic = "force-dynamic";

export default async function DatasetsPage() {
  const { active, all, reason } = await resolveActiveProject();

  if (!active) {
    return (
      <Shell active={null} projects={all}>
        <PageInterior>
          <PageHeader title="Datasets" subtitle="evaluation inputs" />
          <UnconfiguredState reason={reason} />
        </PageInterior>
      </Shell>
    );
  }

  const datasetsRes = await apiGet<DatasetRow[]>(
    `/v1/datasets?project_id=${encodeURIComponent(active.id)}`,
  );
  const datasets = datasetsRes.data ?? [];

  return (
    <Shell active={active} projects={all}>
      <PageInterior>
        <PageHeader
          title="Datasets"
          subtitle={`${active.slug} · ${datasets.length} ${datasets.length === 1 ? "dataset" : "datasets"}`}
          right={<CreateDatasetButton projectId={active.id} />}
        />
        <DatasetsCard
          datasets={datasets}
          reason={datasetsRes.error}
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

function DatasetsCard({
  datasets,
  reason,
  project,
}: {
  datasets: DatasetRow[];
  reason: string | null;
  project: Project;
}) {
  return (
    <section className="card" style={{ overflow: "hidden" }}>
      <div className="card-head">
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <h2>All datasets</h2>
          <span className="card-sub">
            scoped to <span className="mono">{project.slug}</span>
          </span>
        </div>
      </div>
      {datasets.length === 0 ? (
        <EmptyState reason={reason} project={project} />
      ) : (
        <div style={{ overflow: "auto" }}>
          <table className="table">
            <thead>
              <tr>
                <th>Slug</th>
                <th>Name</th>
                <th style={{ textAlign: "right" }}>Items</th>
                <th style={{ textAlign: "right" }}>Created</th>
                <th style={{ textAlign: "right" }}>Updated</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {datasets.map((d) => (
                <tr key={d.id}>
                  <td>
                    <Link href={`/datasets/${d.id}`} className="mono">
                      {d.slug}
                    </Link>
                  </td>
                  <td>{d.name}</td>
                  <td className="num" style={{ textAlign: "right" }}>
                    {d.item_count.toLocaleString("en-US")}
                  </td>
                  <td
                    className="num"
                    style={{ textAlign: "right", color: "var(--text-3)" }}
                  >
                    {fmtDate(d.created_at)}
                  </td>
                  <td
                    className="num"
                    style={{ textAlign: "right", color: "var(--text-3)" }}
                  >
                    {fmtDate(d.updated_at)}
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <DeleteDatasetButton datasetId={d.id} slug={d.slug} />
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
      <h2 style={{ marginBottom: 8 }}>Pin a failing run as a regression row</h2>
      <p
        style={{
          color: "var(--text-2)",
          margin: "0 0 12px",
          fontSize: 13,
          lineHeight: 1.55,
        }}
      >
        Open any failing run from <Link href="/runs">/runs</Link>, copy its
        run id, then add it as a dataset item with the input and expected
        output. The next eval pass blocks the same failure mode.
      </p>
      <pre style={{ margin: 0 }}>
        {`# python sdk (planned):
client.datasets.add_item(
    dataset="regressions-triage",
    input={"messages": [...]},
    expected={"intent": "billing"},
    source_run_id="run_...",
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
        Run the setup wizard or create a project before adding datasets.
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
}: {
  reason: string | null;
  project: Project;
}) {
  return (
    <div style={{ padding: 32 }}>
      <h3 style={{ marginBottom: 6 }}>
        No datasets yet in <span className="mono">{project.slug}</span>.
      </h3>
      <p
        style={{
          color: "var(--text-2)",
          margin: 0,
          lineHeight: 1.55,
          maxWidth: 640,
        }}
      >
        Click <strong>New dataset</strong> to create one. Datasets are how
        you turn a failing trace into a regression test you never have to
        chase twice.
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

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toISOString().slice(0, 10);
  } catch {
    return iso;
  }
}
