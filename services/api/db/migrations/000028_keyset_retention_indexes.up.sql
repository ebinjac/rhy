-- Keyset pagination indexes keep page latency stable regardless of history depth.
CREATE INDEX IF NOT EXISTS alerts_updated_keyset_idx
    ON alerts (updated_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS deployment_validation_runs_created_keyset_idx
    ON deployment_validation_runs (created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS run_events_sequence_keyset_idx
    ON run_events (monitor_run_id, sequence);

-- BRIN indexes are intentionally small and accelerate time-bounded rollups,
-- archival discovery, and retention scans over append-heavy evidence tables.
CREATE INDEX IF NOT EXISTS monitor_runs_created_brin_idx
    ON monitor_runs USING BRIN (created_at) WITH (pages_per_range = 64);

CREATE INDEX IF NOT EXISTS run_events_occurred_brin_idx
    ON run_events USING BRIN (occurred_at) WITH (pages_per_range = 64);

CREATE INDEX IF NOT EXISTS browser_runs_created_brin_idx
    ON browser_runs USING BRIN (created_at) WITH (pages_per_range = 64);

CREATE INDEX IF NOT EXISTS elf_runs_created_brin_idx
    ON elf_runs USING BRIN (created_at) WITH (pages_per_range = 64);

CREATE INDEX IF NOT EXISTS dynatrace_runs_created_brin_idx
    ON dynatrace_runs USING BRIN (created_at) WITH (pages_per_range = 64);

CREATE INDEX IF NOT EXISTS deployment_validation_runs_created_brin_idx
    ON deployment_validation_runs USING BRIN (created_at) WITH (pages_per_range = 64);
