# Design System — tracability

## Product Context
- **What this is:** Self-hosted LLM observability + eval-rigor + agent-replay platform. A LangSmith replacement that doubles as the real debugger for agents.
- **Who it's for:** Engineers running LLM products in their own VPC. Backend-leaning, eval-serious, allergic to SaaS polish-over-substance. The kind of engineer who'd already pay for Berkeley Mono.
- **Space/industry:** LLM observability. Peers: LangSmith, Langfuse, Braintrust, Arize Phoenix, Helicone, W&B Weave, Galileo.
- **Project type:** Hybrid — dense developer-tool web app (trace explorer, replay timeline, eval dashboards, prompt playground, dataset editor, admin) + marketing/docs site.
- **Memorable thing:** "This is the real debugger for agents." Every design decision serves that one sentence.

## Aesthetic Direction
- **Direction:** Instrumented Brutalist. Exposed structure, no decorative flourish, the UI looks like a tool. Closest analogs: Chrome DevTools, Sentry's debugger panel, GDB time-travel debuggers, the React DevTools Profiler. Linear's restraint with more density.
- **Decoration level:** Minimal. Typography, spacing, and structural lines do the work. No gradients. No icon-in-colored-circle. No hero illustration. The closest thing to "decoration" is a thin grid line, a span-bar, a code block.
- **Mood:** Serious software for serious work. Dense, precise, instrumented. The aesthetic of a product engineers reach for when something is broken at 2am, not the aesthetic of a product they're pitched in a sales call.
- **Reference sites:** Linear (restraint), Vercel docs (typography density), Sentry (debugger surfaces), Stripe docs (information density without polish-tax). Anti-references: every other product in the LLM-observability category.

## Typography
- **Display (marketing only):** Fraunces — variable serif with optical-size variation. Editorial seriousness, not SaaS template.
- **Product UI / labels / data / code:** Berkeley Mono (commercial license required, ~$40 personal / per-user). Fallback for OSS distribution and self-hosters who don't have the license: JetBrains Mono.
- **Body prose (docs paragraphs, marketing body):** Inter Tight, with DM Sans as the secondary fallback. Body prose is where you don't need to fight; let the display + monospace UI carry the personality.
- **Tabular data:** Berkeley Mono (or JetBrains Mono fallback) with `font-variant-numeric: tabular-nums slashed-zero`. Numbers align without thinking.
- **Loading strategy:** Self-host all fonts. No Google Fonts CDN — this is a privacy-conscious self-hosted product, fonts must work air-gapped. Provide WOFF2 + variable-font subsetted to Latin range. Berkeley Mono served only when a license file is present at the configured path; absent license falls through to JetBrains Mono.
- **Modular scale (4px base, ratio 1.2 minor third):**

```
xs    11px / 0.6875rem — captions, span timestamps
sm    13px / 0.8125rem — body small, secondary labels
base  14px / 0.875rem  — UI default, table rows
md    16px / 1rem      — body prose
lg    19px / 1.1875rem — section headers
xl    23px / 1.4375rem — page titles
2xl   28px / 1.75rem   — marketing sub-display
3xl   34px / 2.125rem  — marketing display
4xl   48px / 3rem      — marketing hero (Fraunces only)
```

- **Line heights:** UI/data 1.4, prose 1.6, headings 1.15.
- **Letter spacing:** UI labels at -0.005em. Tabular numbers default. Display Fraunces at -0.02em.

## Color
- **Approach:** Restrained, technical. One accent. Color is signal, not brand decoration.
- **No blue. No purple.** That is the convergence trap. Refusing it is the wedge.

### Light mode (marketing default)

| Token | Value | Usage |
|---|---|---|
| `--bg` | `#FAF8F4` | App + page background. Warm off-white, paper. |
| `--surface` | `#FFFFFF` | Cards, popovers, modal surfaces. |
| `--text` | `#0E0E0C` | Primary text. Near-black with slight warmth. |
| `--text-muted` | `#6B6963` | Secondary labels, timestamps, helper text. |
| `--rule` | `#E5E1D8` | Thin lines, grid, table borders, dividers. |
| `--accent` | `#D9531E` | Amber-orange. Breakpoints, playhead, active state, the "this is what failed" highlight. |
| `--accent-soft` | `#F5E0D2` | Accent backgrounds (selected row, focused span). |
| `--pass` | `#2F7A3D` | Eval pass, healthy state. |
| `--warn` | `#B5811A` | Warnings, sampled-eval ceilings, degraded mode. |
| `--fail` | `#B43A2A` | Errors, dead-letter, judge unavailable. |

### Dark mode (product default)

| Token | Value | Usage |
|---|---|---|
| `--bg` | `#0E0E0C` | App background. True charcoal, no blue tint. |
| `--surface` | `#161613` | Panels, popovers. |
| `--text` | `#F4F1EA` | Primary text. |
| `--text-muted` | `#8B8980` | Secondary. |
| `--rule` | `#2A2925` | Lines, grid. |
| `--accent` | `#E96A2E` | Amber-orange, slightly lifted for dark. |
| `--accent-soft` | `#3A1F12` | Accent backgrounds in dark. |
| `--pass` | `#4FA45F` | |
| `--warn` | `#D6A53A` | |
| `--fail` | `#D9594A` | |

### Mode rules

- Product app boots dark by default. User toggle persists.
- Marketing site boots light by default. Same toggle.
- Dark mode is **redesigned**, not auto-inverted. Saturation reduced ~15%, contrast ratios re-checked at every surface.
- Amber accent must always pass WCAG AA (4.5:1) on its background in both modes. Verified: D9531E on FAF8F4 = 4.6, E96A2E on 0E0E0C = 6.1.

## Spacing
- **Base unit:** 4px.
- **Density:** Compact. Debugger-tool density. Default row 28px, not 48px.

```
2xs   2px   — internal padding on dense badges
xs    4px   — inline gaps, icon-to-text
sm    8px   — between tightly related elements
md    16px  — paragraph rhythm, card internal padding
lg    24px  — section gap inside a panel
xl    32px  — between panels
2xl   48px  — page-level breaks
3xl   64px  — marketing section breaks (only on marketing pages)
```

- **Default row height:** 28px (UI tables, trace span rows, list items).
- **Default card padding:** 16px.
- **Marketing density:** less compact than the app, but still tighter than category baseline. Marketing 2xl (48px) is the section break; SaaS-template peers tend to use 96-128px.

## Layout

- **Approach:** Grid-disciplined for the app, editorial-poster for marketing.
- **App shape:** Three-pane debugger. Left nav (collapsible, 240px expanded / 56px collapsed). Main content (the trace tree, the replay timeline, the dashboard). Optional right inspector (320-480px, drag-resizable). All three panes use 1px `--rule` dividers, not box shadows.
- **Marketing first viewport:** A single composition. Static screenshot of the replay timeline with the headline embedded as a tooltip on the playhead. Not a hero/subhero/CTA stack. The marketing IS the demo. One scroll reveals what the product does, not three scrolls of feature cards.
- **Grid:** App content uses a 4px-baseline soft grid. Marketing uses a 12-column grid at 1280px max width with 24px gutters. No max-width on the app — densest screens fill all available pixels.
- **Border radius (hierarchical, not uniform):**

```
sm    2px   — input fields, badges
md    4px   — cards, panels, buttons
lg    8px   — modals, popovers
full  9999px — only on round status dots and avatars
```

- **No bubbly border-radius.** Anything ≥12px outside of `full` reads as SaaS-toy.

## Motion
- **Approach:** Minimal-functional. No entrance animations. No scroll-driven hero. No decorative motion.
- **Easing:** `ease-out` for enter, `ease-in` for exit, `cubic-bezier(0.4, 0, 0.2, 1)` for move.
- **Duration:**

```
instant 0ms       — tab switch, panel show/hide
micro   80-120ms  — hover, focus ring, button press
short   180ms     — replay-scrubber drag interpolation, dropdown open
medium  240ms     — modal in/out (only because users expect it)
```

- **The one expressive motion:** the replay-timeline scrubber. Dragging the scrubber smoothly walks the trace tree highlight forward in real time. This is motion-as-feature because it IS the product. Everywhere else, motion is invisible scaffolding or absent.
- **No parallax. No skeleton shimmer.** Skeletons are flat `--rule` rectangles. Loading is a 2px progress bar in the topmost rule line, not a spinner.

## Iconography
- **Library:** Lucide (open license, monoline, fits the brutalist posture). All icons stroke 1.5px, no fills.
- **Size scale:** 14px (inline), 16px (UI default), 20px (panel headers). Nothing larger.
- **Color:** icons inherit `currentColor`. Never colored independently.
- **Anti-pattern:** no icon-in-colored-circle. Ever.

## Components (high-level posture)
- **Buttons:** flat, 1px border in the same color as text or accent. No gradient. No shadow. Primary = filled accent on dark text. Secondary = ghost with 1px rule. Destructive = filled fail color. Pill rounding (radius full) only on filter chips.
- **Inputs:** 1px rule border, 4px radius, focus ring is a 2px accent outline at -2px offset. No floating labels.
- **Tables:** `tabular-nums` numbers, 28px row height, 1px rule between rows, hover state is `--accent-soft` with no transition.
- **Status pills:** filled background in pass/warn/fail soft tone, monospace text, 11px size, 4px horizontal padding.
- **Code blocks:** 13px Berkeley Mono, `--surface` background, 1px rule border, optional copy button at top-right (icon-only, no label).

## Anti-patterns (never ship these)
- Purple or violet gradients (the AI-tool slop signal).
- 3-column feature grid with icons in colored circles.
- Centered-everything marketing pages.
- Bubble-radius on everything (>12px on cards, buttons, panels).
- Inter as the primary display or body font.
- Space Grotesk anywhere (the AI-mockup convergence signal).
- system-ui as the display or body font.
- Floating-button gradient CTAs.
- Decorative blur blobs, mesh gradients, glassmorphism.
- "Built for AI teams" / "Designed for engineers" copy patterns.
- Skeleton shimmer animations (use flat skeletons).
- Centered hero with subhero with feature-grid (the SaaS template).

## Accessibility minimums
- All text-on-background combinations pass WCAG AA. Body text targets AAA where it doesn't compromise the aesthetic.
- Focus rings always visible: 2px accent outline at -2px offset. Never `outline: none` without a replacement.
- Hit targets minimum 28px on touch, 24px on pointer (matches our row height).
- Trace tree, replay timeline, and eval tables must be fully keyboard-navigable. Arrow keys + Enter + Escape are first-class.
- Color is never the only signal. Pass/warn/fail also use icon glyphs.
- Reduced motion: respect `prefers-reduced-motion`. The replay scrubber falls back to step-by-step jump, not interpolated walk.

## Decisions Log
| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-05-25 | Initial design system created | Created by /design-consultation. Visual research across 6 category competitors revealed convergence on blue/purple SaaS-template aesthetic. Memorable thing locked as "the real debugger for agents." Direction: instrumented brutalist with Berkeley Mono UI and amber-orange accent. Three deliberate risks documented (monospace-default UI, no blue/purple, marketing-equals-product aesthetic). |
