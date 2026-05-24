-- 0004_dataset_items.sql
-- Rows belonging to a dataset. Each item is an input (and optional reference
-- output) used for offline eval / regression suites.

create table if not exists dataset_item
(
    project_id        UUID,
    -- references postgres dataset.id
    dataset_id        UUID,
    item_id           UUID,
    -- arbitrary input shape (json string for flexibility)
    input             String,
    -- reference output / golden answer (optional)
    expected          String,
    -- arbitrary metadata, including category / tags / source span
    metadata          String,
    -- if the item came from a real run, point back at it
    source_run_id     Nullable(UUID),
    source_span_id    Nullable(UUID),
    created_at        DateTime64(9, 'UTC') default now64(9),
    -- tombstone soft delete (we don't issue real deletes for audit reasons)
    deleted_at        Nullable(DateTime64(9, 'UTC')),
    schema_version    UInt8 default 1
)
engine = ReplacingMergeTree(created_at)
partition by toYYYYMM(created_at)
order by (project_id, dataset_id, item_id)
settings index_granularity = 8192;
