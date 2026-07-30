package suites

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/rhythm-monitoring/rhythm/internal/dynatrace"
	"github.com/rhythm-monitoring/rhythm/internal/elf"
	"github.com/rhythm-monitoring/rhythm/internal/id"
	"github.com/rhythm-monitoring/rhythm/internal/runs"
)

type DeploymentRunInput struct {
	Deployment     DeploymentDetails `json:"deployment"`
	BaselineWindow string            `json:"baselineWindow,omitempty"`
	SampleCount    int               `json:"sampleCount,omitempty"`
	SampleInterval int               `json:"sampleIntervalSeconds,omitempty"`
}

type DeploymentDetails struct {
	DeploymentID          string    `json:"deploymentId,omitempty"`
	Version               string    `json:"version,omitempty"`
	Commit                string    `json:"commit,omitempty"`
	ApplicationID         string    `json:"applicationId,omitempty"`
	Environment           string    `json:"environment,omitempty"`
	Notes                 string    `json:"notes,omitempty"`
	DeploymentStart       time.Time `json:"deploymentStart"`
	DeploymentCompletedAt time.Time `json:"deploymentCompletedAt,omitempty"`
}

type DeploymentConfiguration struct {
	BaselineWindow           string            `json:"baselineWindow"`
	SampleCount              int               `json:"sampleCount"`
	SampleIntervalSeconds    int               `json:"sampleIntervalSeconds"`
	MinimumSamples           int               `json:"minimumSamples"`
	RegressionPercent        float64           `json:"regressionPercent"`
	RegressionMinimumMS      int64             `json:"regressionMinimumMs"`
	MonitorRevisionIDs       map[string]string `json:"monitorRevisionIds"`
	ELFRevisionIDs           map[string]string `json:"elfRevisionIds"`
	DynatraceRevisionNumbers map[string]int    `json:"dynatraceRevisionNumbers"`
}

type DeploymentProgress struct {
	Completed int    `json:"completed"`
	Total     int    `json:"total"`
	Message   string `json:"message"`
}

type MetricSeriesPoint struct {
	RunID     string    `json:"runId,omitempty"`
	ValueMS   int64     `json:"valueMs"`
	CreatedAt time.Time `json:"createdAt"`
}

type Distribution struct {
	SampleCount         int                 `json:"sampleCount"`
	CompletedCount      int                 `json:"completedCount"`
	SuccessCount        int                 `json:"successCount"`
	FailureCount        int                 `json:"failureCount"`
	TimeoutCount        int                 `json:"timeoutCount"`
	SuccessRate         float64             `json:"successRate"`
	ErrorRate           float64             `json:"errorRate"`
	TimeoutRate         float64             `json:"timeoutRate"`
	MinMS               int64               `json:"minMs,omitempty"`
	AverageMS           int64               `json:"averageMs,omitempty"`
	P50MS               int64               `json:"p50Ms,omitempty"`
	P75MS               int64               `json:"p75Ms,omitempty"`
	P90MS               int64               `json:"p90Ms,omitempty"`
	P95MS               int64               `json:"p95Ms,omitempty"`
	P99MS               int64               `json:"p99Ms,omitempty"`
	MaxMS               int64               `json:"maxMs,omitempty"`
	StandardDeviationMS float64             `json:"standardDeviationMs,omitempty"`
	FailureCategories   map[string]int      `json:"failureCategories"`
	Series              []MetricSeriesPoint `json:"series"`
}

type StepComparison struct {
	StepDefinitionID string       `json:"stepDefinitionId"`
	StepName         string       `json:"stepName"`
	Baseline         Distribution `json:"baseline"`
	Post             Distribution `json:"post"`
	Classification   string       `json:"classification"`
	DeltaMS          int64        `json:"deltaMs"`
	DeltaPercent     float64      `json:"deltaPercent"`
}

type DeploymentSample struct {
	ID              string    `json:"id"`
	MonitorID       string    `json:"monitorId"`
	MonitorRunID    string    `json:"monitorRunId,omitempty"`
	SampleNumber    int       `json:"sampleNumber"`
	Status          string    `json:"status"`
	DurationMS      int64     `json:"durationMs"`
	FailureCategory string    `json:"failureCategory,omitempty"`
	CreatedAt       time.Time `json:"createdAt"`
}

type MonitorComparison struct {
	CheckID        string             `json:"checkId"`
	MonitorID      string             `json:"monitorId"`
	MonitorName    string             `json:"monitorName"`
	RevisionID     string             `json:"revisionId"`
	Required       bool               `json:"required"`
	Baseline       Distribution       `json:"baseline"`
	Post           Distribution       `json:"post"`
	Classification string             `json:"classification"`
	DeltaMS        int64              `json:"deltaMs"`
	DeltaPercent   float64            `json:"deltaPercent"`
	Steps          []StepComparison   `json:"steps"`
	Samples        []DeploymentSample `json:"samples"`
	Reasons        []string           `json:"reasons"`
}

type DynatraceComparison struct {
	CheckID               string                          `json:"checkId"`
	Name                  string                          `json:"name"`
	ApplicationID         string                          `json:"applicationId"`
	EnvironmentBindingID  string                          `json:"environmentBindingId"`
	ServiceID             string                          `json:"serviceId,omitempty"`
	Required              bool                            `json:"required"`
	GateMode              string                          `json:"gateMode"`
	BaselineRunID         string                          `json:"baselineRunId,omitempty"`
	PostRunID             string                          `json:"postRunId,omitempty"`
	Status                string                          `json:"status"`
	Decision              string                          `json:"decision"`
	BaselineSummary       map[string]dynatrace.Statistics `json:"baselineSummary"`
	PostSummary           map[string]dynatrace.Statistics `json:"postSummary"`
	BaselineResourceCount int                             `json:"baselineResourceCount"`
	PostResourceCount     int                             `json:"postResourceCount"`
	AddedResources        int                             `json:"addedResources"`
	MissingResources      int                             `json:"missingResources"`
	RuleResults           []dynatrace.RuleResult          `json:"ruleResults"`
	RuleIDs               []string                        `json:"ruleIds,omitempty"`
	BaselineFrom          time.Time                       `json:"baselineFrom"`
	BaselineTo            time.Time                       `json:"baselineTo"`
	PostFrom              *time.Time                      `json:"postFrom,omitempty"`
	PostTo                *time.Time                      `json:"postTo,omitempty"`
	StabilizationSeconds  int                             `json:"stabilizationSeconds"`
	PostWindowSeconds     int                             `json:"postWindowSeconds"`
	FailureCategory       string                          `json:"failureCategory,omitempty"`
	FailureReason         string                          `json:"failureReason,omitempty"`
}

type DeploymentReport struct {
	RunID            string                  `json:"runId"`
	SuiteID          string                  `json:"suiteId"`
	SuiteName        string                  `json:"suiteName"`
	Status           string                  `json:"status"`
	GateDecision     string                  `json:"gateDecision"`
	Recommendation   string                  `json:"recommendation"`
	Deployment       DeploymentDetails       `json:"deployment"`
	Configuration    DeploymentConfiguration `json:"configuration"`
	BaselineFrom     time.Time               `json:"baselineFrom"`
	BaselineTo       time.Time               `json:"baselineTo"`
	PostFrom         *time.Time              `json:"postFrom,omitempty"`
	PostTo           *time.Time              `json:"postTo,omitempty"`
	Monitors         []MonitorComparison     `json:"monitors"`
	DynatraceResults []DynatraceComparison   `json:"dynatraceResults"`
	ELFResults       []CheckResult           `json:"elfResults"`
	AlertResults     []CheckResult           `json:"alertResults"`
	Warnings         []string                `json:"warnings"`
	Reasons          []string                `json:"reasons"`
	GeneratedAt      time.Time               `json:"generatedAt"`
}

type DeploymentRun struct {
	ID                string                  `json:"id"`
	SuiteID           string                  `json:"suiteId"`
	Status            string                  `json:"status"`
	Phase             string                  `json:"phase"`
	GateDecision      string                  `json:"gateDecision"`
	Progress          DeploymentProgress      `json:"progress"`
	Deployment        DeploymentDetails       `json:"deployment"`
	Configuration     DeploymentConfiguration `json:"configuration"`
	SuiteSnapshot     Suite                   `json:"suiteSnapshot"`
	Report            DeploymentReport        `json:"report"`
	FailureReason     string                  `json:"failureReason,omitempty"`
	CreatedBy         string                  `json:"createdBy"`
	BaselineStartedAt *time.Time              `json:"baselineStartedAt,omitempty"`
	BaselineEndedAt   *time.Time              `json:"baselineEndedAt,omitempty"`
	SamplingStartedAt *time.Time              `json:"samplingStartedAt,omitempty"`
	SamplingEndedAt   *time.Time              `json:"samplingEndedAt,omitempty"`
	StartedAt         *time.Time              `json:"startedAt,omitempty"`
	EndedAt           *time.Time              `json:"endedAt,omitempty"`
	CreatedAt         time.Time               `json:"createdAt"`
	UpdatedAt         time.Time               `json:"updatedAt"`
}

type DeploymentFilter struct {
	SuiteID, ApplicationID, Environment, Status, Decision string
}

type BaselinePreviewInput struct {
	DeploymentStart       time.Time `json:"deploymentStart"`
	BaselineWindow        string    `json:"baselineWindow"`
	SampleCount           int       `json:"sampleCount"`
	SampleIntervalSeconds int       `json:"sampleIntervalSeconds"`
}

type BaselineMonitorPreview struct {
	MonitorID      string    `json:"monitorId"`
	MonitorName    string    `json:"monitorName"`
	RevisionID     string    `json:"revisionId,omitempty"`
	BaselineFrom   time.Time `json:"baselineFrom"`
	BaselineTo     time.Time `json:"baselineTo"`
	SampleCount    int       `json:"sampleCount"`
	MinimumSamples int       `json:"minimumSamples"`
	Compatible     bool      `json:"compatible"`
	Reason         string    `json:"reason,omitempty"`
}

type BaselinePreview struct {
	Monitors                []BaselineMonitorPreview `json:"monitors"`
	TotalAvailableSamples   int                      `json:"totalAvailableSamples"`
	EstimatedExecutions     int                      `json:"estimatedExecutions"`
	EstimatedMaximumSeconds int                      `json:"estimatedMaximumSeconds"`
	BlockingDependencies    []string                 `json:"blockingDependencies"`
}

func (s *Service) PreviewDeploymentBaseline(ctx context.Context, suiteID string, input BaselinePreviewInput) (BaselinePreview, error) {
	suite, err := s.repository.Get(ctx, suiteID)
	if err != nil {
		return BaselinePreview{}, err
	}
	if input.DeploymentStart.IsZero() {
		return BaselinePreview{}, errors.New("deploymentStart is required")
	}
	window := strings.ToLower(strings.TrimSpace(input.BaselineWindow))
	duration, ok := map[string]time.Duration{"24h": 24 * time.Hour, "7d": 7 * 24 * time.Hour, "30d": 30 * 24 * time.Hour}[window]
	if !ok {
		return BaselinePreview{}, errors.New("baselineWindow must be 24h, 7d, or 30d")
	}
	if input.SampleCount < 3 || input.SampleCount > 50 {
		return BaselinePreview{}, errors.New("sampleCount must be between 3 and 50")
	}
	if input.SampleIntervalSeconds < 1 || input.SampleIntervalSeconds > 300 {
		return BaselinePreview{}, errors.New("sampleIntervalSeconds must be between 1 and 300")
	}
	from, to := input.DeploymentStart.Add(-duration), input.DeploymentStart
	seen := map[string]bool{}
	preview := BaselinePreview{Monitors: []BaselineMonitorPreview{}, BlockingDependencies: []string{}}
	for _, stage := range suite.Stages {
		for _, check := range stage.Checks {
			if check.Kind != "MONITOR" || seen[check.MonitorID] {
				continue
			}
			seen[check.MonitorID] = true
			monitor, monitorErr := s.runs.Monitor(ctx, check.MonitorID)
			if monitorErr != nil {
				preview.BlockingDependencies = append(preview.BlockingDependencies, "A selected monitor could not be loaded.")
				continue
			}
			item := BaselineMonitorPreview{MonitorID: monitor.ID, MonitorName: monitor.Name, RevisionID: monitor.LatestPublishedRevisionID, BaselineFrom: from, BaselineTo: to, MinimumSamples: 5}
			if item.RevisionID == "" {
				item.Reason = "No published revision is available."
				preview.BlockingDependencies = append(preview.BlockingDependencies, monitor.Name+" must be published.")
				preview.Monitors = append(preview.Monitors, item)
				continue
			}
			points, pointErr := s.runs.DeploymentMetricPoints(ctx, monitor.ID, item.RevisionID, from, to, 5000)
			if pointErr != nil {
				item.Reason = "Baseline history could not be loaded."
			} else {
				item.SampleCount = summarize(points).SampleCount
				item.Compatible = item.SampleCount >= item.MinimumSamples
				if !item.Compatible {
					item.Reason = "Fewer than five successful same-revision API timing samples are available."
				}
				preview.TotalAvailableSamples += item.SampleCount
			}
			preview.Monitors = append(preview.Monitors, item)
		}
	}
	monitorCount := len(preview.Monitors)
	preview.EstimatedExecutions = monitorCount * input.SampleCount
	parallelism := max(1, min(suite.Parallelism, monitorCount))
	waves := 0
	if monitorCount > 0 {
		waves = (monitorCount + parallelism - 1) / parallelism
	}
	perMonitor := input.SampleCount*suite.TimeoutSeconds + max(0, input.SampleCount-1)*input.SampleIntervalSeconds
	preview.EstimatedMaximumSeconds = waves * perMonitor
	return preview, nil
}

type DeploymentRepository interface {
	CreateDeploymentRun(context.Context, DeploymentRun) error
	UpdateDeploymentRun(context.Context, DeploymentRun) error
	GetDeploymentRun(context.Context, string) (DeploymentRun, error)
	ListDeploymentRuns(context.Context, DeploymentFilter) ([]DeploymentRun, error)
	SaveDeploymentSample(context.Context, string, DeploymentSample) error
}

func (s *Service) CreateDeploymentRun(ctx context.Context, suiteID, actor string, input DeploymentRunInput) (DeploymentRun, error) {
	repository, ok := s.repository.(DeploymentRepository)
	if !ok {
		return DeploymentRun{}, errors.New("deployment validation requires persistent storage")
	}
	suite, err := s.repository.Get(ctx, suiteID)
	if err != nil {
		return DeploymentRun{}, err
	}
	if input.Deployment.DeploymentStart.IsZero() {
		return DeploymentRun{}, errors.New("deployment.deploymentStart is required")
	}
	windows := map[string]time.Duration{"24h": 24 * time.Hour, "7d": 7 * 24 * time.Hour, "30d": 30 * 24 * time.Hour}
	window := strings.ToLower(strings.TrimSpace(input.BaselineWindow))
	if window == "" {
		window = "24h"
	}
	if _, ok := windows[window]; !ok {
		return DeploymentRun{}, errors.New("baselineWindow must be 24h, 7d, or 30d")
	}
	if input.SampleCount == 0 {
		input.SampleCount = 10
	}
	if input.SampleCount < 3 || input.SampleCount > 50 {
		return DeploymentRun{}, errors.New("sampleCount must be between 3 and 50")
	}
	if input.SampleInterval == 0 {
		input.SampleInterval = 5
	}
	if input.SampleInterval < 1 || input.SampleInterval > 300 {
		return DeploymentRun{}, errors.New("sampleIntervalSeconds must be between 1 and 300")
	}
	runID, err := id.NewUUID()
	if err != nil {
		return DeploymentRun{}, err
	}
	now := s.now()
	monitorCount, elfCount, alertCount, dynatraceCount := deploymentCheckCounts(suite)
	if dynatraceCount > 0 {
		if input.Deployment.DeploymentCompletedAt.IsZero() {
			return DeploymentRun{}, errors.New("deployment.deploymentCompletedAt is required for Dynatrace infrastructure validation")
		}
		if input.Deployment.DeploymentCompletedAt.Before(input.Deployment.DeploymentStart) {
			return DeploymentRun{}, errors.New("deployment.deploymentCompletedAt must not be before deploymentStart")
		}
	}
	configuration := DeploymentConfiguration{BaselineWindow: window, SampleCount: input.SampleCount, SampleIntervalSeconds: input.SampleInterval, MinimumSamples: 5, RegressionPercent: 25, RegressionMinimumMS: 100, MonitorRevisionIDs: map[string]string{}, ELFRevisionIDs: map[string]string{}, DynatraceRevisionNumbers: map[string]int{}}
	for _, stage := range suite.Stages {
		for _, check := range stage.Checks {
			switch check.Kind {
			case "ELF_QUERY":
				if s.elf == nil {
					return DeploymentRun{}, errors.New("suite contains ELF checks but ELF execution is unavailable")
				}
				query, queryErr := s.elf.GetQuery(ctx, check.QueryID)
				if queryErr != nil {
					return DeploymentRun{}, queryErr
				}
				configuration.ELFRevisionIDs[check.QueryID] = query.CurrentRevisionID
			case "OPENSEARCH_ALERT":
				if s.alerts == nil {
					return DeploymentRun{}, errors.New("suite contains OpenSearch alert checks but alerting is unavailable")
				}
				if _, err := s.alerts.GetReceiver(ctx, check.ReceiverID); err != nil {
					return DeploymentRun{}, fmt.Errorf("OpenSearch alert receiver %s was not found", check.ReceiverID)
				}
			case "DYNATRACE_INFRASTRUCTURE":
				if s.dynatrace == nil {
					return DeploymentRun{}, errors.New("suite contains Dynatrace checks but Dynatrace execution is unavailable")
				}
				config, configErr := s.dynatrace.GetConfiguration(ctx, check.ApplicationID, check.EnvironmentBindingID)
				if configErr != nil {
					return DeploymentRun{}, configErr
				}
				configuration.DynatraceRevisionNumbers[check.ApplicationID+"|"+check.EnvironmentBindingID] = config.RevisionNumber
			default:
				monitor, monitorErr := s.runs.Monitor(ctx, check.MonitorID)
				if monitorErr != nil {
					return DeploymentRun{}, monitorErr
				}
				if monitor.LatestPublishedRevisionID == "" {
					return DeploymentRun{}, fmt.Errorf("monitor %s has no published revision", monitor.Name)
				}
				configuration.MonitorRevisionIDs[check.MonitorID] = monitor.LatestPublishedRevisionID
			}
		}
	}
	run := DeploymentRun{ID: runID, SuiteID: suiteID, Status: "QUEUED", Phase: "QUEUED", GateDecision: "PENDING", Progress: DeploymentProgress{Total: monitorCount*input.SampleCount + elfCount + alertCount + dynatraceCount*2, Message: "Waiting for a validation worker."}, Deployment: input.Deployment, Configuration: configuration, SuiteSnapshot: suite, CreatedBy: actor, CreatedAt: now, UpdatedAt: now}
	if err := repository.CreateDeploymentRun(ctx, run); err != nil {
		return DeploymentRun{}, err
	}
	runCtx, cancel := context.WithCancel(context.Background())
	s.mu.Lock()
	s.cancels[runID] = cancel
	s.mu.Unlock()
	go func() {
		defer func() { s.mu.Lock(); delete(s.cancels, runID); s.mu.Unlock() }()
		s.processDeployment(runCtx, run)
	}()
	return run, nil
}

func deploymentCheckCounts(suite Suite) (int, int, int, int) {
	monitors, queries, alertKeys, dynatraceKeys := map[string]bool{}, map[string]bool{}, map[string]bool{}, map[string]bool{}
	for _, stage := range suite.Stages {
		for _, check := range stage.Checks {
			switch check.Kind {
			case "ELF_QUERY":
				queries[check.QueryID] = true
			case "OPENSEARCH_ALERT":
				alertKeys[strings.Join([]string{check.ReceiverID, check.ExternalMonitorID, check.ExternalTriggerID, check.ExternalMonitorName, check.ExternalTriggerName}, "|")] = true
			case "DYNATRACE_INFRASTRUCTURE":
				services := check.ServiceIDs
				if len(services) == 0 {
					services = []string{""}
				}
				for _, serviceID := range services {
					dynatraceKeys[check.ApplicationID+"|"+check.EnvironmentBindingID+"|"+serviceID] = true
				}
			default:
				monitors[check.MonitorID] = true
			}
		}
	}
	return len(monitors), len(queries), len(alertKeys), len(dynatraceKeys)
}

func (s *Service) GetDeploymentRun(ctx context.Context, id string) (DeploymentRun, error) {
	repo, ok := s.repository.(DeploymentRepository)
	if !ok {
		return DeploymentRun{}, ErrNotFound
	}
	run, err := repo.GetDeploymentRun(ctx, id)
	if err != nil {
		return run, err
	}
	normalizeDeploymentReport(&run.Report)
	return run, nil
}
func (s *Service) ListDeploymentRuns(ctx context.Context, filter DeploymentFilter) ([]DeploymentRun, error) {
	repo, ok := s.repository.(DeploymentRepository)
	if !ok {
		return []DeploymentRun{}, nil
	}
	runs, err := repo.ListDeploymentRuns(ctx, filter)
	if err != nil {
		return runs, err
	}
	for index := range runs {
		normalizeDeploymentReport(&runs[index].Report)
	}
	return runs, nil
}
func (s *Service) CancelDeploymentRun(ctx context.Context, id string) (DeploymentRun, error) {
	run, err := s.GetDeploymentRun(ctx, id)
	if err != nil {
		return run, err
	}
	s.mu.Lock()
	cancel := s.cancels[id]
	s.mu.Unlock()
	if cancel == nil {
		return run, errors.New("deployment validation is not active on this worker")
	}
	run.Status = "CANCELLING"
	run.Phase = "CANCELLING"
	run.UpdatedAt = s.now()
	_ = s.saveDeployment(ctx, run)
	cancel()
	return run, nil
}
func (s *Service) saveDeployment(ctx context.Context, run DeploymentRun) error {
	run.UpdatedAt = s.now()
	normalizeDeploymentReport(&run.Report)
	repo := s.repository.(DeploymentRepository)
	return repo.UpdateDeploymentRun(context.WithoutCancel(ctx), run)
}

func (s *Service) processDeployment(ctx context.Context, run DeploymentRun) {
	failed := func(err error) {
		now := s.now()
		run.Status = "FAILED"
		run.Phase = "FAILED"
		run.GateDecision = "BLOCK"
		run.FailureReason = safeError(err)
		run.EndedAt = &now
		run.Report.Status = run.Status
		run.Report.GateDecision = run.GateDecision
		run.Report.Recommendation = "Do not promote this deployment until validation can complete."
		run.Report.GeneratedAt = now
		_ = s.saveDeployment(context.Background(), run)
	}
	started := s.now()
	run.StartedAt = &started
	run.Status = "RUNNING"
	run.Phase = "CAPTURING_BASELINE"
	run.Progress.Message = "Capturing the pre-deployment baseline."
	if err := s.saveDeployment(ctx, run); err != nil {
		return
	}
	duration := map[string]time.Duration{"24h": 24 * time.Hour, "7d": 7 * 24 * time.Hour, "30d": 30 * 24 * time.Hour}[run.Configuration.BaselineWindow]
	baselineFrom, baselineTo := run.Deployment.DeploymentStart.Add(-duration), run.Deployment.DeploymentStart
	run.BaselineStartedAt = &baselineFrom
	comparisons := deploymentMonitorComparisons(run.SuiteSnapshot)
	for index := range comparisons {
		monitor, err := s.runs.Monitor(ctx, comparisons[index].MonitorID)
		if err != nil {
			failed(err)
			return
		}
		comparisons[index].MonitorName = monitor.Name
		comparisons[index].RevisionID = run.Configuration.MonitorRevisionIDs[monitor.ID]
		points, err := s.runs.DeploymentMetricPoints(ctx, monitor.ID, comparisons[index].RevisionID, baselineFrom, baselineTo, 5000)
		if err != nil {
			failed(err)
			return
		}
		comparisons[index].Baseline = summarize(points)
		comparisons[index].Steps = baselineSteps(points)
		if comparisons[index].Baseline.SampleCount < run.Configuration.MinimumSamples {
			comparisons[index].Reasons = append(comparisons[index].Reasons, "Fewer than five successful baseline samples were recorded.")
		}
	}
	dynatraceComparisons := s.deploymentDynatraceComparisons(ctx, run, baselineFrom, baselineTo)
	for index := range dynatraceComparisons {
		comparison := &dynatraceComparisons[index]
		if comparison.FailureCategory == "DYNATRACE_REVISION_CHANGED" || comparison.FailureCategory == "DYNATRACE_CONFIGURATION_UNAVAILABLE" {
			run.Progress.Completed++
			continue
		}
		baselineRun, queryErr := s.dynatrace.Query(ctx, comparison.ApplicationID, comparison.EnvironmentBindingID, dynatrace.QueryInput{
			ServiceID: comparison.ServiceID, TimeFrom: baselineFrom, TimeTo: baselineTo, DeploymentRunID: run.ID,
		}, run.CreatedBy)
		comparison.BaselineRunID = baselineRun.ID
		comparison.BaselineSummary = baselineRun.Summary
		comparison.BaselineResourceCount = baselineRun.ResourceCount
		if queryErr != nil {
			comparison.Status = baselineRun.Status
			comparison.FailureCategory = defaultString(baselineRun.FailureCategory, "DYNATRACE_BASELINE_FAILED")
			comparison.FailureReason = defaultString(baselineRun.FailureReason, safeError(queryErr))
		}
		run.Progress.Completed++
	}
	baselineEnded := s.now()
	run.BaselineEndedAt = &baselineEnded
	run.Report = DeploymentReport{RunID: run.ID, SuiteID: run.SuiteID, SuiteName: run.SuiteSnapshot.Name, Status: run.Status, GateDecision: "PENDING", Deployment: run.Deployment, Configuration: run.Configuration, BaselineFrom: baselineFrom, BaselineTo: baselineTo, Monitors: comparisons, DynatraceResults: dynatraceComparisons}
	_ = s.saveDeployment(ctx, run)
	if ctx.Err() != nil {
		s.finishCancelled(run)
		return
	}
	samplingStarted := s.now()
	run.SamplingStartedAt = &samplingStarted
	run.Phase = "SAMPLING_MONITORS"
	run.Progress.Message = "Running post-deployment monitor samples."
	run.Report.PostFrom = &samplingStarted
	_ = s.saveDeployment(ctx, run)
	var mu sync.Mutex
	jobs := make(chan int)
	workers := min(run.SuiteSnapshot.Parallelism, len(comparisons))
	var group sync.WaitGroup
	for range workers {
		group.Add(1)
		go func() {
			defer group.Done()
			for index := range jobs {
				for number := 1; number <= run.Configuration.SampleCount; number++ {
					if ctx.Err() != nil {
						return
					}
					executed, err := s.runs.RunTriggered(ctx, comparisons[index].MonitorID, run.ID, "DEPLOYMENT_VALIDATION")
					sampleID, _ := id.NewUUID()
					sample := DeploymentSample{ID: sampleID, MonitorID: comparisons[index].MonitorID, SampleNumber: number, CreatedAt: s.now()}
					if err != nil {
						sample.Status = "FAILED"
						sample.FailureCategory = "EXECUTION_ERROR"
					} else {
						sample.MonitorRunID = executed.ID
						sample.Status = string(executed.Status)
						sample.DurationMS = executed.DurationMS
						sample.FailureCategory = executed.FailureCategory
						if executed.RevisionID != comparisons[index].RevisionID {
							sample.Status = "FAILED"
							sample.FailureCategory = "MONITOR_REVISION_CHANGED"
						}
					}
					mu.Lock()
					comparisons[index].Samples = append(comparisons[index].Samples, sample)
					run.Report.Monitors = comparisons
					run.Progress.Completed++
					run.Progress.Message = fmt.Sprintf("Collected sample %d of %d for %s.", number, run.Configuration.SampleCount, comparisons[index].MonitorName)
					_ = s.repository.(DeploymentRepository).SaveDeploymentSample(context.Background(), run.ID, sample)
					_ = s.saveDeployment(context.Background(), run)
					mu.Unlock()
					if number < run.Configuration.SampleCount {
						select {
						case <-ctx.Done():
							return
						case <-time.After(time.Duration(run.Configuration.SampleIntervalSeconds) * time.Second):
						}
					}
				}
			}
		}()
	}
	for index := range comparisons {
		select {
		case jobs <- index:
		case <-ctx.Done():
			break
		}
	}
	close(jobs)
	group.Wait()
	if ctx.Err() != nil {
		s.finishCancelled(run)
		return
	}
	for index := range comparisons {
		points := make([]runs.HistoryMetricPoint, 0, len(comparisons[index].Samples))
		for _, sample := range comparisons[index].Samples {
			if sample.MonitorRunID == "" {
				continue
			}
			execution, err := s.runs.Get(ctx, sample.MonitorRunID)
			if err == nil {
				points = append(points, metricPoint(execution))
			}
		}
		comparisons[index].Post = summarize(points)
		comparisons[index].Steps = completeSteps(comparisons[index].Steps, points, run.Configuration)
		classifyMonitor(&comparisons[index], run.Configuration)
	}
	samplingEnded := s.now()
	run.SamplingEndedAt = &samplingEnded
	run.Report.PostTo = &samplingEnded
	run.Report.Monitors = comparisons
	if len(run.Report.DynatraceResults) > 0 {
		run.Phase = "WAITING_FOR_STABILIZATION"
		run.Progress.Message = "Waiting for the deployment stabilization and infrastructure observation window."
		waitUntil := run.Deployment.DeploymentCompletedAt
		for _, comparison := range run.Report.DynatraceResults {
			candidate := run.Deployment.DeploymentCompletedAt.Add(time.Duration(comparison.StabilizationSeconds+comparison.PostWindowSeconds) * time.Second)
			if candidate.After(waitUntil) {
				waitUntil = candidate
			}
		}
		_ = s.saveDeployment(ctx, run)
		if delay := waitUntil.Sub(s.now()); delay > 0 {
			timer := time.NewTimer(delay)
			select {
			case <-ctx.Done():
				timer.Stop()
				s.finishCancelled(run)
				return
			case <-timer.C:
			}
		}
		run.Phase = "RUNNING_DYNATRACE"
		run.Progress.Message = "Comparing post-deployment Dynatrace infrastructure metrics."
		_ = s.saveDeployment(ctx, run)
		for index := range run.Report.DynatraceResults {
			comparison := &run.Report.DynatraceResults[index]
			if comparison.FailureCategory == "DYNATRACE_REVISION_CHANGED" || comparison.FailureCategory == "DYNATRACE_CONFIGURATION_UNAVAILABLE" {
				run.Progress.Completed++
				continue
			}
			postFrom := run.Deployment.DeploymentCompletedAt.Add(time.Duration(comparison.StabilizationSeconds) * time.Second)
			postTo := postFrom.Add(time.Duration(comparison.PostWindowSeconds) * time.Second)
			comparison.PostFrom, comparison.PostTo = &postFrom, &postTo
			postRun, queryErr := s.dynatrace.Query(ctx, comparison.ApplicationID, comparison.EnvironmentBindingID, dynatrace.QueryInput{
				ServiceID: comparison.ServiceID, TimeFrom: postFrom, TimeTo: postTo, DeploymentRunID: run.ID,
			}, run.CreatedBy)
			comparison.PostRunID = postRun.ID
			comparison.PostSummary = postRun.Summary
			comparison.PostResourceCount = postRun.ResourceCount
			comparison.AddedResources = max(0, comparison.PostResourceCount-comparison.BaselineResourceCount)
			comparison.MissingResources = max(0, comparison.BaselineResourceCount-comparison.PostResourceCount)
			if queryErr != nil {
				comparison.Status = postRun.Status
				comparison.Decision = postRun.Decision
				comparison.FailureCategory = defaultString(postRun.FailureCategory, "DYNATRACE_POST_QUERY_FAILED")
				comparison.FailureReason = defaultString(postRun.FailureReason, safeError(queryErr))
			} else {
				results, decision, compareErr := s.dynatrace.CompareRuns(ctx, comparison.ApplicationID, comparison.EnvironmentBindingID, comparison.ServiceID, dynatrace.Run{Summary: comparison.BaselineSummary, CoveragePercent: 100}, postRun, comparison.RuleIDs)
				if compareErr != nil {
					comparison.Status, comparison.Decision = "ERROR", "ALLOW_WITH_WARNINGS"
					comparison.FailureCategory, comparison.FailureReason = "DYNATRACE_COMPARISON_FAILED", safeError(compareErr)
				} else {
					comparison.RuleResults, comparison.Decision = results, decision
					switch decision {
					case "BLOCK":
						comparison.Status = "FAIL"
					case "ALLOW_WITH_WARNINGS":
						comparison.Status = "WARNING"
					default:
						comparison.Status = "PASS"
					}
				}
			}
			run.Progress.Completed++
			_ = s.saveDeployment(ctx, run)
		}
	}
	run.Phase = "RUNNING_ELF"
	run.Progress.Message = "Checking deployment logs in ELF."
	_ = s.saveDeployment(ctx, run)
	for _, stage := range run.SuiteSnapshot.Stages {
		for _, check := range stage.Checks {
			if check.Kind != "ELF_QUERY" {
				continue
			}
			result := s.runDeploymentELF(ctx, stage, check, run)
			run.Report.ELFResults = append(run.Report.ELFResults, result)
			run.Progress.Completed++
			_ = s.saveDeployment(ctx, run)
			if ctx.Err() != nil {
				s.finishCancelled(run)
				return
			}
		}
	}
	run.Phase = "CHECKING_ALERTS"
	run.Progress.Message = "Checking OpenSearch alerts from receivers."
	_ = s.saveDeployment(ctx, run)
	for _, stage := range run.SuiteSnapshot.Stages {
		for _, check := range stage.Checks {
			if check.Kind != "OPENSEARCH_ALERT" {
				continue
			}
			started := s.now()
			result := s.evaluateOpenSearchAlertCheck(ctx, stage, check, &run.Deployment.DeploymentStart)
			result.DurationMS = s.now().Sub(started).Milliseconds()
			run.Report.AlertResults = append(run.Report.AlertResults, result)
			run.Progress.Completed++
			_ = s.saveDeployment(ctx, run)
			if ctx.Err() != nil {
				s.finishCancelled(run)
				return
			}
		}
	}
	run.Phase = "ANALYZING"
	run.Progress.Message = "Calculating the deployment decision."
	_ = s.saveDeployment(ctx, run)
	decision, warnings, reasons := deploymentDecisionWithDynatrace(comparisons, run.Report.DynatraceResults, run.Report.ELFResults, run.Report.AlertResults)
	now := s.now()
	run.Status = "COMPLETED"
	run.Phase = "COMPLETED"
	run.GateDecision = decision
	run.EndedAt = &now
	run.Progress.Completed = run.Progress.Total
	run.Progress.Message = "Deployment validation completed."
	run.Report.Status = run.Status
	run.Report.GateDecision = decision
	run.Report.Warnings = warnings
	run.Report.Reasons = reasons
	run.Report.GeneratedAt = now
	switch decision {
	case "BLOCK":
		run.Report.Recommendation = "Do not promote this deployment until the blocking checks are resolved."
	case "ALLOW_WITH_WARNINGS":
		run.Report.Recommendation = "Promotion is allowed, with warnings that should be reviewed."
	default:
		run.Report.Recommendation = "The deployment passed performance, functional, ELF, and OpenSearch alert validation."
	}
	_ = s.saveDeployment(context.Background(), run)
}

func (s *Service) finishCancelled(run DeploymentRun) {
	now := s.now()
	run.Status = "CANCELLED"
	run.Phase = "CANCELLED"
	run.GateDecision = "BLOCK"
	run.EndedAt = &now
	run.Report.Status = run.Status
	run.Report.GateDecision = run.GateDecision
	run.Report.Recommendation = "Validation was cancelled before a complete release decision could be produced."
	run.Report.GeneratedAt = now
	_ = s.saveDeployment(context.Background(), run)
}
func deploymentMonitorComparisons(suite Suite) []MonitorComparison {
	byID := map[string]int{}
	out := []MonitorComparison{}
	for _, stage := range suite.Stages {
		for _, check := range stage.Checks {
			if check.Kind == "ELF_QUERY" || check.Kind == "OPENSEARCH_ALERT" || check.Kind == "DYNATRACE_INFRASTRUCTURE" {
				continue
			}
			if index, ok := byID[check.MonitorID]; ok {
				out[index].Required = out[index].Required || check.Required
				continue
			}
			byID[check.MonitorID] = len(out)
			out = append(out, MonitorComparison{CheckID: check.ID, MonitorID: check.MonitorID, MonitorName: check.Name, Required: check.Required, Baseline: emptyDistribution(), Post: emptyDistribution(), Steps: []StepComparison{}, Samples: []DeploymentSample{}, Reasons: []string{}})
		}
	}
	return out
}

func (s *Service) deploymentDynatraceComparisons(ctx context.Context, run DeploymentRun, baselineFrom, baselineTo time.Time) []DynatraceComparison {
	out := []DynatraceComparison{}
	for _, stage := range run.SuiteSnapshot.Stages {
		for _, check := range stage.Checks {
			if check.Kind != "DYNATRACE_INFRASTRUCTURE" {
				continue
			}
			config, err := s.dynatrace.GetConfiguration(ctx, check.ApplicationID, check.EnvironmentBindingID)
			if err != nil {
				out = append(out, DynatraceComparison{
					CheckID: check.ID, Name: check.Name, ApplicationID: check.ApplicationID,
					EnvironmentBindingID: check.EnvironmentBindingID, GateMode: check.GateMode,
					Status: "ERROR", Decision: "ALLOW_WITH_WARNINGS", BaselineFrom: baselineFrom, BaselineTo: baselineTo,
					FailureCategory: "DYNATRACE_CONFIGURATION_UNAVAILABLE", FailureReason: safeError(err),
				})
				continue
			}
			expectedRevision := run.Configuration.DynatraceRevisionNumbers[check.ApplicationID+"|"+check.EnvironmentBindingID]
			services := check.ServiceIDs
			if len(services) == 0 {
				services = []string{""}
			}
			hasExplicitRules := false
			for _, rule := range config.Rules {
				if !rule.Enabled {
					continue
				}
				if len(check.RuleIDs) == 0 {
					hasExplicitRules = true
					break
				}
				for _, ruleID := range check.RuleIDs {
					if rule.ID == ruleID {
						hasExplicitRules = true
						break
					}
				}
			}
			for _, serviceID := range services {
				item := DynatraceComparison{
					CheckID: check.ID, Name: defaultString(check.Name, "Dynatrace infrastructure"),
					ApplicationID: check.ApplicationID, EnvironmentBindingID: check.EnvironmentBindingID,
					ServiceID: serviceID, Required: check.GateMode == "BLOCKING" && hasExplicitRules,
					GateMode: check.GateMode, Status: "PENDING", Decision: "PENDING", RuleIDs: check.RuleIDs,
					BaselineSummary: map[string]dynatrace.Statistics{}, PostSummary: map[string]dynatrace.Statistics{},
					RuleResults: []dynatrace.RuleResult{}, BaselineFrom: baselineFrom, BaselineTo: baselineTo,
					StabilizationSeconds: config.StabilizationSeconds, PostWindowSeconds: config.PostWindowSeconds,
				}
				if expectedRevision != config.RevisionNumber {
					item.Status, item.Decision = "ERROR", "ALLOW_WITH_WARNINGS"
					item.FailureCategory = "DYNATRACE_REVISION_CHANGED"
					item.FailureReason = "The Dynatrace configuration changed after this deployment validation was queued."
				}
				out = append(out, item)
			}
		}
	}
	return out
}

func metricPoint(run runs.Run) runs.HistoryMetricPoint {
	point := runs.HistoryMetricPoint{RunID: run.ID, RevisionID: run.RevisionID, Status: run.Status, FailureCategory: run.FailureCategory, CreatedAt: run.CreatedAt, ExecutionDurationMS: run.DurationMS}
	var total int64
	for _, step := range run.Steps {
		value, ok := numericTiming(step.Timing["apiResponseTimeMs"])
		if !ok {
			continue
		}
		total += value
		copyValue := value
		point.Steps = append(point.Steps, runs.HistoryStepMetricPoint{StepDefinitionID: step.StepDefinitionID, StepName: step.StepName, StepType: step.StepType, Status: step.Status, APIResponseTimeMS: &copyValue})
	}
	if len(point.Steps) > 0 {
		point.APIResponseTimeMS = &total
	}
	return point
}
func numericTiming(value any) (int64, bool) {
	switch v := value.(type) {
	case int:
		return int64(v), true
	case int64:
		return v, true
	case float64:
		return int64(v), true
	case json.Number:
		n, e := v.Int64()
		return n, e == nil
	default:
		return 0, false
	}
}
func emptyDistribution() Distribution {
	return Distribution{FailureCategories: map[string]int{}, Series: []MetricSeriesPoint{}}
}

func normalizeDistribution(distribution *Distribution) {
	if distribution.FailureCategories == nil {
		distribution.FailureCategories = map[string]int{}
	}
	if distribution.Series == nil {
		distribution.Series = []MetricSeriesPoint{}
	}
}

func normalizeDeploymentReport(report *DeploymentReport) {
	if report.Monitors == nil {
		report.Monitors = []MonitorComparison{}
	}
	if report.DynatraceResults == nil {
		report.DynatraceResults = []DynatraceComparison{}
	}
	if report.ELFResults == nil {
		report.ELFResults = []CheckResult{}
	}
	if report.AlertResults == nil {
		report.AlertResults = []CheckResult{}
	}
	if report.Warnings == nil {
		report.Warnings = []string{}
	}
	if report.Reasons == nil {
		report.Reasons = []string{}
	}
	for index := range report.Monitors {
		normalizeDistribution(&report.Monitors[index].Baseline)
		normalizeDistribution(&report.Monitors[index].Post)
		if report.Monitors[index].Steps == nil {
			report.Monitors[index].Steps = []StepComparison{}
		}
		if report.Monitors[index].Samples == nil {
			report.Monitors[index].Samples = []DeploymentSample{}
		}
		if report.Monitors[index].Reasons == nil {
			report.Monitors[index].Reasons = []string{}
		}
		for stepIndex := range report.Monitors[index].Steps {
			normalizeDistribution(&report.Monitors[index].Steps[stepIndex].Baseline)
			normalizeDistribution(&report.Monitors[index].Steps[stepIndex].Post)
		}
	}
}

func summarize(points []runs.HistoryMetricPoint) Distribution {
	result := emptyDistribution()
	values := []int64{}
	for _, point := range points {
		if point.Status == runs.StatusQueued || point.Status == runs.StatusStarting || point.Status == runs.StatusRunning || point.Status == runs.StatusCancelled || point.Status == runs.StatusSkipped {
			continue
		}
		result.CompletedCount++
		if point.Status == runs.StatusSuccess || point.Status == runs.StatusSuccessWithWarnings {
			result.SuccessCount++
			if point.APIResponseTimeMS != nil {
				values = append(values, *point.APIResponseTimeMS)
				result.Series = append(result.Series, MetricSeriesPoint{RunID: point.RunID, ValueMS: *point.APIResponseTimeMS, CreatedAt: point.CreatedAt})
			}
		} else {
			result.FailureCount++
			result.FailureCategories[point.FailureCategory]++
			if point.Status == runs.StatusTimedOut {
				result.TimeoutCount++
			}
		}
	}
	result.SampleCount = len(values)
	if result.CompletedCount > 0 {
		result.SuccessRate = percent(result.SuccessCount, result.CompletedCount)
		result.ErrorRate = percent(result.FailureCount, result.CompletedCount)
		result.TimeoutRate = percent(result.TimeoutCount, result.CompletedCount)
	}
	if len(values) == 0 {
		return result
	}
	sort.Slice(values, func(i, j int) bool { return values[i] < values[j] })
	var total int64
	for _, value := range values {
		total += value
	}
	result.MinMS = values[0]
	result.MaxMS = values[len(values)-1]
	result.AverageMS = total / int64(len(values))
	result.P50MS = deploymentPercentile(values, .5)
	result.P75MS = deploymentPercentile(values, .75)
	result.P90MS = deploymentPercentile(values, .9)
	result.P95MS = deploymentPercentile(values, .95)
	result.P99MS = deploymentPercentile(values, .99)
	var sum float64
	for _, value := range values {
		delta := float64(value - result.AverageMS)
		sum += delta * delta
	}
	result.StandardDeviationMS = math.Round(math.Sqrt(sum/float64(len(values)))*10) / 10
	return result
}
func percent(value, total int) float64 {
	return math.Round((float64(value)/float64(total)*100)*10) / 10
}
func deploymentPercentile(values []int64, q float64) int64 {
	if len(values) == 0 {
		return 0
	}
	index := int(math.Ceil(q*float64(len(values)))) - 1
	if index < 0 {
		index = 0
	}
	if index >= len(values) {
		index = len(values) - 1
	}
	return values[index]
}
func baselineSteps(points []runs.HistoryMetricPoint) []StepComparison {
	names := map[string]string{}
	grouped := map[string][]runs.HistoryMetricPoint{}
	for _, point := range points {
		if point.Status != runs.StatusSuccess && point.Status != runs.StatusSuccessWithWarnings {
			continue
		}
		for _, step := range point.Steps {
			if step.APIResponseTimeMS == nil {
				continue
			}
			names[step.StepDefinitionID] = step.StepName
			value := *step.APIResponseTimeMS
			grouped[step.StepDefinitionID] = append(grouped[step.StepDefinitionID], runs.HistoryMetricPoint{RunID: point.RunID, Status: runs.StatusSuccess, CreatedAt: point.CreatedAt, APIResponseTimeMS: &value})
		}
	}
	out := []StepComparison{}
	for stepID, values := range grouped {
		out = append(out, StepComparison{StepDefinitionID: stepID, StepName: names[stepID], Baseline: summarize(values), Post: emptyDistribution(), Classification: "PENDING"})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].StepName < out[j].StepName })
	return out
}
func completeSteps(existing []StepComparison, points []runs.HistoryMetricPoint, config DeploymentConfiguration) []StepComparison {
	byID := map[string]*StepComparison{}
	for index := range existing {
		byID[existing[index].StepDefinitionID] = &existing[index]
	}
	grouped := map[string][]runs.HistoryMetricPoint{}
	names := map[string]string{}
	for _, point := range points {
		if point.Status != runs.StatusSuccess && point.Status != runs.StatusSuccessWithWarnings {
			continue
		}
		for _, step := range point.Steps {
			if step.APIResponseTimeMS == nil {
				continue
			}
			names[step.StepDefinitionID] = step.StepName
			value := *step.APIResponseTimeMS
			grouped[step.StepDefinitionID] = append(grouped[step.StepDefinitionID], runs.HistoryMetricPoint{RunID: point.RunID, Status: runs.StatusSuccess, CreatedAt: point.CreatedAt, APIResponseTimeMS: &value})
		}
	}
	for stepID, values := range grouped {
		comparison := byID[stepID]
		if comparison == nil {
			existing = append(existing, StepComparison{StepDefinitionID: stepID, StepName: names[stepID]})
			comparison = &existing[len(existing)-1]
		}
		comparison.Post = summarize(values)
		comparison.Classification, comparison.DeltaMS, comparison.DeltaPercent = classify(comparison.Baseline, comparison.Post, config)
	}
	for index := range existing {
		if existing[index].Classification == "PENDING" {
			existing[index].Classification, existing[index].DeltaMS, existing[index].DeltaPercent = classify(existing[index].Baseline, existing[index].Post, config)
		}
	}
	return existing
}
func classifyMonitor(comparison *MonitorComparison, config DeploymentConfiguration) {
	comparison.Classification, comparison.DeltaMS, comparison.DeltaPercent = classify(comparison.Baseline, comparison.Post, config)
	for _, step := range comparison.Steps {
		if step.Classification == "REGRESSED" {
			comparison.Reasons = append(comparison.Reasons, fmt.Sprintf("Step %s exceeded its p95 regression guardrail.", step.StepName))
		}
	}
	if comparison.Post.FailureCount > 0 {
		comparison.Reasons = append(comparison.Reasons, fmt.Sprintf("%d post-deployment samples failed.", comparison.Post.FailureCount))
	}
}
func classify(base, post Distribution, config DeploymentConfiguration) (string, int64, float64) {
	if base.SampleCount < config.MinimumSamples || post.SampleCount < config.MinimumSamples {
		return "INSUFFICIENT_HISTORY", post.P95MS - base.P95MS, 0
	}
	delta := post.P95MS - base.P95MS
	change := float64(0)
	if base.P95MS > 0 {
		change = math.Round((float64(delta)/float64(base.P95MS)*100)*10) / 10
	}
	if delta >= config.RegressionMinimumMS && change >= config.RegressionPercent {
		return "REGRESSED", delta, change
	}
	if delta <= -config.RegressionMinimumMS && change <= -config.RegressionPercent {
		return "IMPROVED", delta, change
	}
	return "NORMAL", delta, change
}
func deploymentDecision(monitors []MonitorComparison, elfResults []CheckResult, alertResults ...[]CheckResult) (string, []string, []string) {
	return deploymentDecisionWithDynatrace(monitors, nil, elfResults, alertResults...)
}

func deploymentDecisionWithDynatrace(monitors []MonitorComparison, dynatraceResults []DynatraceComparison, elfResults []CheckResult, alertResults ...[]CheckResult) (string, []string, []string) {
	block, warn := false, false
	warnings, reasons := []string{}, []string{}
	for _, monitor := range monitors {
		stepRegression := false
		for _, step := range monitor.Steps {
			stepRegression = stepRegression || step.Classification == "REGRESSED"
		}
		failed := monitor.Post.FailureCount > 0
		regressed := monitor.Classification == "REGRESSED" || stepRegression
		if monitor.Classification == "INSUFFICIENT_HISTORY" {
			warn = true
			warnings = append(warnings, monitor.MonitorName+" has insufficient comparison samples.")
		}
		if failed || regressed {
			message := monitor.MonitorName + " failed functional or performance validation."
			if monitor.Required {
				block = true
				reasons = append(reasons, message)
			} else {
				warn = true
				warnings = append(warnings, message)
			}
		}
	}
	for _, result := range dynatraceResults {
		if result.Status == "PASS" {
			continue
		}
		message := defaultString(result.Name, "Dynatrace infrastructure") + " returned " + defaultString(result.Status, "incomplete evidence") + "."
		if result.Decision == "BLOCK" || result.Required && (result.Status == "ERROR" || result.Status == "NO_DATA" || result.Status == "FAIL") {
			block = true
			reasons = append(reasons, message)
		} else {
			warn = true
			warnings = append(warnings, message)
		}
	}
	appendCheckFailures := func(results []CheckResult, label string) {
		for _, result := range results {
			if result.Status == "SUCCESS" {
				continue
			}
			message := defaultString(result.Name, defaultString(result.QueryID, result.CheckID)) + " failed its " + label + " check."
			if result.Required {
				block = true
				reasons = append(reasons, message)
			} else {
				warn = true
				warnings = append(warnings, message)
			}
		}
	}
	appendCheckFailures(elfResults, "ELF")
	if len(alertResults) > 0 {
		appendCheckFailures(alertResults[0], "OpenSearch alert")
	}
	if block {
		return "BLOCK", warnings, reasons
	}
	if warn {
		return "ALLOW_WITH_WARNINGS", warnings, reasons
	}
	return "ALLOW", warnings, reasons
}
func (s *Service) runDeploymentELF(ctx context.Context, stage Stage, check Check, run DeploymentRun) CheckResult {
	started := s.now()
	result := CheckResult{StageID: stage.ID, StageName: stage.Name, CheckID: check.ID, Kind: check.Kind, QueryID: check.QueryID, Name: check.Name, Required: check.Required, Status: "FAILED"}
	if s.elf == nil {
		result.FailureCategory = "ELF_UNAVAILABLE"
		result.FailureReason = "ELF execution is unavailable."
		return result
	}
	query, queryErr := s.elf.GetQuery(ctx, check.QueryID)
	if queryErr != nil || query.CurrentRevisionID != run.Configuration.ELFRevisionIDs[check.QueryID] {
		result.FailureCategory = "ELF_REVISION_CHANGED"
		result.FailureReason = "The ELF query changed after this deployment validation was queued."
		return result
	}
	elfRun, err := s.elf.Run(ctx, check.QueryID, run.CreatedBy, elf.ProbeInput{DeploymentStart: &run.Deployment.DeploymentStart}, true)
	result.DurationMS = s.now().Sub(started).Milliseconds()
	if err != nil {
		result.FailureCategory = "ELF_EXECUTION_ERROR"
		result.FailureReason = safeError(err)
		return result
	}
	result.ELFRunID, result.QueryRevisionID, result.ApplicationID, result.ServiceID, result.ResolvedIndex, result.GateMode, result.Decision, result.HitCount = elfRun.ID, elfRun.RevisionID, elfRun.ApplicationID, elfRun.ServiceID, elfRun.ResolvedIndex, elfRun.GateMode, elfRun.Decision, elfRun.HitCount
	result.TimeFrom, result.TimeTo = &elfRun.TimeFrom, &elfRun.TimeTo
	result.Required = elfRun.GateMode == "BLOCKING"
	if elfRun.Status == "SUCCESS" && elfRun.Decision == "PASS" {
		result.Status = "SUCCESS"
	} else {
		result.FailureCategory, result.FailureReason = elfRun.FailureCategory, elfRun.FailureReason
	}
	return result
}

func (s *Service) DeploymentReportJSON(ctx context.Context, id string) ([]byte, error) {
	run, err := s.GetDeploymentRun(ctx, id)
	if err != nil {
		return nil, err
	}
	return json.MarshalIndent(run.Report, "", "  ")
}
func (s *Service) DeploymentReportPDF(ctx context.Context, id string) ([]byte, error) {
	run, err := s.GetDeploymentRun(ctx, id)
	if err != nil {
		return nil, err
	}
	return renderDeploymentPDF(run.Report), nil
}
func renderDeploymentPDF(report DeploymentReport) []byte {
	lines := []string{"Rhythm deployment validation report", report.SuiteName, "Decision: " + report.GateDecision, "Recommendation: " + report.Recommendation, "Deployment: " + defaultString(report.Deployment.DeploymentID, "Not supplied"), "Version: " + defaultString(report.Deployment.Version, "Not supplied"), "Baseline: " + report.BaselineFrom.Format(time.RFC3339) + " to " + report.BaselineTo.Format(time.RFC3339), ""}
	for _, monitor := range report.Monitors {
		lines = append(lines, fmt.Sprintf("%s — %s", monitor.MonitorName, monitor.Classification), fmt.Sprintf("  p95 before %d ms | after %d ms | change %.1f%%", monitor.Baseline.P95MS, monitor.Post.P95MS, monitor.DeltaPercent), fmt.Sprintf("  success before %.1f%% | after %.1f%%", monitor.Baseline.SuccessRate, monitor.Post.SuccessRate))
	}
	if len(report.ELFResults) > 0 {
		lines = append(lines, "", "ELF log checks")
		for _, result := range report.ELFResults {
			lines = append(lines, fmt.Sprintf("%s — %s — %d hits", defaultString(result.Name, result.QueryID), result.Status, result.HitCount))
		}
	}
	if len(report.DynatraceResults) > 0 {
		lines = append(lines, "", "Dynatrace infrastructure checks")
		for _, result := range report.DynatraceResults {
			lines = append(lines, fmt.Sprintf("%s — %s — %s", defaultString(result.Name, "Dynatrace infrastructure"), result.Status, result.Decision))
		}
	}
	if len(report.AlertResults) > 0 {
		lines = append(lines, "", "OpenSearch alert checks")
		for _, result := range report.AlertResults {
			lines = append(lines, fmt.Sprintf("%s — %s — %s", defaultString(result.Name, result.ExternalTriggerName), result.Status, defaultString(result.AlertState, "not observed")))
		}
	}
	content := bytes.Buffer{}
	content.WriteString("BT /F1 11 Tf 48 790 Td ")
	for index, line := range lines {
		if index > 0 {
			content.WriteString("0 -16 Td ")
		}
		content.WriteString("(" + pdfEscape(line) + ") Tj ")
	}
	content.WriteString("ET")
	stream := content.String()
	objects := []string{"<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>", fmt.Sprintf("<< /Length %d >>\nstream\n%s\nendstream", len(stream), stream), "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"}
	var out bytes.Buffer
	out.WriteString("%PDF-1.4\n")
	offsets := []int{0}
	for index, object := range objects {
		offsets = append(offsets, out.Len())
		fmt.Fprintf(&out, "%d 0 obj\n%s\nendobj\n", index+1, object)
	}
	xref := out.Len()
	fmt.Fprintf(&out, "xref\n0 %d\n0000000000 65535 f \n", len(objects)+1)
	for _, offset := range offsets[1:] {
		fmt.Fprintf(&out, "%010d 00000 n \n", offset)
	}
	fmt.Fprintf(&out, "trailer << /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF", len(objects)+1, xref)
	return out.Bytes()
}
func pdfEscape(value string) string {
	value = strings.Map(func(r rune) rune {
		if r > 126 {
			return '-'
		}
		return r
	}, value)
	return strings.NewReplacer("\\", "\\\\", "(", "\\(", ")", "\\)").Replace(value)
}

func (r *MemoryRepository) CreateDeploymentRun(_ context.Context, v DeploymentRun) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.deployments == nil {
		r.deployments = map[string]DeploymentRun{}
	}
	r.deployments[v.ID] = v
	return nil
}
func (r *MemoryRepository) UpdateDeploymentRun(_ context.Context, v DeploymentRun) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.deployments[v.ID] = v
	return nil
}
func (r *MemoryRepository) GetDeploymentRun(_ context.Context, id string) (DeploymentRun, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	v, ok := r.deployments[id]
	if !ok {
		return DeploymentRun{}, ErrNotFound
	}
	return v, nil
}
func (r *MemoryRepository) ListDeploymentRuns(_ context.Context, filter DeploymentFilter) ([]DeploymentRun, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	out := []DeploymentRun{}
	for _, v := range r.deployments {
		if filter.SuiteID != "" && v.SuiteID != filter.SuiteID || filter.Status != "" && v.Status != filter.Status || filter.Decision != "" && v.GateDecision != filter.Decision || filter.ApplicationID != "" && v.Deployment.ApplicationID != filter.ApplicationID || filter.Environment != "" && v.Deployment.Environment != filter.Environment {
			continue
		}
		out = append(out, v)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].CreatedAt.After(out[j].CreatedAt) })
	return out, nil
}
func (r *MemoryRepository) SaveDeploymentSample(_ context.Context, _ string, _ DeploymentSample) error {
	return nil
}

func (r *PostgresRepository) CreateDeploymentRun(ctx context.Context, v DeploymentRun) error {
	progress, _ := json.Marshal(v.Progress)
	deployment, _ := json.Marshal(v.Deployment)
	configuration, _ := json.Marshal(v.Configuration)
	snapshot, _ := json.Marshal(v.SuiteSnapshot)
	report, _ := json.Marshal(v.Report)
	_, err := r.pool.Exec(ctx, `INSERT INTO deployment_validation_runs(id,suite_id,status,phase,gate_decision,progress_json,deployment_json,configuration_json,suite_snapshot_json,report_json,failure_reason,created_by,started_at,created_at,updated_at)VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`, v.ID, v.SuiteID, v.Status, v.Phase, v.GateDecision, progress, deployment, configuration, snapshot, report, v.FailureReason, v.CreatedBy, v.StartedAt, v.CreatedAt, v.UpdatedAt)
	return err
}
func (r *PostgresRepository) UpdateDeploymentRun(ctx context.Context, v DeploymentRun) error {
	progress, _ := json.Marshal(v.Progress)
	deployment, _ := json.Marshal(v.Deployment)
	configuration, _ := json.Marshal(v.Configuration)
	snapshot, _ := json.Marshal(v.SuiteSnapshot)
	report, _ := json.Marshal(v.Report)
	_, err := r.pool.Exec(ctx, `UPDATE deployment_validation_runs SET status=$2,phase=$3,gate_decision=$4,progress_json=$5,deployment_json=$6,configuration_json=$7,suite_snapshot_json=$8,report_json=$9,failure_reason=$10,baseline_started_at=$11,baseline_ended_at=$12,sampling_started_at=$13,sampling_ended_at=$14,started_at=$15,ended_at=$16,updated_at=$17 WHERE id=$1`, v.ID, v.Status, v.Phase, v.GateDecision, progress, deployment, configuration, snapshot, report, v.FailureReason, v.BaselineStartedAt, v.BaselineEndedAt, v.SamplingStartedAt, v.SamplingEndedAt, v.StartedAt, v.EndedAt, v.UpdatedAt)
	return err
}
func (r *PostgresRepository) GetDeploymentRun(ctx context.Context, id string) (DeploymentRun, error) {
	return scanDeploymentRun(r.pool.QueryRow(ctx, `SELECT id::text,suite_id::text,status,phase,gate_decision,progress_json,deployment_json,configuration_json,suite_snapshot_json,report_json,failure_reason,created_by,baseline_started_at,baseline_ended_at,sampling_started_at,sampling_ended_at,started_at,ended_at,created_at,updated_at FROM deployment_validation_runs WHERE id=$1`, id))
}
func (r *PostgresRepository) ListDeploymentRuns(ctx context.Context, filter DeploymentFilter) ([]DeploymentRun, error) {
	rows, err := r.pool.Query(ctx, `SELECT id::text,suite_id::text,status,phase,gate_decision,progress_json,deployment_json,configuration_json,suite_snapshot_json,report_json,failure_reason,created_by,baseline_started_at,baseline_ended_at,sampling_started_at,sampling_ended_at,started_at,ended_at,created_at,updated_at FROM deployment_validation_runs WHERE ($1='' OR suite_id::text=$1) AND ($2='' OR deployment_json->>'applicationId'=$2) AND ($3='' OR deployment_json->>'environment'=$3) AND ($4='' OR status=$4) AND ($5='' OR gate_decision=$5) ORDER BY created_at DESC LIMIT 200`, filter.SuiteID, filter.ApplicationID, filter.Environment, filter.Status, filter.Decision)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []DeploymentRun{}
	for rows.Next() {
		v, err := scanDeploymentRun(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, v)
	}
	return out, rows.Err()
}

type deploymentScanner interface{ Scan(...any) error }

func scanDeploymentRun(row deploymentScanner) (DeploymentRun, error) {
	var v DeploymentRun
	var progress, deployment, configuration, snapshot, report []byte
	err := row.Scan(&v.ID, &v.SuiteID, &v.Status, &v.Phase, &v.GateDecision, &progress, &deployment, &configuration, &snapshot, &report, &v.FailureReason, &v.CreatedBy, &v.BaselineStartedAt, &v.BaselineEndedAt, &v.SamplingStartedAt, &v.SamplingEndedAt, &v.StartedAt, &v.EndedAt, &v.CreatedAt, &v.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return v, ErrNotFound
	}
	if err != nil {
		return v, err
	}
	_ = json.Unmarshal(progress, &v.Progress)
	_ = json.Unmarshal(deployment, &v.Deployment)
	_ = json.Unmarshal(configuration, &v.Configuration)
	_ = json.Unmarshal(snapshot, &v.SuiteSnapshot)
	_ = json.Unmarshal(report, &v.Report)
	return v, nil
}
func (r *PostgresRepository) SaveDeploymentSample(ctx context.Context, runID string, sample DeploymentSample) error {
	_, err := r.pool.Exec(ctx, `INSERT INTO deployment_validation_samples(id,deployment_run_id,monitor_id,monitor_run_id,sample_number,status,duration_ms,failure_category,created_at)VALUES($1,$2,$3,NULLIF($4,'')::uuid,$5,$6,$7,$8,$9) ON CONFLICT(deployment_run_id,monitor_id,sample_number) DO UPDATE SET monitor_run_id=EXCLUDED.monitor_run_id,status=EXCLUDED.status,duration_ms=EXCLUDED.duration_ms,failure_category=EXCLUDED.failure_category`, sample.ID, runID, sample.MonitorID, sample.MonitorRunID, sample.SampleNumber, sample.Status, sample.DurationMS, sample.FailureCategory, sample.CreatedAt)
	return err
}
