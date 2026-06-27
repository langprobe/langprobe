# Contributing to langprobe

Thanks for taking the time. langprobe is solo-founded and pre-alpha; expect rough edges and rapid change.

## Before you start

- Read `README.md`, `DESIGN.md`, and `CLAUDE.md` first.
- Open an issue describing the change before opening a PR for non-trivial work. Saves you cycles when scope is wrong.
- Bug fixes < 50 lines: skip the issue, just send the PR.

## DCO sign-off

We use the [Developer Certificate of Origin](https://developercertificate.org/), not a CLA. Add `Signed-off-by: Your Name <you@example.com>` to every commit:

```bash
git commit -s -m "fix: clamp span duration on out-of-order timestamps"
```

Unsigned commits will be flagged by CI.

## Local dev

```bash
# Python services
cd services/ingest-api && uv venv && uv pip install -e '.[dev]'
ruff check .
pytest

# Web
cd web && pnpm install && pnpm dev
```

## Code style

- **Python:** ruff + pyright. 4-space indent. Type hints required on public functions.
- **TypeScript:** ESLint + Prettier. No `any` without an `// eslint-disable-next-line` and a reason.
- **SQL:** lower-case keywords, `--` for comments, one statement per migration file when reasonable.
- **Commits:** [Conventional Commits](https://www.conventionalcommits.org/). `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`.

## Visual / UI changes

`DESIGN.md` is the source of truth. Don't ship visual changes without reading it. The aesthetic is **instrumented brutalist** — Berkeley Mono UI, Fraunces display (marketing), amber-orange accent, no blue/purple, no gradients, no bubble radius.

If a design change feels right but contradicts `DESIGN.md`, open an issue tagged `design` first.

## Tests

- Unit tests next to source: `foo.py` + `test_foo.py`.
- Integration tests in `tests/integration/` per service. They hit a real Postgres/ClickHouse/Redis via docker-compose, not mocks.
- Anything touching ingest, eval scoring, or replay capture must have integration coverage.

## Reporting bugs

Use GitHub issues. Include:
- langprobe version (`langprobe version`)
- environment (self-hosted? cloud? OS?)
- minimal repro
- expected vs. actual
- relevant logs (redact PII)

## Security

Found a security issue? Don't open a public issue. Email security@langprobe.dev (TODO: stand up the alias).

## License

By contributing, you agree your contributions are licensed under Apache 2.0.
