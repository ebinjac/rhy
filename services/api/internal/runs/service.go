package runs

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http/cookiejar"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/rhythm-monitoring/rhythm/internal/id"
	"github.com/rhythm-monitoring/rhythm/internal/monitors"
	"github.com/rhythm-monitoring/rhythm/internal/scripts"
)

var ErrNotFound = errors.New("run not found")

type Service struct {
	monitors   *monitors.Service
	repository Repository
	executor   *HTTPExecutor
	now        func() time.Time
	agents     AgentRouter
	cancelMu   sync.Mutex
	cancels    map[string]context.CancelFunc
}

type AgentRouter interface {
	Select(context.Context, AgentRequirements) (string, error)
	Release(context.Context, string) error
}

func NewService(monitors *monitors.Service, repository Repository, executor *HTTPExecutor) *Service {
	return &Service{monitors: monitors, repository: repository, executor: executor, now: func() time.Time { return time.Now().UTC() }, cancels: make(map[string]context.CancelFunc)}
}

func (s *Service) SetAgentRouter(router AgentRouter) { s.agents = router }

type DraftPreview struct {
	Status          Status          `json:"status"`
	DurationMS      int64           `json:"durationMs"`
	FailureCategory string          `json:"failureCategory,omitempty"`
	FailureReason   string          `json:"failureReason,omitempty"`
	Steps           []StepRun       `json:"steps"`
	SetupScript     *scripts.Result `json:"setupScript,omitempty"`
}

// PreviewDefinition executes an unsaved definition without creating a monitor,
// revision, run, event, or database record. Evidence is masked by the same
// executor used for persisted runs.
func (s *Service) PreviewDefinition(ctx context.Context, definition Definition) (DraftPreview, error) {
	return s.PreviewDefinitionWithEnvironment(ctx, definition, "")
}

func (s *Service) PreviewDefinitionWithEnvironment(ctx context.Context, definition Definition, environmentID string) (DraftPreview, error) {
	if len(definition.Steps) == 0 {
		return DraftPreview{}, errors.New("draft has no workflow steps")
	}
	started := s.now()
	preview := DraftPreview{Status: StatusSuccess, Steps: []StepRun{}}
	jar, err := cookiejar.New(nil)
	if err != nil {
		return DraftPreview{}, fmt.Errorf("create preview cookie jar: %w", err)
	}
	values, _, err := s.loadEnvironmentValues(ctx, environmentID)
	if err != nil {
		return DraftPreview{}, fmt.Errorf("selected environment could not be loaded: %w", err)
	}
	if err := s.executor.ResolveDefinitionSecrets(ctx, definition, values); err != nil {
		return DraftPreview{}, err
	}
	if strings.TrimSpace(definition.Scripts.PreRequest.Code) != "" {
		result, next := s.executor.ExecuteSetupScript(ctx, definition.Scripts.PreRequest, values, scripts.Info{EventName: "prerequest", RuntimeVersion: scripts.RuntimeVersion}, 10000)
		preview.SetupScript, values = &result, next
		if result.Status != "SUCCESS" {
			preview.Status = StatusFailed
			preview.FailureCategory = result.ErrorCategory
			preview.FailureReason = result.ErrorMessage
		}
	}
	executedSteps := 0
	for index := 0; index < len(definition.Steps); index++ {
		step := definition.Steps[index]
		executedSteps++
		if executedSteps > 100 {
			preview.Status = StatusFailed
			preview.FailureCategory = "SCRIPT_POLICY_VIOLATION"
			preview.FailureReason = "Workflow navigation exceeded the 100-step execution limit."
			break
		}
		if preview.Status != StatusSuccess || !step.Enabled {
			continue
		}
		shouldRun, conditionErr := evaluateCondition(step.Condition, values)
		if conditionErr != nil {
			preview.Status, preview.FailureCategory, preview.FailureReason = StatusFailed, "CONDITION_EVALUATION_FAILURE", conditionErr.Error()
			break
		}
		if !shouldRun {
			continue
		}
		var stepResult StepRun
		switch step.Type {
		case "ACTION":
			var produced map[string]string
			stepResult, produced = s.executor.ExecuteActions(ctx, step, values)
			for key, value := range produced {
				values[key] = value
				values["variables."+key] = value
				values["steps."+step.ID+".outputs."+key] = value
			}
		case "HTTP_REQUEST":
			stepResult = s.executor.ExecuteWithScriptState(ctx, step, jar, values, ScriptExecutionContext{StepID: step.ID, StepName: step.Name})
		case "METRIC_VALIDATION":
			stepResult = s.executor.ExecuteMetric(ctx, step)
		default:
			stepResult = StepRun{StepDefinitionID: step.ID, StepName: step.Name, StepType: step.Type, Status: StatusFailed, FailureCategory: "CONFIGURATION_ERROR", ErrorMessage: "Unsupported workflow step type."}
		}
		stepResult.StepOrder = index + 1
		preview.Steps = append(preview.Steps, stepResult)
		for _, extractor := range stepResult.Extractors {
			if extractor.Success && !extractor.Sensitive {
				rendered := fmt.Sprint(extractor.Value)
				values[extractor.Variable] = rendered
				values["variables."+extractor.Variable] = rendered
				values["steps."+step.ID+".outputs."+extractor.Variable] = rendered
			}
		}
		for key, value := range stepResult.PrivateOutputs {
			values[key] = value
			values["variables."+key] = value
			values["steps."+step.ID+".outputs."+key] = value
		}
		if stepResult.Status != StatusSuccess && stepResult.Status != StatusSuccessWithWarnings && stepResult.Status != StatusSkipped {
			preview.Status = stepResult.Status
			preview.FailureCategory = stepResult.FailureCategory
			preview.FailureReason = stepResult.ErrorMessage
		}
		execution := scripts.Execution{}
		if stepResult.PreRequestScript != nil && stepResult.PreRequestScript.Execution.NextRequestSet {
			execution = stepResult.PreRequestScript.Execution
		}
		if stepResult.TestScript != nil && stepResult.TestScript.Execution.NextRequestSet {
			execution = stepResult.TestScript.Execution
		}
		if execution.NextRequestSet {
			if execution.NextRequest == "" {
				break
			}
			nextIndex := -1
			for candidateIndex, candidate := range definition.Steps {
				if candidate.ID == execution.NextRequest || candidate.Name == execution.NextRequest {
					nextIndex = candidateIndex
					break
				}
			}
			if nextIndex < 0 {
				preview.Status = StatusFailed
				preview.FailureCategory = "SCRIPT_POLICY_VIOLATION"
				preview.FailureReason = fmt.Sprintf("pm.execution.setNextRequest target %q was not found.", execution.NextRequest)
				break
			}
			index = nextIndex - 1
		}
	}
	preview.DurationMS = s.now().Sub(started).Milliseconds()
	return preview, nil
}

func (s *Service) loadEnvironmentValues(ctx context.Context, environmentID string) (map[string]string, EnvironmentMaterial, error) {
	material, err := s.executor.LoadEnvironment(ctx, environmentID)
	if err != nil {
		return nil, EnvironmentMaterial{}, err
	}
	values := make(map[string]string, len(material.Variables)*2)
	for key, value := range material.Variables {
		values[key] = value
		values["environment."+key] = value
	}
	return values, material, nil
}

func sortedStringKeys(values map[string]string) []string {
	keys := make([]string, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}

func (s *Service) Monitor(ctx context.Context, monitorID string) (monitors.Monitor, error) {
	return s.monitors.Get(ctx, monitorID)
}

func (s *Service) RunDraft(ctx context.Context, monitorID, actorID string) (Run, error) {
	return s.Run(ctx, monitorID, actorID, "draft")
}

func (s *Service) Run(ctx context.Context, monitorID, actorID, mode string) (Run, error) {
	return s.run(ctx, monitorID, actorID, mode, "", "", nil)
}

func (s *Service) RunTriggered(ctx context.Context, monitorID, actorID, triggerType string) (Run, error) {
	return s.run(ctx, monitorID, actorID, "published", triggerType, "", nil)
}

func (s *Service) RunScheduled(ctx context.Context, monitorID, scheduleID string) (Run, error) {
	return s.run(ctx, monitorID, scheduleID, "published", "SCHEDULED", "", nil)
}

func (s *Service) Start(ctx context.Context, monitorID, actorID, mode string) (Run, error) {
	return s.start(ctx, monitorID, actorID, mode, "", "", "")
}

func (s *Service) StartTriggered(ctx context.Context, monitorID, actorID, triggerType string) (Run, error) {
	return s.start(ctx, monitorID, actorID, "published", triggerType, "", "")
}

func (s *Service) WaitForTerminal(ctx context.Context, runID string, pollInterval time.Duration) (Run, error) {
	if pollInterval <= 0 {
		pollInterval = 250 * time.Millisecond
	}
	ticker := time.NewTicker(pollInterval)
	defer ticker.Stop()
	for {
		run, err := s.repository.Get(ctx, runID)
		if err != nil {
			return Run{}, err
		}
		if isTerminalStatus(run.Status) {
			return run, nil
		}
		select {
		case <-ctx.Done():
			return run, ctx.Err()
		case <-ticker.C:
		}
	}
}

func (s *Service) StartScheduled(ctx context.Context, monitorID, scheduleID, concurrencyPolicy string, dueAt time.Time) (Run, error) {
	deduplication := fmt.Sprintf("schedule:%s:%d", scheduleID, dueAt.UTC().Unix())
	return s.start(ctx, monitorID, scheduleID, "published", "SCHEDULED", scheduleID, deduplication, concurrencyPolicy)
}

func (s *Service) start(ctx context.Context, monitorID, actorID, mode, triggerOverride, scheduleID, deduplication string, concurrencyPolicy ...string) (Run, error) {
	monitor, revision, definition, triggerType, err := s.resolveExecution(ctx, monitorID, mode, triggerOverride)
	if err != nil {
		return Run{}, err
	}
	runID, err := id.NewUUID()
	if err != nil {
		return Run{}, err
	}
	queuedAt := s.now()
	run := Run{ID: runID, MonitorID: monitorID, RevisionID: revision.ID, Status: StatusQueued, TriggerType: triggerType, TriggerSource: actorID, CreatedAt: queuedAt, Steps: []StepRun{}, ExecutionContext: map[string]any{"monitorName": monitor.Name, "environmentId": monitor.EnvironmentID, "revisionId": revision.ID, "revisionNumber": revision.RevisionNumber}}
	appendRunEvent(&run, "RUN_QUEUED", StatusQueued, "Run accepted and queued for execution.", "", nil)
	request := QueueRequest{
		MonitorID: monitorID, RevisionID: revision.ID, ActorID: actorID, Mode: mode, TriggerType: triggerOverride,
		ScheduleID: scheduleID, Deduplication: deduplication, QueuedAt: queuedAt,
		RecoverySafe: definitionRecoverySafe(definition),
		Snapshot: &ExecutionSnapshot{MonitorName: monitor.Name, EnvironmentID: monitor.EnvironmentID,
			RevisionID: revision.ID, RevisionNumber: revision.RevisionNumber, Definition: definition},
	}
	if len(concurrencyPolicy) > 0 {
		request.ConcurrencyPolicy = concurrencyPolicy[0]
	}
	if durable, ok := s.repository.(DurableRepository); ok {
		if err := durable.Enqueue(context.WithoutCancel(ctx), run, request); err != nil {
			return Run{}, err
		}
		return run, nil
	}
	if err := s.repository.Save(context.WithoutCancel(ctx), run); err != nil {
		return Run{}, err
	}
	runContext, cancel := context.WithCancel(context.Background())
	s.cancelMu.Lock()
	s.cancels[runID] = cancel
	s.cancelMu.Unlock()
	go func() {
		defer func() { s.cancelMu.Lock(); delete(s.cancels, runID); s.cancelMu.Unlock() }()
		if _, runErr := s.run(runContext, monitorID, actorID, mode, "", runID, &queuedAt); runErr != nil {
			failed := run
			now := s.now()
			failed.Status = StatusAborted
			failed.FailureCategory = "WORKER_LOST"
			failed.FailureReason = "Execution stopped before a terminal result could be recorded."
			failed.EndedAt = &now
			failed.DurationMS = now.Sub(queuedAt).Milliseconds()
			appendRunEvent(&failed, "RUN_ABORTED", StatusAborted, failed.FailureReason, failed.FailureCategory, nil)
			_ = s.repository.Save(context.Background(), failed)
		}
	}()
	return run, nil
}

func definitionRecoverySafe(definition Definition) bool {
	if strings.TrimSpace(definition.Scripts.PreRequest.Code) != "" {
		return false
	}
	for _, step := range definition.Steps {
		if !step.Enabled || step.Type != "HTTP_REQUEST" {
			continue
		}
		request := step.Request
		if strings.TrimSpace(request.PreRequestScript.Code) != "" ||
			strings.TrimSpace(request.TestScript.Code) != "" {
			return false
		}
		switch strings.ToUpper(strings.TrimSpace(request.Method)) {
		case "GET", "HEAD", "OPTIONS", "PUT", "DELETE":
			continue
		}
		idempotencyKey := ""
		for _, header := range request.Headers {
			if header.Enabled && strings.EqualFold(strings.TrimSpace(header.Key), "Idempotency-Key") {
				idempotencyKey = strings.TrimSpace(header.Value)
				break
			}
		}
		if idempotencyKey == "" || strings.Contains(idempotencyKey, "{{") {
			return false
		}
	}
	return true
}

func (s *Service) Cancel(ctx context.Context, runID string) (Run, error) {
	run, err := s.repository.Get(ctx, runID)
	if err != nil {
		return Run{}, err
	}
	if isTerminalStatus(run.Status) {
		return run, errors.New("run is already complete")
	}
	if durable, ok := s.repository.(DurableRepository); ok {
		requested, requestErr := durable.RequestCancel(ctx, runID)
		if requestErr != nil {
			return run, requestErr
		}
		if requested {
			return run, nil
		}
	}
	s.cancelMu.Lock()
	cancel := s.cancels[runID]
	s.cancelMu.Unlock()
	if cancel == nil {
		return run, errors.New("run is not active on this worker")
	}
	cancel()
	return run, nil
}

// ExecuteQueued is the durable worker entry point. It intentionally accepts
// the stable run ID allocated by the API or scheduler so Redis redelivery
// cannot create a duplicate execution.
func (s *Service) ExecuteQueued(ctx context.Context, runID string, request QueueRequest) (Run, error) {
	queuedAt := request.QueuedAt
	if queuedAt.IsZero() {
		if queued, err := s.repository.Get(ctx, runID); err == nil {
			queuedAt = queued.CreatedAt
		} else {
			queuedAt = s.now()
		}
	}
	return s.runWithSnapshot(ctx, request.MonitorID, request.ActorID, request.Mode, request.TriggerType, runID, &queuedAt, request.RevisionID, request.Snapshot)
}

func isTerminalStatus(status Status) bool {
	switch status {
	case StatusSuccess, StatusSuccessWithWarnings, StatusFailed, StatusTimedOut, StatusCancelled, StatusAborted:
		return true
	}
	return false
}

func (s *Service) resolveExecution(ctx context.Context, monitorID, mode, triggerOverride string) (monitors.Monitor, monitors.Revision, Definition, string, error) {
	return s.resolveExecutionAtRevision(ctx, monitorID, mode, triggerOverride, "")
}

func (s *Service) resolveExecutionAtRevision(ctx context.Context, monitorID, mode, triggerOverride, requestedRevisionID string) (monitors.Monitor, monitors.Revision, Definition, string, error) {
	monitor, err := s.monitors.Get(ctx, monitorID)
	if err != nil {
		return monitors.Monitor{}, monitors.Revision{}, Definition{}, "", err
	}
	revisionID := strings.TrimSpace(requestedRevisionID)
	if revisionID == "" {
		revisionID = monitor.CurrentDraftRevisionID
	}
	triggerType := "MANUAL_DRAFT"
	if mode == "published" {
		if strings.TrimSpace(requestedRevisionID) == "" {
			revisionID = monitor.LatestPublishedRevisionID
		}
		triggerType = "MANUAL_PUBLISHED"
		if revisionID == "" {
			return monitors.Monitor{}, monitors.Revision{}, Definition{}, "", errors.New("monitor has no published revision")
		}
	} else if mode != "" && mode != "draft" {
		return monitors.Monitor{}, monitors.Revision{}, Definition{}, "", errors.New("run revision must be draft or published")
	}
	if triggerOverride != "" {
		triggerType = triggerOverride
	}
	if revisionID == "" {
		return monitors.Monitor{}, monitors.Revision{}, Definition{}, "", errors.New("monitor has no executable draft revision")
	}
	revision, err := s.monitors.GetRevision(ctx, monitorID, revisionID)
	if err != nil {
		if errors.Is(err, monitors.ErrNotFound) {
			return monitors.Monitor{}, monitors.Revision{}, Definition{}, "", errors.New("monitor has no executable revision")
		}
		return monitors.Monitor{}, monitors.Revision{}, Definition{}, "", err
	}
	encoded, err := json.Marshal(revision.Definition)
	if err != nil {
		return monitors.Monitor{}, monitors.Revision{}, Definition{}, "", fmt.Errorf("encode monitor definition: %w", err)
	}
	var definition Definition
	if err := json.Unmarshal(encoded, &definition); err != nil {
		return monitors.Monitor{}, monitors.Revision{}, Definition{}, "", fmt.Errorf("decode monitor definition: %w", err)
	}
	if len(definition.Steps) == 0 {
		return monitors.Monitor{}, monitors.Revision{}, Definition{}, "", errors.New("monitor draft has no workflow steps")
	}
	return monitor, revision, definition, triggerType, nil
}

func (s *Service) run(ctx context.Context, monitorID, actorID, mode, triggerOverride, requestedRunID string, queuedAt *time.Time) (Run, error) {
	return s.runAtRevision(ctx, monitorID, actorID, mode, triggerOverride, requestedRunID, queuedAt, "")
}

func (s *Service) runAtRevision(ctx context.Context, monitorID, actorID, mode, triggerOverride, requestedRunID string, queuedAt *time.Time, requestedRevisionID string) (Run, error) {
	return s.runWithSnapshot(ctx, monitorID, actorID, mode, triggerOverride, requestedRunID, queuedAt, requestedRevisionID, nil)
}

func (s *Service) runWithSnapshot(ctx context.Context, monitorID, actorID, mode, triggerOverride, requestedRunID string, queuedAt *time.Time, requestedRevisionID string, snapshot *ExecutionSnapshot) (Run, error) {
	var monitor monitors.Monitor
	var revision monitors.Revision
	var definition Definition
	var triggerType string
	var err error
	if snapshot != nil {
		if snapshot.RevisionID == "" || len(snapshot.Definition.Steps) == 0 || (requestedRevisionID != "" && requestedRevisionID != snapshot.RevisionID) {
			return Run{}, errors.New("queued execution snapshot is invalid")
		}
		monitor = monitors.Monitor{ID: monitorID, Name: snapshot.MonitorName, EnvironmentID: snapshot.EnvironmentID}
		revision = monitors.Revision{ID: snapshot.RevisionID, MonitorID: monitorID, RevisionNumber: snapshot.RevisionNumber}
		definition = snapshot.Definition
		triggerType = "MANUAL_DRAFT"
		if mode == "published" {
			triggerType = "MANUAL_PUBLISHED"
		}
		if triggerOverride != "" {
			triggerType = triggerOverride
		}
	} else {
		monitor, revision, definition, triggerType, err = s.resolveExecutionAtRevision(ctx, monitorID, mode, triggerOverride, requestedRevisionID)
	}
	if err != nil {
		return Run{}, err
	}
	selectedAgentID := ""
	if s.agents != nil && (definition.Agent.AgentID != "" || definition.Agent.GroupID != "" || len(definition.Agent.RequiredTags) > 0 || len(definition.Agent.RequiredCapabilities) > 0) {
		selectedAgentID, err = s.agents.Select(ctx, definition.Agent)
		if err != nil {
			return Run{}, fmt.Errorf("select execution agent: %w", err)
		}
		defer func() { _ = s.agents.Release(context.WithoutCancel(ctx), selectedAgentID) }()
	}
	runID := requestedRunID
	if runID == "" {
		runID, err = id.NewUUID()
		if err != nil {
			return Run{}, err
		}
	}
	started := s.now()
	createdAt := started
	queueDelay := int64(0)
	if queuedAt != nil {
		createdAt = *queuedAt
		queueDelay = started.Sub(*queuedAt).Milliseconds()
	}
	run := Run{ID: runID, MonitorID: monitorID, RevisionID: revision.ID, Status: StatusRunning, TriggerType: triggerType, TriggerSource: actorID, AgentID: selectedAgentID, QueueDelayMS: queueDelay, StartedAt: &started, CreatedAt: createdAt, Steps: []StepRun{}, ExecutionContext: map[string]any{"monitorName": monitor.Name, "environmentId": monitor.EnvironmentID, "revisionId": revision.ID, "revisionNumber": revision.RevisionNumber, "agentId": selectedAgentID, "triggerType": triggerType, "triggerSource": actorID, "scriptRuntimeVersion": scripts.RuntimeVersion}}
	if queuedAt != nil {
		appendRunEvent(&run, "RUN_QUEUED", StatusQueued, "Run accepted and queued for execution.", "", map[string]any{"queueDelayMs": queueDelay})
	}
	appendRunEvent(&run, "RUN_STARTED", StatusRunning, "Execution started.", "", map[string]any{"stepCount": len(definition.Steps)})
	persistedSteps, persistedEvents := 0, 0
	saveProgress := func() error {
		saveContext := context.WithoutCancel(ctx)
		if repository, ok := s.repository.(IncrementalRepository); ok {
			if err := repository.SaveDelta(saveContext, run, run.Steps[persistedSteps:], run.Events[persistedEvents:]); err != nil {
				return err
			}
		} else if err := s.repository.Save(saveContext, run); err != nil {
			return err
		}
		persistedSteps = len(run.Steps)
		persistedEvents = len(run.Events)
		return nil
	}
	if err := saveProgress(); err != nil {
		return Run{}, err
	}
	jar, err := cookiejar.New(nil)
	if err != nil {
		return Run{}, fmt.Errorf("create workflow cookie jar: %w", err)
	}
	workflowValues, environment, environmentErr := s.loadEnvironmentValues(ctx, monitor.EnvironmentID)
	if environmentErr != nil {
		run.Status, run.FailureCategory = StatusFailed, "ENVIRONMENT_RESOLUTION_FAILED"
		run.FailureReason = "The selected environment could not be loaded. Check that it is active and its secret references are valid."
		appendRunEvent(&run, "RUN_FAILED", StatusFailed, run.FailureReason, run.FailureCategory, map[string]any{"environmentId": monitor.EnvironmentID})
		now := s.now()
		run.EndedAt = &now
		run.DurationMS = now.Sub(started).Milliseconds()
		_ = saveProgress()
		return run, nil
	}
	if environment.ID != "" {
		run.ExecutionContext["environment"] = map[string]any{
			"id": environment.ID, "name": environment.Name, "stage": environment.ProfileType,
			"updatedAt": environment.UpdatedAt, "variableNames": sortedStringKeys(environment.Variables),
		}
	}
	if err := s.executor.ResolveDefinitionSecrets(ctx, definition, workflowValues); err != nil {
		run.Status, run.FailureCategory = StatusFailed, "SECRET_RESOLUTION_FAILED"
		run.FailureReason = "A referenced secret could not be resolved. Check the alias and secret profile state."
		appendRunEvent(&run, "RUN_FAILED", StatusFailed, run.FailureReason, run.FailureCategory, nil)
		now := s.now()
		run.EndedAt = &now
		run.DurationMS = now.Sub(started).Milliseconds()
		_ = saveProgress()
		return run, nil
	}
	if strings.TrimSpace(definition.Scripts.PreRequest.Code) != "" {
		appendRunEvent(&run, "PRE_REQUEST_SCRIPT_STARTED", StatusRunning, "Monitor setup script started.", "", map[string]any{"scope": "monitor", "runtimeVersion": scripts.RuntimeVersion})
		setupResult, values := s.executor.ExecuteSetupScript(ctx, definition.Scripts.PreRequest, workflowValues, scripts.Info{MonitorID: monitorID, RunID: runID, RevisionID: revision.ID, RequestName: monitor.Name, EventName: "prerequest", RuntimeVersion: scripts.RuntimeVersion}, 10000)
		workflowValues, run.SetupScript = values, &setupResult
		if setupResult.Status != "SUCCESS" {
			run.Status, run.FailureCategory, run.FailureReason = StatusFailed, setupResult.ErrorCategory, setupResult.ErrorMessage
			appendRunEvent(&run, "PRE_REQUEST_SCRIPT_FAILED", StatusFailed, "Monitor setup script failed.", setupResult.ErrorCategory, map[string]any{"scope": "monitor", "durationMs": setupResult.DurationMS, "line": setupResult.ErrorLine, "auxiliaryRequests": len(setupResult.AuxiliaryRequests)})
		} else {
			appendRunEvent(&run, "PRE_REQUEST_SCRIPT_COMPLETED", StatusSuccess, "Monitor setup script completed.", "", map[string]any{"scope": "monitor", "durationMs": setupResult.DurationMS, "tests": len(setupResult.Tests), "changes": len(setupResult.VariableChanges), "auxiliaryRequests": len(setupResult.AuxiliaryRequests)})
		}
		appendAuxiliaryRequestEvents(&run, nil, "monitor", setupResult.AuxiliaryRequests)
		_ = saveProgress()
	}
	executedSteps := 0
	for index := 0; index < len(definition.Steps); index++ {
		step := definition.Steps[index]
		executedSteps++
		if executedSteps > 100 {
			run.Status = StatusFailed
			run.FailureCategory = "SCRIPT_POLICY_VIOLATION"
			run.FailureReason = "Workflow navigation exceeded the 100-step execution limit."
			break
		}
		if run.Status != StatusRunning {
			break
		}
		if errors.Is(ctx.Err(), context.Canceled) {
			run.Status = StatusCancelled
			run.FailureCategory = "RUN_CANCELLED"
			run.FailureReason = "Execution was cancelled before the next step started."
			break
		}
		if !step.Enabled {
			continue
		}
		stepID, err := id.NewUUID()
		if err != nil {
			return Run{}, err
		}
		var stepResult StepRun
		appendRunEvent(&run, "STEP_STARTED", StatusRunning, "Step started.", "", map[string]any{"stepId": step.ID, "stepName": step.Name, "stepOrder": index + 1, "stepType": step.Type})
		shouldRun, conditionErr := evaluateCondition(step.Condition, workflowValues)
		if conditionErr != nil {
			now := s.now()
			stepResult = StepRun{StepDefinitionID: step.ID, StepName: step.Name, StepType: step.Type, Status: StatusFailed, FailureCategory: "CONDITION_EVALUATION_FAILURE", ErrorMessage: conditionErr.Error(), StartedAt: &now, EndedAt: &now}
		} else if !shouldRun {
			now := s.now()
			stepResult = StepRun{StepDefinitionID: step.ID, StepName: step.Name, StepType: step.Type, Status: StatusSkipped, StartedAt: &now, EndedAt: &now, Extractors: []ExtractorResult{}, Assertions: []AssertionResult{}, Outputs: map[string]any{}}
		} else if step.Type == "ACTION" {
			var produced map[string]string
			stepResult, produced = s.executor.ExecuteActions(ctx, step, workflowValues)
			for key, value := range produced {
				workflowValues[key] = value
				workflowValues["variables."+key] = value
				workflowValues["steps."+step.ID+".outputs."+key] = value
			}
		} else if step.Type == "HTTP_REQUEST" {
			if strings.TrimSpace(step.Request.PreRequestScript.Code) != "" {
				appendRunEvent(&run, "PRE_REQUEST_SCRIPT_STARTED", StatusRunning, "Request pre-request script started.", "", map[string]any{"scope": "request", "stepId": step.ID, "runtimeVersion": scripts.RuntimeVersion})
			}
			if strings.TrimSpace(step.Request.TestScript.Code) != "" {
				appendRunEvent(&run, "TEST_SCRIPT_STARTED", StatusRunning, "Response Tests script scheduled.", "", map[string]any{"scope": "test", "stepId": step.ID, "runtimeVersion": scripts.RuntimeVersion})
			}
			stepResult = s.executor.ExecuteWithScriptState(ctx, step, jar, workflowValues, ScriptExecutionContext{MonitorID: monitorID, RunID: runID, RevisionID: revision.ID, StepID: step.ID, StepName: step.Name})
		} else if step.Type == "METRIC_VALIDATION" {
			stepResult = s.executor.ExecuteMetric(ctx, step)
		} else {
			stepResult = StepRun{StepDefinitionID: step.ID, StepName: step.Name, StepType: step.Type, Status: StatusFailed, FailureCategory: "CONFIGURATION_ERROR", ErrorMessage: "Unsupported workflow step type."}
		}
		stepResult.ID, stepResult.RunID, stepResult.StepOrder = stepID, runID, index+1
		if errors.Is(ctx.Err(), context.Canceled) {
			stepResult.Status = StatusCancelled
			stepResult.FailureCategory = "RUN_CANCELLED"
			stepResult.ErrorMessage = "Execution was cancelled."
		}
		run.Steps = append(run.Steps, stepResult)
		if stepResult.PreRequestScript != nil {
			eventType, message := "PRE_REQUEST_SCRIPT_COMPLETED", "Request pre-request script completed."
			if stepResult.PreRequestScript.Status != "SUCCESS" {
				eventType, message = "PRE_REQUEST_SCRIPT_FAILED", "Request pre-request script failed."
			}
			appendStepEvent(&run, stepResult, eventType, stepResult.Status, message, stepResult.PreRequestScript.ErrorCategory, map[string]any{"scope": "request", "durationMs": stepResult.PreRequestScript.DurationMS, "tests": len(stepResult.PreRequestScript.Tests), "changes": len(stepResult.PreRequestScript.RequestChanges) + len(stepResult.PreRequestScript.VariableChanges), "line": stepResult.PreRequestScript.ErrorLine, "auxiliaryRequests": len(stepResult.PreRequestScript.AuxiliaryRequests)})
			appendAuxiliaryRequestEvents(&run, &stepResult, "request", stepResult.PreRequestScript.AuxiliaryRequests)
		}
		if stepResult.TestScript != nil {
			eventType, message := "TEST_SCRIPT_COMPLETED", "Response Tests script completed."
			if stepResult.TestScript.Status != "SUCCESS" {
				eventType, message = "TEST_SCRIPT_FAILED", "Response Tests script failed."
			}
			appendStepEvent(&run, stepResult, eventType, stepResult.Status, message, stepResult.TestScript.ErrorCategory, map[string]any{"scope": "test", "durationMs": stepResult.TestScript.DurationMS, "tests": len(stepResult.TestScript.Tests), "changes": len(stepResult.TestScript.VariableChanges), "line": stepResult.TestScript.ErrorLine, "auxiliaryRequests": len(stepResult.TestScript.AuxiliaryRequests), "visualizer": stepResult.TestScript.Visualizer != nil})
			appendAuxiliaryRequestEvents(&run, &stepResult, "test", stepResult.TestScript.AuxiliaryRequests)
		}
		if step.Type == "HTTP_REQUEST" {
			appendStepEvent(&run, stepResult, "REQUEST_COMPLETED", stepResult.Status, "HTTP request completed.", stepResult.FailureCategory, map[string]any{"status": stepResult.ResponseSummary["status"], "attempts": stepResult.AttemptCount})
		}
		for _, attempt := range stepResult.Attempts {
			appendAttemptEvent(&run, stepResult, attempt, "ATTEMPT_COMPLETED", "Request attempt completed.")
		}
		if len(stepResult.Extractors) > 0 {
			failures := 0
			for _, extractor := range stepResult.Extractors {
				if !extractor.Success {
					failures++
				}
			}
			appendStepEvent(&run, stepResult, "EXTRACTORS_EVALUATED", stepResult.Status, "Response extractors evaluated.", map[bool]string{true: "EXTRACTOR_FAILURE", false: ""}[failures > 0], map[string]any{"count": len(stepResult.Extractors), "failed": failures})
		}
		if len(stepResult.Assertions) > 0 {
			failures := 0
			for _, assertion := range stepResult.Assertions {
				if !assertion.Passed {
					failures++
				}
			}
			appendStepEvent(&run, stepResult, "ASSERTIONS_EVALUATED", stepResult.Status, "Success criteria evaluated.", map[bool]string{true: "ASSERTION_FAILURE", false: ""}[failures > 0], map[string]any{"count": len(stepResult.Assertions), "failed": failures})
		}
		appendRunEvent(&run, "STEP_COMPLETED", stepResult.Status, "Step completed.", stepResult.FailureCategory, map[string]any{"stepId": step.ID, "stepName": step.Name, "durationMs": stepResult.DurationMS, "attempts": stepResult.AttemptCount})
		for _, extractor := range stepResult.Extractors {
			if extractor.Success && !extractor.Sensitive {
				value := fmt.Sprint(extractor.Value)
				workflowValues[extractor.Variable] = value
				workflowValues["variables."+extractor.Variable] = value
				workflowValues["steps."+step.ID+".outputs."+extractor.Variable] = value
			}
		}
		for key, value := range stepResult.PrivateOutputs {
			workflowValues[key] = value
			workflowValues["variables."+key] = value
			workflowValues["steps."+step.ID+".outputs."+key] = value
		}
		// Non-secret metric results are first-class workflow outputs, so a
		// telemetry gate can feed a later condition or request template.
		if step.Type == "METRIC_VALIDATION" {
			if value, ok := stepResult.Outputs["value"]; ok {
				rendered := fmt.Sprint(value)
				workflowValues["value"] = rendered
				workflowValues["variables.value"] = rendered
				workflowValues["steps."+step.ID+".outputs.value"] = rendered
			}
		}
		if status, ok := stepResult.ResponseSummary["status"]; ok {
			workflowValues["steps."+step.ID+".response.statusCode"] = fmt.Sprint(status)
		}
		if stepResult.Status == StatusCancelled {
			run.Status, run.FailureCategory, run.FailureReason, run.FailedStepID = StatusCancelled, "RUN_CANCELLED", "Execution was cancelled.", step.ID
			break
		}
		if stepResult.Status != StatusSuccess && stepResult.Status != StatusSkipped {
			run.Status, run.FailureCategory, run.FailureReason, run.FailedStepID = stepResult.Status, stepResult.FailureCategory, stepResult.ErrorMessage, step.ID
			break
		}
		if err := saveProgress(); err != nil {
			return Run{}, err
		}
		execution := scripts.Execution{}
		if stepResult.PreRequestScript != nil && stepResult.PreRequestScript.Execution.NextRequestSet {
			execution = stepResult.PreRequestScript.Execution
		}
		if stepResult.TestScript != nil && stepResult.TestScript.Execution.NextRequestSet {
			execution = stepResult.TestScript.Execution
		}
		if execution.NextRequestSet {
			appendStepEvent(&run, stepResult, "SCRIPT_WORKFLOW_NAVIGATION", stepResult.Status, "JavaScript selected the next workflow step.", "", map[string]any{"nextRequest": execution.NextRequest})
			if execution.NextRequest == "" {
				break
			}
			nextIndex := -1
			for candidateIndex, candidate := range definition.Steps {
				if candidate.ID == execution.NextRequest || candidate.Name == execution.NextRequest {
					nextIndex = candidateIndex
					break
				}
			}
			if nextIndex < 0 {
				run.Status = StatusFailed
				run.FailureCategory = "SCRIPT_POLICY_VIOLATION"
				run.FailureReason = fmt.Sprintf("pm.execution.setNextRequest target %q was not found.", execution.NextRequest)
				run.FailedStepID = step.ID
				break
			}
			index = nextIndex - 1
		}
	}
	if run.Status == StatusRunning {
		run.Status = StatusSuccess
	}
	ended := s.now()
	run.EndedAt, run.DurationMS = &ended, ended.Sub(started).Milliseconds()
	appendRunEvent(&run, "RUN_COMPLETED", run.Status, "Execution reached a terminal state.", run.FailureCategory, map[string]any{"durationMs": run.DurationMS, "status": run.Status})
	if err := saveProgress(); err != nil {
		return Run{}, err
	}
	return run, nil
}

func appendRunEvent(run *Run, eventType string, status Status, message, category string, details map[string]any) {
	eventID, err := id.NewUUID()
	if err != nil {
		return
	}
	sequence := len(run.Events) + 1
	run.Events = append(run.Events, RunEvent{ID: eventID, Sequence: sequence, Type: eventType, Status: status, Category: category, Message: message, Details: details, OccurredAt: time.Now().UTC()})
}

func appendStepEvent(run *Run, step StepRun, eventType string, status Status, message, category string, details map[string]any) {
	appendRunEvent(run, eventType, status, message, category, details)
	last := &run.Events[len(run.Events)-1]
	last.StepRunID = step.ID
	last.StepID = step.StepDefinitionID
}

func appendAttemptEvent(run *Run, step StepRun, attempt AttemptRun, eventType, message string) {
	appendStepEvent(run, step, eventType, attempt.Status, message, attempt.FailureCategory, map[string]any{"attemptNumber": attempt.AttemptNumber, "durationMs": attempt.DurationMS, "responseStatus": attempt.ResponseStatus, "retryBackoffMs": attempt.RetryBackoffMS})
	run.Events[len(run.Events)-1].AttemptNumber = attempt.AttemptNumber
}

func appendAuxiliaryRequestEvents(run *Run, step *StepRun, scope string, requests []scripts.AuxiliaryRequest) {
	for index, request := range requests {
		status := StatusSuccess
		category := ""
		if !request.Success || request.Error != "" {
			status = StatusFailed
			category = "AUXILIARY_REQUEST_FAILURE"
		}
		details := map[string]any{
			"scope":      scope,
			"source":     request.Source,
			"index":      index + 1,
			"method":     request.Method,
			"url":        request.URL,
			"status":     request.Status,
			"durationMs": request.DurationMS,
			"success":    request.Success,
		}
		if request.Error != "" {
			details["error"] = request.Error
		}
		message := fmt.Sprintf("Pre-request pm.sendRequest #%d completed.", index+1)
		if status == StatusFailed {
			message = fmt.Sprintf("Pre-request pm.sendRequest #%d failed.", index+1)
		}
		if step != nil {
			appendStepEvent(run, *step, "AUXILIARY_REQUEST_COMPLETED", status, message, category, details)
			continue
		}
		appendRunEvent(run, "AUXILIARY_REQUEST_COMPLETED", status, message, category, details)
	}
}

var conditionPattern = regexp.MustCompile(`^([A-Za-z0-9_.-]+)\s*(==|!=|>=|<=|>|<)\s*(.+)$`)

func evaluateCondition(expression string, values map[string]string) (bool, error) {
	expression = strings.TrimSpace(expression)
	if expression == "" {
		return true, nil
	}
	if strings.HasPrefix(expression, "{{") && strings.HasSuffix(expression, "}}") {
		expression = strings.TrimSpace(strings.TrimSuffix(strings.TrimPrefix(expression, "{{"), "}}"))
	}
	match := conditionPattern.FindStringSubmatch(expression)
	if len(match) == 0 {
		value, ok := conditionOperand(expression, values, true)
		if !ok {
			return false, fmt.Errorf("condition variable %q is unresolved", expression)
		}
		return strings.EqualFold(value, "true") || value == "1", nil
	}
	left, ok := values[match[1]]
	if !ok {
		return false, fmt.Errorf("condition variable %q is unresolved", match[1])
	}
	right, ok := conditionOperand(strings.TrimSpace(match[3]), values, false)
	if !ok {
		return false, fmt.Errorf("condition operand is unresolved")
	}
	if leftNumber, leftErr := strconv.ParseFloat(left, 64); leftErr == nil {
		if rightNumber, rightErr := strconv.ParseFloat(right, 64); rightErr == nil {
			switch match[2] {
			case "==":
				return leftNumber == rightNumber, nil
			case "!=":
				return leftNumber != rightNumber, nil
			case ">":
				return leftNumber > rightNumber, nil
			case ">=":
				return leftNumber >= rightNumber, nil
			case "<":
				return leftNumber < rightNumber, nil
			case "<=":
				return leftNumber <= rightNumber, nil
			}
		}
	}
	switch match[2] {
	case "==":
		return left == right, nil
	case "!=":
		return left != right, nil
	case ">":
		return left > right, nil
	case ">=":
		return left >= right, nil
	case "<":
		return left < right, nil
	case "<=":
		return left <= right, nil
	default:
		return false, errors.New("condition operator is not supported")
	}
}

func conditionOperand(operand string, values map[string]string, requireVariable bool) (string, bool) {
	operand = strings.TrimSpace(operand)
	if value, ok := values[operand]; ok {
		return value, true
	}
	if requireVariable {
		return "", false
	}
	if len(operand) >= 2 && ((operand[0] == '"' && operand[len(operand)-1] == '"') || (operand[0] == '\'' && operand[len(operand)-1] == '\'')) {
		return operand[1 : len(operand)-1], true
	}
	if strings.EqualFold(operand, "true") || strings.EqualFold(operand, "false") {
		return strings.ToLower(operand), true
	}
	if _, err := strconv.ParseFloat(operand, 64); err == nil {
		return operand, true
	}
	return "", false
}

func (s *Service) List(ctx context.Context, monitorID string) ([]Run, error) {
	if _, err := s.monitors.Get(ctx, monitorID); err != nil {
		return nil, err
	}
	return s.repository.List(ctx, monitorID, 50)
}

func (s *Service) ListRecent(ctx context.Context, limit int) ([]Run, error) {
	if limit <= 0 {
		limit = 50
	}
	if limit > 200 {
		limit = 200
	}
	return s.repository.ListRecent(ctx, limit)
}

func (s *Service) Get(ctx context.Context, runID string) (Run, error) {
	return s.repository.Get(ctx, runID)
}

func (s *Service) GetSummary(ctx context.Context, runID string) (Run, error) {
	if repository, ok := s.repository.(SummaryRepository); ok {
		return repository.GetSummary(ctx, runID)
	}
	run, err := s.repository.Get(ctx, runID)
	if err != nil {
		return Run{}, err
	}
	run.Steps = nil
	run.Events = nil
	return run, nil
}

func (s *Service) ListEvents(ctx context.Context, runID string, afterSequence, limit int) ([]RunEvent, int, bool, error) {
	if repository, ok := s.repository.(EventRepository); ok {
		return repository.ListEvents(ctx, runID, afterSequence, limit)
	}
	run, err := s.repository.Get(ctx, runID)
	if err != nil {
		return nil, 0, false, err
	}
	total := len(run.Events)
	start := 0
	if afterSequence > 0 {
		start = total
		for index, event := range run.Events {
			if event.Sequence > afterSequence {
				start = index
				break
			}
		}
	}
	end := min(total, start+limit)
	return run.Events[start:end], total, end < total, nil
}
