# Design System — tracability

## Product Context
- **What this is:** Self-hosted LLM observability + eval-rigor + agent-replay platform. A LangSmith replacement that doubles as the real debugger for agents.
- **Who it's for:** Engineers running LLM products in their own VPC. Backend-leaning, eval-serious, allergic to SaaS polish-over-substance.
- **Memorable thing:** "This is the real debugger for agents." Every design decision serves that one sentence.

## Aesthetic Direction
- **Direction:** Vercel/Geist-grade product surface. Calm, near-black, paper-warm light mode. Information density without ornament. Not "SaaS pastel," not "AI-tool gradient slop," not "shadcn template." Closest analogs: Vercel dashboard, Linear, GitHub Primer's quieter views.
- **Decoration level:** None. Type, spacing, and 1px rules carry everything. No gradients. No icon-in-colored-circle. No mesh blobs. No glassmorphism.
- **Mood:** Quiet, precise, builder-grade. The product looks like calm software, not a pitch deck.
- **Reference:** `/Users/mia/Downloads/tracability.html` is the canonical mock. When in doubt, open that file and copy what it does.

## Typography
- **Sans (default UI + body):** Geist, served via `next/font/google`. Weights 400/500/600.
- **Mono (data, code, kbd, badges, span ids):** Geist Mono. Always with `font-variant-numeric: tabular-nums slashed-zero` on numeric data.
- **No alt fonts.** No Inter. No Space Grotesk. No Berkeley Mono. No Fraunces. No system-ui as the primary face. Geist + Geist Mono is the entire family.
- **Type scale (CSS variables):**

```
--fs-12 12px  — captions, span timestamps, helper
--fs-13 13px  — table rows, sidebar nav, secondary
--fs-14 14px  — UI default, body, button text
--fs-16 16px  — section titles, card titles
--fs-20 20px  — page titles
--fs-28 28px  — KPI numbers
--fs-40 40px  — marketing display only
```

- **Line-height:** UI/data 1.4, prose 1.55, headings 1.2.
- **Letter-spacing:** UI labels at -0.005em. KPI numbers and large mono numbers at -0.015em.

## Color (light is default, dark is parity)

Tokens — copy these names verbatim into `globals.css`:

### Light mode (default for both product and marketing)

| Token | Value | Usage |
|---|---|---|
| `--bg` | `#FCFCFC` | App + page background. Warm-white. |
| `--surface` | `#FFFFFF` | Cards, popovers, modal surfaces. |
| `--surface-2` | `#F7F7F5` | Striped row, sidebar bg, secondary surface. |
| `--surface-3` | `#F0F0EE` | Active nav row, hover-press, code-block bg. |
| `--hover` | `#F5F5F3` | Hover row / hover button. |
| `--border` | `#ECECEA` | Default 1px rule. |
| `--border-strong` | `#DDDDDB` | Stronger rule, focused-card border. |
| `--border-focus` | `#0485F7` | Focus ring color. Matches `--accent`. |
| `--text` | `#0A0A0A` | Primary text. Near-black. |
| `--text-2` | `#4B4B49` | Secondary labels. |
| `--text-3` | `#8A8A86` | Tertiary, helper, timestamps. |
| `--text-4` | `#B4B4AE` | Disabled / placeholder. |
| `--accent` | `#0485F7` | Primary button bg, brand mark, focus ring, active states. HeroUI primary blue. |
| `--accent-fg` | `#FFFFFF` | Foreground on accent. |
| `--accent-soft` | `#E0F0FE` | Accent-tinted bg (focused field band, selected row, link-soft). |
| `--accent-hover` | `#3592F9` | Primary button hover state. |
| `--link` | `#0485F7` | Hyperlinks. Same hue as `--accent` so the brand reads as one voice. |
| `--link-soft` | `#E0F0FE` | Link-tinted hover/selected backgrounds. |
| `--info` | `#0485F7` | Info badge. |
| `--info-soft` | `#E0F0FE` | Info badge bg. |
| `--success` | `#1A7F4E` | Pass, healthy, OK. |
| `--success-soft` | `#E7F4ED` | Success badge bg. |
| `--warn` | `#B05F00` | Warning, sampled-eval ceiling. |
| `--warn-soft` | `#FBF1E0` | Warn badge bg. |
| `--danger` | `#C0382B` | Error, failed run, dead-letter. |
| `--danger-soft` | `#FBEAE7` | Danger badge bg. |

### Kind palette (span-kind badges in trace views)

The kind palette is *categorical*, not emotional — separate from `--accent`. Each kind owns a hue that doesn't collide with the brand blue, so a trace view can read `llm / tool / retr / chain` at a glance without any of them being mistaken for "the active item."

| Token | Value | Usage |
|---|---|---|
| `--kind-llm` | `#B97306` | LLM call. Amber. |
| `--kind-llm-bg` | `#FBF3DF` | LLM badge bg. |
| `--kind-tool` | `#0E7FB8` | Tool call. Cyan (distinct from accent sky-blue). |
| `--kind-tool-bg` | `#E2F1FA` | Tool badge bg. |
| `--kind-retr` | `#1F8A56` | Retriever / vector lookup. Green. |
| `--kind-retr-bg` | `#E5F4EC` | Retr badge bg. |
| `--kind-chain` | `#7A4FD9` | Chain / wrapper / agent step. Indigo. |
| `--kind-chain-bg` | `#EFEAFB` | Chain badge bg. |

### Dark mode (parity, reserved)

Dark mode is reserved. When authored it must be a deliberate redesign, not auto-inverted. Until shipped, the app stays light-mode-only.

### Color rules
- **Accent is `#0485F7`** (HeroUI primary blue). Primary buttons, the brand glyph, focus rings, hyperlinks, and active-nav indicators are this color. Hover deepens to `#3592F9`. Soft-tint backgrounds (focused field band, selected row, info-soft) are `#E0F0FE`.
- **Brand and link are the same hue.** The product reads as one voice; we don't want a "brand color" the user has to learn separately from "clickable thing."
- **Accent is the only chromatic UI color.** No purple in the chrome. No amber/orange in the chrome. The kind palette (`--kind-*`) is categorical and lives only inside trace-view badges; it is *not* available for general UI.
- **No gradients.** Anywhere. Including the brand mark.
- **Semantic colors are rare.** A row is not painted green for being healthy. Green only appears in the pass-pill and the eval-pass dot. Same for warn/danger.

## Geometry
- **Border radius:**
```
--r-1 4px   — inline pills, badges, tags
--r-2 6px   — inputs, buttons, kbd
--r-3 8px   — cards, panels, popovers
--r-4 12px  — modals (top of scale)
```
No radius >12px outside of round status dots / avatars. Round avatars and status dots use `border-radius: 9999px`.

- **Shadow:**
```
--shadow-1: 0 1px 2px rgba(0,0,0,0.04)            — flat lift (default card)
--shadow-2: 0 4px 16px -2px rgba(0,0,0,0.06),
            0 2px 4px rgba(0,0,0,0.04)             — popover
--shadow-3: 0 12px 40px -8px rgba(0,0,0,0.12)     — modal
```
Shadows are subtle. The 1px `--border` rule is the primary container signal; shadow is only a hint.

## Spacing
- **Base unit:** 4px.
- **Density:** Compact-but-breathable. Sidebar nav rows 30-32px, table rows 36-40px, KPI cards 16-20px padding.
```
2xs   2px
xs    4px
sm    8px
md    12px
lg    16px
xl    24px
2xl   32px
3xl   48px
```

## Layout grids
The app shell is one composition: `topbar topbar / sidebar main`.

```
App grid
+------------------ 48px topbar -------------------+
| brand · crumbs                  search · kbd ⌘K  |
+----- 232px ----+--------- 1fr main --------------+
|   sidebar      |    page content                 |
|   project      |                                  |
|   nav-section  |                                  |
|   nav-item     |                                  |
|   ...          |                                  |
|   sidebar-foot |                                  |
+----------------+----------------------------------+
```

- **Topbar:** 48px tall, sticky, 1px `--border` bottom rule. White surface.
- **Sidebar:** 232px wide, full-height, `--surface-2` background, 1px right rule.
- **Trace shell (run-detail):** `360px 1fr 440px` — span-tree / timeline canvas / inspector. Each pane has its own scroll. 1px `--border` rules between, no shadow.
- **Studio shell:** `1fr 380px` — graph pane / chat pane.
- **Marketing:** 12-col grid at 1200px max, 24px gutters, single scroll first viewport.
- **No max-width inside the app.** The shell consumes available width.

## Components (canonical class names — use exactly these)

`.btn` — base button. Variants `.btn-primary` (filled `--accent` / `--accent-fg`), `.btn-ghost` (transparent / `--text` / hover `--hover`), `.btn-danger` (filled `--danger` / white). Default: 32px tall, 12px padding, `--r-2`, 13/14px text.

`.kbd` — inline keyboard hint. `--surface` bg, 1px `--border`, `--r-1`, 11px Geist Mono, 2px 6px padding.

`.badge` — small status pill. 11/12px, monospace digits, `--r-1`, 2px 6px. Variants `.badge-success`, `.badge-warn`, `.badge-danger`, `.badge-info`, `.badge-neutral`.

`.kind-badge` — span-kind tag. Same shape as `.badge` but uses `--kind-*` tokens. Variants `.kind-llm`, `.kind-tool`, `.kind-retr`, `.kind-chain`.

`.card` — bordered container. `--surface` bg, 1px `--border`, `--r-3`, optional `--shadow-1`. Title row uses 14px Geist 500.

`.kpi` — KPI tile. Card + 12px label `--text-3` uppercase + 28px Geist Mono number `--text` + 12px delta row.

`.table` — data grid. 1px `--border` rule between rows, hover row `--hover`, monospace numeric columns, 36-40px row height, sticky header `--surface-2`.

`.nav-section-label` — sidebar group header. 11px uppercase Geist 500, `--text-3`, 8px 12px padding.

`.nav-item` — sidebar row. 13px Geist, 30px tall, 8px horizontal padding, 8px gap to icon. Active = `--surface-3` bg + `--text` color + 2px left bar in `--accent`. Hover = `--hover`.

`.search-box` — topbar search. 32px tall, 1px `--border`, `--r-2`, `--surface-2` bg, leading icon, trailing `.kbd`. Focus = 1px `--border-focus` ring.

`.crumbs` — breadcrumb row. 13px `--text-2`, ` / ` separator in `--text-4`, last segment `--text`.

## Motion
- **Default duration:** 80-120ms for hover/focus, 180ms for state change. No motion >240ms except the replay scrubber.
- **Easing:** `cubic-bezier(0.4, 0, 0.2, 1)` for move, `ease-out` for enter, `ease-in` for exit.
- **No entrance animations** on page load. No scroll-driven hero. No skeleton shimmer (skeletons are flat `--surface-3` rectangles).
- **Reduced motion:** respect `prefers-reduced-motion`. The replay scrubber falls back to step-by-step jump.

## Iconography
- **Library:** Lucide. Stroke 1.5px, no fills. Inherit `currentColor`. Never coloured independently.
- **Sizes:** 14 inline, 16 UI default, 20 panel headers. Nothing larger.
- **Anti-pattern:** never put an icon inside a colored circle.

## Anti-patterns (forbidden)
- Inter, Space Grotesk, system-ui, Berkeley Mono, Fraunces as primary or fallback faces.
- Purple, green, or amber as accent. `--accent` is `#0485F7`; chromatic color in the chrome belongs to the brand and only the brand.
- Categorical `--kind-*` colors used outside trace-view kind badges (e.g. don't paint a button or row in `--kind-llm` amber; that's a hard miscommunication).
- Gradients of any kind, including subtle text gradients on the brand.
- Border radius >12px outside of full-round status dots / avatars.
- Icons in colored circles.
- 3-column SaaS-template feature grids with hero+subhero+CTA stack on marketing.
- Skeleton shimmer animations.
- Decorative blur blobs, mesh gradients, glassmorphism.
- Centered-everything marketing pages.
- "Designed for AI teams" / "Built for modern engineers" boilerplate copy patterns.

## Accessibility minimums
- All text/bg combinations pass WCAG AA.
- Focus is always visible. 1px `--border-focus` ring, never `outline: none` without a replacement.
- Hit targets ≥32px in the app (matches button height), ≥24px in dense tables.
- Trace tree, replay timeline, and eval tables are fully keyboard-navigable. Arrow + Enter + Escape are first-class.
- Color is never the only signal — every status uses an icon or text alongside the color.

## Decisions Log
| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-05-25 | v1 instrumented-brutalist (Berkeley Mono + amber). | Original direction. |
| 2026-05-27 | v2 — adopt Vercel/Geist mock as new source of truth. | User chose "mock wins, replace DESIGN.md." Geist + Geist Mono, near-black `#0A0A0A` accent, light-mode default, blue `#2056E2` links, full token set extracted from `/Users/mia/Downloads/tracability.html`. Berkeley Mono / amber-orange retired. |
| 2026-06-08 | v3 — accent → HeroUI blue `#0485F7`; brand and link unified. | After `/design-shotgun` exploration, user selected the Inline-edit grammar paired with HeroUI's exact primary blue (sourced from `heroui-inc/heroui` `packages/styles/themes/default/variables.css`, `oklch(0.6204 0.195 253.83)` → `#0485F7`). Near-black accent retired; brand and link collapsed to a single hue so the product reads as one voice. Kind palette repointed to a *categorical* set (llm `#B97306` amber / tool `#0E7FB8` cyan / retr `#1F8A56` green / chain `#7A4FD9` indigo) so trace badges don't compete with the new accent. Geist + Geist Mono, light-mode default, no gradients all preserved. |
