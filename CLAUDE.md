# langprobe

Self-hosted LLM observability + eval-rigor + agent-replay platform. The real debugger for agents.

Locked plan: `/Users/mia/.gstack/projects/langprobe/ceo-plans/2026-05-25-langsmith-replacement-mvp.md`
Sections: `/Users/mia/.gstack/projects/langprobe/ceo-plans/2026-05-25-langsmith-replacement-mvp-sections.md`
Registries: `/Users/mia/.gstack/projects/langprobe/ceo-plans/2026-05-25-registries.md`

## Design System

Always read `DESIGN.md` before making any visual or UI decisions. All font choices, colors, spacing, border radii, motion rules, and aesthetic direction are defined there. Do not deviate without explicit user approval.

The memorable thing is "this is the real debugger for agents." Every UI choice serves that. The canonical visual reference is `/Users/mia/Downloads/langprobe.html`. When in doubt: open that file and copy what it does. For aesthetic peers, look at the Vercel dashboard, Linear, or GitHub Primer's quieter views, not LangSmith or Braintrust.

In QA, code review, or design review modes: flag any code that doesn't match `DESIGN.md`. Specifically watch for:
- Any font other than Geist + Geist Mono (no Inter, Space Grotesk, system-ui, Berkeley Mono, or Fraunces).
- Any accent color other than HeroUI primary blue `#0485F7`. Brand and link share the hue. No purple, green, or amber in the chrome. No gradients on the brand.
- The `--kind-*` categorical palette (llm amber, tool cyan, retr green, chain indigo) used outside trace-view kind badges.
- Gradients of any kind.
- Border radius >12px outside of round status dots / avatars (token scale stops at `--r-4 12px`).
- Icons in colored circles, decorative blur blobs, glassmorphism.
- 3-column SaaS-template feature grids with hero+subhero+CTA stacks on marketing.
- Skeleton shimmer animations (skeletons must be flat `--surface-3` rectangles).
- `data-theme="dark"` defaults — the app is light-mode-only until dark mode is deliberately authored.
- CSS variables that don't match the canonical token set (`--bg #FCFCFC`, `--accent #0485F7`, `--link #0485F7`, etc.). The full set is in `DESIGN.md`.

## Skill routing

When the user's request matches an available skill, ALWAYS invoke it using the Skill tool as your FIRST action. Do NOT answer directly, do NOT use other tools first. The skill has specialized workflows that produce better results than ad-hoc answers.

Key routing rules:
- Product ideas, "is this worth building", brainstorming → invoke office-hours
- Bugs, errors, "why is this broken", 500 errors → invoke investigate
- Ship, deploy, push, create PR → invoke ship
- QA, test the site, find bugs → invoke qa
- Code review, check my diff → invoke review
- Update docs after shipping → invoke document-release
- Weekly retro → invoke retro
- Design system, brand → invoke design-consultation
- Visual audit, design polish → invoke design-review
- Architecture review → invoke plan-eng-review
- Save progress, checkpoint, resume → invoke checkpoint
- Code quality, health check → invoke health
