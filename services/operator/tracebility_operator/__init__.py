"""Tracebility Kubernetes operator.

Reconciles a Tracebility CRD into the four-deployment shape the Helm
chart already ships: api / ingest-api / ingest-worker / web. The
operator is the right surface when you want declarative, GitOps-
friendly upgrades across many tracebility installs in one cluster.
For a single-install setup, the Helm chart is simpler.

Storage deps (Postgres / ClickHouse / Redis) are referenced by
secret name; the operator does NOT manage them. Production almost
always wants managed Postgres + managed ClickHouse, and bundling
them in the operator would make that strictly worse.
"""

from .reconciler import build_manifests, reconcile

__all__ = ["build_manifests", "reconcile"]
__version__ = "0.0.1"
