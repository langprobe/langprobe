import Link from "next/link";
import { Shell } from "@/components/Shell";
import {
  DeleteJudgeButton,
  type LunaJudgeRow,
  NewJudgeButton,
} from "@/components/JudgesClient";
import { apiGet } from "@/lib/api";
import { resolveActiveProject, type Project } from "@/lib/projects";

/**
 * Luna judges — LLM-as-judge with user-authored rubrics.
 *
 * Server component. Lists postgres `luna_judge` rows for the active
 * project. Each judge has a slug; reference it at eval-run time as
 * `luna:<slug>` (e.g. on /evals → New eval, judge_kind = `luna:strict`).
 *
 * Per-item scores write to the same `eval_score` store as built-in
 * judges and human annotations — `judge_name='luna:<slug>'`,
 * `judge_endpoint=<provider>`. Analytics shape is identical.
 */

export const dynamic = "force-dynamic";

export default async function JudgesPage() {
  const { active, all, reason } = await resolveActiveProject();
  if (!active) {
    return (
      <Shell active={null} projects={all}>
        <PageInterior>
          <PageHeader title="Judges" subtitle="luna prompted-judges" />
          <UnconfiguredState reason={reason} />
        </PageInterior>
      </Shell>
    );
  }

  const res = await apiGet<LunaJudgeRow[]>(
    `/v1/luna-judges?project_id=${encodeURIComponent(active.id)}`,
  );
  const judges = res.data ?? [];

  return (
    <Shell active={active} projects={all}>
      <PageInterior>
        <PageHeader
          title="Judges"
          subtitle={`${active.slug} · ${judges.length} ${judges.length === 1 ? "judge" : "judges"}`}
          right={<NewJudgeButton projectId={active.id} />}
        />
        <JudgesCard rows={judges} reason={res.error} project={active} />
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

function JudgesCard({
  rows,
  reason,
  project,
}: {
  rows: LunaJudgeRow[];
  reason: string | null;
  project: Project;
}) {
  return (
    <section className="card" style={{ overflow: "hidden" }}>
      <div className="card-head">
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <h2>Judges</h2>
          <span className="card-sub">
            scoped to <span className="mono">{project.slug}</span>
          </span>
        </div>
      </div>
      {rows.length === 0 ? (
        <EmptyState reason={reason} project={project} />
      ) : (
        <div style={{ overflow: "auto" }}>
          <table className="table">
            <thead>
              <tr>
                <th>Slug</th>
                <th>Name</th>
                <th>Provider</th>
                <th>Model</th>
                <th>Format</th>
                <th style={{ textAlign: "right" }}>Temp</th>
                <th style={{ textAlign: "right" }}>Max</th>
                <th style={{ textAlign: "right" }}>Created</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((j) => (
                <tr key={j.id}>
                  <td>
                    <span className="badge badge-neutral">luna:{j.slug}</span>
                  </td>
                  <td>{j.name}</td>
                  <td>
                    <span className="mono" style={{ fontSize: 12 }}>
                      {j.provider}
                    </span>
                  </td>
                  <td>
                    <span className="mono" style={{ fontSize: 12 }}>
                      {j.model}
                    </span>
                  </td>
                  <td>
                    <span className="mono" style={{ fontSize: 11, color: "var(--text-3)" }}>
                      {j.output_format}
                    </span>
                  </td>
                  <td className="num" style={{ textAlign: "right" }}>
                    {j.temperature ?? "—"}
                  </td>
                  <td className="num" style={{ textAlign: "right" }}>
                    {j.max_tokens}
                  </td>
                  <td
                    className="num"
                    style={{ textAlign: "right", color: "var(--text-3)" }}
                  >
                    {fmtDateTime(j.created_at)}
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <DeleteJudgeButton judgeId={j.id} slug={j.slug} />
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
      <h2 style={{ marginBottom: 8 }}>Why prompted-judges</h2>
      <p
        style={{
          color: "var(--text-2)",
          margin: "0 0 12px",
          fontSize: 13,
          lineHeight: 1.55,
        }}
      >
        Built-in judges (echo / contains / exact) are deterministic but
        narrow. A prompted-judge lets you encode any rubric in plain
        English — strictness, faithfulness, harmlessness, brand voice
        — and evaluate against it across a whole dataset. Per-item
        scores land in the same <code>eval_score</code> store as
        every other judge type.
      </p>
      <p
        style={{
          color: "var(--text-2)",
          margin: 0,
          fontSize: 13,
          lineHeight: 1.55,
        }}
      >
        Reference a judge at eval/poll-run time as{" "}
        <code className="mono">luna:&lt;slug&gt;</code>. From the SDK:
      </p>
      <pre style={{ margin: "12px 0 0" }}>
        {`# python
client.evals.create(
    dataset_id="ds_...",
    judge_kind="luna:strict-correctness",
)

# poll panel mixing built-in + luna
client.poll.create(
    dataset_id="ds_...",
    judges=["contains", "luna:strict-correctness"],
    aggregation="majority",
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
        Run the setup wizard or create a project before authoring
        judges.
      </p>
      {reason ? (
        <p className="mono" style={{ marginTop: 12, fontSize: 11, color: "var(--text-3)" }}>
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
        No judges yet in <span className="mono">{project.slug}</span>.
      </h3>
      <p
        style={{
          color: "var(--text-2)",
          margin: 0,
          lineHeight: 1.55,
          maxWidth: 640,
        }}
      >
        Click <strong>New judge</strong> to author a rubric prompt. The
        judge becomes available at <Link href="/evals">/evals</Link> and{" "}
        <Link href="/poll-runs">/poll-runs</Link> as{" "}
        <code className="mono">luna:&lt;slug&gt;</code>.
      </p>
      {reason ? (
        <p className="mono" style={{ marginTop: 12, fontSize: 11, color: "var(--text-3)" }}>
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
