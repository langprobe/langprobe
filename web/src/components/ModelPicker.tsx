"use client";

import { useState } from "react";

import {
  ALL_MODELS,
  MODEL_CATALOG,
  PROVIDERS,
  type Provider,
  findModelOption,
  providerFromValue,
} from "@/lib/models";

/**
 * Provider-grouped model picker.
 *
 * Renders an <optgroup> per provider with the curated catalog plus a
 * "custom..." option that flips to a free-text input. Uncontrolled
 * value below the catalog is preserved as-is (so a typed
 * `gemini/gemini-experimental-1206` round-trips even if it's not in
 * the catalog yet). The escape hatch is the point: we curate for
 * discoverability, not enforcement.
 *
 * The actual gateway dispatches `<provider>/<model_id>`. Legacy bare
 * names (`gpt-4o`, `claude-sonnet-4`) still work for back-compat with
 * existing playground sessions; the api's _resolve_provider routes
 * them. New picks via this component are always fully-qualified.
 */
export function ModelPicker({
  value,
  onChange,
  label,
  ariaLabel,
  availableProviders,
}: {
  value: string;
  onChange: (next: string) => void;
  /** Optional label for the field wrapper. If omitted, render just the inputs. */
  label?: string;
  ariaLabel?: string;
  /**
   * Filter the picker to providers the workspace has credentials for.
   * Pass the result of /v1/llm-credentials projected to distinct
   * provider names. Omit (undefined) for callers without workspace
   * context — judges and others — which keeps today's "show
   * everything" behavior.
   *
   * - undefined: show all providers (legacy)
   * - non-empty array: show only those providers + Custom escape hatch
   * - empty array: show only Custom + nudge to /workspace/credentials
   */
  availableProviders?: string[];
}) {
  // If the current value isn't in the catalog, expose a free-text mode
  // so the user can edit it directly without losing it.
  const inCatalog = ALL_MODELS.some((m) => m.value === value);
  const initialCustom = value !== "" && !inCatalog;
  const [customMode, setCustomMode] = useState(initialCustom);

  const visibleProviders =
    availableProviders === undefined
      ? PROVIDERS
      : PROVIDERS.filter((p) => availableProviders.includes(p.value));

  const noCredentials =
    availableProviders !== undefined && availableProviders.length === 0;

  const select = (
    <select
      aria-label={ariaLabel ?? "model"}
      value={customMode ? "__custom__" : value}
      onChange={(e) => {
        const next = e.target.value;
        if (next === "__custom__") {
          setCustomMode(true);
          // Don't blow away the existing value when entering custom
          // mode; the user might have typed something already.
          return;
        }
        setCustomMode(false);
        onChange(next);
      }}
      style={{ width: "100%" }}
    >
      {visibleProviders.map((p) => (
        <optgroup key={p.value} label={p.label}>
          {MODEL_CATALOG[p.value].map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
              {m.hint ? ` — ${m.hint}` : ""}
            </option>
          ))}
        </optgroup>
      ))}
      <optgroup label="Other">
        <option value="__custom__">Custom… (type any model)</option>
      </optgroup>
    </select>
  );

  const customInput = customMode ? (
    <input
      aria-label="custom model identifier"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder="provider/model-id"
      className="mono"
      style={{ width: "100%", marginTop: 6, fontSize: 13 }}
    />
  ) : null;

  const inferredProvider = providerFromValue(value);
  const opt = findModelOption(value);
  const meta = customMode ? (
    <span
      className="mono"
      style={{ fontSize: 11, color: "var(--text-3)", marginTop: 4 }}
    >
      {inferredProvider
        ? `routed to ${inferredProvider}`
        : "use 'provider/model-id' so the gateway can route correctly"}
    </span>
  ) : opt?.hint ? (
    <span
      style={{ fontSize: 11, color: "var(--text-3)", marginTop: 4 }}
    >
      {opt.provider} · {opt.hint}
    </span>
  ) : null;

  const noCredsNudge = noCredentials ? (
    <span style={{ fontSize: 11, color: "var(--text-3)", marginTop: 4 }}>
      No LLM credentials configured.{" "}
      <a href="/workspace/credentials" style={{ color: "var(--link)" }}>
        Add one →
      </a>
    </span>
  ) : null;

  if (label) {
    return (
      <label style={{ display: "grid", gap: 4 }}>
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
        {select}
        {customInput}
        {meta}
        {noCredsNudge}
      </label>
    );
  }

  return (
    <div style={{ display: "grid", gap: 4 }}>
      {select}
      {customInput}
      {meta}
      {noCredsNudge}
    </div>
  );
}

/**
 * Compact provider+model split. Used by judge config / variant config
 * shapes that store {provider, model} as separate columns. Dispatches
 * the bare model id (no slash prefix) on the wire. Internally this is
 * the same picker UI; we just split the chosen value.
 */
export function ProviderModelPicker({
  provider,
  model,
  onChange,
}: {
  provider: Provider | "" | null;
  model: string;
  onChange: (next: { provider: Provider; model: string }) => void;
}) {
  // Compose the catalog-shaped value; if the model has no provider
  // prefix, pair it with the supplied provider for select rendering.
  const composed =
    model && provider
      ? model.startsWith(`${provider}/`)
        ? model
        : `${provider}/${model}`
      : "";
  return (
    <ModelPicker
      label="Model"
      value={composed}
      onChange={(next) => {
        const slash = next.indexOf("/");
        if (slash > 0) {
          const p = next.slice(0, slash) as Provider;
          const m = next.slice(slash + 1);
          if (PROVIDERS.some((pp) => pp.value === p)) {
            onChange({ provider: p, model: m });
            return;
          }
        }
        // Custom value with no recognizable prefix: keep the existing
        // provider, dispatch the raw model. The api will return
        // bad_model if it's truly unknown, surfaced on the row.
        if (provider) onChange({ provider, model: next });
      }}
    />
  );
}
