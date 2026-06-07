"""Operator entry point.

Wires kopf handlers to the Tracebility CRD. Run via:

  tracebility-operator
  # or, equivalently, while developing:
  python -m kopf run -A --standalone -m tracebility_operator.main

Why kopf over building from `kubernetes`-only? Kopf gives us the
boring stuff for free: leader-election when we add it, finalizers,
status subresource updates, retry-with-backoff. We could roll those
ourselves but every team that does spends six months getting it
wrong before shipping anything else.
"""

from __future__ import annotations

import logging
from typing import Any

import kopf

from .reconciler import build_manifests, reconcile

log = logging.getLogger("tracebility.operator")


def main() -> None:
    """Stand-alone operator entry-point (used by the CLI script).

    For most production deployments, run via `kopf run` so the
    framework owns its own asyncio event loop. We keep this as a
    convenience wrapper.
    """
    import asyncio

    import kopf as _kopf

    asyncio.run(_kopf.operator())


# ---------------------------------------------------------------------------
# Reconciliation handlers
# ---------------------------------------------------------------------------


@kopf.on.startup()
async def configure(settings: kopf.OperatorSettings, **_: Any) -> None:
    # Bound retries — telemetry should not fight an obviously broken
    # API server forever.
    settings.posting.level = logging.INFO
    settings.persistence.finalizer = "tracebility.io/finalizer"
    settings.networking.error_backoffs = [10, 30, 60]


@kopf.on.create("tracebility.io", "v1alpha1", "tracebilities")
@kopf.on.update("tracebility.io", "v1alpha1", "tracebilities")
@kopf.on.resume("tracebility.io", "v1alpha1", "tracebilities")
async def on_change(
    spec: dict[str, Any],
    name: str,
    namespace: str,
    patch: kopf.Patch,
    logger: logging.Logger,
    **_: Any,
) -> None:
    """Reconcile a Tracebility resource into Deployments/Services/Ingress.

    Idempotent: re-applies on every change. Drift between the live
    cluster state and the spec is corrected by the next reconcile.
    """
    logger.info("reconciling tracebility/%s in %s", name, namespace)
    summary = await reconcile(name=name, namespace=namespace, spec=spec)
    patch.status["phase"] = "Ready" if summary.ok else "Error"
    patch.status["message"] = summary.message
    patch.status["lastReconciled"] = summary.timestamp


@kopf.on.delete("tracebility.io", "v1alpha1", "tracebilities")
async def on_delete(
    name: str,
    namespace: str,
    logger: logging.Logger,
    **_: Any,
) -> None:
    """Tear down the deployments owned by this CR.

    We rely on owner-references to handle most cleanup automatically
    (the Deployments / Services / Ingress carry an ownerReferences
    block back to the Tracebility CR), but we still emit a log line
    so operators can see the deletion path in operator logs.
    """
    logger.info("deleting tracebility/%s in %s (owner-references will cascade)", name, namespace)


# Re-export for tooling that imports the top-level handlers.
__all__ = ["main", "configure", "on_change", "on_delete", "build_manifests"]
