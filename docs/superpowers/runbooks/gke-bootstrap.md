# GKE bootstrap runbook

One-time setup before the `deploy` workflow can run. Idempotent: re-running
should be a no-op (commands either succeed or report "already exists").

Replace nothing in this runbook with shell variables — all values are
hard-coded so re-runs are deterministic.

## Prerequisites

- `gcloud` authenticated as a user with project-owner-equivalent perms on
  `project-c4ff4ea3-775a-4e0c-9a3`.
- `kubectl` installed.
- GKE cluster `tracebility-cluster-1` already exists in `asia-southeast2`.

## 1. Enable APIs

```bash
gcloud services enable \
  iamcredentials.googleapis.com \
  sts.googleapis.com \
  container.googleapis.com \
  artifactregistry.googleapis.com \
  --project=project-c4ff4ea3-775a-4e0c-9a3
```

## 2. Create the Artifact Registry repo

```bash
gcloud artifacts repositories create tracebility \
  --repository-format=docker \
  --location=asia-southeast2 \
  --description="tracebility container images" \
  --project=project-c4ff4ea3-775a-4e0c-9a3
```

If it already exists, `gcloud` returns `ALREADY_EXISTS`; ignore.

## 3. Create the deploy service account

```bash
gcloud iam service-accounts describe \
  tracebility-deploy@project-c4ff4ea3-775a-4e0c-9a3.iam.gserviceaccount.com \
  --project=project-c4ff4ea3-775a-4e0c-9a3 >/dev/null 2>&1 \
  || gcloud iam service-accounts create tracebility-deploy \
       --display-name="GitHub Actions deploy SA" \
       --project=project-c4ff4ea3-775a-4e0c-9a3
```

Email: `tracebility-deploy@project-c4ff4ea3-775a-4e0c-9a3.iam.gserviceaccount.com`.

## 4. Grant minimum IAM

```bash
SA=tracebility-deploy@project-c4ff4ea3-775a-4e0c-9a3.iam.gserviceaccount.com

gcloud artifacts repositories add-iam-policy-binding tracebility \
  --location=asia-southeast2 \
  --member="serviceAccount:${SA}" \
  --role=roles/artifactregistry.writer \
  --project=project-c4ff4ea3-775a-4e0c-9a3

gcloud projects add-iam-policy-binding project-c4ff4ea3-775a-4e0c-9a3 \
  --member="serviceAccount:${SA}" \
  --role=roles/container.developer

gcloud projects add-iam-policy-binding project-c4ff4ea3-775a-4e0c-9a3 \
  --member="serviceAccount:${SA}" \
  --role=roles/container.clusterViewer
```

The cluster's node pools also need read access to Artifact Registry so
kubelet can pull the images we push. On Autopilot the node identity is
the project's default compute service account:

```bash
PROJECT_NUMBER=$(gcloud projects describe project-c4ff4ea3-775a-4e0c-9a3 --format='value(projectNumber)')
gcloud artifacts repositories add-iam-policy-binding tracebility \
  --location=asia-southeast2 \
  --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
  --role=roles/artifactregistry.reader \
  --project=project-c4ff4ea3-775a-4e0c-9a3
```

Without this binding pods land in `ImagePullBackOff` with `403 Forbidden`
even though the deploy SA can push to AR fine. Default GCE compute SA
permissions cover most things but not cross-project / cross-region AR
reads, and they don't include AR reader on a freshly-created repo.

## 5. Create the WIF pool and provider

```bash
gcloud iam workload-identity-pools describe github-actions-pool \
  --location=global \
  --project=project-c4ff4ea3-775a-4e0c-9a3 >/dev/null 2>&1 \
  || gcloud iam workload-identity-pools create github-actions-pool \
       --location=global \
       --display-name="GitHub Actions" \
       --project=project-c4ff4ea3-775a-4e0c-9a3

gcloud iam workload-identity-pools providers describe github-actions-provider \
  --workload-identity-pool=github-actions-pool \
  --location=global \
  --project=project-c4ff4ea3-775a-4e0c-9a3 >/dev/null 2>&1 \
  || gcloud iam workload-identity-pools providers create-oidc github-actions-provider \
       --workload-identity-pool=github-actions-pool \
       --location=global \
       --issuer-uri=https://token.actions.githubusercontent.com \
       --attribute-mapping=google.subject=assertion.sub,attribute.repository=assertion.repository \
       --attribute-condition='assertion.repository == "tracebility-ai/tracebility"' \
       --project=project-c4ff4ea3-775a-4e0c-9a3
```

## 6. Bind WIF principal → deploy SA

```bash
PROJECT_NUMBER=$(gcloud projects describe project-c4ff4ea3-775a-4e0c-9a3 --format='value(projectNumber)')

gcloud iam service-accounts add-iam-policy-binding \
  tracebility-deploy@project-c4ff4ea3-775a-4e0c-9a3.iam.gserviceaccount.com \
  --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/github-actions-pool/attribute.repository/tracebility-ai/tracebility" \
  --project=project-c4ff4ea3-775a-4e0c-9a3
```

```bash
# Print the full WIF provider resource name to copy into GitHub Variables:
echo "projects/$(gcloud projects describe project-c4ff4ea3-775a-4e0c-9a3 --format='value(projectNumber)')/locations/global/workloadIdentityPools/github-actions-pool/providers/github-actions-provider"
```

## 7. Get cluster credentials

```bash
gcloud container clusters get-credentials tracebility-cluster-1 \
  --region=asia-southeast2 \
  --project=project-c4ff4ea3-775a-4e0c-9a3
```

## 8. Create namespace + dev-deps

```bash
kubectl create namespace tracebility --dry-run=client -o yaml | kubectl apply -f -
kubectl apply -n tracebility -f deploy/k8s/dev-deps/
kubectl rollout status -n tracebility deployment/postgres deployment/clickhouse deployment/redis --timeout=180s
```

## 9. Create k8s secrets

```bash
kubectl -n tracebility create secret generic tracebility-postgres \
  --from-literal=dsn="postgres://tracebility:tracebility@postgres:5432/tracebility" \
  --dry-run=client -o yaml | kubectl apply -f -

kubectl -n tracebility create secret generic tracebility-clickhouse \
  --from-literal=url="http://tracebility:tracebility@clickhouse:8123/tracebility" \
  --dry-run=client -o yaml | kubectl apply -f -

kubectl -n tracebility create secret generic tracebility-redis \
  --from-literal=url="redis://redis:6379/0" \
  --dry-run=client -o yaml | kubectl apply -f -

kubectl -n tracebility get secret tracebility-session >/dev/null 2>&1 \
  || kubectl -n tracebility create secret generic tracebility-session \
       --from-literal=secret="$(openssl rand -hex 32)"
```

Re-running the runbook will not regenerate the session secret.

## 10. Set GitHub repo variables

In GitHub: **Settings → Secrets and variables → Actions → Variables**.

| Name | Value |
|---|---|
| `WIF_PROVIDER` | Output of the `echo` command in Step 6. |
| `DEPLOY_SA_EMAIL` | `tracebility-deploy@project-c4ff4ea3-775a-4e0c-9a3.iam.gserviceaccount.com` |

These are repository **variables**, not secrets — neither value is sensitive
on its own (they're discoverable from any successful deploy log).

## 11. Verify

```bash
gcloud artifacts repositories describe tracebility --location=asia-southeast2
gcloud iam service-accounts describe tracebility-deploy@project-c4ff4ea3-775a-4e0c-9a3.iam.gserviceaccount.com
gcloud iam workload-identity-pools providers describe github-actions-provider \
  --workload-identity-pool=github-actions-pool --location=global
kubectl -n tracebility get pods,svc,secret
```

All commands should exit zero. The four secrets `tracebility-postgres`,
`-clickhouse`, `-redis`, `-session` should be present.
