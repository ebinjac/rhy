-- Capacity indexes for batched scheduling, look-ahead scaling, and executor
-- lease protection. They are additive so the same migration is safe for both
-- local Compose and managed PostgreSQL in Hydra.
CREATE INDEX IF NOT EXISTS monitor_schedules_hydra_due_idx
    ON monitor_schedules (next_run_at, id)
    INCLUDE (monitor_id, schedule_type, interval_seconds, active)
    WHERE active = TRUE;

CREATE INDEX IF NOT EXISTS execution_jobs_hydra_lease_monitor_idx
    ON execution_jobs ((payload_json ->> 'monitorId'), lease_expires_at)
    WHERE status = 'LEASED' AND job_type = 'API_MONITOR_RUN';

CREATE INDEX IF NOT EXISTS execution_jobs_hydra_capacity_idx
    ON execution_jobs (job_type, status, queue_class, available_at, created_at)
    WHERE job_type = 'API_MONITOR_RUN' AND status IN ('QUEUED', 'LEASED');

CREATE INDEX IF NOT EXISTS execution_job_outbox_hydra_publish_idx
    ON execution_job_outbox (available_at, created_at)
    INCLUDE (id, job_id, stream_name)
    WHERE published_at IS NULL;
