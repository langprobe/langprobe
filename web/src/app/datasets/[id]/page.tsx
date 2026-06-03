import Link from "next/link";
import { Shell } from "@/components/Shell";
import {
  AddItemButton,
  DeleteItemButton,
} from "@/components/DatasetItemsClient";
import type { DatasetRow } from "@/components/DatasetsClient";
import { apiGet } from "@/lib/api";
import { resolveActiveProject } from "@/lib/projects";

/**
 * Dataset detail — list of items in a single dataset.
 *
 * Catalog row comes from postgres (via /v1/datasets/{id}); rows come
 * from ClickHouse (via /v1/datasets/{id}/items). Add/delete are client
 * components that hit the local /api proxy and refresh the server tree.
 */

export const dynamic = "force-dynamic";

interface DatasetItem {
  item_id: string;
  dataset_id: string;
  input: string;
  expected: string;
  metadata: Record<string, unknown>;
  source_run_id: string | null;
  source_span_id: string | null;
  created_at: string;
}

interface DatasetItemList {
  items: DatasetItem[];
}

export default async function DatasetDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const datasetId = decodeURIComponent(params.id);
  const { active, all, reason } = await resolveActiveProject();

  if (!active) {
    return (
      <Shell active={null} projects={all}>
        <PageInterior>
          <BreadcrumbBar />
          <PageHeader title="Dataset" subtitle={datasetId} />
          <UnconfiguredState reason={reason} />
        </PageInterior>
      </Shell>
    );
  }

  const detailRes = await apiGet<DatasetRow>(`/v1/datasets/${datasetId}`);
  const detail = detailRes.data;

  if (!detail) {
    return (
      <Shell active={active} projects={all}>
        <PageInterior>
          <BreadcrumbBar />
          <PageHeader title="Dataset" subtitle={datasetId} />
          <NotFoundState reason={detailRes.error} status={detailRes.status} />
        </PageInterior>
      </Shell>
    );
  }

  const itemsRes = await apiGet<DatasetItemList>(
    `/v1/datasets/${datasetId}/items?limit=100`,
  );
  const items = itemsRes.data?.items ?? [];

  return (
    <Shell active={active} projects={all}>
      <PageInterior>
        <BreadcrumbBar />
        <PageHeader
          title={detail.name}
          subtitle={
            <span className="mono" style={{ color: "var(--text-3)" }}>
              {detail.slug}
            </span>
          }
          right={<AddItemButton datasetId={detail.id} />}
        />
        <SummaryGrid detail={detail} loadedCount={items.length} />
        {detail.description ? (
          <DescriptionCard description={detail.description} />
        ) : null}
        <ItemsCard
          datasetId={detail.id}
          items={items}
          reason={itemsRes.error}
          status={itemsRes.status}
        />
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
        gap: 16,
        maxWidth: 1400,
      }}
    >
      {children}
    </div>
  );
}

function BreadcrumbBar() {
  return (
    <div style={{ fontSize: 12, color: "var(--text-3)" }}>
      <Link href="/datasets" style={{ color: "var(--text-3)" }}>
        ← all datasets
      </Link>
    </div>
  );
}

function PageHeader({
  title,
  subtitle,
  right,
}: {
  title: string;
  subtitle: React.ReactNode;
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
        {subtitle}
      </div>
      {right}
    </header>
  );
}

function SummaryGrid({
  detail,
  loadedCount,
}: {
  detail: DatasetRow;
  loadedCount: number;
}) {
  return (
    <section
      className="card"
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
        gap: 0,
        overflow: "hidden",
      }}
    >
      <KpiCell
        label="Items"
        value={detail.item_count.toLocaleString("en-US")}
      />
      <KpiCell
        label="Loaded"
        value={loadedCount.toLocaleString("en-US")}
        sub={
          loadedCount < detail.item_count
            ? `first ${loadedCount} of ${detail.item_count}`
            : undefined
        }
      />
      <KpiCell label="Created" value={fmtDate(detail.created_at)} />
      <KpiCell label="Updated" value={fmtDate(detail.updated_at)} />
    </section>
  );
}

function KpiCell({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div
      style={{
        padding: "16px 20px",
        borderRight: "1px solid var(--border)",
        display: "flex",
        flexDirection: "column",
        gap: 4,
      }}
    >
      <span
        style={{
          fontSize: 11,
          color: "var(--text-3)",
          textTransform: "uppercase",
          letterSpacing: 0.4,
        }}
      >
        {label}
      </span>
      <span
        className="num"
        style={{ fontSize: 22, fontWeight: 500, color: "var(--text)" }}
      >
        {value}
      </span>
      {sub ? (
        <span
          className="mono"
          style={{ fontSize: 11, color: "var(--text-3)" }}
        >
          {sub}
        </span>
      ) : null}
    </div>
  );
}

function DescriptionCard({ description }: { description: string }) {
  return (
    <section className="card card-pad-lg">
      <p
        style={{
          margin: 0,
          color: "var(--text-2)",
          lineHeight: 1.55,
          whiteSpace: "pre-wrap",
        }}
      >
        {description}
      </p>
    </section>
  );
}

function ItemsCard({
  datasetId,
  items,
  reason,
  status,
}: {
  datasetId: string;
  items: DatasetItem[];
  reason: string | null;
  status: number;
}) {
  return (
    <section className="card" style={{ overflow: "hidden" }}>
      <div className="card-head">
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <h2>Items</h2>
          <span className="card-sub">most recent first</span>
        </div>
      </div>
      {reason && items.length === 0 ? (
        <ItemsErrorState reason={reason} status={status} />
      ) : items.length === 0 ? (
        <EmptyItemsState />
      ) : (
        <div style={{ overflow: "auto" }}>
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 120 }}>Item</th>
                <th>Input</th>
                <th>Expected</th>
                <th>Source run</th>
                <th style={{ textAlign: "right" }}>Created</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.item_id}>
                  <td className="mono" style={{ color: "var(--text-3)" }}>
                    {it.item_id.slice(0, 8)}
                  </td>
                  <td>
                    <Preview text={it.input} />
                  </td>
                  <td>
                    <Preview text={it.expected} muted />
                  </td>
                  <td>
                    {it.source_run_id ? (
                      <Link
                        href={`/runs/${it.source_run_id}`}
                        className="mono"
                      >
                        {it.source_run_id.slice(0, 8)}
                      </Link>
                    ) : (
                      <span style={{ color: "var(--text-3)" }}>—</span>
                    )}
                  </td>
                  <td
                    className="num"
                    style={{ textAlign: "right", color: "var(--text-3)" }}
                  >
                    {fmtTime(it.created_at)}
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <DeleteItemButton
                      datasetId={datasetId}
                      itemId={it.item_id}
                    />
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

function Preview({ text, muted }: { text: string; muted?: boolean }) {
  if (!text) {
    return <span style={{ color: "var(--text-3)" }}>—</span>;
  }
  const trimmed = text.length > 140 ? `${text.slice(0, 140)}…` : text;
  return (
    <span
      className="mono"
      style={{
        fontSize: 12,
        color: muted ? "var(--text-3)" : "var(--text-2)",
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
      }}
    >
      {trimmed}
    </span>
  );
}

function EmptyItemsState() {
  return (
    <div style={{ padding: 32 }}>
      <h3 style={{ marginBottom: 6 }}>No items yet.</h3>
      <p
        style={{
          color: "var(--text-2)",
          margin: 0,
          lineHeight: 1.55,
          maxWidth: 640,
        }}
      >
        Click <strong>Add item</strong> to pin an input/expected pair —
        or paste a failing run id from <Link href="/runs">/runs</Link> as
        the source. The next eval pass blocks the same failure mode.
      </p>
    </div>
  );
}

function ItemsErrorState({
  reason,
  status,
}: {
  reason: string | null;
  status: number;
}) {
  return (
    <div style={{ padding: 32 }}>
      <h3 style={{ marginBottom: 6 }}>Unable to load items</h3>
      <p
        style={{
          color: "var(--text-2)",
          margin: 0,
          lineHeight: 1.55,
          maxWidth: 640,
        }}
      >
        {status === 503
          ? "The data plane (ClickHouse) is unreachable."
          : "The data plane returned an error."}
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

function NotFoundState({
  reason,
  status,
}: {
  reason: string | null;
  status: number;
}) {
  return (
    <div className="card card-pad-lg">
      <h2 style={{ marginBottom: 8 }}>
        {status === 404 ? "Dataset not found" : "Unable to load dataset"}
      </h2>
      <p style={{ color: "var(--text-2)", lineHeight: 1.55, margin: 0 }}>
        {status === 404
          ? "No dataset matches this id in the active project."
          : "The control plane returned an error."}
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

function UnconfiguredState({ reason }: { reason: string | null }) {
  return (
    <div className="card card-pad-lg">
      <h2 style={{ marginBottom: 8 }}>No project resolved</h2>
      <p style={{ color: "var(--text-2)", lineHeight: 1.55, margin: 0 }}>
        Run the setup wizard or create a project before viewing datasets.
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

function fmtTime(iso: string): string {
  try {
    return new Date(iso).toISOString().slice(11, 19);
  } catch {
    return iso;
  }
}
