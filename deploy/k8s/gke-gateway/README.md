# gke-gateway

Gateway API resources that route public internet traffic to `langprobe-web`
on the Autopilot cluster. Applied with plain `kubectl` — **not** managed by
the Helm chart (the chart's Ingress doesn't fit modern Autopilot, which only
supports Gateway API).

## Prerequisites (one-time, in Phase B of bootstrap)

1. Reserve a global static IP:
   ```bash
   gcloud compute addresses create langprobe-web-ip --global \
     --project=project-c4ff4ea3-775a-4e0c-9a3
   ```
2. Enable Certificate Manager API:
   ```bash
   gcloud services enable certificatemanager.googleapis.com \
     --project=project-c4ff4ea3-775a-4e0c-9a3
   ```
3. Create the managed cert + map (substitute the real domain):
   ```bash
   gcloud certificate-manager certificates create langprobe-web-cert \
     --domains=langprobe.daz.co.in \
     --project=project-c4ff4ea3-775a-4e0c-9a3

   gcloud certificate-manager maps create langprobe-web-certmap \
     --project=project-c4ff4ea3-775a-4e0c-9a3

   gcloud certificate-manager maps entries create langprobe-web-certmap-entry \
     --map=langprobe-web-certmap \
     --certificates=langprobe-web-cert \
     --hostname=langprobe.daz.co.in \
     --project=project-c4ff4ea3-775a-4e0c-9a3
   ```
4. Add a DNS A record at your registrar pointing the host (e.g.
   `langprobe.daz.co.in`) at the static IP from step 1.

## Apply

```bash
kubectl apply -n langprobe -f deploy/k8s/gke-gateway/
```

The directory contains:

- `gateway.yaml` — the GKE-managed L7 LB (HTTP+HTTPS listeners on the static IP).
- `httproute.yaml` — routes `langprobe.daz.co.in/*` to the `langprobe-web` Service.
- `healthcheckpolicy.yaml` — points the GCP backend health check at `/login`
  instead of the default `/`. Without it, `/` returns 307 → LB marks the
  backend UNHEALTHY → public domain serves "no healthy upstream" 503s.

## Wait for provisioning

```bash
kubectl -n langprobe get gateway langprobe-web -w
```

`PROGRAMMED=True` and an `ADDRESS` matching the static IP means the LB is
live. Cert provisioning is separate — check with:

```bash
gcloud certificate-manager certificates describe langprobe-web-cert \
  --project=project-c4ff4ea3-775a-4e0c-9a3 \
  --format="value(managed.state)"
```

`ACTIVE` means the cert has finished its DNS challenge and HTTPS will work.
First-time provisioning is typically 10–30 minutes after DNS resolves.

## Why not the Helm chart's Ingress?

The chart's `Ingress` template uses `ingressClassName: gce`, which depends
on the legacy Ingress-V1 controller. GKE Autopilot clusters created with
Gateway API enabled (the modern default) don't ship that controller, so the
Ingress sits forever with no `Address`. Gateway is the supported path.

When/if we add a managed Postgres + multi-environment story, the Gateway
resources should move into the chart as templates (gated by a values flag),
or we should adopt a separate gateway chart. For now: ship-shape but
deliberately decoupled.
