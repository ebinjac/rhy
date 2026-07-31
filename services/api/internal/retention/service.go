package retention

import (
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/rhythm-monitoring/rhythm/internal/runs"
)

type ArtifactStore interface {
	Put(context.Context, string, string, []byte) error
	Get(context.Context, string) (io.ReadCloser, error)
	Delete(context.Context, string) error
}

type RunReader interface {
	Get(context.Context, string) (runs.Run, error)
}

type Service struct {
	pool   *pgxpool.Pool
	runs   RunReader
	store  ArtifactStore
	logger *slog.Logger
	now    func() time.Time
}

func New(pool *pgxpool.Pool, runReader RunReader, store ArtifactStore, logger *slog.Logger) *Service {
	return &Service{pool: pool, runs: runReader, store: store, logger: logger, now: func() time.Time { return time.Now().UTC() }}
}

func (s *Service) Start(ctx context.Context) {
	go func() {
		s.archiveAvailable(ctx)
		s.runMaintenance(ctx)
		archiveTicker := time.NewTicker(time.Minute)
		maintenanceTicker := time.NewTicker(time.Hour)
		defer archiveTicker.Stop()
		defer maintenanceTicker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-archiveTicker.C:
				s.archiveAvailable(ctx)
			case <-maintenanceTicker.C:
				s.runMaintenance(ctx)
			}
		}
	}()
}

func (s *Service) archiveAvailable(ctx context.Context) {
	const batchSize = 500
	for range 4 {
		count, err := s.archiveBatch(ctx, batchSize)
		if err != nil {
			s.logger.Error("archive warm run evidence", "error", err)
			break
		}
		if count < batchSize {
			break
		}
	}
	if err := s.cleanupControlPlane(ctx); err != nil {
		s.logger.Error("clean terminal execution jobs", "error", err)
	}
	if err := s.expireOldRunSummaries(ctx); err != nil {
		s.logger.Error("expire old monitor run summaries", "error", err)
	}
}

func (s *Service) runMaintenance(ctx context.Context) {
	if err := s.refreshDailyRollups(ctx); err != nil {
		s.logger.Error("refresh daily monitor rollups", "error", err)
	}
	if err := s.expireEvidence(ctx); err != nil {
		s.logger.Error("expire old monitoring evidence", "error", err)
	}
}

func (s *Service) archiveBatch(ctx context.Context, limit int) (int, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT mr.id::text
		FROM monitor_runs mr
		LEFT JOIN warm_evidence_manifests warm ON warm.run_id=mr.id
		WHERE mr.created_at<NOW()-INTERVAL '7 days'
		  AND mr.created_at>=NOW()-INTERVAL '30 days'
		  AND mr.status IN ('SUCCESS','SUCCESS_WITH_WARNINGS','FAILED','TIMED_OUT','CANCELLED','ABORTED')
		  AND warm.run_id IS NULL
		  AND EXISTS(SELECT 1 FROM monitor_step_runs step WHERE step.monitor_run_id=mr.id)
		ORDER BY mr.created_at
		LIMIT $1`, limit)
	if err != nil {
		return 0, err
	}
	ids := make([]string, 0, limit)
	for rows.Next() {
		var runID string
		if err := rows.Scan(&runID); err != nil {
			rows.Close()
			return 0, err
		}
		ids = append(ids, runID)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return 0, err
	}
	rows.Close()
	for _, runID := range ids {
		if err := s.archiveRun(ctx, runID); err != nil {
			s.logger.Warn("archive run evidence", "runId", runID, "error", err)
		}
	}
	return len(ids), nil
}

func (s *Service) archiveRun(ctx context.Context, runID string) error {
	run, err := s.runs.Get(ctx, runID)
	if err != nil {
		return err
	}
	encoded, err := json.Marshal(run)
	if err != nil {
		return err
	}
	var compressed bytes.Buffer
	writer := gzip.NewWriter(&compressed)
	if _, err := writer.Write(encoded); err != nil {
		return err
	}
	if err := writer.Close(); err != nil {
		return err
	}
	checksum := sha256.Sum256(compressed.Bytes())
	objectKey := fmt.Sprintf("warm-runs/%s.json.gz", runID)
	if err := s.store.Put(ctx, objectKey, "application/gzip", compressed.Bytes()); err != nil {
		return err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(context.Background()) }()
	if _, err := tx.Exec(ctx, `
		INSERT INTO warm_evidence_manifests(
			run_id,object_key,checksum_sha256,compressed_size_bytes,
			evidence_from,evidence_to,archived_at,expires_at
		) VALUES($1,$2,$3,$4,$5,$6,NOW(),$7)
		ON CONFLICT(run_id) DO NOTHING`,
		runID, objectKey, hex.EncodeToString(checksum[:]), compressed.Len(),
		run.CreatedAt, s.now(), run.CreatedAt.Add(30*24*time.Hour)); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `DELETE FROM run_events WHERE monitor_run_id=$1`, runID); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `DELETE FROM monitor_step_runs WHERE monitor_run_id=$1`, runID); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (s *Service) refreshDailyRollups(ctx context.Context) error {
	_, err := s.pool.Exec(ctx, `
		WITH hourly AS (
			SELECT *
			FROM monitor_metric_rollups_hourly
			WHERE bucket_start>=date_trunc('day',NOW()-INTERVAL '2 days')
			  AND bucket_start<date_trunc('day',NOW())
		), totals AS (
			SELECT monitor_id,bucket_start::date bucket_start,
				SUM(sample_count) sample_count,SUM(success_count) success_count,
				SUM(failure_count) failure_count,SUM(timeout_count) timeout_count,
				SUM(api_response_sum_ms) api_response_sum_ms,
				MIN(api_response_min_ms) api_response_min_ms,
				MAX(api_response_max_ms) api_response_max_ms
			FROM hourly
			GROUP BY monitor_id,bucket_start::date
		), values AS (
			SELECT hourly.monitor_id,hourly.bucket_start::date bucket_start,
				COALESCE(jsonb_agg(element.value::bigint ORDER BY hourly.bucket_start,element.ordinality),'[]'::jsonb)
					api_response_values_ms
			FROM hourly
			CROSS JOIN LATERAL jsonb_array_elements_text(hourly.api_response_values_ms)
				WITH ORDINALITY AS element(value,ordinality)
			GROUP BY hourly.monitor_id,hourly.bucket_start::date
		)
		INSERT INTO monitor_metric_rollups_daily(
			monitor_id,bucket_start,sample_count,success_count,failure_count,
			timeout_count,api_response_sum_ms,api_response_min_ms,
			api_response_max_ms,api_response_values_ms,updated_at
		)
		SELECT totals.monitor_id,totals.bucket_start,totals.sample_count,
			totals.success_count,totals.failure_count,totals.timeout_count,
			totals.api_response_sum_ms,totals.api_response_min_ms,
			totals.api_response_max_ms,COALESCE(values.api_response_values_ms,'[]'::jsonb),NOW()
		FROM totals
		LEFT JOIN values USING (monitor_id,bucket_start)
		ON CONFLICT(monitor_id,bucket_start) DO UPDATE SET
			sample_count=EXCLUDED.sample_count,success_count=EXCLUDED.success_count,
			failure_count=EXCLUDED.failure_count,timeout_count=EXCLUDED.timeout_count,
			api_response_sum_ms=EXCLUDED.api_response_sum_ms,
			api_response_min_ms=EXCLUDED.api_response_min_ms,
			api_response_max_ms=EXCLUDED.api_response_max_ms,
			api_response_values_ms=EXCLUDED.api_response_values_ms,updated_at=NOW()`)
	return err
}

func (s *Service) expireEvidence(ctx context.Context) error {
	rows, err := s.pool.Query(ctx, `
		SELECT run_id::text,object_key FROM warm_evidence_manifests
		WHERE expires_at<NOW() AND restore_state='AVAILABLE'
		LIMIT 500`)
	if err != nil {
		return err
	}
	type expired struct{ runID, key string }
	items := []expired{}
	for rows.Next() {
		var item expired
		if err := rows.Scan(&item.runID, &item.key); err != nil {
			rows.Close()
			return err
		}
		items = append(items, item)
	}
	rows.Close()
	for _, item := range items {
		if err := s.store.Delete(ctx, item.key); err != nil {
			s.logger.Warn("delete expired warm evidence", "runId", item.runID, "error", err)
			continue
		}
		_, _ = s.pool.Exec(ctx, `
			UPDATE warm_evidence_manifests SET restore_state='EXPIRED' WHERE run_id=$1`, item.runID)
	}
	_, err = s.pool.Exec(ctx, `
		DELETE FROM monitor_metric_rollups_hourly WHERE bucket_start<NOW()-INTERVAL '13 months';
		DELETE FROM monitor_metric_rollups_daily WHERE bucket_start<CURRENT_DATE-INTERVAL '13 months'`)
	return err
}

func (s *Service) cleanupControlPlane(ctx context.Context) error {
	_, err := s.pool.Exec(ctx, `
		WITH expired AS (
			SELECT id
			FROM execution_jobs
			WHERE status IN ('SUCCEEDED','FAILED','CANCELLED','DEAD_LETTER')
			  AND completed_at<NOW()-INTERVAL '7 days'
			ORDER BY completed_at
			LIMIT 10000
		)
		DELETE FROM execution_jobs job
		USING expired
		WHERE job.id=expired.id`)
	return err
}

func (s *Service) expireOldRunSummaries(ctx context.Context) error {
	_, err := s.pool.Exec(ctx, `
		WITH expired AS (
			SELECT run.id
			FROM monitor_runs run
			LEFT JOIN warm_evidence_manifests warm ON warm.run_id=run.id
			WHERE run.created_at<NOW()-INTERVAL '30 days'
			  AND run.status IN (
				'SUCCESS','SUCCESS_WITH_WARNINGS','FAILED',
				'TIMED_OUT','CANCELLED','ABORTED'
			  )
			  AND COALESCE(warm.restore_state,'EXPIRED')<>'AVAILABLE'
			ORDER BY run.created_at
			LIMIT 2000
		)
		DELETE FROM monitor_runs run
		USING expired
		WHERE run.id=expired.id`)
	return err
}
