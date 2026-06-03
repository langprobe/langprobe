import { RoadmapSurface } from "@/components/RoadmapSurface";

export const dynamic = "force-dynamic";

/**
 * Threads — multi-turn session view.
 *
 * Groups runs by session_id (or user_id) and renders the conversation
 * transcript with each turn's spans, evals, and feedback inline. This
 * is what LangSmith calls "Threads" — the missing piece between an
 * individual trace and aggregate analytics.
 */

export default function ThreadsPage() {
  return (
    <RoadmapSurface
      title="Threads"
      tagline="Reconstruct multi-turn agent sessions. Group runs by session, see every turn's prompt, tool calls, and feedback inline — the missing layer between one trace and aggregate analytics."
      status="design"
      shipsIn="months 4–6"
      capabilities={[
        { label: "Group runs by session_id (or user_id, custom dim)", status: "planned" },
        { label: "Conversation transcript view (turn-by-turn)", status: "planned" },
        { label: "Inline eval scores + feedback per turn", status: "planned" },
        { label: "Drill into any turn's full trace tree", status: "planned" },
        { label: "Filter sessions by length, score, error count", status: "planned" },
        { label: "Pin a thread as a regression dataset (multi-turn)", status: "planned" },
      ]}
      dataShape={{
        name: "threads (derived view, ClickHouse)",
        rows: [
          { name: "session_id", type: "String", note: "from runs.attributes['session_id']" },
          { name: "project_id", type: "String", note: "FK to projects" },
          { name: "user_id", type: "String", note: "optional, for end-user grouping" },
          { name: "first_run_at", type: "DateTime64(6)" },
          { name: "last_run_at", type: "DateTime64(6)" },
          { name: "turn_count", type: "UInt32" },
          { name: "total_cost_usd", type: "Decimal(18, 6)" },
          { name: "any_error", type: "UInt8", note: "1 if any run in thread errored" },
          { name: "min_eval_score", type: "Float32", note: "weakest score across turns" },
        ],
      }}
      preview={{
        kind: "code",
        lang: "python",
        body: `from tracebility import Tracebility

client = Tracebility()

# Tag every run in a session — the Threads view groups on this.
with client.trace(name="customer_chat", session_id="sess_8a2f...") as run:
    response = agent.respond(user_message)
    run.set_outputs({"reply": response})

# Or query threads directly:
threads = client.threads.list(
    project="prod",
    filter="any_error=1 AND turn_count>=3",
    order_by="last_run_at desc",
    limit=20,
)
for t in threads:
    print(t.session_id, t.turn_count, t.total_cost_usd)
`,
      }}
    />
  );
}
