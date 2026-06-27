# Langprobe Kubernetes operator

Reconciles a `Langprobe` Custom Resource into the four-deployment
shape the [Helm chart](../helm/langprobe) ships:
api / ingest-api / ingest-worker / web.

## When to use the operator vs. the Helm chart

- **Helm**: a single langprobe install, one cluster, manual
  upgrades. Simpler.
- **Operator**: many langprobe installs across many namespaces,
  GitOps-driven, declarative upgrades. Ergonomic for fleet
  management.

## Install

```bash
# 1) Install the CRD.
kubectl apply -f deploy/operator/crd.yaml

# 2) Install the operator (cluster-scoped service account so it can
#    manage Deployments/Services in any namespace that hosts a CR).
kubectl apply -f deploy/operator/operator-deployment.yaml

# 3) Pre-create the four secrets in your target namespace.
kubectl create secret generic langprobe-postgres \
  --from-literal=dsn='postgres://user:pass@host:5432/langprobe'
# ...etc.

# 4) Apply your CR.
kubectl apply -f deploy/operator/example-cr.yaml
```

## What it manages

- `Deployment` × 4 (api, ingest-api, ingest-worker, web)
- `Service` × 3 (api, ingest-api, web)
- `PersistentVolumeClaim` × 1 (ingest-api disk buffer)
- `Ingress` × 1 (optional; one Ingress with up to three hosts)

Owner-references on every child object so deleting the CR cascades
to all of them.

## What it does NOT manage

- Postgres, ClickHouse, Redis. References these by `secret` name.
  Production almost always wants managed Postgres + managed
  ClickHouse, and bundling them in the operator would make that
  worse.
- Network policy, certificate provisioning, monitoring. Plug those
  in via your usual cluster baseline.

## Development

The reconciler is unit-testable without a cluster:

```python
from langprobe_operator import build_manifests

spec = {"api": {"replicas": 1}, "secrets": {...}}
mans = build_manifests(name="dev", namespace="default", spec=spec)
assert any(m["kind"] == "Deployment" for m in mans)
```

`reconcile(...)` is the apply path; it lazy-imports the kubernetes
client so the manifest builder stays test-friendly.
