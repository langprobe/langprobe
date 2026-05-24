# tracability

Self-hosted LLM observability + eval-rigor + agent-replay platform. The real debugger for agents.

Locked plan: `/Users/mia/.gstack/projects/tracability/ceo-plans/2026-05-25-langsmith-replacement-mvp.md`
Sections: `/Users/mia/.gstack/projects/tracability/ceo-plans/2026-05-25-langsmith-replacement-mvp-sections.md`
Registries: `/Users/mia/.gstack/projects/tracability/ceo-plans/2026-05-25-registries.md`

## Design System

Always read `DESIGN.md` before making any visual or UI decisions. All font choices, colors, spacing, border radii, motion rules, and aesthetic direction are defined there. Do not deviate without explicit user approval.

The memorable thing is "this is the real debugger for agents." Every UI choice serves that. When in doubt: look at Chrome DevTools, Sentry's debugger panel, or Linear, not LangSmith or Braintrust.

In QA, code review, or design review modes: flag any code that doesn't match `DESIGN.md`. Specifically watch for:
- Inter, Space Grotesk, or system-ui as primary fonts (use Berkeley Mono for UI / Fraunces for marketing display).
- Blue or purple as primary accent (only amber-orange `#D9531E` light / `#E96A2E` dark).
- Gradients of any kind.
- Border radius >12px outside of round status dots / avatars.
- Icons in colored circles, decorative blur blobs, glassmorphism.
- 3-column SaaS-template feature grids.
- Skeleton shimmer animations.

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
