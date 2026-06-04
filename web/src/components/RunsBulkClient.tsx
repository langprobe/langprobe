"use client";

import {
  CheckSquare,
  Database,
  PencilLine,
  Square,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  useTransition,
} from "react";

/**
 * Bulk-actions on /runs.
 *
 * Three components compose this feature:
 *  - <RunsBulkProvider/> wraps the runs table; tracks selection in
 *    React state (intentionally NOT in URL; the URL is the filter
 *    state, not the selection state).
 *  - <RunCheckbox/> renders inside the per-row table cell; reads/writes
 *    the provider state.
 *  - <BulkActionBar/> renders below the table (sticky bottom); when
 *    selection > 0 it surfaces "Add to dataset" and "Send to
 *    annotation queue" actions. The actions hit the cookie-forwarding
 *    proxy and refresh on success.
 *
 * Selection state is project-scoped: switching projects clears it
 * (we re-mount on a new active project).
 *
 * The bar limits the selection to 200 to match the server cap; the
 * "select all visible" affordance only selects up to 200.
 */

const MAX_SELECTION = 200;

interface BulkContextValue {
  selected: Set<string>;
  toggle: (runId: string) => void;
  selectAll: (runIds: string[]) => void;
  clear: () => void;
}

const BulkContext = createContext<BulkContextValue | null>(null);

export function RunsBulkProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const toggle = useCallback((runId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(runId)) {
        next.delete(runId);
      } else if (next.size < MAX_SELECTION) {
        next.add(runId);
      }
      return next;
    });
  }, []);

  const selectAll = useCallback((runIds: string[]) => {
    setSelected((prev) => {
      // If everything visible is already selected, clear; otherwise
      // select up to the cap.
      const everyVisibleSelected = runIds.every((id) => prev.has(id));
      if (everyVisibleSelected) {
        const next = new Set(prev);
        for (const id of runIds) next.delete(id);
        return next;
      }
      const next = new Set(prev);
      for (const id of runIds) {
        if (next.size >= MAX_SELECTION) break;
        next.add(id);
      }
      return next;
    });
  }, []);

  const clear = useCallback(() => setSelected(new Set()), []);

  const value = useMemo(
    () => ({ selected, toggle, selectAll, clear }),
    [selected, toggle, selectAll, clear],
  );
  return (
    <BulkContext.Provider value={value}>{children}</BulkContext.Provider>
  );
}

function useBulk(): BulkContextValue {
  const ctx = useContext(BulkContext);
  if (!ctx) {
    throw new Error("useBulk must be used inside <RunsBulkProvider>");
  }
  return ctx;
}

// ---------------------------------------------------------------------------
// Per-row checkbox + header "select all visible" checkbox
// ---------------------------------------------------------------------------

export function RunCheckbox({ runId }: { runId: string }) {
  const { selected, toggle } = useBulk();
  const checked = selected.has(runId);
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      onClick={(e) => {
        e.stopPropagation();
        toggle(runId);
      }}
      style={{
        background: "transparent",
        border: 0,
        cursor: "pointer",
        padding: 0,
        color: checked ? "var(--accent)" : "var(--text-3)",
        display: "inline-flex",
      }}
    >
      {checked ? <CheckSquare size={14} /> : <Square size={14} />}
    </button>
  );
}

export function SelectAllVisibleCheckbox({
  runIds,
}: {
  runIds: string[];
}) {
  const { selected, selectAll } = useBulk();
  const allChecked =
    runIds.length > 0 && runIds.every((id) => selected.has(id));
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={allChecked}
      onClick={() => selectAll(runIds)}
      title={
        allChecked
          ? "deselect all visible"
          : `select all visible (cap ${MAX_SELECTION})`
      }
      style={{
        background: "transparent",
        border: 0,
        cursor: "pointer",
        padding: 0,
        color: allChecked ? "var(--accent)" : "var(--text-3)",
        display: "inline-flex",
      }}
    >
      {allChecked ? <CheckSquare size={14} /> : <Square size={14} />}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Action bar
// ---------------------------------------------------------------------------

export interface DatasetOption {
  id: string;
  slug: string;
  name: string;
}

export interface AnnotationQueueOption {
  id: string;
  name: string;
}

type Mode = "dataset" | "annotation" | null;

export function BulkActionBar({
  projectId,
  datasets,
  queues,
}: {
  projectId: string;
  datasets: DatasetOption[];
  queues: AnnotationQueueOption[];
}) {
  const router = useRouter();
  const { selected, clear } = useBulk();
  const [mode, setMode] = useState<Mode>(null);
  const [datasetId, setDatasetId] = useState<string>(datasets[0]?.id ?? "");
  const [queueId, setQueueId] = useState<string>(queues[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const count = selected.size;
  if (count === 0) return null;

  function submit() {
    setError(null);
    setSummary(null);
    if (mode === "dataset" && !datasetId) {
      setError("pick a dataset");
      return;
    }
    if (mode === "annotation" && !queueId) {
      setError("pick a queue");
      return;
    }
    const runIds = [...selected];
    startTransition(async () => {
      const path =
        mode === "dataset"
          ? "/api/runs/_actions/add-to-dataset"
          : "/api/runs/_actions/add-to-annotation-queue";
      const body: Record<string, unknown> = {
        project_id: projectId,
        run_ids: runIds,
      };
      if (mode === "dataset") {
        body.dataset_id = datasetId;
      } else {
        body.queue_id = queueId;
      }
      const res = await fetch(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        let data: unknown;
        try {
          data = await res.json();
        } catch {
          data = null;
        }
        const detail =
          data && typeof data === "object" && "detail" in data
            ? String((data as { detail: unknown }).detail)
            : `request failed (${res.status})`;
        setError(detail);
        return;
      }
      const data = (await res.json()) as { accepted: number; skipped: number };
      setSummary(
        `accepted ${data.accepted}${
          data.skipped ? ` · skipped ${data.skipped}` : ""
        }`,
      );
      setMode(null);
      // Keep selection so the operator can verify what they did.
      router.refresh();
    });
  }

  return (
    <div
      role="region"
      aria-label="bulk actions"
      className="card"
      style={{
        position: "sticky",
        bottom: 16,
        marginTop: 8,
        padding: 12,
        display: "flex",
        alignItems: "center",
        gap: 12,
        flexWrap: "wrap",
        boxShadow: "var(--shadow-1, 0 4px 16px rgba(10,10,10,0.08))",
        zIndex: 10,
      }}
    >
      <span
        style={{
          fontSize: 13,
          color: "var(--text-2)",
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        <span
          className="badge badge-success"
          style={{ fontSize: 11, paddingInline: 8 }}
        >
          {count}
        </span>
        selected
      </span>
      <button
        type="button"
        className={mode === "dataset" ? "btn btn-primary" : "btn btn-ghost"}
        onClick={() => setMode(mode === "dataset" ? null : "dataset")}
        disabled={datasets.length === 0}
        title={
          datasets.length === 0 ? "create a dataset first" : "add to dataset"
        }
        style={{ fontSize: 12 }}
      >
        <Database size={13} /> Add to dataset
      </button>
      <button
        type="button"
        className={
          mode === "annotation" ? "btn btn-primary" : "btn btn-ghost"
        }
        onClick={() => setMode(mode === "annotation" ? null : "annotation")}
        disabled={queues.length === 0}
        title={
          queues.length === 0
            ? "create an annotation queue first"
            : "send to annotation queue"
        }
        style={{ fontSize: 12 }}
      >
        <PencilLine size={13} /> Send to queue
      </button>
      {mode === "dataset" ? (
        <select
          value={datasetId}
          onChange={(e) => setDatasetId(e.target.value)}
          style={{ minWidth: 220 }}
        >
          {datasets.map((d) => (
            <option key={d.id} value={d.id}>
              {d.slug} — {d.name}
            </option>
          ))}
        </select>
      ) : null}
      {mode === "annotation" ? (
        <select
          value={queueId}
          onChange={(e) => setQueueId(e.target.value)}
          style={{ minWidth: 220 }}
        >
          {queues.map((q) => (
            <option key={q.id} value={q.id}>
              {q.name}
            </option>
          ))}
        </select>
      ) : null}
      {mode != null ? (
        <button
          type="button"
          className="btn btn-primary"
          onClick={submit}
          disabled={pending}
          style={{ fontSize: 12 }}
        >
          {pending ? "applying…" : "Apply"}
        </button>
      ) : null}
      <span style={{ flex: 1 }} />
      {summary ? (
        <span
          className="mono"
          style={{ fontSize: 12, color: "var(--success, #1f7a3a)" }}
        >
          {summary}
        </span>
      ) : null}
      {error ? (
        <span
          className="mono"
          style={{ fontSize: 12, color: "var(--danger)" }}
        >
          {error}
        </span>
      ) : null}
      <button
        type="button"
        className="btn btn-ghost"
        onClick={() => {
          clear();
          setMode(null);
          setSummary(null);
          setError(null);
        }}
        style={{ fontSize: 12 }}
        title="clear selection"
      >
        <X size={13} /> Clear
      </button>
    </div>
  );
}
