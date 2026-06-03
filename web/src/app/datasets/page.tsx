import { RoadmapSurface } from "@/components/RoadmapSurface";

export const dynamic = "force-dynamic";

/**
 * Datasets — the input side of evaluation.
 *
 * Datasets are versioned, content-addressed snapshots of agent inputs
 * (prompt context, tool transcripts, expected outputs). The "pin from
 * production" flow lets you turn any failing trace into a regression
 * row with one click, so the next eval run blocks the same failure
 * mode. Schema lives in Postgres (dataset, dataset_version, dataset_row).
 */

export default function DatasetsPage() {
  return (
    <RoadmapSurface
      title="Datasets"
      tagline="Curate evaluation datasets from production traces. Pin failures as regression cases, sample by tag or session, and version everything in source control."
      status="design"
      shipsIn="months 6–9"
      capabilities={[
        { label: "Pin a failing run as a regression row (one click)", status: "planned" },
        { label: "Sample from production by tag, session, or score", status: "planned" },
        { label: "Versioned dataset rows (immutable, content-hashed)", status: "planned" },
        { label: "CLI export to JSONL for source control", status: "planned" },
        { label: "Dataset diffs across versions", status: "planned" },
        { label: "Tie a dataset version to a passing eval run", status: "planned" },
      ]}
      dataShape={{
        name: "datasets (Postgres)",
        rows: [
          { name: "dataset.id", type: "uuid", note: "stable handle" },
          { name: "dataset.slug", type: "text", note: "e.g. regressions/triage-2026-q2" },
          { name: "dataset_version.id", type: "uuid" },
          { name: "dataset_version.dataset_id", type: "uuid", note: "FK" },
          { name: "dataset_version.content_hash", type: "text", note: "sha256 of all rows" },
          { name: "dataset_version.created_at", type: "timestamptz" },
          { name: "dataset_row.version_id", type: "uuid", note: "FK" },
          { name: "dataset_row.input", type: "jsonb", note: "the prompt + context" },
          { name: "dataset_row.expected", type: "jsonb", note: "expected output, optional" },
          { name: "dataset_row.source_run_id", type: "text", note: "if pinned from a trace" },
        ],
      }}
      preview={{
        kind: "shell",
        lang: "bash",
        body: `# Pin every failing run from the last 7 days as a regression set.
$ tracebility datasets ingest \\
    --slug regressions/triage-2026-q2 \\
    --from-traces 'status=error AND start_time>=now()-7d' \\
    --project prod

ingested 47 rows → regressions/triage-2026-q2:v3
content_hash: 7c4f1a...

# Diff against the previous version.
$ tracebility datasets diff \\
    regressions/triage-2026-q2:v2 \\
    regressions/triage-2026-q2:v3

+ 12 rows added (new failure modes)
- 3 rows removed (fixed in main)
~ 0 rows changed
`,
      }}
    />
  );
}
