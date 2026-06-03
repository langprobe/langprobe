import { Shell } from "@/components/Shell";
import {
  CreateFeedbackKeyButton,
  RevokeFeedbackKeyButton,
  type FeedbackKeyRow,
} from "@/components/FeedbackKeysClient";
import { apiGet } from "@/lib/api";
import { resolveActiveProject, type Project } from "@/lib/projects";

/**
 * Feedback — end-user signal capture (public scoped keys).
 *
 * The browser-side SDK posts thumbs/ratings/text against `run_id`
 * using a write-only `tbf_pub_*` key. Each accepted submission
 * lands as one ClickHouse `eval_score` row with `judge_name='user'`,
 * so the feedback signal aggregates alongside LLM-judge scores.
 *
 * This page manages the keys: list, create (with one-shot reveal),
 * revoke (immediate, ER-20). Below the table is a usage snippet you
 * can paste into your front-end. Owner/admin only for create/revoke;
 * any role can list.
 */

export const dynamic = "force-dynamic";

export default async function FeedbackPage() {
  const { active, all, reason } = await resolveActiveProject();

  if (!active) {
    return (
      <Shell active={null} projects={all}>
        <PageInterior>
          <PageHeader title="Feedback" subtitle="end-user signal" />
          <UnconfiguredState reason={reason} />
        </PageInterior>
      </Shell>
    );
  }

  const keysRes = await apiGet<FeedbackKeyRow[]>(
    `/v1/feedback-keys?project_id=${encodeURIComponent(active.id)}`,
  );
  const keys = keysRes.data ?? [];
  const active_keys = keys.filter((k) => !k.revoked_at).length;

  return (
    <Shell active={active} projects={all}>
      <PageInterior>
        <PageHeader
          title="Feedback"
          subtitle={`${active.slug} · ${active_keys} active ${active_keys === 1 ? "key" : "keys"}`}
          right={<CreateFeedbackKeyButton projectId={active.id} />}
        />
        <KeysCard keys={keys} reason={keysRes.error} project={active} />
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

function KeysCard({
  keys,
  reason,
  project,
}: {
  keys: FeedbackKeyRow[];
  reason: string | null;
  project: Project;
}) {
  return (
    <section className="card" style={{ overflow: "hidden" }}>
      <div className="card-head">
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <h2>Feedback keys</h2>
          <span className="card-sub">
            scoped to <span className="mono">{project.slug}</span>; revoke is
            instant
          </span>
        </div>
      </div>
      {keys.length === 0 ? (
        <EmptyState reason={reason} project={project} />
      ) : (
        <div style={{ overflow: "auto" }}>
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Public id</th>
                <th>Origins</th>
                <th>Status</th>
                <th style={{ textAlign: "right" }}>Last used</th>
                <th style={{ textAlign: "right" }}>Created</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {keys.map((k) => (
                <tr key={k.id}>
                  <td>{k.name ?? "(unnamed)"}</td>
                  <td>
                    <span className="mono" style={{ fontSize: 12 }}>
                      tbf_pub_{k.public_id.slice(0, 8)}…
                    </span>
                  </td>
                  <td>
                    {k.allowed_origins.length === 0 ? (
                      <span style={{ color: "var(--text-3)" }}>any</span>
                    ) : (
                      <OriginList origins={k.allowed_origins} />
                    )}
                  </td>
                  <td>
                    {k.revoked_at ? (
                      <span className="badge badge-danger">revoked</span>
                    ) : (
                      <span className="badge badge-success">active</span>
                    )}
                  </td>
                  <td
                    className="num"
                    style={{ textAlign: "right", color: "var(--text-3)" }}
                  >
                    {k.last_used_at ? fmtDate(k.last_used_at) : "—"}
                  </td>
                  <td
                    className="num"
                    style={{ textAlign: "right", color: "var(--text-3)" }}
                  >
                    {fmtDate(k.created_at)}
                  </td>
                  <td style={{ textAlign: "right" }}>
                    {k.revoked_at ? null : (
                      <RevokeFeedbackKeyButton
                        keyId={k.id}
                        name={k.name ?? "unnamed"}
                      />
                    )}
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

function OriginList({ origins }: { origins: string[] }) {
  const shown = origins.slice(0, 2);
  const extra = origins.length - shown.length;
  return (
    <span style={{ display: "inline-flex", flexWrap: "wrap", gap: 4 }}>
      {shown.map((o) => (
        <span
          key={o}
          className="mono"
          style={{
            fontSize: 11,
            padding: "1px 6px",
            border: "1px solid var(--border)",
            borderRadius: 4,
            color: "var(--text-2)",
          }}
        >
          {o}
        </span>
      ))}
      {extra > 0 ? (
        <span
          className="mono"
          style={{ fontSize: 11, color: "var(--text-3)" }}
        >
          +{extra} more
        </span>
      ) : null}
    </span>
  );
}

function UsageCard() {
  return (
    <section className="card card-pad-lg">
      <h2 style={{ marginBottom: 8 }}>Wire it up in 4 lines</h2>
      <p
        style={{
          color: "var(--text-2)",
          margin: "0 0 12px",
          fontSize: 13,
          lineHeight: 1.55,
        }}
      >
        Drop the key into your front-end and POST one row per
        thumbs-up / rating / text comment. The body fields are
        documented below; everything except <span className="mono">key</span>,{" "}
        <span className="mono">run_id</span>, and{" "}
        <span className="mono">score</span> is optional.
      </p>
      <pre style={{ margin: 0 }}>
        {`// browser snippet (no SDK needed yet)
await fetch("/v1/feedback", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    key: "tbf_pub_<your_public_id>",
    run_id: "<the run id you traced>",
    score: 1,                  // 0..1; 1 = thumbs-up, 0 = thumbs-down
    kind: "thumbs",            // or "rating" | "text"
    comment: "useful but slow",
    end_user_id: currentUser.id,
  }),
});
`}
      </pre>
      <p
        style={{
          color: "var(--text-3)",
          marginTop: 12,
          fontSize: 12,
          lineHeight: 1.55,
        }}
      >
        Server returns 202 on accept, 401 on bad/revoked key, 403 if
        the request <span className="mono">Origin</span> is not in the
        key&apos;s allowlist (when set), 503 if the feedback store is
        temporarily unreachable so you can buffer client-side.
      </p>
    </section>
  );
}

function UnconfiguredState({ reason }: { reason: string | null }) {
  return (
    <div className="card card-pad-lg">
      <h2 style={{ marginBottom: 8 }}>No project resolved</h2>
      <p style={{ color: "var(--text-2)", margin: 0, lineHeight: 1.55 }}>
        Run the setup wizard or create a project before issuing
        feedback keys.
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
        No feedback keys yet in{" "}
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
        Click <strong>New feedback key</strong> to issue one. The key
        is shown ONCE on creation; copy it into your browser snippet
        and ship. Lock it down with an origin allowlist, or leave
        empty for server-to-server callers.
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
