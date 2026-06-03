import { RoadmapSurface } from "@/components/RoadmapSurface";

export const dynamic = "force-dynamic";

/**
 * Prompts — versioned, content-addressed prompt templates.
 *
 * Every revision is immutable and tagged (production / candidate /
 * winner / archived). The SDK pulls by tag, so promoting a winner to
 * production is one row update — no redeploy. Every run records the
 * exact prompt revision id, so eval regressions blame the right edit.
 */

export default function PromptsPage() {
  return (
    <RoadmapSurface
      title="Prompts"
      tagline="Version, diff, and roll back prompts without redeploying. Tag a winning revision, A/B against production, and tie every run back to the exact prompt that produced it."
      status="design"
      shipsIn="months 6–9"
      capabilities={[
        { label: "Immutable, content-addressed revisions", status: "planned" },
        { label: "Tags: production / candidate / winner / archived", status: "planned" },
        { label: "Side-by-side diff between any two revisions", status: "planned" },
        { label: "Pull by tag from SDK (no redeploy to roll out)", status: "planned" },
        { label: "Every run records its prompt_revision_id", status: "planned" },
        { label: "A/B traffic split by tag weight", status: "planned" },
      ]}
      dataShape={{
        name: "prompts (Postgres)",
        rows: [
          { name: "prompt.id", type: "uuid", note: "stable handle" },
          { name: "prompt.slug", type: "text", note: "e.g. triage-router" },
          { name: "prompt.project_id", type: "uuid", note: "FK" },
          { name: "prompt_revision.id", type: "uuid" },
          { name: "prompt_revision.prompt_id", type: "uuid", note: "FK" },
          { name: "prompt_revision.content_hash", type: "text", note: "sha256 of body+vars" },
          { name: "prompt_revision.body", type: "text", note: "Jinja2-style template" },
          { name: "prompt_revision.input_schema", type: "jsonb", note: "JSON-schema for vars" },
          { name: "prompt_revision.created_at", type: "timestamptz" },
          { name: "prompt_tag.revision_id", type: "uuid", note: "FK" },
          { name: "prompt_tag.tag", type: "text", note: "production | candidate | winner" },
        ],
      }}
      preview={{
        kind: "code",
        lang: "python",
        body: `from tracebility import prompts

# Pull the production prompt — no redeploy needed when tag moves.
tpl = prompts.pull("triage-router", tag="production")
rendered = tpl.render(user_message=msg, history=hist)

# Promote a candidate to production after evals pass.
prompts.tag(
    slug="triage-router",
    revision="01J9Z...QXR",
    tag="production",
    note="beat baseline by 4.2% on regressions/triage-2026-q2",
)

# Diff two revisions.
prompts.diff("triage-router", from_tag="production", to_tag="candidate")
# - You are a helpful assistant. Always be brief.
# + You are a helpful assistant. Be brief, but cite sources for any
# +   claim that involves account data, orders, or payments.
`,
      }}
    />
  );
}
