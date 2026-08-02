package browsermonitors

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"math"
	"net/url"
	"os"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"

	"github.com/rhythm-monitoring/rhythm/internal/id"
	"github.com/rhythm-monitoring/rhythm/internal/library"
	queueutil "github.com/rhythm-monitoring/rhythm/internal/queue"
	"github.com/rhythm-monitoring/rhythm/internal/secretscrypto"
)

var (
	ErrNotFound = errors.New("browser monitor was not found")
	ErrConflict = errors.New("browser monitor already exists")
)

var secretTemplatePattern = regexp.MustCompile(`\{\{\s*secrets\.([A-Za-z0-9_.:-]+)\s*\}\}`)

const (
	browserExecutionStream     = "rhythm:execution:browser"
	browserConsumerGroup       = "rhythm-browser-dispatchers"
	maxBrowserArtifactBytes    = int64(10 << 20)
	maxBrowserArtifactsPerRun  = 128
	browserArtifactURLLifetime = 15 * time.Minute
)

type browserArtifactUploadSlot struct {
	ID        string
	ObjectKey string
	MaxBytes  int64
}

type Service struct {
	pool          *pgxpool.Pool
	library       *library.Service
	runner        Runner
	artifacts     ArtifactStore
	encryptionKey []byte
	now           func() time.Time
	cancelMu      sync.Mutex
	cancels       map[string]context.CancelFunc
	queueRedis    redis.UniversalClient
	logger        *slog.Logger
	workerID      string
	jobSlots      chan struct{}
	queueOnce     sync.Once
}

func New(pool *pgxpool.Pool, profiles *library.Service, runner Runner, artifacts ArtifactStore, encryptionKey string) (*Service, error) {
	var key []byte
	var err error
	if strings.TrimSpace(encryptionKey) != "" {
		key, err = secretscrypto.ParseKey(encryptionKey)
		if err != nil {
			return nil, err
		}
	}
	return &Service{
		pool:          pool,
		library:       profiles,
		runner:        runner,
		artifacts:     artifacts,
		encryptionKey: key,
		now:           func() time.Time { return time.Now().UTC() },
		cancels:       map[string]context.CancelFunc{},
	}, nil
}

func (s *Service) ConfigureQueue(redisClient redis.UniversalClient, logger *slog.Logger, concurrency int) {
	if redisClient == nil {
		return
	}
	if concurrency < 1 {
		concurrency = 8
	}
	if logger == nil {
		logger = slog.Default()
	}
	hostname, _ := os.Hostname()
	s.queueRedis = redisClient
	s.logger = logger
	s.workerID = fmt.Sprintf("%s-%d", hostname, os.Getpid())
	s.jobSlots = make(chan struct{}, concurrency)
}

func (s *Service) startQueue(ctx context.Context) {
	if s.queueRedis == nil {
		return
	}
	s.queueOnce.Do(func() {
		if err := s.queueRedis.XGroupCreateMkStream(ctx, browserExecutionStream, browserConsumerGroup, "0").Err(); err != nil &&
			!strings.Contains(err.Error(), "BUSYGROUP") {
			s.logger.Error("create browser execution consumer group", "error", err)
		}
		go s.consumeBrowserJobs(ctx)
		go s.reapExpiredBrowserJobs(ctx)
	})
}

func (s *Service) consumeBrowserJobs(ctx context.Context) {
	consumer := s.workerID + "-browser"
	for ctx.Err() == nil {
		streams, err := s.queueRedis.XReadGroup(ctx, &redis.XReadGroupArgs{
			Group: browserConsumerGroup, Consumer: consumer,
			Streams: []string{browserExecutionStream, ">"},
			Count:   16, Block: 2 * time.Second,
		}).Result()
		if errors.Is(err, redis.Nil) || errors.Is(err, context.Canceled) {
			continue
		}
		if err != nil {
			s.logger.Error("read browser execution stream", "error", err)
			continue
		}
		for _, stream := range streams {
			for _, message := range stream.Messages {
				jobID, _ := message.Values["jobId"].(string)
				if jobID == "" {
					_ = queueutil.AcknowledgeAndDelete(ctx, s.queueRedis, browserExecutionStream, browserConsumerGroup, message.ID)
					continue
				}
				select {
				case s.jobSlots <- struct{}{}:
					go s.processBrowserJob(ctx, message.ID, jobID)
				case <-ctx.Done():
					return
				}
			}
		}
	}
}

func (s *Service) processBrowserJob(parent context.Context, messageID, jobID string) {
	defer func() { <-s.jobSlots }()
	runID, claimed, err := s.claimBrowserJob(parent, jobID)
	if err != nil {
		s.logger.Error("claim browser execution job", "jobId", jobID, "error", err)
		return
	}
	if !claimed {
		_ = queueutil.AcknowledgeAndDelete(parent, s.queueRedis, browserExecutionStream, browserConsumerGroup, messageID)
		return
	}
	runCtx, cancel := context.WithCancel(parent)
	defer cancel()
	done := make(chan struct{})
	cancelRequested := make(chan struct{}, 1)
	go s.watchBrowserJob(runCtx, done, jobID, cancel, cancelRequested)
	runErr := s.executeQueuedBrowserRun(runCtx, runID)
	close(done)
	if parent.Err() != nil {
		return
	}
	cancelled := len(cancelRequested) > 0
	if completeErr := s.completeBrowserJob(context.WithoutCancel(parent), jobID, runID, runErr, cancelled); completeErr != nil {
		s.logger.Error("complete browser execution job", "jobId", jobID, "runId", runID, "error", completeErr)
		return
	}
	if err := queueutil.AcknowledgeAndDelete(context.WithoutCancel(parent), s.queueRedis, browserExecutionStream, browserConsumerGroup, messageID); err != nil {
		s.logger.Error("acknowledge browser execution job", "jobId", jobID, "error", err)
	}
}

func (s *Service) claimBrowserJob(ctx context.Context, jobID string) (string, bool, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return "", false, err
	}
	defer func() { _ = tx.Rollback(context.Background()) }()
	var runID, status string
	err = tx.QueryRow(ctx, `
		SELECT COALESCE(browser_run_id::text,''),status
		FROM execution_jobs
		WHERE id=$1 AND job_type='BROWSER_MONITOR_RUN'
		FOR UPDATE`, jobID).Scan(&runID, &status)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", false, nil
	}
	if err != nil {
		return "", false, err
	}
	if status != "QUEUED" {
		return runID, false, tx.Commit(ctx)
	}
	command, err := tx.Exec(ctx, `
		UPDATE execution_jobs
		SET status='LEASED',lease_owner=$2,lease_expires_at=NOW()+INTERVAL '150 seconds',
			attempt_count=attempt_count+1,started_at=COALESCE(started_at,NOW()),updated_at=NOW()
		WHERE id=$1 AND status='QUEUED' AND cancel_requested_at IS NULL`, jobID, s.workerID)
	if err != nil {
		return "", false, err
	}
	return runID, command.RowsAffected() == 1, tx.Commit(ctx)
}

func (s *Service) watchBrowserJob(
	ctx context.Context,
	done <-chan struct{},
	jobID string,
	cancel context.CancelFunc,
	cancelRequested chan<- struct{},
) {
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-done:
			return
		case <-ticker.C:
			var requested bool
			err := s.pool.QueryRow(ctx, `
				UPDATE execution_jobs
				SET lease_expires_at=NOW()+INTERVAL '150 seconds',updated_at=NOW()
				WHERE id=$1 AND status='LEASED' AND lease_owner=$2
				RETURNING cancel_requested_at IS NOT NULL`, jobID, s.workerID).Scan(&requested)
			if errors.Is(err, pgx.ErrNoRows) {
				cancel()
				return
			}
			if err != nil {
				s.logger.Warn("refresh browser execution lease", "jobId", jobID, "error", err)
				continue
			}
			if requested {
				select {
				case cancelRequested <- struct{}{}:
				default:
				}
				cancel()
				return
			}
		}
	}
}

func (s *Service) executeQueuedBrowserRun(ctx context.Context, runID string) error {
	run, err := s.GetRun(ctx, runID)
	if err != nil {
		return err
	}
	monitor, err := s.Get(ctx, run.MonitorID)
	if err != nil {
		return err
	}
	revision, err := s.GetRevision(ctx, run.MonitorID, run.RevisionID)
	if err != nil {
		return err
	}
	s.execute(ctx, monitor, revision, runID)
	return nil
}

func (s *Service) completeBrowserJob(ctx context.Context, jobID, runID string, runErr error, cancelled bool) error {
	status := "SUCCEEDED"
	if cancelled {
		status = "CANCELLED"
	} else if runErr != nil {
		status = "FAILED"
		s.finishFailure(runID, s.now(), "WORKER_LOST", "Browser execution stopped before a terminal result could be recorded.", "")
	}
	_, err := s.pool.Exec(ctx, `
		UPDATE execution_jobs
		SET status=$2,completed_at=NOW(),lease_owner=NULL,lease_expires_at=NULL,
			last_error=NULLIF($3,''),updated_at=NOW()
		WHERE id=$1 AND lease_owner=$4`,
		jobID, status, safeError(runErr), s.workerID)
	return err
}

func (s *Service) reapExpiredBrowserJobs(ctx context.Context) {
	ticker := time.NewTicker(15 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			tx, err := s.pool.Begin(ctx)
			if err != nil {
				continue
			}
			rows, err := tx.Query(ctx, `
				SELECT id::text,COALESCE(browser_run_id::text,'')
				FROM execution_jobs
				WHERE job_type='BROWSER_MONITOR_RUN' AND status='LEASED' AND lease_expires_at<NOW()
				ORDER BY lease_expires_at
				FOR UPDATE SKIP LOCKED LIMIT 50`)
			if err != nil {
				_ = tx.Rollback(ctx)
				continue
			}
			type expiredJob struct{ jobID, runID string }
			expired := make([]expiredJob, 0, 50)
			for rows.Next() {
				var item expiredJob
				if rows.Scan(&item.jobID, &item.runID) == nil {
					expired = append(expired, item)
				}
			}
			rows.Close()
			for _, item := range expired {
				_, _ = tx.Exec(ctx, `
					UPDATE execution_jobs
					SET status='FAILED',completed_at=NOW(),lease_owner=NULL,lease_expires_at=NULL,
						last_error='Browser worker lease expired; the journey was not replayed.',updated_at=NOW()
					WHERE id=$1`, item.jobID)
				_, _ = tx.Exec(ctx, `
					UPDATE browser_runs
					SET status='ABORTED',ended_at=NOW(),
						duration_ms=GREATEST(0,EXTRACT(EPOCH FROM (NOW()-created_at))*1000)::bigint,
						failure_category='AGENT_LOST',
						failure_reason='The browser worker lease expired. Rhythm did not replay the journey because it may contain side effects.'
					WHERE id=$1 AND status IN ('QUEUED','STARTING','RUNNING','ANALYZING')`, item.runID)
			}
			_ = tx.Commit(ctx)
		}
	}
}

const monitorColumns = `
	m.id::text,m.name,m.slug,m.description,COALESCE(m.application_id::text,''),COALESCE(a.name,''),
	COALESCE(m.service_id::text,''),COALESCE(s.name,''),COALESCE(m.environment_profile_id::text,''),
	COALESCE(e.name,''),m.state,m.health,m.enabled,COALESCE(m.current_draft_revision_id::text,''),
	COALESCE(m.latest_published_revision_id::text,''),m.frequency_seconds,m.next_run_at,m.last_run_at,
	m.last_status,m.consecutive_failures,m.created_by,m.updated_by,m.created_at,m.updated_at`

func scanMonitor(row pgx.Row) (Monitor, error) {
	var item Monitor
	err := row.Scan(
		&item.ID, &item.Name, &item.Slug, &item.Description, &item.ApplicationID, &item.ApplicationName,
		&item.ServiceID, &item.ServiceName, &item.EnvironmentProfileID, &item.EnvironmentName,
		&item.State, &item.Health, &item.Enabled, &item.CurrentDraftRevisionID,
		&item.LatestPublishedRevisionID, &item.FrequencySeconds, &item.NextRunAt, &item.LastRunAt,
		&item.LastStatus, &item.ConsecutiveFailures, &item.CreatedBy, &item.UpdatedBy, &item.CreatedAt, &item.UpdatedAt,
	)
	return item, err
}

func (s *Service) List(ctx context.Context) ([]Monitor, error) {
	rows, err := s.pool.Query(ctx, `SELECT `+monitorColumns+`
		FROM browser_monitors m
		LEFT JOIN applications a ON a.id=m.application_id
		LEFT JOIN application_services s ON s.id=m.service_id
		LEFT JOIN configuration_profiles e ON e.id=m.environment_profile_id
		ORDER BY m.updated_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []Monitor{}
	for rows.Next() {
		item, scanErr := scanMonitor(rows)
		if scanErr != nil {
			return nil, scanErr
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s *Service) Get(ctx context.Context, monitorID string) (Monitor, error) {
	item, err := scanMonitor(s.pool.QueryRow(ctx, `SELECT `+monitorColumns+`
		FROM browser_monitors m
		LEFT JOIN applications a ON a.id=m.application_id
		LEFT JOIN application_services s ON s.id=m.service_id
		LEFT JOIN configuration_profiles e ON e.id=m.environment_profile_id
		WHERE m.id=$1`, monitorID))
	if errors.Is(err, pgx.ErrNoRows) {
		return Monitor{}, ErrNotFound
	}
	return item, err
}

func (s *Service) Create(ctx context.Context, input CreateInput, actor string) (Monitor, error) {
	input.Name = strings.TrimSpace(input.Name)
	input.Slug = strings.ToLower(strings.TrimSpace(input.Slug))
	if input.Name == "" || input.Slug == "" {
		return Monitor{}, errors.New("name and slug are required")
	}
	if !regexp.MustCompile(`^[a-z0-9]+(?:-[a-z0-9]+)*$`).MatchString(input.Slug) {
		return Monitor{}, errors.New("slug must contain lowercase letters, numbers, and hyphens")
	}
	if input.FrequencySeconds == 0 {
		input.FrequencySeconds = 900
	}
	if input.FrequencySeconds < 60 || input.FrequencySeconds > 2592000 {
		return Monitor{}, errors.New("frequencySeconds must be between 60 and 2592000")
	}
	input.Definition = normalizeDefinition(input.Definition)
	if err := validateDefinition(input.Definition); err != nil {
		return Monitor{}, err
	}
	if err := s.validateOwnership(ctx, input.ApplicationID, input.ServiceID); err != nil {
		return Monitor{}, err
	}

	monitorID, err := id.NewUUID()
	if err != nil {
		return Monitor{}, err
	}
	revisionID, err := id.NewUUID()
	if err != nil {
		return Monitor{}, err
	}
	definitionJSON, _ := json.Marshal(input.Definition)
	now := s.now()
	state := "DRAFT"
	revisionStatus := "DRAFT"
	var nextRunAt *time.Time
	latestPublishedRevisionID := ""
	if input.Enabled {
		state = "ENABLED"
		revisionStatus = "PUBLISHED"
		latestPublishedRevisionID = revisionID
		next := now.Add(time.Duration(input.FrequencySeconds) * time.Second)
		nextRunAt = &next
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return Monitor{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	_, err = tx.Exec(ctx, `
		INSERT INTO browser_monitors(
			id,name,slug,description,application_id,service_id,environment_profile_id,state,enabled,
			frequency_seconds,next_run_at,created_by,updated_by
		) VALUES($1,$2,$3,$4,NULLIF($5,'')::uuid,NULLIF($6,'')::uuid,NULLIF($7,'')::uuid,$8,$9,$10,$11,$12,$12)`,
		monitorID, input.Name, input.Slug, strings.TrimSpace(input.Description), input.ApplicationID, input.ServiceID,
		input.EnvironmentProfileID, state, input.Enabled, input.FrequencySeconds, nextRunAt, actor)
	if err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "unique") {
			return Monitor{}, ErrConflict
		}
		return Monitor{}, err
	}
	_, err = tx.Exec(ctx, `
		INSERT INTO browser_monitor_revisions(
			id,monitor_id,revision_number,status,schema_version,definition,change_summary,published_by,published_at,created_by
		) VALUES($1,$2,1,$3,1,$4,'Initial browser journey',$5,$6,$5)`,
		revisionID, monitorID, revisionStatus, definitionJSON, map[bool]string{true: actor}[input.Enabled], map[bool]*time.Time{true: &now}[input.Enabled])
	if err != nil {
		return Monitor{}, err
	}
	_, err = tx.Exec(ctx, `
		UPDATE browser_monitors
		SET current_draft_revision_id=$2,latest_published_revision_id=NULLIF($3,'')::uuid
		WHERE id=$1`, monitorID, revisionID, latestPublishedRevisionID)
	if err != nil {
		return Monitor{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Monitor{}, err
	}
	return s.Get(ctx, monitorID)
}

func (s *Service) Update(ctx context.Context, monitorID string, input UpdateInput, actor string) (Monitor, error) {
	current, err := s.Get(ctx, monitorID)
	if err != nil {
		return Monitor{}, err
	}
	name, description := current.Name, current.Description
	applicationID, serviceID := current.ApplicationID, current.ServiceID
	environmentID, frequency, enabled := current.EnvironmentProfileID, current.FrequencySeconds, current.Enabled
	if input.Name != nil {
		name = strings.TrimSpace(*input.Name)
	}
	if input.Description != nil {
		description = strings.TrimSpace(*input.Description)
	}
	if input.ApplicationID != nil {
		applicationID = strings.TrimSpace(*input.ApplicationID)
	}
	if input.ServiceID != nil {
		serviceID = strings.TrimSpace(*input.ServiceID)
	}
	if input.EnvironmentProfileID != nil {
		environmentID = strings.TrimSpace(*input.EnvironmentProfileID)
	}
	if input.FrequencySeconds != nil {
		frequency = *input.FrequencySeconds
	}
	if input.Enabled != nil {
		enabled = *input.Enabled
	}
	if name == "" {
		return Monitor{}, errors.New("name is required")
	}
	if frequency < 60 || frequency > 2592000 {
		return Monitor{}, errors.New("frequencySeconds must be between 60 and 2592000")
	}
	if enabled && current.LatestPublishedRevisionID == "" {
		return Monitor{}, errors.New("publish the browser monitor before enabling it")
	}
	if err := s.validateOwnership(ctx, applicationID, serviceID); err != nil {
		return Monitor{}, err
	}
	var nextRunAt *time.Time
	if enabled {
		next := s.now().Add(time.Duration(frequency) * time.Second)
		nextRunAt = &next
	}
	command, err := s.pool.Exec(ctx, `
		UPDATE browser_monitors SET
			name=$2,description=$3,application_id=NULLIF($4,'')::uuid,service_id=NULLIF($5,'')::uuid,
			environment_profile_id=NULLIF($6,'')::uuid,frequency_seconds=$7,enabled=$8,
			state=CASE WHEN $8 THEN 'ENABLED' WHEN state='ARCHIVED' THEN state ELSE 'DISABLED' END,
			next_run_at=$9,updated_by=$10,updated_at=NOW()
		WHERE id=$1`, monitorID, name, description, applicationID, serviceID, environmentID, frequency, enabled, nextRunAt, actor)
	if err != nil {
		return Monitor{}, err
	}
	if command.RowsAffected() == 0 {
		return Monitor{}, ErrNotFound
	}
	return s.Get(ctx, monitorID)
}

func (s *Service) Delete(ctx context.Context, monitorID string) error {
	command, err := s.pool.Exec(ctx, `DELETE FROM browser_monitors WHERE id=$1`, monitorID)
	if err != nil {
		return err
	}
	if command.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *Service) SaveDraft(ctx context.Context, monitorID string, definition Definition, actor string) (Revision, error) {
	if _, err := s.Get(ctx, monitorID); err != nil {
		return Revision{}, err
	}
	definition = normalizeDefinition(definition)
	if err := validateDefinition(definition); err != nil {
		return Revision{}, err
	}
	revisionID, err := id.NewUUID()
	if err != nil {
		return Revision{}, err
	}
	encoded, _ := json.Marshal(definition)
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return Revision{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	var revisionNumber int
	if err := tx.QueryRow(ctx, `SELECT COALESCE(MAX(revision_number),0)+1 FROM browser_monitor_revisions WHERE monitor_id=$1`, monitorID).Scan(&revisionNumber); err != nil {
		return Revision{}, err
	}
	_, err = tx.Exec(ctx, `
		INSERT INTO browser_monitor_revisions(id,monitor_id,revision_number,status,schema_version,definition,change_summary,created_by)
		VALUES($1,$2,$3,'DRAFT',1,$4,'Browser journey updated',$5)`,
		revisionID, monitorID, revisionNumber, encoded, actor)
	if err != nil {
		return Revision{}, err
	}
	_, err = tx.Exec(ctx, `UPDATE browser_monitors SET current_draft_revision_id=$2,state=CASE WHEN enabled THEN state ELSE 'DRAFT' END,updated_by=$3,updated_at=NOW() WHERE id=$1`, monitorID, revisionID, actor)
	if err != nil {
		return Revision{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Revision{}, err
	}
	return s.GetRevision(ctx, monitorID, revisionID)
}

func (s *Service) Publish(ctx context.Context, monitorID, actor, summary string) (Revision, error) {
	monitor, err := s.Get(ctx, monitorID)
	if err != nil {
		return Revision{}, err
	}
	if monitor.CurrentDraftRevisionID == "" {
		return Revision{}, errors.New("browser monitor has no draft revision")
	}
	now := s.now()
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return Revision{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	_, err = tx.Exec(ctx, `
		UPDATE browser_monitor_revisions
		SET status='PUBLISHED',change_summary=$3,published_by=$4,published_at=$5
		WHERE id=$1 AND monitor_id=$2`,
		monitor.CurrentDraftRevisionID, monitorID, strings.TrimSpace(summary), actor, now)
	if err != nil {
		return Revision{}, err
	}
	_, err = tx.Exec(ctx, `
		UPDATE browser_monitors SET latest_published_revision_id=$2,state=CASE WHEN enabled THEN 'ENABLED' ELSE 'PUBLISHED' END,
			updated_by=$3,updated_at=$4 WHERE id=$1`, monitorID, monitor.CurrentDraftRevisionID, actor, now)
	if err != nil {
		return Revision{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Revision{}, err
	}
	return s.GetRevision(ctx, monitorID, monitor.CurrentDraftRevisionID)
}

func (s *Service) ListRevisions(ctx context.Context, monitorID string) ([]Revision, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id::text,monitor_id::text,revision_number,status,schema_version,definition,change_summary,
		       published_by,published_at,created_by,created_at
		FROM browser_monitor_revisions WHERE monitor_id=$1 ORDER BY revision_number DESC`, monitorID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []Revision{}
	for rows.Next() {
		item, scanErr := scanRevision(rows)
		if scanErr != nil {
			return nil, scanErr
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s *Service) GetRevision(ctx context.Context, monitorID, revisionID string) (Revision, error) {
	item, err := scanRevision(s.pool.QueryRow(ctx, `
		SELECT id::text,monitor_id::text,revision_number,status,schema_version,definition,change_summary,
		       published_by,published_at,created_by,created_at
		FROM browser_monitor_revisions WHERE id=$1 AND monitor_id=$2`, revisionID, monitorID))
	if errors.Is(err, pgx.ErrNoRows) {
		return Revision{}, ErrNotFound
	}
	return item, err
}

type rowScanner interface{ Scan(...any) error }

func scanRevision(row rowScanner) (Revision, error) {
	var item Revision
	var encoded []byte
	err := row.Scan(&item.ID, &item.MonitorID, &item.RevisionNumber, &item.Status, &item.SchemaVersion, &encoded,
		&item.ChangeSummary, &item.PublishedBy, &item.PublishedAt, &item.CreatedBy, &item.CreatedAt)
	if err == nil {
		err = json.Unmarshal(encoded, &item.Definition)
	}
	return item, err
}

func (s *Service) StartRun(ctx context.Context, monitorID, actor, mode, trigger string) (Run, error) {
	monitor, err := s.Get(ctx, monitorID)
	if err != nil {
		return Run{}, err
	}
	revisionID := monitor.LatestPublishedRevisionID
	if mode == "draft" {
		revisionID = monitor.CurrentDraftRevisionID
	}
	if revisionID == "" {
		return Run{}, errors.New("browser monitor has no executable revision")
	}
	revision, err := s.GetRevision(ctx, monitorID, revisionID)
	if err != nil {
		return Run{}, err
	}
	runID, err := id.NewUUID()
	if err != nil {
		return Run{}, err
	}
	now := s.now()
	if trigger == "" {
		trigger = "MANUAL"
	}
	viewport, _ := json.Marshal(map[string]any{
		"width": revision.Definition.Profile.ViewportWidth, "height": revision.Definition.Profile.ViewportHeight,
		"deviceScaleFactor": revision.Definition.Profile.DeviceScale, "isMobile": revision.Definition.Profile.IsMobile,
	})
	profile, _ := json.Marshal(revision.Definition.Profile)
	events, _ := json.Marshal([]Event{{Type: "RUN_QUEUED", Message: "Browser run accepted and queued.", OccurredAt: now}})
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return Run{}, err
	}
	defer func() { _ = tx.Rollback(context.Background()) }()
	_, err = tx.Exec(ctx, `
		INSERT INTO browser_runs(
			id,monitor_id,revision_id,status,trigger_type,trigger_source,browser_name,viewport,execution_profile,events,created_at
		) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
		runID, monitorID, revisionID, StatusQueued, trigger, actor, revision.Definition.Profile.Browser, viewport, profile, events, now)
	if err != nil {
		return Run{}, err
	}
	if s.queueRedis != nil {
		jobID, idErr := id.NewUUID()
		if idErr != nil {
			return Run{}, idErr
		}
		outboxID, idErr := id.NewUUID()
		if idErr != nil {
			return Run{}, idErr
		}
		payload, _ := json.Marshal(map[string]any{
			"monitorId": monitorID, "revisionId": revisionID, "triggerType": trigger,
			"recoverySafe": false,
		})
		deduplication := ""
		if trigger == "SCHEDULED" {
			deduplication = fmt.Sprintf("browser-schedule:%s:%d", monitorID, now.UTC().Unix())
		}
		if _, err = tx.Exec(ctx, `
			INSERT INTO execution_jobs(
				id,browser_run_id,job_type,queue_class,priority,status,payload_json,
				deduplication_key,available_at,created_at,updated_at
			) VALUES(
				$1,$2,'BROWSER_MONITOR_RUN','browser',50,'QUEUED',$3,NULLIF($4,''),$5,$5,$5
			)`, jobID, runID, payload, deduplication, now); err != nil {
			return Run{}, err
		}
		if _, err = tx.Exec(ctx, `
			INSERT INTO execution_job_outbox(id,job_id,stream_name,payload_json)
			VALUES($1::uuid,$2::uuid,$3,jsonb_build_object('jobId',$2::text))`,
			outboxID, jobID, browserExecutionStream); err != nil {
			return Run{}, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return Run{}, err
	}
	if s.queueRedis != nil {
		return s.GetRun(ctx, runID)
	}
	runContext, cancel := context.WithCancel(context.Background())
	s.cancelMu.Lock()
	s.cancels[runID] = cancel
	s.cancelMu.Unlock()
	go func() {
		defer func() {
			s.cancelMu.Lock()
			delete(s.cancels, runID)
			s.cancelMu.Unlock()
		}()
		s.execute(runContext, monitor, revision, runID)
	}()
	return s.GetRun(ctx, runID)
}

func (s *Service) CancelRun(ctx context.Context, runID string) (Run, error) {
	run, err := s.GetRun(ctx, runID)
	if err != nil {
		return Run{}, err
	}
	if terminal(run.Status) {
		return run, errors.New("browser run is already complete")
	}
	if s.queueRedis != nil {
		tx, txErr := s.pool.Begin(ctx)
		if txErr != nil {
			return Run{}, txErr
		}
		defer func() { _ = tx.Rollback(context.Background()) }()
		command, updateErr := tx.Exec(ctx, `
			UPDATE browser_runs
			SET cancel_requested_at=NOW()
			WHERE id=$1 AND status IN ('QUEUED','STARTING','RUNNING','ANALYZING')`, runID)
		if updateErr != nil {
			return Run{}, updateErr
		}
		if command.RowsAffected() == 0 {
			return run, errors.New("browser run is already complete")
		}
		if _, updateErr = tx.Exec(ctx, `
			UPDATE execution_jobs
			SET cancel_requested_at=NOW(),
				status=CASE WHEN status='QUEUED' THEN 'CANCELLED' ELSE status END,
				completed_at=CASE WHEN status='QUEUED' THEN NOW() ELSE completed_at END,
				updated_at=NOW()
			WHERE browser_run_id=$1 AND status IN ('QUEUED','LEASED')`, runID); updateErr != nil {
			return Run{}, updateErr
		}
		if _, updateErr = tx.Exec(ctx, `
			UPDATE browser_runs
			SET status='CANCELLED',ended_at=NOW(),
				duration_ms=GREATEST(0,EXTRACT(EPOCH FROM (NOW()-created_at))*1000)::bigint,
				failure_category='CANCELLED',failure_reason='Browser run was cancelled before execution.'
			WHERE id=$1 AND status='QUEUED'`, runID); updateErr != nil {
			return Run{}, updateErr
		}
		if txErr = tx.Commit(ctx); txErr != nil {
			return Run{}, txErr
		}
		return s.GetRun(ctx, runID)
	}
	s.cancelMu.Lock()
	cancel := s.cancels[runID]
	s.cancelMu.Unlock()
	if cancel == nil {
		return run, errors.New("browser run is not active on this worker")
	}
	cancel()
	return run, nil
}

func (s *Service) execute(ctx context.Context, monitor Monitor, revision Revision, runID string) {
	started := s.now()
	s.updateRunState(context.Background(), runID, StatusStarting, started, "RUN_STARTING", "Browser agent is preparing the execution.")
	values, sensitive, err := s.runtimeValues(ctx, monitor, revision.Definition)
	if err != nil {
		s.finishFailure(runID, started, "CONFIGURATION_ERROR", safeError(err), "")
		return
	}
	baselines, err := s.runnerBaselines(ctx, monitor.ID, revision.ID)
	if err != nil {
		s.finishFailure(runID, started, "ARTIFACT_POLICY_BLOCKED", "Approved visual baselines could not be loaded.", "")
		return
	}
	artifactUploads, uploadSlots, err := s.runnerArtifactUploads(ctx, monitor.ID, runID, revision.Definition)
	if err != nil {
		s.finishFailure(runID, started, "ARTIFACT_POLICY_BLOCKED", "Browser artifact upload slots could not be prepared.", "")
		return
	}
	storageState, err := s.authStorageState(ctx, revision.Definition.AuthSessionID)
	if err != nil {
		s.cleanupArtifactUploads(context.Background(), uploadSlots, nil)
		s.finishFailure(runID, started, "SESSION_EXPIRED", safeError(err), "")
		return
	}
	s.updateRunState(context.Background(), runID, StatusRunning, started, "BROWSER_LAUNCHED", "Chromium launched in an isolated browser context.")
	result, err := s.runner.Execute(ctx, RunnerRequest{
		RunID: runID, MonitorID: monitor.ID, RevisionID: revision.ID, Definition: revision.Definition,
		Variables: values, SensitiveValues: sensitive, StorageState: storageState, Baselines: baselines,
		ArtifactUploads: artifactUploads,
	})
	if err != nil {
		s.cleanupArtifactUploads(context.Background(), uploadSlots, nil)
		if errors.Is(ctx.Err(), context.Canceled) {
			s.finishFailure(runID, started, "CANCELLED", "Browser run was cancelled.", "")
			return
		}
		s.finishFailure(runID, started, "AGENT_LOST", "Browser agent could not complete the execution.", "")
		return
	}
	s.updateRunState(context.Background(), runID, StatusAnalyzing, started, "RUN_ANALYZING", "Rhythm is sanitizing and storing browser evidence.")
	artifacts, artifactErr := s.persistArtifacts(context.Background(), monitor.ID, runID, result.Status, result.Artifacts, revision, uploadSlots)
	if artifactErr != nil || result.ArtifactUploadFailures > 0 {
		result.WarningCount++
		result.Events = append(result.Events, Event{
			Type: "ARTIFACT_POLICY_BLOCKED", Category: "ARTIFACT_POLICY_BLOCKED",
			Message:    "One or more browser artifacts could not be stored safely.",
			Details:    map[string]any{"uploadFailures": result.ArtifactUploadFailures},
			OccurredAt: s.now(),
		})
	}
	if result.Status == StatusSuccess && result.WarningCount > 0 {
		result.Status = StatusSuccessWithWarnings
	}
	if err := s.persistResult(context.Background(), monitor, runID, started, result, artifacts); err != nil {
		s.finishFailure(runID, started, "WORKER_LOST", "Browser result could not be persisted.", result.FailedStepID)
	}
}

func (s *Service) updateRunState(ctx context.Context, runID, status string, started time.Time, eventType, message string) {
	var encoded []byte
	_ = s.pool.QueryRow(ctx, `SELECT events FROM browser_runs WHERE id=$1`, runID).Scan(&encoded)
	events := []Event{}
	_ = json.Unmarshal(encoded, &events)
	events = append(events, Event{Type: eventType, Message: message, OccurredAt: s.now()})
	encoded, _ = json.Marshal(events)
	_, _ = s.pool.Exec(ctx, `
		UPDATE browser_runs SET status=$2,started_at=COALESCE(started_at,$3),queue_delay_ms=CASE WHEN started_at IS NULL THEN GREATEST(0,EXTRACT(EPOCH FROM ($3-created_at))*1000)::bigint ELSE queue_delay_ms END,events=$4
		WHERE id=$1`, runID, status, started, encoded)
}

func (s *Service) finishFailure(runID string, started time.Time, category, reason, stepID string) {
	now := s.now()
	status := StatusFailed
	if category == "CANCELLED" {
		status = StatusCancelled
	}
	events, _ := json.Marshal([]Event{
		{Type: "RUN_STARTED", Message: "Browser execution started.", OccurredAt: started},
		{Type: "RUN_FAILED", Category: category, Message: reason, StepID: stepID, OccurredAt: now},
	})
	_, _ = s.pool.Exec(context.Background(), `
		UPDATE browser_runs SET status=$2,failure_category=$3,failure_reason=$4,failed_step_id=$5,
			started_at=COALESCE(started_at,$6),ended_at=$7,duration_ms=$8,events=$9 WHERE id=$1`,
		runID, status, category, reason, stepID, started, now, now.Sub(started).Milliseconds(), events)
}

func (s *Service) persistResult(ctx context.Context, monitor Monitor, runID string, started time.Time, result RunnerResult, artifacts []Artifact) error {
	now := s.now()
	status := result.Status
	if status == "" {
		status = StatusSuccess
	}
	metrics, _ := json.Marshal(nonNilMap(result.Metrics))
	graph, _ := json.Marshal(nonNilSlice(result.GraphEvidence))
	visual, _ := json.Marshal(nonNilSlice(result.VisualEvidence))
	network, _ := json.Marshal(nonNilMap(result.NetworkSummary))
	consoleEvents, _ := json.Marshal(nonNilSlice(result.ConsoleEvents))
	result.Events = append(result.Events, Event{Type: "RUN_COMPLETED", Message: "Browser execution completed.", OccurredAt: now})
	events, _ := json.Marshal(result.Events)
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	_, err = tx.Exec(ctx, `
		UPDATE browser_runs SET status=$2,browser_name=$3,browser_version=$4,agent_image_version=$5,metrics=$6,
			graph_evidence=$7,visual_evidence=$8,network_summary=$9,console_events=$10,events=$11,
			failure_category=$12,failure_reason=$13,failed_step_id=$14,duration_ms=$15,warning_count=$16,
			started_at=COALESCE(started_at,$17),ended_at=$18
		WHERE id=$1`,
		runID, status, result.BrowserName, result.BrowserVersion, result.AgentImageVersion, metrics, graph, visual,
		network, consoleEvents, events, result.FailureCategory, result.FailureReason, result.FailedStepID,
		result.DurationMS, result.WarningCount, started, now)
	if err != nil {
		return err
	}
	for index, step := range result.Steps {
		stepID := step.ID
		if stepID == "" {
			stepID, _ = id.NewUUID()
		}
		locator, _ := json.Marshal(nonNilMap(step.LocatorEvidence))
		checks, _ := json.Marshal(step.CheckResults)
		timing, _ := json.Marshal(nonNilMap(step.Timing))
		_, err = tx.Exec(ctx, `
			INSERT INTO browser_step_runs(
				id,browser_run_id,step_definition_id,step_order,name,step_type,status,duration_ms,
				locator_evidence,check_results,timing,failure_category,failure_reason,started_at,ended_at
			) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
			stepID, runID, step.StepDefinitionID, index+1, step.Name, step.Type, step.Status, step.DurationMS,
			locator, checks, timing, step.FailureCategory, step.FailureReason, step.StartedAt, step.EndedAt)
		if err != nil {
			return err
		}
	}
	health := "HEALTHY"
	consecutiveFailures := 0
	if status == StatusFailed || status == StatusTimedOut || status == StatusAborted {
		health = "FAILING"
		consecutiveFailures = monitor.ConsecutiveFailures + 1
	} else if status == StatusSuccessWithWarnings {
		health = "DEGRADED"
	}
	nextRunAt := any(nil)
	if monitor.Enabled {
		nextRunAt = now.Add(time.Duration(monitor.FrequencySeconds) * time.Second)
	}
	_, err = tx.Exec(ctx, `
		UPDATE browser_monitors SET health=$2,last_run_at=$3,last_status=$4,consecutive_failures=$5,
			next_run_at=$6,updated_at=$3 WHERE id=$1`,
		monitor.ID, health, now, status, consecutiveFailures, nextRunAt)
	if err != nil {
		return err
	}
	if err := s.updateBrowserAlert(ctx, tx, monitor, runID, status, result, consecutiveFailures, now); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (s *Service) updateBrowserAlert(
	ctx context.Context,
	tx pgx.Tx,
	monitor Monitor,
	runID string,
	status string,
	result RunnerResult,
	consecutiveFailures int,
	occurred time.Time,
) error {
	deduplicationKey := "browser-monitor:" + monitor.ID + ":journey-failure"
	if status == StatusSuccess || status == StatusSuccessWithWarnings {
		var alertID string
		err := tx.QueryRow(ctx, `
			UPDATE alerts SET state='RESOLVED',resolved_at=$2,updated_at=$2
			WHERE deduplication_key=$1 AND source_type='RHYTHM_BROWSER_MONITOR'
			  AND state IN ('OPEN','ACKNOWLEDGED')
			RETURNING id::text`, deduplicationKey, occurred).Scan(&alertID)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil
		}
		if err != nil {
			return err
		}
		eventID, _ := id.NewUUID()
		_, err = tx.Exec(ctx, `
			INSERT INTO alert_events(id,alert_id,event_type,summary,evidence,occurred_at)
			VALUES($1,$2,'RECOVERED','Browser journey recovered',$3,$4)`,
			eventID, alertID, []byte(`{"source":"browser-run"}`), occurred)
		return err
	}
	if status != StatusFailed && status != StatusTimedOut && status != StatusAborted {
		return nil
	}
	// Scheduled browser monitors default to two consecutive failures to avoid
	// alerting on transient rendering or network noise.
	if consecutiveFailures < 2 {
		return nil
	}
	alertID, _ := id.NewUUID()
	evidence, _ := json.Marshal(map[string]any{
		"browserRunId":   runID,
		"browserName":    result.BrowserName,
		"browserVersion": result.BrowserVersion,
		"failedStepId":   result.FailedStepID,
		"warningCount":   result.WarningCount,
	})
	var persistedAlertID string
	err := tx.QueryRow(ctx, `
		INSERT INTO alerts(
			id,monitor_id,browser_monitor_id,deduplication_key,state,severity,title,description,
			failure_category,failed_step_id,consecutive_failures,first_triggered_at,last_triggered_at,
			created_at,updated_at,source_type,application_id,service_id,evidence
		) VALUES(
			$1,NULL,$2,$3,'OPEN','HIGH',$4,$5,NULLIF($6,''),NULLIF($7,''),$8,$9,$9,$9,$9,
			'RHYTHM_BROWSER_MONITOR',NULLIF($10,'')::uuid,NULLIF($11,'')::uuid,$12
		)
		ON CONFLICT (deduplication_key) WHERE state IN ('OPEN','ACKNOWLEDGED')
		DO UPDATE SET
			last_triggered_at=EXCLUDED.last_triggered_at,
			updated_at=EXCLUDED.updated_at,
			consecutive_failures=EXCLUDED.consecutive_failures,
			failure_category=EXCLUDED.failure_category,
			failed_step_id=EXCLUDED.failed_step_id,
			description=EXCLUDED.description,
			evidence=EXCLUDED.evidence
		RETURNING id::text`,
		alertID, monitor.ID, deduplicationKey, monitor.Name+" browser journey is failing",
		result.FailureReason, result.FailureCategory, result.FailedStepID, consecutiveFailures,
		occurred, monitor.ApplicationID, monitor.ServiceID, evidence).Scan(&persistedAlertID)
	if err != nil {
		return err
	}
	eventID, _ := id.NewUUID()
	_, err = tx.Exec(ctx, `
		INSERT INTO alert_events(id,alert_id,event_type,summary,evidence,occurred_at)
		VALUES($1,$2,'FAILURE_OBSERVED',$3,$4,$5)`,
		eventID, persistedAlertID, result.FailureReason, evidence, occurred)
	return err
}

func (s *Service) persistArtifacts(
	ctx context.Context,
	monitorID, runID, status string,
	payloads []ArtifactPayload,
	revision Revision,
	slots map[string]browserArtifactUploadSlot,
) ([]Artifact, error) {
	if s.artifacts == nil {
		return nil, nil
	}
	persisted := map[string]struct{}{}
	defer s.cleanupArtifactUploads(context.Background(), slots, persisted)
	if len(payloads) == 0 {
		return nil, nil
	}
	items := []Artifact{}
	for _, payload := range payloads {
		slot, ok := slots[payload.UploadID]
		if !ok || payload.ByteSize <= 0 || payload.ByteSize > slot.MaxBytes || !allowedArtifactContentType(payload.ContentType) {
			continue
		}
		if _, duplicate := persisted[slot.ID]; duplicate {
			continue
		}
		info, err := s.artifacts.Stat(ctx, slot.ObjectKey)
		if err != nil {
			continue
		}
		if info.Size != payload.ByteSize || info.Size <= 0 || info.Size > slot.MaxBytes {
			continue
		}
		if payload.ETag != "" && info.ETag != "" && !strings.EqualFold(strings.Trim(payload.ETag, `"`), strings.Trim(info.ETag, `"`)) {
			continue
		}
		contentType := strings.ToLower(strings.TrimSpace(info.ContentType))
		if contentType == "" {
			contentType = strings.ToLower(strings.TrimSpace(payload.ContentType))
		}
		if contentType != strings.ToLower(strings.TrimSpace(payload.ContentType)) || !allowedArtifactContentType(contentType) {
			continue
		}
		now := s.now()
		failureDays := revision.Definition.ArtifactPolicy.FailureEvidenceDays
		if failureDays < 1 {
			failureDays = 7
		}
		expiry := now.Add(time.Duration(failureDays) * 24 * time.Hour)
		if status == StatusSuccess || status == StatusSuccessWithWarnings {
			successHours := revision.Definition.ArtifactPolicy.SuccessScreenshotHours
			if successHours < 1 {
				successHours = 24
			}
			expiry = now.Add(time.Duration(successHours) * time.Hour)
		}
		metadata := map[string]any{"checkpointId": payload.CheckpointID, "revisionId": revision.ID}
		metadataJSON, _ := json.Marshal(metadata)
		_, err = s.pool.Exec(ctx, `
			INSERT INTO browser_artifacts(
				id,browser_run_id,monitor_id,kind,object_key,content_type,byte_size,capture_state,masked,metadata,expires_at,created_at
			) VALUES($1,$2,$3,$4,$5,$6,$7,'CAPTURED',$8,$9,$10,$11)`,
			slot.ID, runID, monitorID, payload.Kind, slot.ObjectKey, contentType, info.Size, payload.Masked, metadataJSON, expiry, now)
		if err != nil {
			return items, err
		}
		persisted[slot.ID] = struct{}{}
		items = append(items, Artifact{
			ID: slot.ID, RunID: runID, MonitorID: monitorID, Kind: payload.Kind, ObjectKey: slot.ObjectKey,
			ContentType: contentType, ByteSize: info.Size, CaptureState: "CAPTURED",
			Masked: payload.Masked, Metadata: metadata, ExpiresAt: &expiry, CreatedAt: now,
		})
	}
	return items, nil
}

func (s *Service) runnerArtifactUploads(
	ctx context.Context,
	monitorID, runID string,
	definition Definition,
) ([]RunnerArtifactUpload, map[string]browserArtifactUploadSlot, error) {
	if s.artifacts == nil {
		return nil, nil, nil
	}
	screenshotCount := 0
	for _, step := range definition.Steps {
		if step.Enabled && step.Screenshot != nil {
			screenshotCount++
		}
	}
	slotCount := min(maxBrowserArtifactsPerRun, 1+(2*screenshotCount))
	uploads := make([]RunnerArtifactUpload, 0, slotCount)
	slots := make(map[string]browserArtifactUploadSlot, slotCount)
	for index := 0; index < slotCount; index++ {
		artifactID, err := id.NewUUID()
		if err != nil {
			s.cleanupArtifactUploads(context.Background(), slots, nil)
			return nil, nil, err
		}
		key := fmt.Sprintf("browser/%s/%s/%s.artifact", monitorID, runID, artifactID)
		signedURL, err := s.artifacts.PresignPut(ctx, key, browserArtifactURLLifetime)
		if err != nil {
			s.cleanupArtifactUploads(context.Background(), slots, nil)
			return nil, nil, err
		}
		slot := browserArtifactUploadSlot{ID: artifactID, ObjectKey: key, MaxBytes: maxBrowserArtifactBytes}
		slots[artifactID] = slot
		uploads = append(uploads, RunnerArtifactUpload{ID: artifactID, URL: signedURL, MaxBytes: maxBrowserArtifactBytes})
	}
	return uploads, slots, nil
}

func (s *Service) cleanupArtifactUploads(
	ctx context.Context,
	slots map[string]browserArtifactUploadSlot,
	persisted map[string]struct{},
) {
	if s.artifacts == nil {
		return
	}
	for id, slot := range slots {
		if _, keep := persisted[id]; keep {
			continue
		}
		_ = s.artifacts.Delete(ctx, slot.ObjectKey)
	}
}

func allowedArtifactContentType(contentType string) bool {
	switch strings.ToLower(strings.TrimSpace(contentType)) {
	case "image/png", "application/zip", "application/json":
		return true
	default:
		return false
	}
}

func (s *Service) runtimeValues(ctx context.Context, monitor Monitor, definition Definition) (map[string]string, []string, error) {
	values := map[string]string{}
	sensitive := []string{}
	if monitor.EnvironmentProfileID != "" && s.library != nil {
		material, err := s.library.ResolveEnvironmentProfile(ctx, monitor.EnvironmentProfileID)
		if err != nil {
			return nil, nil, err
		}
		for key, value := range material.Variables {
			values[key] = value
			values["environment."+key] = value
		}
		if material.BaseURL != "" {
			values["baseUrl"] = material.BaseURL
			values["environment.baseUrl"] = material.BaseURL
		}
	}
	encoded, _ := json.Marshal(definition)
	seen := map[string]bool{}
	for _, match := range secretTemplatePattern.FindAllSubmatch(encoded, -1) {
		alias := string(match[1])
		if seen[alias] {
			continue
		}
		seen[alias] = true
		if s.library == nil {
			return nil, nil, errors.New("secret references require the configuration library")
		}
		value, err := s.library.ResolveSecret(ctx, "secret://"+alias)
		if err != nil {
			return nil, nil, err
		}
		values["secrets."+alias] = value
		sensitive = append(sensitive, value)
	}
	return values, sensitive, nil
}

func (s *Service) authStorageState(ctx context.Context, sessionID string) (string, error) {
	if strings.TrimSpace(sessionID) == "" {
		return "", nil
	}
	var encrypted []byte
	var status string
	var expiresAt *time.Time
	err := s.pool.QueryRow(ctx, `SELECT encrypted_state,status,expires_at FROM browser_auth_sessions WHERE id=$1`, sessionID).
		Scan(&encrypted, &status, &expiresAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", errors.New("browser authentication session was not found")
	}
	if err != nil {
		return "", err
	}
	if status != "ACTIVE" || len(encrypted) == 0 {
		return "", errors.New("browser authentication session requires capture or renewal")
	}
	if expiresAt != nil && expiresAt.Before(s.now()) {
		return "", errors.New("browser authentication session has expired")
	}
	if len(s.encryptionKey) == 0 {
		return "", errors.New("browser authentication session cannot be decrypted")
	}
	return secretscrypto.Decrypt(s.encryptionKey, string(encrypted))
}

func (s *Service) Preview(ctx context.Context, monitorID string, definition Definition) (RunnerResult, error) {
	monitor, err := s.Get(ctx, monitorID)
	if err != nil {
		return RunnerResult{}, err
	}
	definition = normalizeDefinition(definition)
	if err := validateDefinition(definition); err != nil {
		return RunnerResult{}, err
	}
	values, sensitive, err := s.runtimeValues(ctx, monitor, definition)
	if err != nil {
		return RunnerResult{}, err
	}
	storageState, err := s.authStorageState(ctx, definition.AuthSessionID)
	if err != nil {
		return RunnerResult{}, err
	}
	return s.runner.Execute(ctx, RunnerRequest{
		RunID: "preview-" + monitorID, MonitorID: monitorID, RevisionID: "draft-preview",
		Definition: definition, Variables: values, SensitiveValues: sensitive, StorageState: storageState,
	})
}

func (s *Service) PreviewDraft(ctx context.Context, environmentProfileID string, definition Definition) (RunnerResult, error) {
	definition = normalizeDefinition(definition)
	if err := validateDefinition(definition); err != nil {
		return RunnerResult{}, err
	}
	monitor := Monitor{
		ID:                   "draft-preview",
		EnvironmentProfileID: strings.TrimSpace(environmentProfileID),
	}
	values, sensitive, err := s.runtimeValues(ctx, monitor, definition)
	if err != nil {
		return RunnerResult{}, err
	}
	storageState, err := s.authStorageState(ctx, definition.AuthSessionID)
	if err != nil {
		return RunnerResult{}, err
	}
	return s.runner.Execute(ctx, RunnerRequest{
		RunID: "preview-" + strconv.FormatInt(s.now().UnixNano(), 10), MonitorID: monitor.ID, RevisionID: "draft-preview",
		Definition: definition, Variables: values, SensitiveValues: sensitive, StorageState: storageState,
	})
}

func (s *Service) GetRun(ctx context.Context, runID string) (Run, error) {
	run, err := scanRun(s.pool.QueryRow(ctx, `
		SELECT r.id::text,r.monitor_id::text,m.name,r.revision_id::text,r.status,r.trigger_type,r.trigger_source,
		       COALESCE(r.agent_id::text,''),r.browser_name,r.browser_version,r.agent_image_version,r.viewport,
		       r.execution_profile,r.metrics,r.graph_evidence,r.visual_evidence,r.network_summary,r.console_events,r.events,
		       r.failure_category,r.failure_reason,r.failed_step_id,r.queue_delay_ms,r.duration_ms,r.warning_count,
		       r.started_at,r.ended_at,r.created_at
		FROM browser_runs r JOIN browser_monitors m ON m.id=r.monitor_id WHERE r.id=$1`, runID))
	if errors.Is(err, pgx.ErrNoRows) {
		return Run{}, ErrNotFound
	}
	if err != nil {
		return Run{}, err
	}
	run.Steps, err = s.listStepRuns(ctx, runID)
	if err != nil {
		return Run{}, err
	}
	run.Artifacts, err = s.listArtifacts(ctx, runID)
	return run, err
}

func (s *Service) ListRuns(ctx context.Context, monitorID string, limit int) ([]Run, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	rows, err := s.pool.Query(ctx, `
		SELECT r.id::text,r.monitor_id::text,m.name,r.revision_id::text,r.status,r.trigger_type,r.trigger_source,
		       COALESCE(r.agent_id::text,''),r.browser_name,r.browser_version,r.agent_image_version,r.viewport,
		       r.execution_profile,r.metrics,r.graph_evidence,r.visual_evidence,r.network_summary,r.console_events,r.events,
		       r.failure_category,r.failure_reason,r.failed_step_id,r.queue_delay_ms,r.duration_ms,r.warning_count,
		       r.started_at,r.ended_at,r.created_at
		FROM browser_runs r JOIN browser_monitors m ON m.id=r.monitor_id
		WHERE ($1='' OR r.monitor_id::text=$1) ORDER BY r.created_at DESC LIMIT $2`, monitorID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []Run{}
	for rows.Next() {
		item, scanErr := scanRun(rows)
		if scanErr != nil {
			return nil, scanErr
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

// ListRunsBetween returns lightweight run summaries for immutable historical
// comparison. Step and artifact evidence are intentionally omitted; callers
// can load an individual run when detailed diagnostics are needed.
func (s *Service) ListRunsBetween(
	ctx context.Context,
	monitorID, revisionID string,
	from, to time.Time,
	limit int,
) ([]Run, error) {
	if limit <= 0 || limit > 5000 {
		limit = 5000
	}
	rows, err := s.pool.Query(ctx, `
		SELECT r.id::text,r.monitor_id::text,m.name,r.revision_id::text,r.status,r.trigger_type,r.trigger_source,
		       COALESCE(r.agent_id::text,''),r.browser_name,r.browser_version,r.agent_image_version,r.viewport,
		       r.execution_profile,r.metrics,r.graph_evidence,r.visual_evidence,r.network_summary,r.console_events,r.events,
		       r.failure_category,r.failure_reason,r.failed_step_id,r.queue_delay_ms,r.duration_ms,r.warning_count,
		       r.started_at,r.ended_at,r.created_at
		FROM browser_runs r JOIN browser_monitors m ON m.id=r.monitor_id
		WHERE r.monitor_id=$1
		  AND ($2='' OR r.revision_id::text=$2)
		  AND r.created_at >= $3 AND r.created_at < $4
		ORDER BY r.created_at ASC
		LIMIT $5`, monitorID, revisionID, from, to, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []Run{}
	for rows.Next() {
		item, scanErr := scanRun(rows)
		if scanErr != nil {
			return nil, scanErr
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func scanRun(row rowScanner) (Run, error) {
	var run Run
	var viewport, profile, metrics, graph, visual, network, consoleEvents, events []byte
	err := row.Scan(&run.ID, &run.MonitorID, &run.MonitorName, &run.RevisionID, &run.Status, &run.TriggerType,
		&run.TriggerSource, &run.AgentID, &run.BrowserName, &run.BrowserVersion, &run.AgentImageVersion,
		&viewport, &profile, &metrics, &graph, &visual, &network, &consoleEvents, &events,
		&run.FailureCategory, &run.FailureReason, &run.FailedStepID, &run.QueueDelayMS, &run.DurationMS,
		&run.WarningCount, &run.StartedAt, &run.EndedAt, &run.CreatedAt)
	if err != nil {
		return Run{}, err
	}
	run.Viewport, run.ExecutionProfile, run.Metrics, run.NetworkSummary = map[string]any{}, map[string]any{}, map[string]any{}, map[string]any{}
	run.GraphEvidence, run.VisualEvidence, run.ConsoleEvents, run.Events = []map[string]any{}, []map[string]any{}, []map[string]any{}, []Event{}
	// Run-list queries intentionally omit detailed step and artifact evidence.
	// Keep those collections as JSON arrays so clients can render lightweight
	// summaries without treating a valid response as a broken page.
	run.Steps, run.Artifacts = []StepRun{}, []Artifact{}
	_ = json.Unmarshal(viewport, &run.Viewport)
	_ = json.Unmarshal(profile, &run.ExecutionProfile)
	_ = json.Unmarshal(metrics, &run.Metrics)
	_ = json.Unmarshal(graph, &run.GraphEvidence)
	_ = json.Unmarshal(visual, &run.VisualEvidence)
	_ = json.Unmarshal(network, &run.NetworkSummary)
	_ = json.Unmarshal(consoleEvents, &run.ConsoleEvents)
	_ = json.Unmarshal(events, &run.Events)
	return run, nil
}

func (s *Service) listStepRuns(ctx context.Context, runID string) ([]StepRun, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id::text,step_definition_id,step_order,name,step_type,status,duration_ms,locator_evidence,
		       check_results,timing,failure_category,failure_reason,started_at,ended_at
		FROM browser_step_runs WHERE browser_run_id=$1 ORDER BY step_order`, runID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []StepRun{}
	for rows.Next() {
		var item StepRun
		var locator, checks, timing []byte
		if err := rows.Scan(&item.ID, &item.StepDefinitionID, &item.StepOrder, &item.Name, &item.Type, &item.Status,
			&item.DurationMS, &locator, &checks, &timing, &item.FailureCategory, &item.FailureReason,
			&item.StartedAt, &item.EndedAt); err != nil {
			return nil, err
		}
		item.LocatorEvidence, item.Timing, item.CheckResults = map[string]any{}, map[string]any{}, []CheckResult{}
		_ = json.Unmarshal(locator, &item.LocatorEvidence)
		_ = json.Unmarshal(checks, &item.CheckResults)
		_ = json.Unmarshal(timing, &item.Timing)
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s *Service) listArtifacts(ctx context.Context, runID string) ([]Artifact, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id::text,COALESCE(browser_run_id::text,''),monitor_id::text,kind,object_key,content_type,byte_size,
		       capture_state,masked,metadata,expires_at,created_at
		FROM browser_artifacts WHERE browser_run_id=$1 ORDER BY created_at`, runID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []Artifact{}
	for rows.Next() {
		var item Artifact
		var metadata []byte
		if err := rows.Scan(&item.ID, &item.RunID, &item.MonitorID, &item.Kind, &item.ObjectKey, &item.ContentType,
			&item.ByteSize, &item.CaptureState, &item.Masked, &metadata, &item.ExpiresAt, &item.CreatedAt); err != nil {
			return nil, err
		}
		item.Metadata = map[string]any{}
		_ = json.Unmarshal(metadata, &item.Metadata)
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s *Service) GetArtifact(ctx context.Context, artifactID string) (Artifact, ArtifactStore, error) {
	var item Artifact
	var metadata []byte
	err := s.pool.QueryRow(ctx, `
		SELECT id::text,COALESCE(browser_run_id::text,''),monitor_id::text,kind,object_key,content_type,byte_size,
		       capture_state,masked,metadata,expires_at,created_at
		FROM browser_artifacts WHERE id=$1`, artifactID).
		Scan(&item.ID, &item.RunID, &item.MonitorID, &item.Kind, &item.ObjectKey, &item.ContentType,
			&item.ByteSize, &item.CaptureState, &item.Masked, &metadata, &item.ExpiresAt, &item.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return Artifact{}, nil, ErrNotFound
	}
	if err != nil {
		return Artifact{}, nil, err
	}
	item.Metadata = map[string]any{}
	_ = json.Unmarshal(metadata, &item.Metadata)
	return item, s.artifacts, nil
}

func (s *Service) Metrics(ctx context.Context, monitorID, period string) (Metrics, error) {
	duration := 24 * time.Hour
	switch period {
	case "7d":
		duration = 7 * 24 * time.Hour
	case "30d":
		duration = 30 * 24 * time.Hour
	case "90d":
		duration = 90 * 24 * time.Hour
	default:
		period = "24h"
	}
	rows, err := s.pool.Query(ctx, `
		SELECT id::text,status,duration_ms,metrics,graph_evidence,failure_category,created_at
		FROM browser_runs WHERE monitor_id=$1 AND created_at >= $2 AND status NOT IN ('QUEUED','STARTING','RUNNING','ANALYZING')
		ORDER BY created_at`, monitorID, s.now().Add(-duration))
	if err != nil {
		return Metrics{}, err
	}
	defer rows.Close()
	result := Metrics{
		MonitorID: monitorID, Range: period, MetricDistributions: map[string]Statistics{},
		Series: []map[string]any{}, GraphSeries: []map[string]any{}, FailureCategories: map[string]int{},
	}
	journeyValues := []int64{}
	metricValues := map[string][]int64{}
	successes := 0
	for rows.Next() {
		var runID, status, category string
		var durationMS int64
		var encodedMetrics, encodedGraph []byte
		var createdAt time.Time
		if err := rows.Scan(&runID, &status, &durationMS, &encodedMetrics, &encodedGraph, &category, &createdAt); err != nil {
			return Metrics{}, err
		}
		result.RunCount++
		if status == StatusSuccess || status == StatusSuccessWithWarnings {
			successes++
		}
		if category != "" {
			result.FailureCategories[category]++
		}
		if durationMS > 0 {
			journeyValues = append(journeyValues, durationMS)
		}
		metrics := map[string]any{}
		_ = json.Unmarshal(encodedMetrics, &metrics)
		point := map[string]any{"runId": runID, "status": status, "createdAt": createdAt, "journeyMs": durationMS}
		for _, key := range []string{"ttfbMs", "fcpMs", "lcpMs", "tbtMs", "interactionMs", "loadMs"} {
			if value, ok := numeric(metrics[key]); ok {
				rounded := int64(math.Round(value))
				metricValues[key] = append(metricValues[key], rounded)
				point[key] = rounded
			}
		}
		if value, ok := numeric(metrics["cls"]); ok {
			point["cls"] = value
		}
		result.Series = append(result.Series, point)
		graph := []map[string]any{}
		_ = json.Unmarshal(encodedGraph, &graph)
		for _, evidence := range graph {
			if observed, ok := numeric(evidence["observed"]); ok {
				result.GraphSeries = append(result.GraphSeries, map[string]any{
					"runId": runID, "checkpointId": evidence["checkpointId"], "name": evidence["name"],
					"value": observed, "createdAt": createdAt, "passed": evidence["passed"],
				})
			}
		}
	}
	if err := rows.Err(); err != nil {
		return Metrics{}, err
	}
	if result.RunCount > 0 {
		result.SuccessRate = float64(successes) / float64(result.RunCount) * 100
		result.FailureRate = 100 - result.SuccessRate
	}
	result.Journey = summarize(journeyValues)
	for key, values := range metricValues {
		result.MetricDistributions[key] = summarize(values)
	}
	return result, nil
}

func summarize(values []int64) Statistics {
	if len(values) == 0 {
		return Statistics{}
	}
	sort.Slice(values, func(i, j int) bool { return values[i] < values[j] })
	var total int64
	for _, value := range values {
		total += value
	}
	average := float64(total) / float64(len(values))
	var variance float64
	for _, value := range values {
		delta := float64(value) - average
		variance += delta * delta
	}
	minimum, maximum := values[0], values[len(values)-1]
	avg := int64(math.Round(average))
	p50, p75, p90, p95, p99 := percentile(values, .50), percentile(values, .75), percentile(values, .90), percentile(values, .95), percentile(values, .99)
	return Statistics{
		SampleCount: len(values), MinimumMS: &minimum, AverageMS: &avg, P50MS: &p50, P75MS: &p75,
		P90MS: &p90, P95MS: &p95, P99MS: &p99, MaximumMS: &maximum,
		StandardDeviation: math.Sqrt(variance / float64(len(values))),
	}
}

func percentile(values []int64, quantile float64) int64 {
	if len(values) == 0 {
		return 0
	}
	index := int(math.Ceil(quantile*float64(len(values)))) - 1
	index = max(0, min(index, len(values)-1))
	return values[index]
}

func (s *Service) ListBaselines(ctx context.Context, monitorID string) ([]Baseline, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id::text,monitor_id::text,revision_id::text,checkpoint_id,fingerprint,artifact_id::text,status,
		       browser_version,agent_image_version,viewport,approved_by,approved_at,created_at
		FROM browser_visual_baselines WHERE monitor_id=$1 ORDER BY created_at DESC`, monitorID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []Baseline{}
	for rows.Next() {
		var item Baseline
		var viewport []byte
		if err := rows.Scan(&item.ID, &item.MonitorID, &item.RevisionID, &item.CheckpointID, &item.Fingerprint,
			&item.ArtifactID, &item.Status, &item.BrowserVersion, &item.AgentImageVersion, &viewport,
			&item.ApprovedBy, &item.ApprovedAt, &item.CreatedAt); err != nil {
			return nil, err
		}
		item.Viewport = map[string]any{}
		_ = json.Unmarshal(viewport, &item.Viewport)
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s *Service) ProposeBaseline(ctx context.Context, monitorID, runID, artifactID, checkpointID string) (Baseline, error) {
	run, err := s.GetRun(ctx, runID)
	if err != nil || run.MonitorID != monitorID {
		return Baseline{}, ErrNotFound
	}
	var belongs bool
	if err := s.pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM browser_artifacts WHERE id=$1 AND browser_run_id=$2 AND monitor_id=$3)`, artifactID, runID, monitorID).Scan(&belongs); err != nil {
		return Baseline{}, err
	}
	if !belongs {
		return Baseline{}, errors.New("artifact does not belong to this browser run")
	}
	baselineID, _ := id.NewUUID()
	fingerprint := baselineFingerprint(run.RevisionID, checkpointID, run.BrowserVersion, run.AgentImageVersion, run.Viewport)
	viewport, _ := json.Marshal(run.Viewport)
	_, err = s.pool.Exec(ctx, `
		INSERT INTO browser_visual_baselines(
			id,monitor_id,revision_id,checkpoint_id,fingerprint,artifact_id,status,browser_version,agent_image_version,viewport
		) VALUES($1,$2,$3,$4,$5,$6,'PROPOSED',$7,$8,$9)`,
		baselineID, monitorID, run.RevisionID, checkpointID, fingerprint, artifactID, run.BrowserVersion, run.AgentImageVersion, viewport)
	if err != nil {
		return Baseline{}, err
	}
	items, err := s.ListBaselines(ctx, monitorID)
	if err != nil {
		return Baseline{}, err
	}
	for _, item := range items {
		if item.ID == baselineID {
			return item, nil
		}
	}
	return Baseline{}, ErrNotFound
}

func (s *Service) ApproveBaseline(ctx context.Context, baselineID, actor string) (Baseline, error) {
	var monitorID, fingerprint string
	err := s.pool.QueryRow(ctx, `SELECT monitor_id::text,fingerprint FROM browser_visual_baselines WHERE id=$1`, baselineID).Scan(&monitorID, &fingerprint)
	if errors.Is(err, pgx.ErrNoRows) {
		return Baseline{}, ErrNotFound
	}
	if err != nil {
		return Baseline{}, err
	}
	now := s.now()
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return Baseline{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	_, err = tx.Exec(ctx, `UPDATE browser_visual_baselines SET status='SUPERSEDED' WHERE monitor_id=$1 AND fingerprint=$2 AND status='APPROVED'`, monitorID, fingerprint)
	if err == nil {
		_, err = tx.Exec(ctx, `UPDATE browser_visual_baselines SET status='APPROVED',approved_by=$2,approved_at=$3 WHERE id=$1`, baselineID, actor, now)
	}
	if err != nil {
		return Baseline{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Baseline{}, err
	}
	items, err := s.ListBaselines(ctx, monitorID)
	if err != nil {
		return Baseline{}, err
	}
	for _, item := range items {
		if item.ID == baselineID {
			return item, nil
		}
	}
	return Baseline{}, ErrNotFound
}

func (s *Service) DeleteBaseline(ctx context.Context, baselineID string) error {
	command, err := s.pool.Exec(ctx, `DELETE FROM browser_visual_baselines WHERE id=$1`, baselineID)
	if err != nil {
		return err
	}
	if command.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *Service) runnerBaselines(ctx context.Context, monitorID, revisionID string) ([]RunnerBaseline, error) {
	if s.artifacts == nil {
		return nil, nil
	}
	rows, err := s.pool.Query(ctx, `
		SELECT b.checkpoint_id,b.fingerprint,a.object_key
		FROM browser_visual_baselines b JOIN browser_artifacts a ON a.id=b.artifact_id
		WHERE b.monitor_id=$1 AND b.revision_id=$2 AND b.status='APPROVED'`, monitorID, revisionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []RunnerBaseline{}
	for rows.Next() {
		var item RunnerBaseline
		var objectKey string
		if err := rows.Scan(&item.CheckpointID, &item.Fingerprint, &objectKey); err != nil {
			return nil, err
		}
		info, err := s.artifacts.Stat(ctx, objectKey)
		if err != nil {
			return nil, err
		}
		if info.Size <= 0 || info.Size > maxBrowserArtifactBytes || !allowedArtifactContentType(info.ContentType) {
			return nil, errors.New("approved visual baseline artifact violates the capture policy")
		}
		signedURL, err := s.artifacts.PresignGet(ctx, objectKey, browserArtifactURLLifetime)
		if err != nil {
			return nil, err
		}
		item.ContentURL = signedURL
		item.MaxBytes = info.Size
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s *Service) Start(ctx context.Context) {
	s.startQueue(ctx)
	scheduleTicker := time.NewTicker(15 * time.Second)
	orphanTicker := time.NewTicker(time.Hour)
	defer scheduleTicker.Stop()
	defer orphanTicker.Stop()
	s.purgeOrphanedArtifactUploads(ctx)
	for {
		select {
		case <-ctx.Done():
			return
		case <-scheduleTicker.C:
			s.dispatchDue(ctx)
			s.purgeExpiredArtifacts(ctx)
		case <-orphanTicker.C:
			s.purgeOrphanedArtifactUploads(ctx)
		}
	}
}

func (s *Service) dispatchDue(ctx context.Context) {
	rows, err := s.pool.Query(ctx, `
		SELECT id::text FROM browser_monitors
		WHERE enabled=TRUE AND latest_published_revision_id IS NOT NULL AND next_run_at<=NOW()
		ORDER BY next_run_at FOR UPDATE SKIP LOCKED LIMIT 20`)
	if err != nil {
		return
	}
	ids := []string{}
	for rows.Next() {
		var monitorID string
		if rows.Scan(&monitorID) == nil {
			ids = append(ids, monitorID)
		}
	}
	rows.Close()
	for _, monitorID := range ids {
		monitor, getErr := s.Get(ctx, monitorID)
		if getErr != nil {
			continue
		}
		next := s.now().Add(time.Duration(monitor.FrequencySeconds) * time.Second)
		command, updateErr := s.pool.Exec(ctx, `UPDATE browser_monitors SET next_run_at=$2 WHERE id=$1 AND next_run_at<=NOW()`, monitorID, next)
		if updateErr == nil && command.RowsAffected() > 0 {
			_, _ = s.StartRun(context.Background(), monitorID, "browser-scheduler", "published", "SCHEDULED")
		}
	}
}

func (s *Service) purgeExpiredArtifacts(ctx context.Context) {
	if s.artifacts == nil {
		return
	}
	rows, err := s.pool.Query(ctx, `SELECT id::text,object_key FROM browser_artifacts WHERE expires_at<NOW() LIMIT 100`)
	if err != nil {
		return
	}
	type expired struct{ id, key string }
	items := []expired{}
	for rows.Next() {
		var item expired
		if rows.Scan(&item.id, &item.key) == nil {
			items = append(items, item)
		}
	}
	rows.Close()
	for _, item := range items {
		if s.artifacts.Delete(ctx, item.key) == nil {
			_, _ = s.pool.Exec(ctx, `DELETE FROM browser_artifacts WHERE id=$1`, item.id)
		}
	}
}

func (s *Service) purgeOrphanedArtifactUploads(ctx context.Context) {
	if s.artifacts == nil {
		return
	}
	candidates, err := s.artifacts.List(ctx, "browser/", s.now().Add(-30*time.Minute), 500)
	if err != nil || len(candidates) == 0 {
		return
	}
	keys := make([]string, 0, len(candidates))
	for _, candidate := range candidates {
		keys = append(keys, candidate.Key)
	}
	rows, err := s.pool.Query(ctx, `SELECT object_key FROM browser_artifacts WHERE object_key=ANY($1)`, keys)
	if err != nil {
		return
	}
	tracked := make(map[string]struct{}, len(keys))
	for rows.Next() {
		var key string
		if rows.Scan(&key) == nil {
			tracked[key] = struct{}{}
		}
	}
	rows.Close()
	for _, candidate := range candidates {
		if _, exists := tracked[candidate.Key]; exists {
			continue
		}
		_ = s.artifacts.Delete(ctx, candidate.Key)
	}
}

type AuthSessionInput struct {
	Name                 string     `json:"name"`
	ApplicationID        string     `json:"applicationId,omitempty"`
	EnvironmentProfileID string     `json:"environmentProfileId,omitempty"`
	Mode                 string     `json:"mode"`
	AllowedOrigins       []string   `json:"allowedOrigins"`
	StateBase64          string     `json:"stateBase64,omitempty"`
	ExpiresAt            *time.Time `json:"expiresAt,omitempty"`
}

func (s *Service) ListAuthSessions(ctx context.Context) ([]AuthSession, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id::text,name,COALESCE(application_id::text,''),COALESCE(environment_profile_id::text,''),mode,
		       allowed_origins,status,expires_at,last_validated_at,created_by,updated_by,created_at,updated_at
		FROM browser_auth_sessions ORDER BY updated_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []AuthSession{}
	for rows.Next() {
		var item AuthSession
		var origins []byte
		if err := rows.Scan(&item.ID, &item.Name, &item.ApplicationID, &item.EnvironmentProfileID, &item.Mode,
			&origins, &item.Status, &item.ExpiresAt, &item.LastValidatedAt, &item.CreatedBy, &item.UpdatedBy,
			&item.CreatedAt, &item.UpdatedAt); err != nil {
			return nil, err
		}
		_ = json.Unmarshal(origins, &item.AllowedOrigins)
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s *Service) SaveAuthSession(ctx context.Context, input AuthSessionInput, actor string) (AuthSession, error) {
	if strings.TrimSpace(input.Name) == "" {
		return AuthSession{}, errors.New("name is required")
	}
	if len(input.AllowedOrigins) == 0 {
		return AuthSession{}, errors.New("at least one allowed origin is required")
	}
	for _, origin := range input.AllowedOrigins {
		if parsed, err := url.Parse(origin); err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" {
			return AuthSession{}, errors.New("allowed origins must be absolute HTTP or HTTPS origins")
		}
	}
	sessionID, _ := id.NewUUID()
	origins, _ := json.Marshal(uniqueStrings(input.AllowedOrigins))
	status := "NOT_CAPTURED"
	var encrypted []byte
	if strings.TrimSpace(input.StateBase64) != "" {
		if len(s.encryptionKey) == 0 {
			return AuthSession{}, errors.New("browser session capture requires RHYTHM_SECRETS_ENCRYPTION_KEY")
		}
		state, err := base64.StdEncoding.DecodeString(input.StateBase64)
		if err != nil || len(state) > 1<<20 {
			return AuthSession{}, errors.New("browser session state is invalid or too large")
		}
		ciphertext, err := secretscrypto.Encrypt(s.encryptionKey, string(state))
		if err != nil {
			return AuthSession{}, err
		}
		encrypted = []byte(ciphertext)
		status = "ACTIVE"
	}
	_, err := s.pool.Exec(ctx, `
		INSERT INTO browser_auth_sessions(
			id,name,application_id,environment_profile_id,mode,allowed_origins,encrypted_state,status,expires_at,created_by,updated_by
		) VALUES($1,$2,NULLIF($3,'')::uuid,NULLIF($4,'')::uuid,$5,$6,$7,$8,$9,$10,$10)`,
		sessionID, strings.TrimSpace(input.Name), input.ApplicationID, input.EnvironmentProfileID,
		strings.ToUpper(strings.TrimSpace(input.Mode)), origins, encrypted, status, input.ExpiresAt, actor)
	if err != nil {
		return AuthSession{}, err
	}
	items, err := s.ListAuthSessions(ctx)
	if err != nil {
		return AuthSession{}, err
	}
	for _, item := range items {
		if item.ID == sessionID {
			return item, nil
		}
	}
	return AuthSession{}, ErrNotFound
}

func (s *Service) DeleteAuthSession(ctx context.Context, sessionID string) error {
	command, err := s.pool.Exec(ctx, `DELETE FROM browser_auth_sessions WHERE id=$1`, sessionID)
	if err != nil {
		return err
	}
	if command.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *Service) ValidateAuthSession(ctx context.Context, sessionID string) (AuthSession, error) {
	if _, err := s.authStorageState(ctx, sessionID); err != nil {
		_, _ = s.pool.Exec(ctx, `UPDATE browser_auth_sessions SET status='RENEWAL_REQUIRED',updated_at=NOW() WHERE id=$1`, sessionID)
		return AuthSession{}, err
	}
	now := s.now()
	_, err := s.pool.Exec(ctx, `UPDATE browser_auth_sessions SET status='ACTIVE',last_validated_at=$2,updated_at=$2 WHERE id=$1`, sessionID, now)
	if err != nil {
		return AuthSession{}, err
	}
	items, err := s.ListAuthSessions(ctx)
	if err != nil {
		return AuthSession{}, err
	}
	for _, item := range items {
		if item.ID == sessionID {
			return item, nil
		}
	}
	return AuthSession{}, ErrNotFound
}

func (s *Service) validateOwnership(ctx context.Context, applicationID, serviceID string) error {
	if serviceID == "" {
		return nil
	}
	if applicationID == "" {
		return errors.New("applicationId is required when serviceId is selected")
	}
	var valid bool
	if err := s.pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM application_services WHERE id=$1 AND application_id=$2)`, serviceID, applicationID).Scan(&valid); err != nil {
		return err
	}
	if !valid {
		return errors.New("selected service does not belong to the application")
	}
	return nil
}

func normalizeDefinition(definition Definition) Definition {
	definition.SchemaVersion = 1
	if definition.Profile.Browser == "" {
		definition.Profile.Browser = "chromium"
	}
	if definition.Profile.ViewportWidth == 0 {
		definition.Profile.ViewportWidth = 1440
	}
	if definition.Profile.ViewportHeight == 0 {
		definition.Profile.ViewportHeight = 900
	}
	if definition.Profile.DeviceScale == 0 {
		definition.Profile.DeviceScale = 1
	}
	if definition.Profile.Locale == "" {
		definition.Profile.Locale = "en-US"
	}
	if definition.Profile.Timezone == "" {
		definition.Profile.Timezone = "UTC"
	}
	if definition.Profile.ColorScheme == "" {
		definition.Profile.ColorScheme = "light"
	}
	if definition.Profile.NetworkProfile == "" {
		definition.Profile.NetworkProfile = "NATIVE"
	}
	if definition.ArtifactPolicy.SuccessScreenshotHours == 0 {
		definition.ArtifactPolicy.SuccessScreenshotHours = 24
	}
	if definition.ArtifactPolicy.FailureEvidenceDays == 0 {
		definition.ArtifactPolicy.FailureEvidenceDays = 7
	}
	if len(definition.AllowedOrigins) == 0 && definition.StartURL != "" {
		if parsed, err := url.Parse(definition.StartURL); err == nil {
			definition.AllowedOrigins = []string{parsed.Scheme + "://" + parsed.Host}
		}
	}
	for index := range definition.Steps {
		if definition.Steps[index].TimeoutMS == 0 {
			definition.Steps[index].TimeoutMS = 15000
		}
	}
	return definition
}

func validateDefinition(definition Definition) error {
	parsed, err := url.Parse(strings.TrimSpace(definition.StartURL))
	if err != nil || parsed.Host == "" || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		return errors.New("startUrl must be an absolute HTTP or HTTPS URL")
	}
	if len(definition.Steps) == 0 {
		return errors.New("browser journey requires at least one step")
	}
	if len(definition.Steps) > 100 {
		return errors.New("browser journey cannot exceed 100 steps")
	}
	seen := map[string]bool{}
	for index, step := range definition.Steps {
		if strings.TrimSpace(step.ID) == "" || strings.TrimSpace(step.Name) == "" {
			return fmt.Errorf("step %d requires an id and name", index+1)
		}
		if seen[step.ID] {
			return fmt.Errorf("step id %q is duplicated", step.ID)
		}
		seen[step.ID] = true
		if step.TimeoutMS < 100 || step.TimeoutMS > 120000 {
			return fmt.Errorf("step %q timeout must be between 100 and 120000 ms", step.Name)
		}
	}
	for _, origin := range definition.AllowedOrigins {
		parsedOrigin, err := url.Parse(origin)
		if err != nil || parsedOrigin.Host == "" || (parsedOrigin.Scheme != "http" && parsedOrigin.Scheme != "https") {
			return errors.New("allowed origins must be absolute HTTP or HTTPS origins")
		}
	}
	return nil
}

func baselineFingerprint(revisionID, checkpointID, browserVersion, imageVersion string, viewport map[string]any) string {
	encoded, _ := json.Marshal(viewport)
	sum := sha256.Sum256([]byte(strings.Join([]string{revisionID, checkpointID, browserVersion, imageVersion, string(encoded)}, "|")))
	return hex.EncodeToString(sum[:16])
}

func terminal(status string) bool {
	switch status {
	case StatusSuccess, StatusSuccessWithWarnings, StatusFailed, StatusTimedOut, StatusCancelled, StatusAborted:
		return true
	}
	return false
}

func nonNilMap(value map[string]any) map[string]any {
	if value == nil {
		return map[string]any{}
	}
	return value
}

func nonNilSlice(value []map[string]any) []map[string]any {
	if value == nil {
		return []map[string]any{}
	}
	return value
}

func numeric(value any) (float64, bool) {
	switch typed := value.(type) {
	case float64:
		return typed, true
	case int:
		return float64(typed), true
	case int64:
		return float64(typed), true
	case json.Number:
		parsed, err := typed.Float64()
		return parsed, err == nil
	case string:
		parsed, err := strconv.ParseFloat(typed, 64)
		return parsed, err == nil
	default:
		return 0, false
	}
}

func safeError(err error) string {
	if err == nil {
		return ""
	}
	message := err.Error()
	message = regexp.MustCompile(`(?i)(authorization|cookie|token|password|secret)\s*[:=]\s*[^\s,;]+`).ReplaceAllString(message, "$1=MASKED")
	if len(message) > 500 {
		message = message[:500]
	}
	return message
}

func uniqueStrings(values []string) []string {
	seen := map[string]bool{}
	out := []string{}
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value != "" && !seen[value] {
			seen[value] = true
			out = append(out, value)
		}
	}
	sort.Strings(out)
	return out
}
