# OAuth signup wiring for GKE deploys

**Date:** 2026-06-06
**Status:** approved (brainstorming) → pending implementation plan
**Owner:** infra
**Predecessor:** [2026-06-06-gke-cicd-design.md](./2026-06-06-gke-cicd-design.md)

## Summary

The API already implements public OAuth signup (Google + GitHub) at
`services/api/tracebility_api/routers/oauth_signup.py`. It is config-gated
on four env vars: `OAUTH_GOOGLE_CLIENT_ID`, `OAUTH_GOOGLE_CLIENT_SECRET`,
`OAUTH_GITHUB_CLIENT_ID`, `OAUTH_GITHUB_CLIENT_SECRET`. When a credential
pair is missing, the start endpoint 503s and the web UI hides the
corresponding "Continue with X" button.

On the GKE deploy at `https://langprobe.daz.co.in/`, both buttons are
hidden because the Helm chart never wires those env vars to the API
container, regardless of whether a secret exists. Same is true for
`OAUTH_REDIRECT_BASE` and `TRACEBILITY_WEB_BASE_URL`, which the API uses
to construct the IdP callback URI and to validate post-login redirects.

This spec wires those six values through the chart, defines a single k8s
secret to hold the four credentials, and extends the bootstrap runbook
with the human side (register OAuth apps with Google + GitHub, paste
creds into the secret).

**No application code changes.** The OAuth router, web `/login` flow, and
same-origin cookie shim are all already correct.

## Out of scope

- Workspace-level corporate SSO (`routers/sso.py`). Different code path,
  different state table, different config.
- Email + password signup. Project doesn't have it; not adding it here.
- OAuth secret rotation tooling. Manual `kubectl create secret ... --dry-run | kubectl apply` is enough for v1.
- GCP Secret Manager / Sealed Secrets / external-secrets-operator.
  In-cluster `Opaque` secret matches the existing pattern (postgres,
  clickhouse, redis, session) and stays consistent.
- Multi-tenant per-workspace OAuth client config. Single global
  client per provider, configured at deploy time.

## Architecture

### Three pieces, one feature

```
                Helm chart (deploy/helm/tracebility/)
   ┌─────────────────────────────────────────────────────────────┐
   │ values.yaml                                                  │
   │   oauth:                                                      │
   │     existingSecret: ""           # default empty → feature off │
   │     googleClientIdKey: google_client_id                       │
   │     googleClientSecretKey: google_client_secret               │
   │     githubClientIdKey: github_client_id                       │
   │     githubClientSecretKey: github_client_secret               │
   │     publicUrl: ""                # external https URL         │
   │                                                                │
   │ templates/api-deployment.yaml                                  │
   │   {{- if .Values.oauth.existingSecret }}                      │
   │   - name: OAUTH_GOOGLE_CLIENT_ID                              │
   │     valueFrom:                                                 │
   │       secretKeyRef:                                            │
   │         name: {{ .Values.oauth.existingSecret }}              │
   │         key:  {{ .Values.oauth.googleClientIdKey }}           │
   │         optional: true                                         │
   │   ... (same for the other 3 OAuth keys)                       │
   │   {{- end }}                                                   │
   │   {{- with .Values.oauth.publicUrl }}                         │
   │   - name: OAUTH_REDIRECT_BASE                                 │
   │     value: {{ . | quote }}                                    │
   │   - name: TRACEBILITY_WEB_BASE_URL                            │
   │     value: {{ . | quote }}                                    │
   │   {{- end }}                                                   │
   └─────────────────────────────────────────────────────────────┘

                Production values (deploy/helm/tracebility/values-gke.yaml)
   ┌─────────────────────────────────────────────────────────────┐
   │ oauth:                                                       │
   │   existingSecret: tracebility-oauth                          │
   │   publicUrl: https://langprobe.daz.co.in                    │
   └─────────────────────────────────────────────────────────────┘

                Bootstrap runbook (one-time, human-run)
   ┌─────────────────────────────────────────────────────────────┐
   │ 1. Register at console.cloud.google.com/apis/credentials    │
   │    Redirect URI: https://langprobe.daz.co.in/api/auth/      │
   │                  oauth/google/callback                       │
   │ 2. Register at github.com/settings/developers               │
   │    Callback URL: https://langprobe.daz.co.in/api/auth/      │
   │                  oauth/github/callback                       │
   │ 3. kubectl -n tracebility create secret generic              │
   │      tracebility-oauth \                                     │
   │      --from-literal=google_client_id="..." \                 │
   │      --from-literal=google_client_secret="..." \             │
   │      --from-literal=github_client_id="..." \                 │
   │      --from-literal=github_client_secret="..." \             │
   │      --dry-run=client -o yaml | kubectl apply -f -           │
   │ 4. kubectl rollout restart deployment/tracebility-api       │
   │      -n tracebility                                          │
   └─────────────────────────────────────────────────────────────┘
```

### Why this shape

- **`existingSecret`-by-name pattern.** The chart already uses this for
  Postgres, ClickHouse, Redis, and the session secret. Re-using it keeps
  the operator's mental model uniform: "five secrets exist in the
  cluster, the chart references them by name."

- **All keys optional, but the secret itself is required when
  referenced.** `secretKeyRef.optional: true` means a missing *key*
  inside the secret doesn't crash the pod; the env var just isn't set,
  the API treats the provider as unconfigured, the button hides. The
  *secret object* must still exist if `oauth.existingSecret` is set
  (otherwise pod creation fails fast). This lets an operator enable
  Google now and add GitHub next week without re-rolling deploys for
  both at once — they `kubectl apply` an updated secret and rollout-
  restart the API.

- **`publicUrl` as a single value.** The OAuth router needs it twice
  (`OAUTH_REDIRECT_BASE` for IdP callbacks, `TRACEBILITY_WEB_BASE_URL`
  for relative redirects after login). One source of truth in the
  values file → two env vars on the pod. If those ever need to diverge,
  splitting them is a one-line chart edit.

- **Single secret, four keys.** Mirrors the env var names from
  `infra/docker-compose.yml` (which is the dev-loop reference). One
  `kubectl create secret` call holds all four creds; `kubectl rollout
  restart deployment/tracebility-api` picks up rotations atomically.

- **Bootstrap doc, not Terraform.** Registering OAuth apps requires a
  human in the IdP UI to copy/paste a client secret. There's no
  automating that for v1; the runbook records the literal URL, the
  exact `kubectl` command, and what to do on rotation.

## Files written by this design

```
deploy/helm/tracebility/values.yaml                            MODIFIED (+1 block)
deploy/helm/tracebility/templates/api-deployment.yaml          MODIFIED (+~15 lines)
deploy/helm/tracebility/values-gke.yaml                        MODIFIED (+3 lines)
docs/superpowers/runbooks/gke-bootstrap.md                     MODIFIED (+1 section)
docs/superpowers/specs/2026-06-06-oauth-signup-gke-design.md   THIS DOC
```

No new files.

## Failure modes

| Failure | Outcome |
|---|---|
| Operator never registers OAuth apps. | `oauth.existingSecret` stays `""`, the `if` branch in the deployment template emits no env vars. API reports `{google:false, github:false}` from `/v1/auth/oauth/providers`. UI hides both buttons. Same state as today — feature is opt-in. |
| Operator registers Google but not GitHub. | Operator omits the `github_*` keys from the secret. `secretKeyRef.optional: true` means the pod still starts. API: `{google:true, github:false}`. Only Google's button shows. |
| Operator typos a callback URL in the IdP console. | The OAuth dance succeeds up to the IdP, the IdP redirects to a wrong path, browser shows the IdP's error page. Recovery is in the IdP dashboard, not the cluster. Runbook prints the literal URL to register, so this should not be a recurring failure. |
| `oauth.publicUrl` ≠ Gateway hostname. | Browser ends up on a host whose DNS / cert / CORS doesn't match. Runbook ties `oauth.publicUrl` to the same domain as the Gateway in `deploy/k8s/gke-gateway/`. |
| Secret created with wrong key names. | `secretKeyRef.optional: true` masks this — pod starts but `_provider_creds` 503s when the user clicks the button. The runbook spells out the four canonical key names. |
| Helm upgrade with `existingSecret` set but the secret missing. | Pod creation fails (referenced secret not found). `helm upgrade --atomic` rolls back the release. Recovery: create the secret, re-run the deploy workflow. |
| Operator wants to rotate one credential. | Re-run the `kubectl create secret ... --dry-run | kubectl apply` block; `kubectl rollout restart deployment/tracebility-api`. Idempotent. |

## Verification (for the implementation plan)

A reviewer should be able to verify all of these after merge:

1. `deploy/helm/tracebility/values.yaml` has a top-level `oauth:` block with the five fields above and sensible empty defaults.
2. `deploy/helm/tracebility/templates/api-deployment.yaml` emits the four `secretKeyRef` env vars guarded by `if .Values.oauth.existingSecret`, and the two plain env vars guarded by `with .Values.oauth.publicUrl`. `helm template` renders correctly with `oauth.existingSecret=""` (no env vars) and with it set (six env vars).
3. `deploy/helm/tracebility/values-gke.yaml` references `tracebility-oauth` and `https://langprobe.daz.co.in`.
4. `docs/superpowers/runbooks/gke-bootstrap.md` has a numbered "OAuth signup setup" section with literal URLs and the `kubectl` command, idempotent on re-run.
5. After the runbook is followed and CI/CD ships the chart change, `curl https://langprobe.daz.co.in/api/auth/oauth/providers` returns `{"google":true,"github":true}` and the `/login` page shows both buttons.
6. Clicking either button initiates an OAuth flow that round-trips through the IdP and lands the user on the dashboard with a session cookie set on `langprobe.daz.co.in`.

## Open follow-ups (NOT this spec)

- Email + password signup as a fallback when no OAuth is configured.
- Per-workspace OAuth client overrides for tenants who want to use their
  own Google client (multi-tenancy story).
- OAuth client rotation automation (Cert Manager-style).
- Same wiring for the dev-deps profile (currently `infra/docker-compose.yml`
  reads from the parent shell — fine for dev, but a `.env.example` would
  reduce friction).
