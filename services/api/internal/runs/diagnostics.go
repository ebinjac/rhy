package runs

import (
	"context"
	"math"
	"sort"
	"strings"
)

type Diagnostics struct {
	Run            Run            `json:"run"`
	Analysis       RunAnalysis    `json:"analysis"`
	PrimaryFailure *FailureDetail `json:"primaryFailure,omitempty"`
	Steps          []StepInsight  `json:"steps"`
	Events         []RunEvent     `json:"events"`
}

type RunAnalysis struct {
	StepTimeMS        int64  `json:"stepTimeMs"`
	OverheadMS        int64  `json:"overheadMs"`
	APIResponseTimeMS int64  `json:"apiResponseTimeMs"`
	NetworkTimeMS     int64  `json:"networkTimeMs"`
	PreparationTimeMS int64  `json:"preparationTimeMs"`
	PostProcessingMS  int64  `json:"postProcessingMs"`
	RetryCount        int    `json:"retryCount"`
	RetryTimeMS       int64  `json:"retryTimeMs"`
	SlowestStepID     string `json:"slowestStepId,omitempty"`
	SlowestStepName   string `json:"slowestStepName,omitempty"`
	SlowestStepMS     int64  `json:"slowestStepMs,omitempty"`
	SlowestPhase      string `json:"slowestPhase,omitempty"`
	SlowestPhaseMS    int64  `json:"slowestPhaseMs,omitempty"`
	CompletedSteps    int    `json:"completedSteps"`
	FailedSteps       int    `json:"failedSteps"`
	SkippedSteps      int    `json:"skippedSteps"`
}

type StepInsight struct {
	StepDefinitionID  string       `json:"stepDefinitionId"`
	StepRunID         string       `json:"stepRunId"`
	Rank              int          `json:"rank"`
	DurationMS        int64        `json:"durationMs"`
	DurationShare     float64      `json:"durationShare"`
	APIResponseTimeMS int64        `json:"apiResponseTimeMs,omitempty"`
	APIResponseShare  float64      `json:"apiResponseShare,omitempty"`
	SlowestPhase      string       `json:"slowestPhase,omitempty"`
	SlowestPhaseMS    int64        `json:"slowestPhaseMs,omitempty"`
	Baseline          StepBaseline `json:"baseline"`
}

type StepBaseline struct {
	SampleCount    int     `json:"sampleCount"`
	P50MS          int64   `json:"p50Ms,omitempty"`
	P95MS          int64   `json:"p95Ms,omitempty"`
	ChangePercent  float64 `json:"changePercent,omitempty"`
	Classification string  `json:"classification"`
	MixedRevisions bool    `json:"mixedRevisions"`
}

type FailureDetail struct {
	Phase         string `json:"phase"`
	Category      string `json:"category"`
	Title         string `json:"title"`
	Message       string `json:"message"`
	StepID        string `json:"stepId,omitempty"`
	StepName      string `json:"stepName,omitempty"`
	AttemptNumber int    `json:"attemptNumber,omitempty"`
	CheckType     string `json:"checkType,omitempty"`
	Expected      string `json:"expected,omitempty"`
	Observed      any    `json:"observed,omitempty"`
	Retryable     bool   `json:"retryable"`
	HelpCode      string `json:"helpCode"`
}

type StepDiagnostics struct {
	Run     Run          `json:"run"`
	Step    StepRun      `json:"step"`
	Insight *StepInsight `json:"insight,omitempty"`
}

type BaselineRepository interface {
	StepDurations(context.Context, string, string, string, string, int, bool) ([]int64, error)
}

func (s *Service) DiagnosticsSummary(ctx context.Context, runID string) (Diagnostics, error) {
	if repository, ok := s.repository.(DiagnosticsSummaryRepository); ok {
		run, analysis, err := repository.GetDiagnosticsSummary(ctx, runID)
		if err != nil {
			return Diagnostics{}, err
		}
		return Diagnostics{
			Run:            run,
			Analysis:       analysis,
			PrimaryFailure: primaryFailure(run),
			Steps:          []StepInsight{},
			Events:         []RunEvent{},
		}, nil
	}
	diagnostics, err := s.Diagnostics(ctx, runID)
	if err != nil {
		return Diagnostics{}, err
	}
	diagnostics.Run.Steps = nil
	diagnostics.Run.Events = nil
	diagnostics.Events = nil
	diagnostics.Steps = nil
	return diagnostics, nil
}

func (s *Service) StepDiagnostics(ctx context.Context, runID, stepRunID string) (StepDiagnostics, error) {
	repository, ok := s.repository.(StepRepository)
	if !ok {
		diagnostics, err := s.Diagnostics(ctx, runID)
		if err != nil {
			return StepDiagnostics{}, err
		}
		for _, step := range diagnostics.Run.Steps {
			if step.ID != stepRunID {
				continue
			}
			var insight *StepInsight
			for index := range diagnostics.Steps {
				if diagnostics.Steps[index].StepRunID == stepRunID {
					value := diagnostics.Steps[index]
					insight = &value
					break
				}
			}
			return StepDiagnostics{Run: diagnostics.Run, Step: step, Insight: insight}, nil
		}
		return StepDiagnostics{}, ErrNotFound
	}
	var run Run
	var err error
	if summaryRepository, summaryOK := s.repository.(SummaryRepository); summaryOK {
		run, err = summaryRepository.GetSummary(ctx, runID)
	} else {
		run, err = s.repository.Get(ctx, runID)
	}
	if err != nil {
		return StepDiagnostics{}, err
	}
	step, err := repository.GetStep(ctx, runID, stepRunID)
	if err != nil {
		return StepDiagnostics{}, err
	}
	apiResponseMS := timingMilliseconds(step.Timing, "apiResponseTimeMs")
	phase, phaseMS := slowestTimingPhase(step.Timing)
	insight := &StepInsight{
		StepDefinitionID:  step.StepDefinitionID,
		StepRunID:         step.ID,
		DurationMS:        step.DurationMS,
		APIResponseTimeMS: apiResponseMS,
		SlowestPhase:      phase,
		SlowestPhaseMS:    phaseMS,
		Baseline:          StepBaseline{Classification: "INSUFFICIENT_HISTORY"},
	}
	if run.DurationMS > 0 {
		insight.DurationShare = math.Round((float64(step.DurationMS)/float64(run.DurationMS))*1000) / 10
	}
	if baselineRepository, baselineOK := s.repository.(BaselineRepository); baselineOK && apiResponseMS > 0 {
		values, baselineErr := baselineRepository.StepDurations(ctx, run.MonitorID, run.RevisionID, step.StepDefinitionID, run.ID, 20, false)
		mixed := false
		if baselineErr == nil && len(values) < 5 {
			values, baselineErr = baselineRepository.StepDurations(ctx, run.MonitorID, "", step.StepDefinitionID, run.ID, 50, true)
			mixed = true
		}
		if baselineErr == nil {
			insight.Baseline = calculateBaseline(values, apiResponseMS, mixed)
		}
	}
	return StepDiagnostics{Run: run, Step: step, Insight: insight}, nil
}

func (s *Service) Diagnostics(ctx context.Context, runID string) (Diagnostics, error) {
	run, err := s.repository.Get(ctx, runID)
	if err != nil {
		return Diagnostics{}, err
	}
	events := run.Events
	if events == nil {
		events = make([]RunEvent, 0)
	}
	result := Diagnostics{Run: run, Events: events, Steps: make([]StepInsight, 0, len(run.Steps))}
	total := run.DurationMS
	if total <= 0 {
		for _, step := range run.Steps {
			total += step.DurationMS
		}
	}
	type ranked struct {
		index    int
		duration int64
	}
	ranks := make([]ranked, len(run.Steps))
	var totalAPIResponseMS int64
	for index, step := range run.Steps {
		apiResponseMS := timingMilliseconds(step.Timing, "apiResponseTimeMs")
		totalAPIResponseMS += apiResponseMS
		ranks[index] = ranked{index, apiResponseMS}
	}
	sort.SliceStable(ranks, func(i, j int) bool { return ranks[i].duration > ranks[j].duration })
	rankByIndex := make(map[int]int, len(ranks))
	for rank, item := range ranks {
		rankByIndex[item.index] = rank + 1
	}
	for index, step := range run.Steps {
		result.Analysis.StepTimeMS += step.DurationMS
		apiResponseMS := timingMilliseconds(step.Timing, "apiResponseTimeMs")
		result.Analysis.APIResponseTimeMS += apiResponseMS
		result.Analysis.NetworkTimeMS += timingMilliseconds(step.Timing, "networkTotalMs")
		result.Analysis.PreparationTimeMS += timingMilliseconds(step.Timing, "preparationMs")
		result.Analysis.PostProcessingMS += timingMilliseconds(step.Timing, "postProcessingMs")
		if step.Status == StatusFailed || step.Status == StatusTimedOut || step.Status == StatusAborted {
			result.Analysis.FailedSteps++
		} else if step.Status == StatusSkipped {
			result.Analysis.SkippedSteps++
		} else {
			result.Analysis.CompletedSteps++
		}
		result.Analysis.RetryCount += max(0, step.AttemptCount-1)
		for _, attempt := range step.Attempts {
			result.Analysis.RetryTimeMS += attempt.RetryBackoffMS
		}
		phase, phaseMS := slowestTimingPhase(step.Timing)
		insight := StepInsight{StepDefinitionID: step.StepDefinitionID, StepRunID: step.ID, Rank: rankByIndex[index], DurationMS: step.DurationMS, APIResponseTimeMS: apiResponseMS, SlowestPhase: phase, SlowestPhaseMS: phaseMS, Baseline: StepBaseline{Classification: "INSUFFICIENT_HISTORY"}}
		if total > 0 {
			insight.DurationShare = math.Round((float64(step.DurationMS)/float64(total))*1000) / 10
		}
		if totalAPIResponseMS > 0 {
			insight.APIResponseShare = math.Round((float64(apiResponseMS)/float64(totalAPIResponseMS))*1000) / 10
		}
		if baselineRepo, ok := s.repository.(BaselineRepository); ok && apiResponseMS > 0 {
			values, baselineErr := baselineRepo.StepDurations(ctx, run.MonitorID, run.RevisionID, step.StepDefinitionID, run.ID, 20, false)
			mixed := false
			if baselineErr == nil && len(values) < 5 {
				values, baselineErr = baselineRepo.StepDurations(ctx, run.MonitorID, "", step.StepDefinitionID, run.ID, 50, true)
				mixed = true
			}
			if baselineErr == nil {
				insight.Baseline = calculateBaseline(values, apiResponseMS, mixed)
			}
		}
		result.Steps = append(result.Steps, insight)
		if apiResponseMS > result.Analysis.SlowestStepMS {
			result.Analysis.SlowestStepID, result.Analysis.SlowestStepName, result.Analysis.SlowestStepMS = step.StepDefinitionID, step.StepName, apiResponseMS
		}
		if phaseMS > result.Analysis.SlowestPhaseMS {
			result.Analysis.SlowestPhase, result.Analysis.SlowestPhaseMS = phase, phaseMS
		}
	}
	result.Analysis.OverheadMS = max(int64(0), run.DurationMS-result.Analysis.StepTimeMS)
	result.PrimaryFailure = primaryFailure(run)
	return result, nil
}

func calculateBaseline(values []int64, current int64, mixed bool) StepBaseline {
	baseline := StepBaseline{SampleCount: len(values), Classification: "INSUFFICIENT_HISTORY", MixedRevisions: mixed}
	if len(values) < 5 {
		return baseline
	}
	sort.Slice(values, func(i, j int) bool { return values[i] < values[j] })
	baseline.P50MS = percentile(values, .50)
	baseline.P95MS = percentile(values, .95)
	if baseline.P50MS > 0 {
		baseline.ChangePercent = math.Round(((float64(current-baseline.P50MS)/float64(baseline.P50MS))*100)*10) / 10
	}
	baseline.Classification = "NORMAL"
	if current > baseline.P95MS && current-baseline.P50MS >= 100 && float64(current) >= float64(baseline.P50MS)*1.25 {
		baseline.Classification = "REGRESSED"
	} else if baseline.P50MS-current >= 100 && float64(current) <= float64(baseline.P50MS)*.75 {
		baseline.Classification = "IMPROVED"
	}
	return baseline
}

func percentile(values []int64, quantile float64) int64 {
	if len(values) == 0 {
		return 0
	}
	index := int(math.Ceil(quantile*float64(len(values)))) - 1
	if index < 0 {
		index = 0
	}
	if index >= len(values) {
		index = len(values) - 1
	}
	return values[index]
}

func slowestTimingPhase(timing map[string]any) (string, int64) {
	phase, longest := "", int64(0)
	apiPhases := map[string]bool{"dnsMs": true, "proxyConnectMs": true, "connectMs": true, "tlsHandshakeMs": true, "requestWriteMs": true, "serverWaitMs": true, "downloadMs": true}
	for key, raw := range timing {
		if !apiPhases[key] {
			continue
		}
		value := int64(0)
		switch number := raw.(type) {
		case int64:
			value = number
		case int:
			value = int64(number)
		case float64:
			value = int64(number)
		}
		if value > longest {
			phase, longest = key, value
		}
	}
	return phase, longest
}

func timingMilliseconds(timing map[string]any, key string) int64 {
	raw, ok := timing[key]
	if !ok {
		return 0
	}
	switch number := raw.(type) {
	case int64:
		return number
	case int:
		return int64(number)
	case float64:
		return int64(number)
	default:
		return 0
	}
}

func primaryFailure(run Run) *FailureDetail {
	if run.Status == StatusSuccess || run.Status == StatusSuccessWithWarnings || run.Status == StatusRunning || run.Status == StatusQueued || run.Status == StatusStarting {
		return nil
	}
	detail := &FailureDetail{Category: run.FailureCategory, Message: run.FailureReason, StepID: run.FailedStepID, Title: "Execution failed", HelpCode: "CHECK_EXECUTION_EVIDENCE"}
	for _, step := range run.Steps {
		if step.StepDefinitionID != run.FailedStepID && step.Status != StatusFailed && step.Status != StatusTimedOut {
			continue
		}
		detail.StepID, detail.StepName = step.StepDefinitionID, step.StepName
		if detail.Category == "" {
			detail.Category = step.FailureCategory
		}
		for _, attempt := range step.Attempts {
			if attempt.Status != StatusSuccess {
				detail.AttemptNumber = attempt.AttemptNumber
				break
			}
		}
		for _, assertion := range step.Assertions {
			if !assertion.Passed {
				detail.CheckType, detail.Expected, detail.Observed = assertion.Type, assertion.Expected, assertion.Observed
				break
			}
		}
		break
	}
	category := strings.ToUpper(detail.Category)
	switch {
	case strings.Contains(category, "DNS"):
		detail.Phase, detail.Title, detail.HelpCode, detail.Retryable = "DNS", "DNS resolution failed", "CHECK_DNS_AND_AGENT_NETWORK", true
	case strings.Contains(category, "PROXY"):
		detail.Phase, detail.Title, detail.HelpCode = "PROXY", "Proxy connection failed", "CHECK_PROXY_PROFILE"
	case strings.Contains(category, "TLS") || strings.Contains(category, "CERTIFICATE"):
		detail.Phase, detail.Title, detail.HelpCode = "TLS", "TLS verification failed", "CHECK_CERTIFICATE_AND_TRUST"
	case strings.Contains(category, "SCRIPT"):
		detail.Phase, detail.Title, detail.HelpCode = "PRE_REQUEST_SCRIPT", "Pre-request JavaScript failed", "CHECK_PRE_REQUEST_SCRIPT"
	case strings.Contains(category, "TIMEOUT"):
		detail.Phase, detail.Title, detail.HelpCode, detail.Retryable = "SERVER_WAIT", "Request timed out", "CHECK_TARGET_LATENCY_AND_TIMEOUT", true
	case strings.Contains(category, "SECRET") || strings.Contains(category, "AUTH"):
		detail.Phase, detail.Title, detail.HelpCode = "PREPARATION", "Credential preparation failed", "CHECK_SECRET_AND_AUTH_PROFILE"
	case strings.Contains(category, "ASSERTION"):
		detail.Phase, detail.Title, detail.HelpCode = "ASSERTION", "A success criterion failed", "CHECK_EXPECTED_AND_OBSERVED"
	case strings.Contains(category, "EXTRACTOR"):
		detail.Phase, detail.Title, detail.HelpCode = "EXTRACTION", "A required value could not be extracted", "CHECK_RESPONSE_AND_EXPRESSION"
	case run.Status == StatusCancelled:
		detail.Phase, detail.Title, detail.HelpCode = "CANCELLATION", "Execution was cancelled", "RUN_CANCELLED"
	default:
		detail.Phase = "REQUEST"
	}
	return detail
}
