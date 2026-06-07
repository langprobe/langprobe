"use client";

import { useState } from "react";

const SLUG_RE = /[^a-z0-9-]+/g;

function deriveSlug(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(SLUG_RE, "-")
    .replace(/(^-+|-+$)/g, "")
    .slice(0, 64);
}

export function SavePromptForm({
  onSubmit,
  onCancel,
  busy,
}: {
  onSubmit: (next: { name: string; slug: string }) => void;
  onCancel: () => void;
  busy: boolean;
}) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const effectiveSlug = slugTouched ? slug : deriveSlug(name);
  const valid = name.trim().length >= 2 && effectiveSlug.length >= 2;

  return (
    <div
      role="dialog"
      aria-label="Save as new prompt"
      style={{
        display: "grid",
        gap: 8,
        padding: 12,
        border: "1px solid var(--border)",
        borderRadius: "var(--r-3)",
        background: "var(--surface-2)",
      }}
    >
      <label style={{ display: "grid", gap: 4 }}>
        <span style={{ fontSize: 11, color: "var(--text-3)" }}>Name</span>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="fraud-review"
          style={{ padding: "6px 10px", fontSize: 13 }}
        />
      </label>
      <label style={{ display: "grid", gap: 4 }}>
        <span style={{ fontSize: 11, color: "var(--text-3)" }}>
          Slug (auto from name)
        </span>
        <input
          value={effectiveSlug}
          onChange={(e) => {
            setSlug(e.target.value);
            setSlugTouched(true);
          }}
          placeholder="fraud-review"
          className="mono"
          style={{ padding: "6px 10px", fontSize: 12 }}
        />
      </label>
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={onCancel}
          disabled={busy}
        >
          Cancel
        </button>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={() =>
            onSubmit({ name: name.trim(), slug: effectiveSlug })
          }
          disabled={!valid || busy}
        >
          {busy ? "Saving..." : "Save"}
        </button>
      </div>
    </div>
  );
}
