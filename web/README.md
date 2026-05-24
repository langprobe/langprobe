# web

Next.js 14 (App Router) + TypeScript shell for the tracebility product UI.
Boots on port 7090 to match the API CORS allowlist
(`TRACEBILITY_CORS_ALLOW_ORIGIN=http://localhost:7090`).

Visual language is locked in repo-root `DESIGN.md`. Tokens live in
`src/app/globals.css`. **No blue, no purple, no gradients.** If you find
yourself reaching for `box-shadow`, reach for a 1px `--rule` border instead.

## Run

```sh
pnpm install
pnpm --filter @tracebility/web dev
```

Then open http://localhost:7090.

## Design conflict to resolve

The mock at `file:///Users/mia/Downloads/tracability.html` uses a blue accent
(#2056E2). DESIGN.md (locked 2026-05-25) calls for amber-orange (#D9531E /
#E96A2E). This scaffold follows DESIGN.md. If we want to revisit, run
`/design-consultation` and update DESIGN.md before changing the tokens.

## Structure

```
src/
  app/
    layout.tsx       — root layout, boots dark theme
    page.tsx         — overview dashboard (stub data)
    globals.css      — design tokens + reset
  components/
    Shell.tsx        — three-pane debugger shell (nav | main | inspector)
```
