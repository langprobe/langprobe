# Design Overhaul — Method, Gate, and claude-design Brief

**Date:** 2026-06-28
**Status:** Approved approach; pending claude-design run
**Goal:** Complete visual overhaul of the langprobe frontend to a flawless, "nothing-to-point-at" premium bar (Linear/Vercel restraint, executed perfectly). Everything is open — typeface, color, light/dark, layout, density, motion. The only constraint: every choice must serve "the real debugger for agents."

This doc is **not** the new design system. It is the *method* to produce one, the *gate* to judge it, and the *brief* to hand to `/design-consultation`. The current `DESIGN.md` (verbose yet incomplete) is superseded by whatever the overhaul produces.

---

## Decisions locked

| Decision | Value |
|---|---|
| Scope | Complete overhaul, not polish-to-spec |
| Constraints | None except positioning. Font, color, light/dark, layout, density, motion all open. |
| Feel target | Linear/Vercel restraint, executed flawlessly. Premium = absence of anything wrong, not a feature you can point at. |
| Hero surface (design first) | **Dashboard / monitoring** — the landing screen; first-impression gut-check. |
| Light/dark | **Light-first**, with dark mode as deliberate parity (authored, never auto-inverted). |
| Stress check | System derived from dashboard must be re-tested against the trace/replay view (where density breaks). |

---

## 1 · Method — how we reach "nothing to point at"

The premium feeling comes from precision and constraint under stress, not addition. Sequence matters; this is the order.

- **Phase 0 — Soul → 3 hard principles.** Turn "the real debugger for agents" into three principles, each able to kill a proposal. Working set: *(1) data is the interface — chrome recedes, the signal is the hero; (2) latency is a feeling — the UI must feel as fast as the tool it debugs; (3) density is respect — engineers want more on screen, not whitespace theater.*
- **Phase 1 — Design ONE hard surface, fully.** The dashboard/monitoring view, on real worst-case data. All states. If the most-seen screen is flawless, first impression is flawless.
- **Phase 2 — Reference forensics, not moodboards.** Reverse-engineer *measurements* from Linear, Vercel, Sentry, Raycast: exact type ramp, grid, row density, border treatment, motion durations. Premium is measurable — copy the numbers, not the vibe.
- **Phase 3 — Tokens fall OUT of the surface.** Design the surface first, then extract the *minimum* token set it proves we need. (Inverts today's DESIGN.md, which declares ~200 tokens then applies them — the reason it's both long and incomplete.)
- **Phase 4 — State matrix + stress test.** Every component × {rest, hover, active, focus, disabled, loading}. Every screen × {empty, loading, partial, error, overflow, max-density}. Then re-test the system on the trace/replay view.
- **Phase 5 — Evaluation gate** (section 2) before any rollout.
- **Phase 6 — Roll mechanically** across the 34 pages last, because the system is proven, not speculative.

---

## 2 · The 21stdev gate

Score each dimension 0–10. **Nothing ships below 9.** This is a *minimum* gate, not an average — one weak dimension is exactly the thing the expert points at.

1. **Restraint** — can anything be removed? Fewer tokens/sizes/colors scores higher.
2. **Optical precision** — alignment and rhythm tuned by eye, not math.
3. **Hierarchy** — 1-second squint test: is the one important thing obvious?
4. **State completeness** — all states designed; zero amateur gaps.
5. **Density without clutter** — information-dense *and* calm at once.
6. **Motion discipline** — one curve, fast, purposeful, never decorative.
7. **Data legibility** — traces/numbers/timelines read instantly (it's a debugger).
8. **Consistency under stress** — 10k-row table, deep nested trace, 4k-token span.
9. **Keyboard + a11y first-class** — not retrofitted.
10. **"Nothing to point at"** — blind side-by-side vs Linear/Vercel; does ours hold?

---

## 3 · Brief for claude-design

> **Product:** langprobe — self-hosted LLM observability + eval + agent-replay. "The real debugger for agents."
> **User:** Backend-leaning engineers running LLM products in their own VPC. Eval-serious, allergic to SaaS polish-over-substance. They live in this tool all day.
> **Mandate:** Complete visual overhaul. Everything is open — typeface, color, light/dark, layout, density, motion. No legacy constraint except that every choice must serve "the real debugger for agents."
> **Feel target:** Linear / Vercel restraint, executed flawlessly. The premium signal is the *absence of anything wrong* — invisible craft, nothing to point at. Information density without ornament.
> **Hard anti-targets:** No gradients, no glassmorphism, no icon-in-colored-circle, no AI-tool slop, no SaaS-template feature grids, no skeleton shimmer, no decoration that doesn't carry information.
> **Design this surface first:** the **dashboard / monitoring** view, on real worst-case data. Derive the whole system from it, then prove it survives the trace/replay view.
> **Light-first, dark as deliberate parity** (authored, never auto-inverted).
> **Must handle:** empty / loading / partial / error / overflow / max-density states for every surface; a data-viz language for traces, timelines, and eval scores; a density story for 10k-row tables.
> **Deliver:** aesthetic direction + reference forensics (measured, not moodboard), minimal token set extracted from the hero surface, type ramp, color system, grid + density, motion spec, light+dark, and a component-state matrix.
> **Bar:** must pass the 10-dimension 9/10 gate above and survive a blind side-by-side against Linear and Vercel.
