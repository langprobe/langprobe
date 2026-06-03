import { RoadmapSurface } from "@/components/RoadmapSurface";

export const dynamic = "force-dynamic";

/**
 * Replay — the debugger half of tracability.
 *
 * Captures every non-deterministic input on a span (tool I/O, retrieval,
 * RNG, time) into a content-addressed payload, then lets you re-run the
 * agent against the captured fixture — mutating one node at a time to
 * see what would have changed. This is the "step through frame by frame"
 * superpower. Surface is in design until the capture writer ships.
 */

export default function ReplayPage() {
  return (
    <RoadmapSurface
      title="Replay"
      tagline="Step through any captured agent run frame-by-frame. Mutate a prompt, swap a model, replay a tool call — and see the divergence inline. The debugger half of tracability."
      status="design"
      shipsIn="months 9–14"
      capabilities={[
        { label: "Capture tool I/O on every span (content-hashed)", status: "planned" },
        { label: "Capture retrieval results, RNG seeds, wall clock", status: "planned" },
        { label: "Replay against captured fixture, byte-identical", status: "planned" },
        { label: "Mutate a single node, see divergence diff", status: "planned" },
        { label: "Branch a replay into a Studio session", status: "planned" },
        { label: "Promote a passing replay to a regression dataset row", status: "planned" },
      ]}
      bridges={[
        { name: "LangGraph", status: "planned" },
        { name: "OpenAI Agents SDK", status: "planned" },
        { name: "Anthropic SDK (tool use)", status: "planned" },
        { name: "LangChain callbacks", status: "planned" },
      ]}
      dataShape={{
        name: "replay_capture (ClickHouse)",
        rows: [
          { name: "capture_id", type: "String", note: "sha256 of payload — content-addressed" },
          { name: "span_id", type: "String", note: "FK to runs_and_spans.span_id" },
          { name: "run_id", type: "String", note: "FK to runs_and_spans.run_id" },
          { name: "kind", type: "Enum8", note: "tool_io | retrieval | rng | clock" },
          { name: "payload", type: "String", note: "JSON or raw bytes; large payloads off-row" },
          { name: "captured_at", type: "DateTime64(6)" },
        ],
      }}
      preview={{
        kind: "code",
        lang: "python",
        body: `from tracebility import replay

# Replay a production run, but force the user-fetch tool to fail.
result = replay.run(
    run_id="01J9Z...QXR",
    mutate={
        "tool:fetch_user": {"status": 500, "body": '{"error": "timeout"}'},
    },
)

print(result.diff())
# diff @ span 4f2a (call:llm_router): output diverged
#   was: route="account_lookup"
#   now: route="error_handler"
# diff @ span 5c1b (final_response): output diverged
#   was: "Your last login was..."
#   now: "I'm having trouble looking that up..."
`,
      }}
    />
  );
}
