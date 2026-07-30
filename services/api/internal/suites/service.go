package suites

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/rhythm-monitoring/rhythm/internal/alerts"
	"github.com/rhythm-monitoring/rhythm/internal/dynatrace"
	"github.com/rhythm-monitoring/rhythm/internal/elf"
	"github.com/rhythm-monitoring/rhythm/internal/id"
	"github.com/rhythm-monitoring/rhythm/internal/runs"
)

var ErrNotFound = errors.New("validation suite not found")

type Check struct {
	ID                   string   `json:"id"`
	Kind                 string   `json:"kind"`
	MonitorID            string   `json:"monitorId,omitempty"`
	QueryID              string   `json:"queryId,omitempty"`
	ReceiverID           string   `json:"receiverId,omitempty"`
	ExternalMonitorID    string   `json:"externalMonitorId,omitempty"`
	ExternalTriggerID    string   `json:"externalTriggerId,omitempty"`
	ExternalMonitorName  string   `json:"externalMonitorName,omitempty"`
	ExternalTriggerName  string   `json:"externalTriggerName,omitempty"`
	Name                 string   `json:"name,omitempty"`
	Required             bool     `json:"required"`
	ApplicationID        string   `json:"applicationId,omitempty"`
	EnvironmentBindingID string   `json:"environmentBindingId,omitempty"`
	ServiceIDs           []string `json:"serviceIds,omitempty"`
	RuleIDs              []string `json:"ruleIds,omitempty"`
	GateMode             string   `json:"gateMode,omitempty"`
}

type Stage struct {
	ID     string  `json:"id"`
	Name   string  `json:"name"`
	Order  int     `json:"order"`
	Checks []Check `json:"checks"`
}

type Suite struct {
	ID                 string    `json:"id"`
	Name               string    `json:"name"`
	Description        string    `json:"description,omitempty"`
	Environment        string    `json:"environment,omitempty"`
	Stages             []Stage   `json:"stages"`
	Parallelism        int       `json:"parallelism"`
	FailFast           bool      `json:"failFast"`
	TimeoutSeconds     int       `json:"timeoutSeconds"`
	BaselinePolicy     string    `json:"baselinePolicy"`
	NotificationPolicy string    `json:"notificationPolicy"`
	CreatedBy          string    `json:"createdBy"`
	UpdatedBy          string    `json:"updatedBy"`
	CreatedAt          time.Time `json:"createdAt"`
	UpdatedAt          time.Time `json:"updatedAt"`
}

type Input struct {
	Name               string  `json:"name"`
	Description        string  `json:"description"`
	Environment        string  `json:"environment"`
	Stages             []Stage `json:"stages"`
	Parallelism        int     `json:"parallelism"`
	FailFast           bool    `json:"failFast"`
	TimeoutSeconds     int     `json:"timeoutSeconds"`
	BaselinePolicy     string  `json:"baselinePolicy"`
	NotificationPolicy string  `json:"notificationPolicy"`
}

type CheckResult struct {
	StageID             string     `json:"stageId"`
	StageName           string     `json:"stageName"`
	CheckID             string     `json:"checkId"`
	MonitorID           string     `json:"monitorId,omitempty"`
	Kind                string     `json:"kind"`
	QueryID             string     `json:"queryId,omitempty"`
	QueryRevisionID     string     `json:"queryRevisionId,omitempty"`
	ELFRunID            string     `json:"elfRunId,omitempty"`
	AlertID             string     `json:"alertId,omitempty"`
	ReceiverID          string     `json:"receiverId,omitempty"`
	ExternalMonitorID   string     `json:"externalMonitorId,omitempty"`
	ExternalTriggerID   string     `json:"externalTriggerId,omitempty"`
	ExternalMonitorName string     `json:"externalMonitorName,omitempty"`
	ExternalTriggerName string     `json:"externalTriggerName,omitempty"`
	AlertState          string     `json:"alertState,omitempty"`
	UpstreamState       string     `json:"upstreamState,omitempty"`
	ApplicationID       string     `json:"applicationId,omitempty"`
	ServiceID           string     `json:"serviceId,omitempty"`
	ResolvedIndex       string     `json:"resolvedIndex,omitempty"`
	GateMode            string     `json:"gateMode,omitempty"`
	Decision            string     `json:"decision,omitempty"`
	HitCount            int64      `json:"hitCount,omitempty"`
	TimeFrom            *time.Time `json:"timeFrom,omitempty"`
	TimeTo              *time.Time `json:"timeTo,omitempty"`
	Name                string     `json:"name,omitempty"`
	Required            bool       `json:"required"`
	Status              string     `json:"status"`
	MonitorRunID        string     `json:"monitorRunId,omitempty"`
	FailureCategory     string     `json:"failureCategory,omitempty"`
	FailureReason       string     `json:"failureReason,omitempty"`
	DurationMS          int64      `json:"durationMs"`
	DynatraceRunID      string     `json:"dynatraceRunId,omitempty"`
}

type SuiteRun struct {
	ID            string        `json:"id"`
	SuiteID       string        `json:"suiteId"`
	Status        string        `json:"status"`
	GateDecision  string        `json:"gateDecision"`
	TriggerType   string        `json:"triggerType"`
	TriggerSource string        `json:"triggerSource,omitempty"`
	Results       []CheckResult `json:"results"`
	StartedAt     time.Time     `json:"startedAt"`
	EndedAt       *time.Time    `json:"endedAt,omitempty"`
	DurationMS    int64         `json:"durationMs"`
	CreatedAt     time.Time     `json:"createdAt"`
}

type DeploymentContext struct {
	DeploymentID    string     `json:"deploymentId,omitempty"`
	Version         string     `json:"version,omitempty"`
	Commit          string     `json:"commit,omitempty"`
	DeploymentStart *time.Time `json:"deploymentStart,omitempty"`
}

type RunInput struct {
	TriggerType string            `json:"triggerType,omitempty"`
	Deployment  DeploymentContext `json:"deployment,omitempty"`
}

type Repository interface {
	List(context.Context) ([]Suite, error)
	Get(context.Context, string) (Suite, error)
	Create(context.Context, Suite) error
	Update(context.Context, Suite) error
	Delete(context.Context, string) error
	SaveRun(context.Context, SuiteRun) error
	GetRun(context.Context, string) (SuiteRun, error)
}

type OpenSearchAlertSource interface {
	MatchOpenSearchAlerts(context.Context, alerts.OpenSearchAlertMatch) ([]alerts.Alert, error)
	GetReceiver(context.Context, string) (alerts.Receiver, error)
}

type Service struct {
	repository Repository
	runs       *runs.Service
	elf        *elf.Service
	alerts     OpenSearchAlertSource
	dynatrace  *dynatrace.Service
	now        func() time.Time
	mu         sync.Mutex
	cancels    map[string]context.CancelFunc
}

func New(repository Repository, runService *runs.Service) *Service {
	return &Service{repository: repository, runs: runService, now: func() time.Time { return time.Now().UTC() }, cancels: make(map[string]context.CancelFunc)}
}
func (s *Service) SetELF(service *elf.Service)             { s.elf = service }
func (s *Service) SetAlerts(source OpenSearchAlertSource)  { s.alerts = source }
func (s *Service) SetDynatrace(service *dynatrace.Service) { s.dynatrace = service }

func (s *Service) List(ctx context.Context) ([]Suite, error) { return s.repository.List(ctx) }
func (s *Service) Get(ctx context.Context, suiteID string) (Suite, error) {
	return s.repository.Get(ctx, suiteID)
}
func (s *Service) GetRun(ctx context.Context, runID string) (SuiteRun, error) {
	return s.repository.GetRun(ctx, runID)
}

func (s *Service) Create(ctx context.Context, input Input, actor string) (Suite, error) {
	suite, err := suiteFromInput(input, actor, s.now())
	if err != nil {
		return Suite{}, err
	}
	if err := s.repository.Create(ctx, suite); err != nil {
		return Suite{}, err
	}
	return suite, nil
}

func (s *Service) Update(ctx context.Context, suiteID string, input Input, actor string) (Suite, error) {
	existing, err := s.repository.Get(ctx, suiteID)
	if err != nil {
		return Suite{}, err
	}
	updated, err := suiteFromInput(input, actor, s.now())
	if err != nil {
		return Suite{}, err
	}
	updated.ID, updated.CreatedAt, updated.CreatedBy = existing.ID, existing.CreatedAt, existing.CreatedBy
	if err := s.repository.Update(ctx, updated); err != nil {
		return Suite{}, err
	}
	return updated, nil
}

func (s *Service) Delete(ctx context.Context, suiteID string) error {
	if _, err := s.repository.Get(ctx, suiteID); err != nil {
		return err
	}
	return s.repository.Delete(ctx, suiteID)
}

func suiteFromInput(input Input, actor string, now time.Time) (Suite, error) {
	input.Name = strings.TrimSpace(input.Name)
	if input.Name == "" {
		return Suite{}, errors.New("suite name is required")
	}
	if len(input.Stages) == 0 {
		return Suite{}, errors.New("at least one validation stage is required")
	}
	if input.Parallelism == 0 {
		input.Parallelism = 1
	}
	if input.Parallelism < 1 || input.Parallelism > 20 {
		return Suite{}, errors.New("parallelism must be between 1 and 20")
	}
	if input.TimeoutSeconds == 0 {
		input.TimeoutSeconds = 900
	}
	if input.TimeoutSeconds < 1 || input.TimeoutSeconds > 86400 {
		return Suite{}, errors.New("timeoutSeconds must be between 1 and 86400")
	}
	seen := map[string]bool{}
	for stageIndex := range input.Stages {
		stage := &input.Stages[stageIndex]
		if stage.ID == "" {
			stage.ID = fmt.Sprintf("stage-%d", stageIndex+1)
		}
		if stage.Order == 0 {
			stage.Order = stageIndex + 1
		}
		if strings.TrimSpace(stage.Name) == "" || len(stage.Checks) == 0 {
			return Suite{}, errors.New("each stage requires a name and at least one check")
		}
		for checkIndex := range stage.Checks {
			check := &stage.Checks[checkIndex]
			check.Kind = strings.ToUpper(strings.TrimSpace(check.Kind))
			if check.Kind == "" {
				check.Kind = "MONITOR"
			}
			if check.ID == "" {
				check.ID = fmt.Sprintf("%s-check-%d", stage.ID, checkIndex+1)
			}
			if check.Kind != "MONITOR" && check.Kind != "ELF_QUERY" && check.Kind != "OPENSEARCH_ALERT" && check.Kind != "DYNATRACE_INFRASTRUCTURE" {
				return Suite{}, errors.New("suite check kind must be MONITOR, ELF_QUERY, OPENSEARCH_ALERT, or DYNATRACE_INFRASTRUCTURE")
			}
			if check.Kind == "MONITOR" && strings.TrimSpace(check.MonitorID) == "" {
				return Suite{}, errors.New("monitor checks require monitorId")
			}
			if check.Kind == "ELF_QUERY" && strings.TrimSpace(check.QueryID) == "" {
				return Suite{}, errors.New("ELF query checks require queryId")
			}
			if check.Kind == "OPENSEARCH_ALERT" {
				check.ReceiverID = strings.TrimSpace(check.ReceiverID)
				check.ExternalMonitorID = strings.TrimSpace(check.ExternalMonitorID)
				check.ExternalTriggerID = strings.TrimSpace(check.ExternalTriggerID)
				check.ExternalMonitorName = strings.TrimSpace(check.ExternalMonitorName)
				check.ExternalTriggerName = strings.TrimSpace(check.ExternalTriggerName)
				if check.ReceiverID == "" {
					return Suite{}, errors.New("OpenSearch alert checks require receiverId")
				}
				if check.ExternalMonitorID == "" && check.ExternalMonitorName == "" && check.ExternalTriggerID == "" && check.ExternalTriggerName == "" {
					return Suite{}, errors.New("OpenSearch alert checks require a monitor or trigger identity")
				}
			}
			if check.Kind == "DYNATRACE_INFRASTRUCTURE" {
				check.ApplicationID = strings.TrimSpace(check.ApplicationID)
				check.EnvironmentBindingID = strings.TrimSpace(check.EnvironmentBindingID)
				check.GateMode = strings.ToUpper(strings.TrimSpace(check.GateMode))
				if check.ApplicationID == "" || check.EnvironmentBindingID == "" {
					return Suite{}, errors.New("Dynatrace infrastructure checks require applicationId and environmentBindingId")
				}
				if check.GateMode == "" {
					check.GateMode = "ADVISORY"
				}
				if check.GateMode != "ADVISORY" && check.GateMode != "BLOCKING" {
					return Suite{}, errors.New("Dynatrace infrastructure gateMode must be ADVISORY or BLOCKING")
				}
			}
			if seen[check.ID] {
				return Suite{}, errors.New("suite check IDs must be unique")
			}
			seen[check.ID] = true
		}
	}
	sort.SliceStable(input.Stages, func(i, j int) bool { return input.Stages[i].Order < input.Stages[j].Order })
	idValue, err := id.NewUUID()
	if err != nil {
		return Suite{}, err
	}
	return Suite{ID: idValue, Name: input.Name, Description: strings.TrimSpace(input.Description), Environment: strings.TrimSpace(input.Environment), Stages: input.Stages, Parallelism: input.Parallelism, FailFast: input.FailFast, TimeoutSeconds: input.TimeoutSeconds, BaselinePolicy: defaultString(input.BaselinePolicy, "NONE"), NotificationPolicy: defaultString(input.NotificationPolicy, "NONE"), CreatedBy: actor, UpdatedBy: actor, CreatedAt: now, UpdatedAt: now}, nil
}

func (s *Service) Run(ctx context.Context, suiteID, actor, trigger string) (SuiteRun, error) {
	return s.RunWithInput(ctx, suiteID, actor, RunInput{TriggerType: trigger})
}

func (s *Service) RunWithInput(ctx context.Context, suiteID, actor string, input RunInput) (SuiteRun, error) {
	suite, err := s.repository.Get(ctx, suiteID)
	if err != nil {
		return SuiteRun{}, err
	}
	runID, err := id.NewUUID()
	if err != nil {
		return SuiteRun{}, err
	}
	started := s.now()
	if input.TriggerType == "" {
		input.TriggerType = "MANUAL"
	}
	run := SuiteRun{ID: runID, SuiteID: suite.ID, Status: "RUNNING", GateDecision: "PENDING", TriggerType: input.TriggerType, TriggerSource: actor, Results: []CheckResult{}, StartedAt: started, CreatedAt: started}
	runContext, cancel := context.WithTimeout(ctx, time.Duration(suite.TimeoutSeconds)*time.Second)
	s.mu.Lock()
	s.cancels[runID] = cancel
	s.mu.Unlock()
	defer func() { cancel(); s.mu.Lock(); delete(s.cancels, runID); s.mu.Unlock() }()
	requiredFailure, optionalFailure := false, false
	for _, stage := range suite.Stages {
		stageResults := s.runStage(runContext, suite, stage, actor, input.Deployment)
		run.Results = append(run.Results, stageResults...)
		for _, result := range stageResults {
			if result.Status != "SUCCESS" {
				if result.Required {
					requiredFailure = true
				} else {
					optionalFailure = true
				}
			}
		}
		if runContext.Err() != nil || suite.FailFast && requiredFailure {
			break
		}
	}
	ended := s.now()
	run.EndedAt, run.DurationMS = &ended, ended.Sub(started).Milliseconds()
	switch {
	case errors.Is(runContext.Err(), context.DeadlineExceeded):
		run.Status, run.GateDecision = "TIMED_OUT", "BLOCK"
	case errors.Is(runContext.Err(), context.Canceled):
		run.Status, run.GateDecision = "CANCELLED", "BLOCK"
	case requiredFailure:
		run.Status, run.GateDecision = "FAILED", "BLOCK"
	case optionalFailure:
		run.Status, run.GateDecision = "PASSED_WITH_WARNINGS", "ALLOW_WITH_WARNINGS"
	default:
		run.Status, run.GateDecision = "PASSED", "ALLOW"
	}
	if err := s.repository.SaveRun(context.WithoutCancel(ctx), run); err != nil {
		return SuiteRun{}, err
	}
	return run, nil
}

func (s *Service) runStage(ctx context.Context, suite Suite, stage Stage, actor string, deployment DeploymentContext) []CheckResult {
	results := make([]CheckResult, len(stage.Checks))
	jobs := make(chan int)
	workers := min(suite.Parallelism, len(stage.Checks))
	var group sync.WaitGroup
	for range workers {
		group.Add(1)
		go func() {
			defer group.Done()
			for index := range jobs {
				check := stage.Checks[index]
				started := s.now()
				result := CheckResult{
					StageID: stage.ID, StageName: stage.Name, CheckID: check.ID, Kind: check.Kind,
					MonitorID: check.MonitorID, QueryID: check.QueryID, ReceiverID: check.ReceiverID,
					ExternalMonitorID: check.ExternalMonitorID, ExternalTriggerID: check.ExternalTriggerID,
					ExternalMonitorName: check.ExternalMonitorName, ExternalTriggerName: check.ExternalTriggerName,
					Name: check.Name, Required: check.Required, Status: "FAILED",
				}
				switch check.Kind {
				case "ELF_QUERY":
					if s.elf == nil {
						result.FailureCategory, result.FailureReason = "ELF_UNAVAILABLE", "ELF execution is unavailable."
					} else {
						elfRun, err := s.elf.Run(ctx, check.QueryID, actor, elf.ProbeInput{DeploymentStart: deployment.DeploymentStart}, true)
						if err != nil {
							result.FailureCategory, result.FailureReason = "ELF_EXECUTION_ERROR", safeError(err)
						} else {
							result.ELFRunID, result.QueryRevisionID, result.ApplicationID, result.ServiceID, result.ResolvedIndex, result.GateMode, result.Decision, result.HitCount = elfRun.ID, elfRun.RevisionID, elfRun.ApplicationID, elfRun.ServiceID, elfRun.ResolvedIndex, elfRun.GateMode, elfRun.Decision, elfRun.HitCount
							result.TimeFrom, result.TimeTo = &elfRun.TimeFrom, &elfRun.TimeTo
							result.Required = elfRun.GateMode == "BLOCKING"
							if elfRun.Status == "SUCCESS" && elfRun.Decision == "PASS" {
								result.Status = "SUCCESS"
							} else {
								result.Status, result.FailureCategory, result.FailureReason = "FAILED", elfRun.FailureCategory, elfRun.FailureReason
							}
						}
					}
				case "OPENSEARCH_ALERT":
					result = s.evaluateOpenSearchAlertCheck(ctx, stage, check, deployment.DeploymentStart)
				case "DYNATRACE_INFRASTRUCTURE":
					result.ApplicationID = check.ApplicationID
					result.GateMode = check.GateMode
					result.Required = check.GateMode == "BLOCKING"
					if s.dynatrace == nil {
						result.FailureCategory, result.FailureReason = "DYNATRACE_UNAVAILABLE", "Dynatrace execution is unavailable."
					} else {
						to := s.now()
						from := to.Add(-15 * time.Minute)
						if deployment.DeploymentStart != nil {
							from = *deployment.DeploymentStart
						}
						serviceID := ""
						if len(check.ServiceIDs) > 0 {
							serviceID = check.ServiceIDs[0]
						}
						dynatraceRun, queryErr := s.dynatrace.Query(ctx, check.ApplicationID, check.EnvironmentBindingID, dynatrace.QueryInput{ServiceID: serviceID, TimeFrom: from, TimeTo: to}, actor)
						result.DynatraceRunID, result.Decision = dynatraceRun.ID, dynatraceRun.Decision
						if queryErr == nil && dynatraceRun.Decision != "BLOCK" {
							result.Status = "SUCCESS"
							if dynatraceRun.Decision == "ALLOW_WITH_WARNINGS" {
								result.Status = "WARNING"
							}
						} else {
							result.FailureCategory, result.FailureReason = defaultString(dynatraceRun.FailureCategory, "DYNATRACE_CHECK_FAILED"), defaultString(dynatraceRun.FailureReason, safeError(queryErr))
						}
					}
				default:
					monitorRun, err := s.runs.Run(ctx, check.MonitorID, actor, "published")
					if err != nil {
						result.FailureCategory, result.FailureReason = "EXECUTION_ERROR", safeError(err)
					} else {
						result.MonitorRunID, result.Status, result.FailureCategory, result.FailureReason = monitorRun.ID, string(monitorRun.Status), monitorRun.FailureCategory, monitorRun.FailureReason
					}
				}
				result.DurationMS = s.now().Sub(started).Milliseconds()
				results[index] = result
			}
		}()
	}
	for index := range stage.Checks {
		select {
		case jobs <- index:
		case <-ctx.Done():
			break
		}
	}
	close(jobs)
	group.Wait()
	for index := range results {
		if results[index].CheckID == "" {
			check := stage.Checks[index]
			results[index] = CheckResult{StageID: stage.ID, StageName: stage.Name, CheckID: check.ID, Kind: check.Kind, MonitorID: check.MonitorID, QueryID: check.QueryID, Name: check.Name, Required: check.Required, Status: "CANCELLED", FailureCategory: "SUITE_CANCELLED", FailureReason: "Check was not started."}
		}
	}
	return results
}

func (s *Service) Cancel(runID string) bool {
	s.mu.Lock()
	cancel, ok := s.cancels[runID]
	s.mu.Unlock()
	if ok {
		cancel()
	}
	return ok
}

func (s *Service) evaluateOpenSearchAlertCheck(ctx context.Context, stage Stage, check Check, deploymentStart *time.Time) CheckResult {
	result := CheckResult{
		StageID: stage.ID, StageName: stage.Name, CheckID: check.ID, Kind: check.Kind,
		ReceiverID: check.ReceiverID, ExternalMonitorID: check.ExternalMonitorID, ExternalTriggerID: check.ExternalTriggerID,
		ExternalMonitorName: check.ExternalMonitorName, ExternalTriggerName: check.ExternalTriggerName,
		Name: check.Name, Required: check.Required, Status: "FAILED",
	}
	if s.alerts == nil {
		result.FailureCategory, result.FailureReason = "ALERTING_UNAVAILABLE", "OpenSearch alert evaluation is unavailable."
		return result
	}
	if _, err := s.alerts.GetReceiver(ctx, check.ReceiverID); err != nil {
		result.FailureCategory, result.FailureReason = "RECEIVER_NOT_FOUND", "OpenSearch alert receiver was not found."
		return result
	}
	matches, err := s.alerts.MatchOpenSearchAlerts(ctx, alerts.OpenSearchAlertMatch{
		ReceiverID:          check.ReceiverID,
		ExternalMonitorID:   check.ExternalMonitorID,
		ExternalTriggerID:   check.ExternalTriggerID,
		ExternalMonitorName: check.ExternalMonitorName,
		ExternalTriggerName: check.ExternalTriggerName,
	})
	if err != nil {
		result.FailureCategory, result.FailureReason = "ALERT_LOOKUP_ERROR", safeError(err)
		return result
	}
	applyOpenSearchAlertGate(&result, matches, deploymentStart)
	return result
}

// applyOpenSearchAlertGate encodes deploy-gate semantics: the check passes when the
// selected OpenSearch alert is not currently firing. During deployment validation,
// a trigger at or after deployment start also fails the check even if later resolved.
func applyOpenSearchAlertGate(result *CheckResult, matches []alerts.Alert, deploymentStart *time.Time) {
	for _, match := range matches {
		if result.AlertID == "" {
			result.AlertID = match.ID
			result.AlertState = match.State
			result.UpstreamState = match.UpstreamState
			result.ApplicationID = match.ApplicationID
			result.ServiceID = match.ServiceID
			if result.Name == "" {
				result.Name = match.Title
			}
			if result.ExternalMonitorName == "" {
				result.ExternalMonitorName = match.ExternalMonitorName
			}
			if result.ExternalTriggerName == "" {
				result.ExternalTriggerName = match.ExternalTriggerName
			}
		}
		if isOpenSearchAlertFiring(match) {
			result.Status = "FAILED"
			result.AlertID, result.AlertState, result.UpstreamState = match.ID, match.State, match.UpstreamState
			result.FailureCategory = "ALERT_FIRING"
			result.FailureReason = fmt.Sprintf("OpenSearch alert %q is %s.", defaultString(match.Title, match.ID), strings.ToLower(match.State))
			return
		}
	}
	if deploymentStart != nil {
		for _, match := range matches {
			if match.LastTriggeredAt != nil && !match.LastTriggeredAt.Before(deploymentStart.UTC()) {
				result.Status = "FAILED"
				result.AlertID, result.AlertState, result.UpstreamState = match.ID, match.State, match.UpstreamState
				result.FailureCategory = "ALERT_TRIGGERED_POST_DEPLOY"
				result.FailureReason = fmt.Sprintf("OpenSearch alert %q triggered at or after deployment start.", defaultString(match.Title, match.ID))
				return
			}
		}
	}
	result.Status = "SUCCESS"
	result.Decision = "PASS"
	if len(matches) == 0 {
		result.FailureReason = ""
		result.Decision = "PASS"
		// Honest gap: absence from the receiver inbox means "not currently observed as firing".
	}
}

func isOpenSearchAlertFiring(alert alerts.Alert) bool {
	switch alert.State {
	case "OPEN", "ACKNOWLEDGED", "ERROR":
		return true
	default:
		return false
	}
}

func defaultString(value, fallback string) string {
	if strings.TrimSpace(value) == "" {
		return fallback
	}
	return strings.TrimSpace(value)
}
func safeError(err error) string {
	if err == nil {
		return ""
	}
	return strings.ReplaceAll(err.Error(), "\n", " ")
}

type MemoryRepository struct {
	mu          sync.RWMutex
	suites      map[string]Suite
	runs        map[string]SuiteRun
	deployments map[string]DeploymentRun
}

func NewMemoryRepository() *MemoryRepository {
	return &MemoryRepository{suites: map[string]Suite{}, runs: map[string]SuiteRun{}, deployments: map[string]DeploymentRun{}}
}
func (r *MemoryRepository) List(_ context.Context) ([]Suite, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	out := make([]Suite, 0, len(r.suites))
	for _, v := range r.suites {
		out = append(out, v)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].UpdatedAt.After(out[j].UpdatedAt) })
	return out, nil
}
func (r *MemoryRepository) Get(_ context.Context, id string) (Suite, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	v, ok := r.suites[id]
	if !ok {
		return Suite{}, ErrNotFound
	}
	return v, nil
}
func (r *MemoryRepository) Create(_ context.Context, v Suite) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.suites[v.ID] = v
	return nil
}
func (r *MemoryRepository) Update(ctx context.Context, v Suite) error { return r.Create(ctx, v) }
func (r *MemoryRepository) Delete(_ context.Context, id string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, ok := r.suites[id]; !ok {
		return ErrNotFound
	}
	delete(r.suites, id)
	for runID, run := range r.runs {
		if run.SuiteID == id {
			delete(r.runs, runID)
		}
	}
	for deploymentID, deployment := range r.deployments {
		if deployment.SuiteID == id {
			delete(r.deployments, deploymentID)
		}
	}
	return nil
}
func (r *MemoryRepository) SaveRun(_ context.Context, v SuiteRun) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.runs[v.ID] = v
	return nil
}
func (r *MemoryRepository) GetRun(_ context.Context, id string) (SuiteRun, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	v, ok := r.runs[id]
	if !ok {
		return SuiteRun{}, ErrNotFound
	}
	return v, nil
}

type PostgresRepository struct{ pool *pgxpool.Pool }

func NewPostgresRepository(pool *pgxpool.Pool) *PostgresRepository {
	return &PostgresRepository{pool: pool}
}
func (r *PostgresRepository) List(ctx context.Context) ([]Suite, error) {
	rows, err := r.pool.Query(ctx, `SELECT id::text,name,description,environment,stages_json,parallelism,fail_fast,timeout_seconds,baseline_policy,notification_policy,created_by,updated_by,created_at,updated_at FROM validation_suites ORDER BY updated_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Suite{}
	for rows.Next() {
		v, err := scanSuite(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, v)
	}
	return out, rows.Err()
}
func (r *PostgresRepository) Get(ctx context.Context, id string) (Suite, error) {
	v, err := scanSuite(r.pool.QueryRow(ctx, `SELECT id::text,name,description,environment,stages_json,parallelism,fail_fast,timeout_seconds,baseline_policy,notification_policy,created_by,updated_by,created_at,updated_at FROM validation_suites WHERE id=$1`, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return Suite{}, ErrNotFound
	}
	return v, err
}

type rowScanner interface{ Scan(...any) error }

func scanSuite(row rowScanner) (Suite, error) {
	var v Suite
	var stages []byte
	err := row.Scan(&v.ID, &v.Name, &v.Description, &v.Environment, &stages, &v.Parallelism, &v.FailFast, &v.TimeoutSeconds, &v.BaselinePolicy, &v.NotificationPolicy, &v.CreatedBy, &v.UpdatedBy, &v.CreatedAt, &v.UpdatedAt)
	if err == nil {
		err = json.Unmarshal(stages, &v.Stages)
		for stageIndex := range v.Stages {
			for checkIndex := range v.Stages[stageIndex].Checks {
				if v.Stages[stageIndex].Checks[checkIndex].Kind == "" {
					v.Stages[stageIndex].Checks[checkIndex].Kind = "MONITOR"
				}
			}
		}
	}
	return v, err
}
func (r *PostgresRepository) Create(ctx context.Context, v Suite) error {
	stages, _ := json.Marshal(v.Stages)
	_, err := r.pool.Exec(ctx, `INSERT INTO validation_suites(id,name,description,environment,stages_json,parallelism,fail_fast,timeout_seconds,baseline_policy,notification_policy,created_by,updated_by,created_at,updated_at)VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`, v.ID, v.Name, v.Description, v.Environment, stages, v.Parallelism, v.FailFast, v.TimeoutSeconds, v.BaselinePolicy, v.NotificationPolicy, v.CreatedBy, v.UpdatedBy, v.CreatedAt, v.UpdatedAt)
	return err
}
func (r *PostgresRepository) Update(ctx context.Context, v Suite) error {
	stages, _ := json.Marshal(v.Stages)
	tag, err := r.pool.Exec(ctx, `UPDATE validation_suites SET name=$2,description=$3,environment=$4,stages_json=$5,parallelism=$6,fail_fast=$7,timeout_seconds=$8,baseline_policy=$9,notification_policy=$10,updated_by=$11,updated_at=$12 WHERE id=$1`, v.ID, v.Name, v.Description, v.Environment, stages, v.Parallelism, v.FailFast, v.TimeoutSeconds, v.BaselinePolicy, v.NotificationPolicy, v.UpdatedBy, v.UpdatedAt)
	if err == nil && tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return err
}
func (r *PostgresRepository) Delete(ctx context.Context, id string) error {
	tag, err := r.pool.Exec(ctx, `DELETE FROM validation_suites WHERE id=$1`, id)
	if err == nil && tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return err
}
func (r *PostgresRepository) SaveRun(ctx context.Context, v SuiteRun) error {
	results, _ := json.Marshal(v.Results)
	_, err := r.pool.Exec(ctx, `INSERT INTO validation_suite_runs(id,suite_id,status,gate_decision,trigger_type,trigger_source,results_json,started_at,ended_at,duration_ms,created_at)VALUES($1,$2,$3,$4,$5,NULLIF($6,''),$7,$8,$9,$10,$11)`, v.ID, v.SuiteID, v.Status, v.GateDecision, v.TriggerType, v.TriggerSource, results, v.StartedAt, v.EndedAt, v.DurationMS, v.CreatedAt)
	return err
}
func (r *PostgresRepository) GetRun(ctx context.Context, id string) (SuiteRun, error) {
	var v SuiteRun
	var results []byte
	err := r.pool.QueryRow(ctx, `SELECT id::text,suite_id::text,status,gate_decision,trigger_type,COALESCE(trigger_source,''),results_json,started_at,ended_at,duration_ms,created_at FROM validation_suite_runs WHERE id=$1`, id).Scan(&v.ID, &v.SuiteID, &v.Status, &v.GateDecision, &v.TriggerType, &v.TriggerSource, &results, &v.StartedAt, &v.EndedAt, &v.DurationMS, &v.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return SuiteRun{}, ErrNotFound
	}
	if err == nil {
		err = json.Unmarshal(results, &v.Results)
	}
	return v, err
}
