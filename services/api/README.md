# api

Control-plane API. Auth (session cookies), RBAC, project/workspace/org CRUD,
API key management, audit log. Talks Postgres only — the data plane
(ClickHouse) is read by a separate service in a later phase.

## Endpoints

Auth:
- `POST /v1/auth/login` — `{email, password}` → session cookie
- `POST /v1/auth/logout`
- `GET /v1/auth/me`

Projects:
- `GET /v1/projects` — projects in workspaces the caller belongs to
- `POST /v1/projects` — workspace owner/admin
- `PATCH /v1/projects/{id}` — workspace owner/admin

API keys:
- `GET /v1/api_keys?project_id=...`
- `POST /v1/api_keys` — workspace owner/admin (returns plaintext key ONCE)
- `DELETE /v1/api_keys/{id}` — workspace owner/admin (sets `revoked_at`)

Operational:
- `GET /healthz`
- `GET /readyz`

## Run

```sh
export TRACEBILITY_PG_DSN=postgres://tracebility:tracebility@localhost:5432/tracebility
export TRACEBILITY_SESSION_SECRET=$(openssl rand -hex 32)
python -m tracebility_api
```

## Env vars

| name                                  | default                 |
| ------------------------------------- | ----------------------- |
| `TRACEBILITY_PG_DSN`                  | required                |
| `TRACEBILITY_SESSION_SECRET`          | required, ≥32 chars     |
| `TRACEBILITY_SESSION_COOKIE`          | `tracebility_session`   |
| `TRACEBILITY_SESSION_MAX_AGE_SECONDS` | `604800` (7 days)       |
| `TRACEBILITY_BIND_HOST`               | `0.0.0.0`               |
| `TRACEBILITY_API_BIND_PORT`           | `7081`                  |
| `TRACEBILITY_LOG_LEVEL`               | `INFO`                  |
| `TRACEBILITY_CORS_ALLOW_ORIGIN`       | `http://localhost:7090` |
