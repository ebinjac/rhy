package runs

import (
	"context"
	"errors"
	"sort"
	"strings"
	"sync"
	"time"
)

var ErrAlreadyQueued = errors.New("run is already queued")

type ExecutionSnapshot struct {
	MonitorName    string     `json:"monitorName"`
	EnvironmentID  string     `json:"environmentId,omitempty"`
	RevisionID     string     `json:"revisionId"`
	RevisionNumber int        `json:"revisionNumber"`
	Definition     Definition `json:"definition"`
}

type PageQuery struct {
	Limit          int
	AfterCreatedAt time.Time
	AfterID        string
	Since          time.Time
	Status         string
	TriggerType    string
	Query          string
}

type Page struct {
	Items   []Run
	Total   int
	HasMore bool
}

type Repository interface {
	Save(context.Context, Run) error
	List(context.Context, string, int) ([]Run, error)
	ListPage(context.Context, string, PageQuery) (Page, error)
	ListRecent(context.Context, int) ([]Run, error)
	Get(context.Context, string) (Run, error)
}

type QueueRequest struct {
	MonitorID         string             `json:"monitorId"`
	RevisionID        string             `json:"revisionId,omitempty"`
	ActorID           string             `json:"actorId"`
	Mode              string             `json:"mode"`
	TriggerType       string             `json:"triggerType,omitempty"`
	ScheduleID        string             `json:"scheduleId,omitempty"`
	ConcurrencyPolicy string             `json:"concurrencyPolicy,omitempty"`
	Deduplication     string             `json:"deduplicationKey,omitempty"`
	QueuedAt          time.Time          `json:"queuedAt"`
	RecoverySafe      bool               `json:"recoverySafe"`
	Snapshot          *ExecutionSnapshot `json:"snapshot,omitempty"`
}

// DurableRepository is implemented by persistent repositories that can create
// the queued run and its execution job in one transaction.
type DurableRepository interface {
	Enqueue(context.Context, Run, QueueRequest) error
	RequestCancel(context.Context, string) (bool, error)
}

type SummaryRepository interface {
	GetSummary(context.Context, string) (Run, error)
}

type EventRepository interface {
	ListEvents(context.Context, string, int, int) ([]RunEvent, int, bool, error)
}

type DiagnosticsSummaryRepository interface {
	GetDiagnosticsSummary(context.Context, string) (Run, RunAnalysis, error)
}

type StepRepository interface {
	GetStep(context.Context, string, string) (StepRun, error)
}

type IncrementalRepository interface {
	SaveDelta(context.Context, Run, []StepRun, []RunEvent) error
}

func (r *MemoryRepository) MetricPoints(_ context.Context, monitorID string, since time.Time, limit int) ([]HistoryMetricPoint, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	points := make([]HistoryMetricPoint, 0)
	for _, run := range r.runs {
		if run.MonitorID != monitorID || run.CreatedAt.Before(since) {
			continue
		}
		point := HistoryMetricPoint{RunID: run.ID, Status: run.Status, FailureCategory: run.FailureCategory, CreatedAt: run.CreatedAt, ExecutionDurationMS: run.DurationMS, QueueDelayMS: run.QueueDelayMS, WarningCount: run.WarningCount}
		if run.PreparationMS != nil {
			point.PreparationMS = *run.PreparationMS
		}
		var apiResponseMS int64
		var measured bool
		var preparationMS int64
		var preparationRecorded bool
		for _, step := range run.Steps {
			if value, recorded := StepAPIResponseMS(step); recorded {
				apiResponseMS += value
				measured = true
			}
			if value, recorded := RecordedPreparationMS(step.Timing); recorded {
				preparationMS += value
				preparationRecorded = true
			}
			point.PostProcessingMS += timingMilliseconds(step.Timing, "postProcessingMs")
			point.NetworkTotalMS += timingMilliseconds(step.Timing, "networkTotalMs")
			point.RetryBackoffMS += timingMilliseconds(step.Timing, "retryBackoffMs")
			point.RetryCount += max(0, step.AttemptCount-1)
		}
		if preparationRecorded {
			point.PreparationMS = preparationMS
		}
		if measured {
			point.APIResponseTimeMS = &apiResponseMS
		}
		if status, ok := LastAttemptResponseStatus(run.Steps); ok {
			point.ResponseStatus = &status
		}
		points = append(points, point)
	}
	sort.Slice(points, func(i, j int) bool { return points[i].CreatedAt.After(points[j].CreatedAt) })
	if len(points) > limit {
		points = points[:limit]
	}
	return points, nil
}

func (r *MemoryRepository) MetricPointsBetween(_ context.Context, monitorID, revisionID string, from, to time.Time, limit int) ([]HistoryMetricPoint, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	points := make([]HistoryMetricPoint, 0)
	for _, run := range r.runs {
		if run.MonitorID != monitorID || run.RevisionID != revisionID || run.CreatedAt.Before(from) || !run.CreatedAt.Before(to) {
			continue
		}
		point := HistoryMetricPoint{RunID: run.ID, RevisionID: run.RevisionID, Status: run.Status, FailureCategory: run.FailureCategory, CreatedAt: run.CreatedAt, ExecutionDurationMS: run.DurationMS, QueueDelayMS: run.QueueDelayMS, WarningCount: run.WarningCount}
		var total int64
		for _, step := range run.Steps {
			stepPoint := HistoryStepMetricPoint{StepDefinitionID: step.StepDefinitionID, StepName: step.StepName, StepType: step.StepType, Status: step.Status}
			if value, recorded := StepAPIResponseMS(step); recorded {
				stepPoint.APIResponseTimeMS = &value
				total += value
				point.Steps = append(point.Steps, stepPoint)
			}
		}
		if len(point.Steps) > 0 {
			point.APIResponseTimeMS = &total
		}
		points = append(points, point)
	}
	sort.Slice(points, func(i, j int) bool { return points[i].CreatedAt.Before(points[j].CreatedAt) })
	if len(points) > limit {
		points = points[len(points)-limit:]
	}
	return points, nil
}

func (r *MemoryRepository) ListRecent(_ context.Context, limit int) ([]Run, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	items := make([]Run, 0, len(r.runs))
	for _, run := range r.runs {
		items = append(items, run)
	}
	sort.Slice(items, func(i, j int) bool { return items[i].CreatedAt.After(items[j].CreatedAt) })
	if len(items) > limit {
		items = items[:limit]
	}
	return items, nil
}

type MemoryRepository struct {
	mu   sync.RWMutex
	runs map[string]Run
}

func NewMemoryRepository() *MemoryRepository { return &MemoryRepository{runs: make(map[string]Run)} }

func (r *MemoryRepository) Save(_ context.Context, run Run) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.runs[run.ID] = run
	return nil
}

func (r *MemoryRepository) List(ctx context.Context, monitorID string, limit int) ([]Run, error) {
	page, err := r.ListPage(ctx, monitorID, PageQuery{Limit: limit})
	if err != nil {
		return nil, err
	}
	return page.Items, nil
}

func (r *MemoryRepository) ListPage(_ context.Context, monitorID string, query PageQuery) (Page, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	query.Limit = normalizeRunPageLimit(query.Limit)
	needle := strings.ToLower(strings.TrimSpace(query.Query))
	items := make([]Run, 0)
	for _, run := range r.runs {
		if run.MonitorID != monitorID {
			continue
		}
		if !query.Since.IsZero() && run.CreatedAt.Before(query.Since) {
			continue
		}
		if status := strings.TrimSpace(query.Status); status != "" && string(run.Status) != status {
			continue
		}
		if trigger := strings.TrimSpace(query.TriggerType); trigger != "" && run.TriggerType != trigger {
			continue
		}
		if needle != "" && !strings.Contains(strings.ToLower(run.ID), needle) {
			continue
		}
		items = append(items, withListAPIResponseTime(run))
	}
	sort.Slice(items, func(i, j int) bool {
		if items[i].CreatedAt.Equal(items[j].CreatedAt) {
			return items[i].ID > items[j].ID
		}
		return items[i].CreatedAt.After(items[j].CreatedAt)
	})
	result := Page{Total: len(items)}
	if !query.AfterCreatedAt.IsZero() && strings.TrimSpace(query.AfterID) != "" {
		start := 0
		for start < len(items) {
			item := items[start]
			if item.CreatedAt.Before(query.AfterCreatedAt) || (item.CreatedAt.Equal(query.AfterCreatedAt) && item.ID < query.AfterID) {
				break
			}
			start++
		}
		items = items[start:]
	}
	result.Items = items
	if len(items) > query.Limit {
		result.HasMore = true
		result.Items = items[:query.Limit]
	}
	return result, nil
}

func normalizeRunPageLimit(limit int) int {
	if limit <= 0 {
		return 50
	}
	if limit > 200 {
		return 200
	}
	return limit
}

func withListAPIResponseTime(run Run) Run {
	if run.APIResponseTimeMS == nil {
		if sum, recorded := RunAPIResponseFromSteps(run.Steps); recorded {
			run.APIResponseTimeMS = &sum
		}
	}
	if run.PreparationMS == nil {
		if sum, recorded := RunPreparationFromSteps(run.Steps); recorded {
			run.PreparationMS = &sum
		}
	}
	return run
}

func (r *MemoryRepository) Get(_ context.Context, runID string) (Run, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	run, ok := r.runs[runID]
	if !ok {
		return Run{}, ErrNotFound
	}
	return run, nil
}

func (r *MemoryRepository) StepDurations(_ context.Context, monitorID, revisionID, stepDefinitionID, excludeRunID string, limit int, _ bool) ([]int64, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	type candidate struct {
		duration  int64
		createdAt int64
	}
	items := make([]candidate, 0)
	for _, run := range r.runs {
		if run.ID == excludeRunID || run.MonitorID != monitorID || run.Status != StatusSuccess || (revisionID != "" && run.RevisionID != revisionID) {
			continue
		}
		for _, step := range run.Steps {
			if step.StepDefinitionID == stepDefinitionID && step.Status == StatusSuccess {
				if apiResponseMS, recorded := StepAPIResponseMS(step); recorded && apiResponseMS > 0 {
					items = append(items, candidate{apiResponseMS, run.CreatedAt.UnixNano()})
				}
			}
		}
	}
	sort.Slice(items, func(i, j int) bool { return items[i].createdAt > items[j].createdAt })
	if len(items) > limit {
		items = items[:limit]
	}
	values := make([]int64, len(items))
	for index, item := range items {
		values[index] = item.duration
	}
	return values, nil
}
