# TODOS

Phased build list seeded from the locked CEO plan registries
(`~/.gstack/projects/tracability/ceo-plans/2026-05-25-registries.md`).

## Pre-commit (must resolve before scaling code)

- [x] License decision (Apache 2.0)
- [x] Codename / public name (`tracebility`)
- [x] Primary languages: Python (services) + TypeScript/Next.js (web)
- [x] Repo structure: monorepo (single repo, polylang)
- [ ] Counsel review on LangSmith SDK shim trade dress / trademark posture
- [ ] CLA vs DCO decision (currently DCO; reassess at first commercial customer)
- [ ] Pricing model shape (multi-meter vs per-seat)
- [ ] Open vs closed feature line documented
- [ ] Monorepo tool decision (bare? Turborepo? Nx?)

## Validation actions (parallel with foundation work)

- [ ] Reach out to 1st SaaS contact, schedule demo-of-spec call
- [ ] Reach out to 2nd SaaS contact, schedule demo-of-spec call
- [ ] Draft 1-page LOI / paid-pilot spec
- [ ] Set up monthly check-in with both contacts
- [ ] Document each contact's current LangSmith pain points (first call)

## Foundation work (months 0-3)

- [x] Repo init, README, CONTRIBUTING.md, LICENSE
- [ ] CI scaffolding (GitHub Actions)
- [ ] Postgres schema for orgs/workspaces/projects/users/api-keys/audit-log
- [ ] ClickHouse schema for runs/spans/eval-scores/replay-captures
- [ ] Redis setup with rate-limit, queue, cache namespaces
- [ ] docker-compose.yml end-to-end (all services)
- [ ] auth: SAML + OIDC + email-password fallback
- [ ] Audit log middleware
- [ ] Billing meter middleware
- [ ] Setup wizard for first-run admin

## Floor capture (months 3-9)

- [ ] LangSmith SDK shim (Python, full surface)
- [ ] LangSmith SDK shim (JS)
- [ ] `/runs/multipart` endpoint with attachments
- [ ] OpenInference translation layer
- [ ] LangChain callback bridge
- [ ] LangGraph callback bridge
- [ ] `wrap_openai` shim
- [ ] `wrap_anthropic` shim
- [ ] OpenAI Agents SDK trace ingestion
- [ ] Migration importer (pull LangSmith projects/datasets/prompts)
- [ ] Dual-write tooling (fan-out collector config + reconciler)
- [ ] Data export tooling (no-lock-in)
- [ ] PII redactor (Presidio integration)

## Floor surface (months 6-12)

- [ ] Trace explorer UI
- [ ] Prompt management (versioned, playground, A/B)
- [ ] Dataset editor (CSV import, manual, from-traces)
- [ ] Project dashboards (p50/p95/p99, cost, error rate, tokens)
- [ ] Single-judge eval (no PoLL yet)

## Pull #1 — Eval-rigor (months 12-16)

- [ ] PoLL aggregator
- [ ] Judge adapters (Ollama, vLLM, hosted endpoints)
- [ ] Reliability metrics dashboard (test-retest, schema-adherence)
- [ ] Prompted Luna-style judges (hallucination, faithfulness, instruction-following)
- [ ] Sampling-based real-time eval with cost ceilings
- [ ] Configurable RCA with cost ceilings
- [ ] Inspect-ai log-format read

## Pull #2 — Agent replay (months 14-22)

- [ ] Capture format design (content-addressed)
- [ ] Tool I/O capture instrumentation
- [ ] Model RNG/sampler state capture
- [ ] Retrieval result capture
- [ ] Time/env capture
- [ ] Replay execution engine
- [ ] Replay diff computation
- [ ] Replay timeline UI
- [ ] LangGraph integration first

## Hardening (months 18-24)

- [ ] docker-compose polish
- [ ] MinIO bundle
- [ ] Secrets management documentation
- [ ] Backup procedure
- [ ] Upgrade tool (`tracebility upgrade`)
- [ ] Self-hosted dogfood telemetry

## First-migration (months 22-30)

- [ ] First SaaS contact onboarding playbook
- [ ] Dual-write phase support
- [ ] Cutover playbook
- [ ] Real-production-load bug-fix tail

## Continuous

- [ ] Quarterly external check-in (founder support, not customer)
- [ ] Monthly Langfuse-on-ClickHouse roadmap watch
- [ ] Monthly LangSmith API drift check
- [ ] Quarterly OTel GenAI semconv compatibility check
- [ ] Quarterly market-position read (acquisitions, new entrants)
