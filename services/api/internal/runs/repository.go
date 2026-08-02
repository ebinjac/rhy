package runs

import (
	"context"
	"errors"
	"sort"
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

type Repository interface {
	Save(context.Context, Run) error
	List(context.Context, string, int) ([]Run, error)
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
		var apiResponseMS int64
		var measured bool
		for _, step := range run.Steps {
			if _, recorded := step.Timing["apiResponseTimeMs"]; recorded {
				value := timingMilliseconds(step.Timing, "apiResponseTimeMs")
				apiResponseMS += value
				measured = true
			}
			point.PreparationMS += timingMilliseconds(step.Timing, "preparationMs")
			point.PostProcessingMS += timingMilliseconds(step.Timing, "postProcessingMs")
			point.NetworkTotalMS += timingMilliseconds(step.Timing, "networkTotalMs")
			point.RetryBackoffMS += timingMilliseconds(step.Timing, "retryBackoffMs")
			point.RetryCount += max(0, step.AttemptCount-1)
		}
		if measured {
			point.APIResponseTimeMS = &apiResponseMS
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
			if _, recorded := step.Timing["apiResponseTimeMs"]; recorded {
				value := timingMilliseconds(step.Timing, "apiResponseTimeMs")
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

func (r *MemoryRepository) List(_ context.Context, monitorID string, limit int) ([]Run, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	items := make([]Run, 0)
	for _, run := range r.runs {
		if run.MonitorID == monitorID {
			items = append(items, withListAPIResponseTime(run))
		}
	}
	sort.Slice(items, func(i, j int) bool { return items[i].CreatedAt.After(items[j].CreatedAt) })
	if len(items) > limit {
		items = items[:limit]
	}
	return items, nil
}

func withListAPIResponseTime(run Run) Run {
	if run.APIResponseTimeMS != nil {
		return run
	}
	var sum int64
	recorded := false
	for _, step := range run.Steps {
		if step.Timing == nil {
			continue
		}
		if _, ok := step.Timing["apiResponseTimeMs"]; !ok {
			continue
		}
		sum += timingMilliseconds(step.Timing, "apiResponseTimeMs")
		recorded = true
	}
	if recorded {
		run.APIResponseTimeMS = &sum
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
				if apiResponseMS := timingMilliseconds(step.Timing, "apiResponseTimeMs"); apiResponseMS > 0 {
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
