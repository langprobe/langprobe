# dev-deps

Ephemeral, single-replica Postgres / ClickHouse / Redis applied directly with
`kubectl` — **not** managed by the Helm chart.

Purpose: let the first GKE deploy of `tracebility` reach Ready without
requiring managed databases up front. Storage is `emptyDir`; deleting a pod
loses the data.

## Apply

```bash
kubectl apply -n tracebility -f deploy/k8s/dev-deps/
```

## Replace with managed services

Edit the three k8s secrets created during bootstrap to point at the new
endpoints, then `kubectl rollout restart deploy -n tracebility`:

- `tracebility-postgres` (key `dsn`)
- `tracebility-clickhouse` (key `url`)
- `tracebility-redis` (key `url`)

(`tracebility-session` is unrelated — it stays.)

Once switched, delete the dev-deps:

```bash
kubectl delete -n tracebility -f deploy/k8s/dev-deps/
```

## Why not StatefulSets?

A StatefulSet + PVC is the right answer when you actually want the data to
survive a pod restart. The premise of dev-deps is "you'll replace these
within a week" — adding PVCs adds GCE Persistent Disks that you then have to
remember to delete. `emptyDir` makes the disposable nature explicit.
