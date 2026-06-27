# Multi-tenancy stream-sharding cutover

**Companion to:** [multi-tenancy-spec.md](./multi-tenancy-spec.md) §5.6, §9 step 9.

## What this changes

Pre-cutover, ingest-api wrote to a single Redis stream
`langprobe:ingest:v1`. Post-cutover, ingest-api writes to N=16 sharded
streams `langprobe:ingest:v1:{0..15}` keyed by `hash(org_id) % 16`. One
runaway tenant fills its shard, not the whole stream.

## Sequencing (no-data-loss)

The deploy of ingest-api (Phase 5) and ingest-worker (Phase 6) can land
in either order, because:

- **Worker dual-reads.** `dual_read_legacy=True` (the default) means the
  worker consumes from both the 16 shards AND the legacy stream. So an
  envelope written by old-ingest-api still gets drained.
- **API stamps tenant fields.** Phase 5 ingest-api always writes to a
  shard, never the legacy stream. The legacy stream is therefore
  guaranteed to be monotonically draining once the new API is rolled out.

**Recommended order:**

1. Deploy ingest-worker (Phase 6) first. Workers start dual-reading;
   nothing user-visible changes because old-ingest-api is still writing
   to the legacy stream.
2. Deploy ingest-api (Phase 5). New envelopes start landing on the
   sharded streams. Legacy stream now has only in-flight tail.
3. Wait for `XLEN langprobe:ingest:v1` to reach 0 (typical: minutes).
4. Set `LANGPROBE_INGEST_DUAL_READ_LEGACY=false` and roll the worker.
   Optionally `XADD langprobe:ingest:v1 MAXLEN 0` to clear residue.

## Verifying the cutover

```bash
# Ingest-api should be writing to shards.
redis-cli XLEN langprobe:ingest:v1:0
redis-cli XLEN langprobe:ingest:v1:7

# Legacy stream should monotonically decrease then plateau at 0.
watch redis-cli XLEN langprobe:ingest:v1

# Per-shard backlog skew (the `weighted_map` reactivation trigger)
for i in $(seq 0 15); do
    printf "shard %2d: " "$i"
    redis-cli XLEN "langprobe:ingest:v1:$i"
done
```

## Backlog-skew alert (the `weighted_map` reactivation trigger)

Spec §5.6 leaves a **TODO**: when a single tenant saturates one shard for
sustained periods, replace uniform hash with a weighted shard map. The
trigger is operational, not algorithmic — alert when:

- Any single shard's `XLEN` is 5x the median across shards
- AND that imbalance persists for 10+ minutes
- AND CPU on the worker pod consuming that shard is pinned

When the alert fires, capture which `org_id` is dominating that shard
(`SELECT org_id, count() FROM run WHERE start_time > now() - 600 GROUP
BY org_id ORDER BY count() DESC LIMIT 5`) and start the weighted-map
project.

## DLQ

Each shard has its own DLQ: `langprobe:ingest:v1:<shard>:dlq`. The
legacy stream's DLQ is `langprobe:ingest:v1:dlq`. After the cutover,
sweep both DLQs into the per-shard DLQ for whichever shard the org's
`org_id` would hash to (or just inspect manually — DLQs are low-volume
by design).

## Rollback

If something goes wrong with the new ingest-api:

1. Roll ingest-api back to the pre-Phase-5 image.
2. Old ingest-api writes to the legacy stream; the dual-reading worker
   keeps draining both. No data is lost.

If the worker is the problem:

1. Roll ingest-worker back. Pre-Phase-6 worker only reads the legacy
   stream — it will leave envelopes on the sharded streams pending.
2. Once a Phase-6 worker is back online, those pending envelopes drain.
   ReplacingMergeTree collapses any duplicate that snuck through the
   pre-Phase-6 path.
