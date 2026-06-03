"use client";

import { Save } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

/**
 * Project settings editor.
 *
 * PII redaction defaults ON and we make the operator type a confirmation
 * before turning it off — the locked plan flag is "PII redactor cannot be
 * silently disabled". Sampling and RCA cost ceiling shape the data plane,
 * so we surface them prominently rather than burying them in a JSON blob.
 */

type RcaMode = "off" | "errors_only" | "errors_and_poor" | "all";

export interface ProjectSettings {
  id: string;
  workspace_id: string;
  slug: string;
  name: string;
  sample_rate: number;
  pii_redaction: boolean;
  eval_default_judge: string | null;
  eval_cost_ceiling_usd_per_day: string | null;
  rca_mode: RcaMode;
}

const RCA_OPTIONS: { value: RcaMode; label: string; hint: string }[] = [
  { value: "off", label: "Off", hint: "no automated RCA" },
  { value: "errors_only", label: "Errors only", hint: "default" },
  { value: "errors_and_poor", label: "Errors + poor scores", hint: "broader" },
  { value: "all", label: "All runs", hint: "expensive — set ceiling" },
];

export function ProjectSettingsForm({ project }: { project: ProjectSettings }) {
  const router = useRouter();
  const [name, setName] = useState(project.name);
  const [sampleRate, setSampleRate] = useState(String(project.sample_rate));
  const [piiRedaction, setPiiRedaction] = useState(project.pii_redaction);
  const [piiConfirm, setPiiConfirm] = useState("");
  const [rcaMode, setRcaMode] = useState<RcaMode>(project.rca_mode);
  const [costCeiling, setCostCeiling] = useState(
    project.eval_cost_ceiling_usd_per_day ?? "",
  );
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const dirty =
    name !== project.name ||
    Number(sampleRate) !== project.sample_rate ||
    piiRedaction !== project.pii_redaction ||
    rcaMode !== project.rca_mode ||
    (costCeiling || null) !==
      (project.eval_cost_ceiling_usd_per_day || null);

  const piiTurningOff = project.pii_redaction && !piiRedaction;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setOkMsg(null);

    const sr = Number(sampleRate);
    if (!Number.isFinite(sr) || sr < 0 || sr > 1) {
      setError("sample rate must be between 0 and 1");
      return;
    }
    if (piiTurningOff && piiConfirm !== "DISABLE") {
      setError(
        'type DISABLE in the confirmation box to turn PII redaction off',
      );
      return;
    }

    const patch: Record<string, unknown> = {};
    if (name !== project.name) patch.name = name;
    if (sr !== project.sample_rate) patch.sample_rate = sr;
    if (piiRedaction !== project.pii_redaction)
      patch.pii_redaction = piiRedaction;
    if (rcaMode !== project.rca_mode) patch.rca_mode = rcaMode;
    const cc = costCeiling.trim();
    if ((cc || null) !== (project.eval_cost_ceiling_usd_per_day || null)) {
      patch.eval_cost_ceiling_usd_per_day = cc === "" ? null : cc;
    }
    if (Object.keys(patch).length === 0) return;

    startTransition(async () => {
      const res = await fetch(`/api/projects/${project.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          detail?: string;
        };
        setError(body.detail ?? `request failed (${res.status})`);
        return;
      }
      setOkMsg("Saved.");
      setPiiConfirm("");
      router.refresh();
    });
  }

  return (
    <form
      onSubmit={submit}
      style={{ display: "flex", flexDirection: "column", gap: 24 }}
    >
      <Field label="Display name" hint="Shown in the project switcher">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          style={{ width: 320 }}
          disabled={pending}
        />
      </Field>

      <Field
        label="Sample rate"
        hint="Fraction of runs to ingest (0.0 – 1.0). 1.0 = keep everything."
      >
        <input
          type="number"
          step="0.01"
          min="0"
          max="1"
          value={sampleRate}
          onChange={(e) => setSampleRate(e.target.value)}
          style={{ width: 120 }}
          className="mono"
          disabled={pending}
        />
      </Field>

      <Field
        label="PII redaction"
        hint="Strips emails, phone numbers, credit cards, and other PII from inputs/outputs at ingest. Cannot be silently disabled."
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <label
            style={{ display: "inline-flex", alignItems: "center", gap: 8 }}
          >
            <input
              type="checkbox"
              checked={piiRedaction}
              onChange={(e) => setPiiRedaction(e.target.checked)}
              disabled={pending}
            />
            <span>{piiRedaction ? "On" : "Off"}</span>
            {project.pii_redaction ? (
              <span className="badge badge-success">On in production</span>
            ) : (
              <span className="badge badge-warn">Off in production</span>
            )}
          </label>
          {piiTurningOff ? (
            <div
              style={{
                padding: 10,
                background: "var(--warn-soft)",
                border: "1px solid var(--warn)",
                borderRadius: "var(--r-2)",
                color: "var(--warn)",
                fontSize: 12,
                lineHeight: 1.5,
              }}
            >
              Type <span className="mono">DISABLE</span> to confirm. New traces
              will store inputs and outputs verbatim. Existing traces are
              unchanged.
              <input
                type="text"
                value={piiConfirm}
                onChange={(e) => setPiiConfirm(e.target.value)}
                placeholder="DISABLE"
                style={{ display: "block", marginTop: 8, width: 200 }}
                className="mono"
                disabled={pending}
              />
            </div>
          ) : null}
        </div>
      </Field>

      <Field
        label="RCA mode"
        hint="When to launch automated root-cause analysis. Cost ceiling stops a runaway."
      >
        <select
          value={rcaMode}
          onChange={(e) => setRcaMode(e.target.value as RcaMode)}
          style={{ width: 280 }}
          disabled={pending}
        >
          {RCA_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label} — {o.hint}
            </option>
          ))}
        </select>
      </Field>

      <Field
        label="Eval cost ceiling"
        hint="Max USD/day for automated evals + RCA on this project. Empty = no ceiling."
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span className="mono" style={{ color: "var(--text-3)" }}>
            $
          </span>
          <input
            type="text"
            inputMode="decimal"
            placeholder="50.00"
            value={costCeiling}
            onChange={(e) => setCostCeiling(e.target.value)}
            style={{ width: 140 }}
            className="mono"
            disabled={pending}
          />
          <span style={{ color: "var(--text-3)", fontSize: 12 }}>per day</span>
        </div>
      </Field>

      {error ? (
        <p style={{ color: "var(--danger)", fontSize: 13, margin: 0 }}>
          {error}
        </p>
      ) : null}
      {okMsg ? (
        <p style={{ color: "var(--success)", fontSize: 13, margin: 0 }}>
          {okMsg}
        </p>
      ) : null}

      <div style={{ display: "flex", gap: 8 }}>
        <button
          type="submit"
          className="btn btn-primary"
          disabled={pending || !dirty}
        >
          <Save size={14} strokeWidth={1.75} />
          {pending ? "Saving…" : "Save changes"}
        </button>
      </div>
    </form>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <span style={{ fontSize: 13, color: "var(--text)", fontWeight: 500 }}>
          {label}
        </span>
        {hint ? (
          <span
            style={{
              fontSize: 12,
              color: "var(--text-3)",
              lineHeight: 1.5,
            }}
          >
            {hint}
          </span>
        ) : null}
      </div>
      {children}
    </div>
  );
}
