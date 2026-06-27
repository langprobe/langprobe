"use client";

import { Copy, KeyRound, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

/**
 * Interactive controls for API keys: create, reveal-once, revoke.
 *
 * Plaintext keys are returned by the API exactly once; we hold them in
 * component state and never echo them to logs or to the server. After the
 * user dismisses the reveal modal the secret is gone forever — that's the
 * point. Revoke is irreversible (per ER-20: revocation must take effect on
 * the next ingest call, no cache to invalidate).
 */

export interface ApiKey {
  id: string;
  project_id: string;
  public_id: string;
  name: string;
  scopes: string[];
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
  expires_at: string | null;
}

interface CreateResponse {
  key: ApiKey;
  plaintext_key: string;
}

export function CreateKeyButton({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<CreateResponse | null>(null);
  const [pending, startTransition] = useTransition();

  function reset() {
    setOpen(false);
    setName("");
    setError(null);
    setRevealed(null);
  }

  function submit() {
    setError(null);
    if (!name.trim()) {
      setError("name is required");
      return;
    }
    startTransition(async () => {
      const res = await fetch("/api/api-keys", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          project_id: projectId,
          name: name.trim(),
          scopes: ["ingest:write"],
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          detail?: string;
        };
        setError(body.detail ?? `request failed (${res.status})`);
        return;
      }
      const data = (await res.json()) as CreateResponse;
      setRevealed(data);
      setName("");
    });
  }

  return (
    <>
      <button
        type="button"
        className="btn btn-primary"
        onClick={() => setOpen(true)}
      >
        <Plus size={14} strokeWidth={1.75} />
        New key
      </button>

      {open && !revealed ? (
        <Backdrop onClose={reset}>
          <div
            style={{
              minWidth: 400,
              padding: 20,
              display: "flex",
              flexDirection: "column",
              gap: 16,
            }}
          >
            <div>
              <h2>Create API key</h2>
              <p
                style={{
                  margin: "4px 0 0",
                  color: "var(--text-3)",
                  fontSize: 12,
                }}
              >
                Plaintext key is shown once. Save it somewhere safe.
              </p>
            </div>
            <label
              style={{ display: "flex", flexDirection: "column", gap: 6 }}
            >
              <span style={{ fontSize: 12, color: "var(--text-2)" }}>
                Name
              </span>
              <input
                type="text"
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="prod-ingest"
                disabled={pending}
              />
            </label>
            {error ? (
              <p
                style={{
                  color: "var(--danger)",
                  fontSize: 12,
                  margin: 0,
                }}
              >
                {error}
              </p>
            ) : null}
            <div
              style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}
            >
              <button
                type="button"
                className="btn"
                onClick={reset}
                disabled={pending}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={submit}
                disabled={pending}
              >
                {pending ? "Creating…" : "Create key"}
              </button>
            </div>
          </div>
        </Backdrop>
      ) : null}

      {revealed ? (
        <Backdrop
          onClose={() => {
            reset();
            router.refresh();
          }}
        >
          <div
            style={{
              minWidth: 480,
              padding: 20,
              display: "flex",
              flexDirection: "column",
              gap: 16,
            }}
          >
            <div>
              <h2>Save this key</h2>
              <p
                style={{
                  margin: "4px 0 0",
                  color: "var(--text-3)",
                  fontSize: 12,
                }}
              >
                You won&apos;t see it again. Set it as{" "}
                <span className="mono">LANGPROBE_API_KEY</span> in your
                ingest environment.
              </p>
            </div>
            <SecretReveal value={revealed.plaintext_key} />
            <div
              style={{
                display: "flex",
                gap: 8,
                justifyContent: "flex-end",
              }}
            >
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  reset();
                  router.refresh();
                }}
              >
                Done
              </button>
            </div>
          </div>
        </Backdrop>
      ) : null}
    </>
  );
}

function SecretReveal({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "10px 12px",
        background: "var(--surface-3)",
        border: "1px solid var(--border)",
        borderRadius: "var(--r-2)",
      }}
    >
      <KeyRound size={14} strokeWidth={1.5} color="var(--text-3)" />
      <code
        className="mono"
        style={{
          flex: 1,
          fontSize: 12,
          color: "var(--text)",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {value}
      </code>
      <button
        type="button"
        className="btn btn-sm"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          } catch {
            /* ignore */
          }
        }}
      >
        <Copy size={12} strokeWidth={1.5} />
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

export function RevokeButton({
  keyId,
  name,
}: {
  keyId: string;
  name: string;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function revoke() {
    setError(null);
    startTransition(async () => {
      const res = await fetch(`/api/api-keys/${keyId}`, { method: "DELETE" });
      if (!res.ok && res.status !== 204) {
        const body = (await res.json().catch(() => ({}))) as {
          detail?: string;
        };
        setError(body.detail ?? `request failed (${res.status})`);
        return;
      }
      setConfirming(false);
      router.refresh();
    });
  }

  return (
    <>
      <button
        type="button"
        className="btn btn-sm"
        onClick={() => setConfirming(true)}
        title="Revoke this key"
      >
        <Trash2 size={12} strokeWidth={1.5} />
        Revoke
      </button>
      {confirming ? (
        <Backdrop onClose={() => setConfirming(false)}>
          <div
            style={{
              minWidth: 360,
              padding: 20,
              display: "flex",
              flexDirection: "column",
              gap: 12,
            }}
          >
            <div>
              <h2>Revoke key?</h2>
              <p
                style={{
                  margin: "4px 0 0",
                  color: "var(--text-2)",
                  fontSize: 13,
                  lineHeight: 1.5,
                }}
              >
                Any SDK using <span className="mono">{name}</span> will start
                getting <span className="mono">401</span> on the next call.
                This can&apos;t be undone.
              </p>
            </div>
            {error ? (
              <p
                style={{
                  color: "var(--danger)",
                  fontSize: 12,
                  margin: 0,
                }}
              >
                {error}
              </p>
            ) : null}
            <div
              style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}
            >
              <button
                type="button"
                className="btn"
                onClick={() => setConfirming(false)}
                disabled={pending}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={revoke}
                disabled={pending}
              >
                {pending ? "Revoking…" : "Revoke"}
              </button>
            </div>
          </div>
        </Backdrop>
      ) : null}
    </>
  );
}

function Backdrop({
  children,
  onClose,
}: {
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(10, 10, 10, 0.4)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 100,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="card"
        style={{
          background: "var(--surface)",
          borderRadius: "var(--r-3)",
          boxShadow: "var(--shadow-3)",
        }}
      >
        {children}
      </div>
    </div>
  );
}
