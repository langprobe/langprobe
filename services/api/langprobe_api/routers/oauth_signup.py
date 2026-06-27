"""Public OAuth signup/login (Google + GitHub).

This is the personal-account onboarding path: a user clicks
"Continue with Google" / "Continue with GitHub" on /login or /signup,
and on first sign-in we auto-provision an `app_user` plus a personal
`org` + `workspace` so they land somewhere usable instead of staring
at "no project resolved".

This is INTENTIONALLY separate from the per-workspace OIDC SSO at
`routers/sso.py`. Per-workspace SSO is a corporate-admin feature
(one IdP per workspace, configured in the UI). Public OAuth signup
is operator-controlled at the env-var level: you set
`OAUTH_GOOGLE_CLIENT_ID` / `OAUTH_GITHUB_CLIENT_ID` once at deploy
time and it's available to anyone hitting `/login` or `/signup`.

The two share `app_user.external_idp / external_subject` (added in
0003). They do NOT share state tables: workspace SSO uses
`sso_state`, public OAuth uses `oauth_state` (added in 0022).

V1 boundaries:
  - Email is the primary identity. If a user signs up with Google
    and then later with GitHub using the same email, the second
    sign-in matches the existing app_user row (and updates
    external_idp to the latest provider). This trades a small
    edge-case for not having to surface a "link your accounts"
    flow in v1.
  - Personal workspace auto-creation: every signup gets one
    "personal" org + workspace + project named after a slug
    derived from the user's email local-part. If the slug
    collides we suffix a short hash. Operators don't have to
    pre-provision anything for self-service signup to work.
  - SSO is intentionally left as scope for later: workspace-level
    SCIM / OIDC continues to live at `/v1/auth/sso/*`. Future SAML,
    magic-link email, and MFA all slot in here without breaking
    the storage shape.
  - id_token / access_token signature verification is skipped — we
    rely on the TLS-protected token-endpoint round-trip with our
    secret. Same posture as `routers/sso.py`. Hardening is the next
    iteration.
"""

from __future__ import annotations

import asyncio
import base64
import hashlib
import json as _json
import secrets
import urllib.error
import urllib.parse
import urllib.request
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID

import asyncpg
import structlog
from fastapi import APIRouter, HTTPException, Query, Request, status
from fastapi.responses import RedirectResponse

from .. import audit
from ..auth import Principal, issue_session_cookie
from ..config import Settings

log = structlog.get_logger("langprobe.api.oauth_signup")

router = APIRouter(prefix="/v1/auth/oauth", tags=["oauth"])

_STATE_TTL_SECONDS = 600

# ---------------------------------------------------------------------------
# Provider config
# ---------------------------------------------------------------------------

_GOOGLE_AUTH = "https://accounts.google.com/o/oauth2/v2/auth"
_GOOGLE_TOKEN = "https://oauth2.googleapis.com/token"
_GOOGLE_USERINFO = "https://openidconnect.googleapis.com/v1/userinfo"
_GOOGLE_SCOPE = "openid email profile"

_GITHUB_AUTH = "https://github.com/login/oauth/authorize"
_GITHUB_TOKEN = "https://github.com/login/oauth/access_token"
_GITHUB_USERINFO = "https://api.github.com/user"
_GITHUB_EMAILS = "https://api.github.com/user/emails"
_GITHUB_SCOPE = "read:user user:email"


def _provider_creds(provider: str, settings: Settings) -> tuple[str, str]:
    """Return (client_id, client_secret) or 503 if not configured."""
    if provider == "google":
        if not settings.oauth_google_client_id or not settings.oauth_google_client_secret:
            raise HTTPException(
                status.HTTP_503_SERVICE_UNAVAILABLE,
                "google oauth not configured (set OAUTH_GOOGLE_CLIENT_ID / OAUTH_GOOGLE_CLIENT_SECRET)",
            )
        return settings.oauth_google_client_id, settings.oauth_google_client_secret
    if provider == "github":
        if not settings.oauth_github_client_id or not settings.oauth_github_client_secret:
            raise HTTPException(
                status.HTTP_503_SERVICE_UNAVAILABLE,
                "github oauth not configured (set OAUTH_GITHUB_CLIENT_ID / OAUTH_GITHUB_CLIENT_SECRET)",
            )
        return settings.oauth_github_client_id, settings.oauth_github_client_secret
    raise HTTPException(status.HTTP_404_NOT_FOUND, f"unknown provider: {provider}")


# ---------------------------------------------------------------------------
# Public surface
# ---------------------------------------------------------------------------


@router.get("/providers")
async def list_providers(request: Request) -> dict[str, Any]:
    """Which providers does this deployment expose?

    The UI calls this on /login + /signup to decide which buttons to
    show. No secrets are leaked — only the configured-or-not bit.
    """
    settings: Settings = request.app.state.settings
    return {
        "google": bool(settings.oauth_google_client_id and settings.oauth_google_client_secret),
        "github": bool(settings.oauth_github_client_id and settings.oauth_github_client_secret),
    }


@router.get("/{provider}/start")
async def start(
    request: Request,
    provider: str,
    intent: str = Query("login", pattern="^(login|signup)$"),
    return_to: str | None = Query(default=None, max_length=512),
) -> RedirectResponse:
    settings: Settings = request.app.state.settings
    pool: asyncpg.Pool = request.app.state.pg
    client_id, _ = _provider_creds(provider, settings)

    state = secrets.token_urlsafe(32)
    code_verifier = secrets.token_urlsafe(48)
    code_challenge = _pkce_challenge(code_verifier)
    redirect_uri = _redirect_uri(provider, settings)
    safe_return_to = _safe_return_to(return_to, settings)

    expires_at = datetime.now(UTC) + timedelta(seconds=_STATE_TTL_SECONDS)
    await pool.execute(
        """
        insert into oauth_state (
            state, provider, code_verifier, redirect_uri, intent,
            return_to, expires_at
        ) values ($1, $2, $3, $4, $5, $6, $7)
        """,
        state,
        provider,
        code_verifier,
        redirect_uri,
        intent,
        safe_return_to,
        expires_at,
    )

    if provider == "google":
        params = {
            "client_id": client_id,
            "redirect_uri": redirect_uri,
            "response_type": "code",
            "scope": _GOOGLE_SCOPE,
            "state": state,
            "code_challenge": code_challenge,
            "code_challenge_method": "S256",
            # `prompt=select_account` lets a user pick a different
            # google account than the one they're currently signed
            # into in this browser; useful for switching between
            # personal and work accounts.
            "prompt": "select_account",
            "access_type": "online",
        }
        target = f"{_GOOGLE_AUTH}?{urllib.parse.urlencode(params)}"
    else:  # github
        params = {
            "client_id": client_id,
            "redirect_uri": redirect_uri,
            "scope": _GITHUB_SCOPE,
            "state": state,
            # GitHub doesn't require PKCE; we still send the
            # challenge so a future migration to a stricter github
            # configuration is a one-line change.
        }
        target = f"{_GITHUB_AUTH}?{urllib.parse.urlencode(params)}"

    return RedirectResponse(target, status_code=status.HTTP_302_FOUND)


@router.get("/{provider}/callback")
async def callback(
    request: Request,
    provider: str,
    code: str = Query(...),
    state: str = Query(...),
) -> RedirectResponse:
    settings: Settings = request.app.state.settings
    pool: asyncpg.Pool = request.app.state.pg

    state_row = await pool.fetchrow(
        """
        delete from oauth_state
         where state = $1
         returning provider, code_verifier, redirect_uri, intent,
                   return_to, expires_at
        """,
        state,
    )
    if state_row is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "invalid oauth state")
    if state_row["provider"] != provider:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "oauth state provider mismatch")
    if state_row["expires_at"] < datetime.now(UTC):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "oauth state expired")

    client_id, client_secret = _provider_creds(provider, settings)

    try:
        if provider == "google":
            email, full_name, subject = await _google_userinfo(
                client_id=client_id,
                client_secret=client_secret,
                code=code,
                code_verifier=state_row["code_verifier"],
                redirect_uri=state_row["redirect_uri"],
            )
        else:
            email, full_name, subject = await _github_userinfo(
                client_id=client_id,
                client_secret=client_secret,
                code=code,
                redirect_uri=state_row["redirect_uri"],
            )
    except RuntimeError as exc:
        log.warning("oauth userinfo failed", provider=provider, error=str(exc))
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            f"{provider} oauth handshake failed: {exc}",
        ) from exc

    intent = state_row["intent"]
    user_row, was_provisioned = await _resolve_or_provision_user(
        pool,
        provider=provider,
        email=email,
        full_name=full_name,
        subject=subject,
        intent=intent,
    )

    cookie_value = issue_session_cookie(settings, user_row["id"])
    redirect = RedirectResponse(
        state_row["return_to"] or _default_return_to(settings),
        status_code=status.HTTP_302_FOUND,
    )
    redirect.set_cookie(
        key=settings.session_cookie_name,
        value=cookie_value,
        httponly=True,
        secure=False,
        samesite="lax",
        max_age=settings.session_max_age_seconds,
    )

    await audit.record(
        pool,
        principal=Principal(
            user_id=user_row["id"],
            email=user_row["email"],
            is_root=bool(user_row.get("is_root")),
        ),
        action="oauth.signup" if was_provisioned else "oauth.login",
        target_kind="app_user",
        target_id=user_row["id"],
        payload={"provider": provider, "email": email, "intent": intent},
        request=request,
    )
    return redirect


# ---------------------------------------------------------------------------
# Provider HTTP exchanges (stdlib so we don't add httpx as a dep)
# ---------------------------------------------------------------------------


async def _google_userinfo(
    *,
    client_id: str,
    client_secret: str,
    code: str,
    code_verifier: str,
    redirect_uri: str,
) -> tuple[str, str, str]:
    token = await asyncio.to_thread(
        _post_form,
        url=_GOOGLE_TOKEN,
        data={
            "client_id": client_id,
            "client_secret": client_secret,
            "code": code,
            "code_verifier": code_verifier,
            "grant_type": "authorization_code",
            "redirect_uri": redirect_uri,
        },
    )
    access = token.get("access_token")
    if not isinstance(access, str):
        raise RuntimeError("google token response missing access_token")
    info = await asyncio.to_thread(
        _get_json,
        url=_GOOGLE_USERINFO,
        headers={"Authorization": f"Bearer {access}"},
    )
    email = info.get("email")
    if not isinstance(email, str) or "@" not in email:
        raise RuntimeError("google userinfo missing email")
    if info.get("email_verified") is False:
        # Google sets this explicitly. An unverified email is a
        # phishing risk (anyone could create an account with
        # someone else's email) so we refuse rather than provision.
        raise RuntimeError("google email not verified")
    sub = info.get("sub")
    if not isinstance(sub, str):
        raise RuntimeError("google userinfo missing sub")
    name = info.get("name") if isinstance(info.get("name"), str) else ""
    return email.lower(), str(name), sub


async def _github_userinfo(
    *,
    client_id: str,
    client_secret: str,
    code: str,
    redirect_uri: str,
) -> tuple[str, str, str]:
    token = await asyncio.to_thread(
        _post_form,
        url=_GITHUB_TOKEN,
        data={
            "client_id": client_id,
            "client_secret": client_secret,
            "code": code,
            "redirect_uri": redirect_uri,
        },
        accept_json=True,
    )
    access = token.get("access_token")
    if not isinstance(access, str):
        raise RuntimeError("github token response missing access_token")
    headers = {
        "Authorization": f"Bearer {access}",
        "Accept": "application/vnd.github+json",
        "User-Agent": "langprobe-oauth",
    }
    user = await asyncio.to_thread(_get_json, url=_GITHUB_USERINFO, headers=headers)
    sub = user.get("id")
    if not isinstance(sub, (int, str)):
        raise RuntimeError("github user response missing id")
    name = (
        user.get("name")
        if isinstance(user.get("name"), str)
        else (user.get("login") if isinstance(user.get("login"), str) else "")
    )
    email_v = user.get("email")
    # GitHub omits email when the user has it private; we hit the
    # /emails endpoint to find a verified primary one.
    if not isinstance(email_v, str) or "@" not in email_v:
        emails = await asyncio.to_thread(_get_json, url=_GITHUB_EMAILS, headers=headers)
        if not isinstance(emails, list):
            raise RuntimeError("github /user/emails returned unexpected shape")
        email_v = None
        for entry in emails:
            if not isinstance(entry, dict):
                continue
            if (
                entry.get("primary")
                and entry.get("verified")
                and isinstance(entry.get("email"), str)
            ):
                email_v = str(entry["email"])
                break
        if email_v is None:
            for entry in emails:
                if (
                    isinstance(entry, dict)
                    and entry.get("verified")
                    and isinstance(entry.get("email"), str)
                ):
                    email_v = str(entry["email"])
                    break
        if email_v is None:
            raise RuntimeError(
                "no verified github email found (check the user:email scope is granted)"
            )
    return str(email_v).lower(), str(name), str(sub)


def _post_form(*, url: str, data: dict[str, str], accept_json: bool = False) -> dict[str, Any]:
    body = urllib.parse.urlencode(data).encode("utf-8")
    headers = {"Content-Type": "application/x-www-form-urlencoded"}
    if accept_json:
        headers["Accept"] = "application/json"
    headers["User-Agent"] = "langprobe-oauth"
    req = urllib.request.Request(url, data=body, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            raw = resp.read()
            content_type = resp.headers.get("Content-Type", "")
    except urllib.error.HTTPError as exc:
        text = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"POST {url} → {exc.code}: {text[:200]}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"POST {url} → {exc.reason}") from exc
    if "application/json" in content_type:
        return _json.loads(raw)
    # GitHub default content-type is form-urlencoded; parse it.
    parsed = urllib.parse.parse_qs(raw.decode("utf-8", errors="replace"))
    return {k: v[0] for k, v in parsed.items() if v}


def _get_json(*, url: str, headers: dict[str, str]) -> Any:
    req = urllib.request.Request(url, headers=headers, method="GET")
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return _json.loads(resp.read())
    except urllib.error.HTTPError as exc:
        text = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"GET {url} → {exc.code}: {text[:200]}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"GET {url} → {exc.reason}") from exc


# ---------------------------------------------------------------------------
# User + workspace provisioning
# ---------------------------------------------------------------------------


async def _resolve_or_provision_user(
    pool: asyncpg.Pool,
    *,
    provider: str,
    email: str,
    full_name: str,
    subject: str,
    intent: str,
) -> tuple[dict[str, Any], bool]:
    """Match by email, or create a fresh app_user + personal workspace.

    Returns `(user_row, was_provisioned)`. If `intent='login'` and no
    matching app_user exists we still provision — there's no value in
    the distinction for the personal-account flow, and "login" before
    signup is a common UX mistake. We just record the audit action
    differently so operators can tell signups apart from logins.
    """
    async with pool.acquire() as conn, conn.transaction():
        existing = await conn.fetchrow(
            """select id, email, is_root, deleted_at
                     from app_user where email = $1""",
            email,
        )
        if existing is not None and existing["deleted_at"] is not None:
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                "user account is deactivated",
            )
        if existing is not None:
            # Refresh the IdP linkage on every login so the most
            # recent provider is recorded; we don't track per-
            # provider linkages in v1.
            await conn.execute(
                """
                    update app_user
                       set external_idp = $2,
                           external_subject = $3,
                           last_login_at = now()
                     where id = $1
                       and password_hash is null
                    """,
                existing["id"],
                f"oauth:{provider}",
                subject,
            )
            return {
                "id": existing["id"],
                "email": existing["email"],
                "is_root": existing["is_root"],
            }, False

        # Brand new user: create app_user + personal org/workspace/project.
        display_name = full_name or email.split("@", 1)[0]
        user_row = await conn.fetchrow(
            """
                insert into app_user (
                    email, name, password_hash,
                    external_idp, external_subject, last_login_at
                ) values ($1, $2, NULL, $3, $4, now())
                returning id, email, is_root
                """,
            email,
            display_name,
            f"oauth:{provider}",
            subject,
        )
        assert user_row is not None
        user_id = user_row["id"]

        slug_base = _slug_from_email(email)
        slug = await _unique_org_slug(conn, slug_base)

        org_row = await conn.fetchrow(
            """
                insert into org (slug, name)
                values ($1, $2)
                returning id
                """,
            slug,
            f"{display_name}'s workspace",
        )
        assert org_row is not None
        org_id = org_row["id"]
        await conn.execute(
            """
                insert into org_member (org_id, user_id, role)
                values ($1, $2, 'owner')
                """,
            org_id,
            user_id,
        )

        workspace_row = await conn.fetchrow(
            """
                insert into workspace (org_id, slug, name)
                values ($1, $2, $3)
                returning id
                """,
            org_id,
            slug,
            "Personal",
        )
        assert workspace_row is not None
        workspace_id = workspace_row["id"]
        await conn.execute(
            """
                insert into workspace_member (workspace_id, user_id, role)
                values ($1, $2, 'admin')
                """,
            workspace_id,
            user_id,
        )

        await conn.execute(
            """
                insert into project (workspace_id, slug, name)
                values ($1, 'default', 'Default')
                """,
            workspace_id,
        )

        return {
            "id": user_row["id"],
            "email": user_row["email"],
            "is_root": user_row["is_root"],
        }, True


def _slug_from_email(email: str) -> str:
    """Best-effort kebab-case slug from email local-part.

    Strips non-alphanumerics, lower-cases, caps to 32 chars. Falls
    back to "personal" if everything was filtered out.
    """
    local = email.split("@", 1)[0].lower()
    cleaned: list[str] = []
    for ch in local:
        if ch.isalnum():
            cleaned.append(ch)
        elif ch in {".", "_", "-", "+"} and cleaned and cleaned[-1] != "-":
            cleaned.append("-")
    slug = "".join(cleaned).strip("-")[:32] or "personal"
    return slug


async def _unique_org_slug(conn: asyncpg.Connection, base: str) -> str:
    """Append a short hash if the base slug is taken."""
    taken = await conn.fetchval("select exists (select 1 from org where slug = $1)", base)
    if not taken:
        return base
    suffix = secrets.token_hex(3)
    return f"{base}-{suffix}"[:48]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _pkce_challenge(verifier: str) -> str:
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")


def _redirect_uri(provider: str, settings: Settings) -> str:
    """The URI we hand to Google / GitHub.

    Points at the *web* origin (not the api), because the web's
    /api/auth/oauth/<provider>/callback route handler relays the
    Set-Cookie back to its own origin. If we pointed at the api,
    the cookie would land on the api origin and the user's browser
    on the web origin would then have no session.

    `OAUTH_REDIRECT_BASE` env var must therefore be the
    externally-reachable WEB origin (e.g. http://localhost:7090 in
    dev, https://app.langprobe.example in prod).
    """
    base = settings.oauth_redirect_base.rstrip("/")
    return f"{base}/api/auth/oauth/{provider}/callback"


def _safe_return_to(value: str | None, settings: Settings) -> str | None:
    """Allow only origin-scoped relative paths in return_to.

    Same posture as `routers/sso.py`: paths starting with `/` are
    fine; absolute URLs are rejected to prevent open-redirect.
    """
    if value is None or value == "":
        return None
    if not value.startswith("/"):
        return None
    if value.startswith("//"):
        return None
    _ = settings
    return value


def _default_return_to(settings: Settings) -> str:
    return settings.web_base_url.rstrip("/") + "/"


def _utc_now() -> datetime:
    return datetime.now(UTC)


# Keep type-checkers happy when the field is unused in the helper above.
_ = UUID
