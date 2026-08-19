package suites

import (
	"sort"
	"strings"
	"time"
)

// DeploymentReportFacts is the sanitized evidence packet sent to the AI
// provider. It contains operational outcomes only: names, statuses, timings,
// and failure messages. Request bodies, credentials, and raw series are omitted.
type DeploymentReportFacts struct {
	SuiteName       string           `json:"suiteName"`
	RunID           string           `json:"runId"`
	Status          string           `json:"status"`
	GateDecision    string           `json:"gateDecision"`
	Recommendation  string           `json:"recommendation,omitempty"`
	FailureReason   string           `json:"failureReason,omitempty"`
	DurationSeconds *int64           `json:"durationSeconds,omitempty"`
	Environment     string           `json:"environment,omitempty"`
	Version         string           `json:"version,omitempty"`
	Commit          string           `json:"commit,omitempty"`
	DeploymentID    string           `json:"deploymentId,omitempty"`
	ApplicationID   string           `json:"applicationId,omitempty"`
	DeploymentStart string           `json:"deploymentStart,omitempty"`
	BaselineWindow  string           `json:"baselineWindow,omitempty"`
	SampleCount     int              `json:"sampleCount,omitempty"`
	Counts          ReportFactCounts `json:"counts"`
	BlockingReasons []string         `json:"blockingReasons,omitempty"`
	Warnings        []string         `json:"warnings,omitempty"`
	Monitors        []MonitorFact    `json:"monitors,omitempty"`
	BrowserMonitors []BrowserFact    `json:"browserMonitors,omitempty"`
	ELFChecks       []CheckFact      `json:"elfChecks,omitempty"`
	AlertChecks     []CheckFact      `json:"alertChecks,omitempty"`
	DynatraceChecks []DynatraceFact  `json:"dynatraceChecks,omitempty"`
}

type ReportFactCounts struct {
	Monitors        int `json:"monitors"`
	FailedMonitors  int `json:"failedMonitors"`
	BrowserMonitors int `json:"browserMonitors"`
	FailedBrowser   int `json:"failedBrowserMonitors"`
	ELFChecks       int `json:"elfChecks"`
	FailedELF       int `json:"failedElfChecks"`
	AlertChecks     int `json:"alertChecks"`
	FailedAlerts    int `json:"failedAlertChecks"`
	DynatraceChecks int `json:"dynatraceChecks"`
	FailedDynatrace int `json:"failedDynatraceChecks"`
	BlockingReasons int `json:"blockingReasons"`
	Warnings        int `json:"warnings"`
}

type LatencyFact struct {
	P50MS       int64   `json:"p50Ms,omitempty"`
	P95MS       int64   `json:"p95Ms,omitempty"`
	P99MS       int64   `json:"p99Ms,omitempty"`
	AverageMS   int64   `json:"averageMs,omitempty"`
	SuccessRate float64 `json:"successRate"`
	SampleCount int     `json:"sampleCount"`
	Failures    int     `json:"failures,omitempty"`
	Timeouts    int     `json:"timeouts,omitempty"`
}

type StepFact struct {
	Name           string  `json:"name"`
	Classification string  `json:"classification"`
	BaselineP95MS  int64   `json:"baselineP95Ms,omitempty"`
	PostP95MS      int64   `json:"postP95Ms,omitempty"`
	DeltaPercent   float64 `json:"deltaPercent"`
	PostFailures   int     `json:"postFailures,omitempty"`
}

type SampleFact struct {
	Number          int    `json:"number"`
	Status          string `json:"status"`
	DurationMS      int64  `json:"durationMs,omitempty"`
	FailureCategory string `json:"failureCategory,omitempty"`
	MonitorRunID    string `json:"monitorRunId,omitempty"`
	BrowserRunID    string `json:"browserRunId,omitempty"`
}

type MonitorFact struct {
	MonitorID      string       `json:"monitorId"`
	Name           string       `json:"name"`
	Required       bool         `json:"required"`
	Classification string       `json:"classification"`
	DeltaPercent   float64      `json:"deltaPercent"`
	Baseline       LatencyFact  `json:"baseline"`
	Post           LatencyFact  `json:"post"`
	Reasons        []string     `json:"reasons,omitempty"`
	FailedSteps    []StepFact   `json:"failedSteps,omitempty"`
	PassedSteps    []StepFact   `json:"passedSteps,omitempty"`
	FailedSamples  []SampleFact `json:"failedSamples,omitempty"`
	PassedSamples  int          `json:"passedSamples"`
}

type BrowserFact struct {
	BrowserMonitorID string       `json:"browserMonitorId"`
	Name             string       `json:"name"`
	Required         bool         `json:"required"`
	Classification   string       `json:"classification"`
	DeltaPercent     float64      `json:"deltaPercent"`
	Baseline         LatencyFact  `json:"baseline"`
	Post             LatencyFact  `json:"post"`
	Reasons          []string     `json:"reasons,omitempty"`
	FailedSamples    []SampleFact `json:"failedSamples,omitempty"`
	PassedSamples    int          `json:"passedSamples"`
}

type CheckFact struct {
	Name            string `json:"name"`
	Required        bool   `json:"required"`
	Status          string `json:"status"`
	GateMode        string `json:"gateMode,omitempty"`
	Decision        string `json:"decision,omitempty"`
	HitCount        int64  `json:"hitCount,omitempty"`
	AlertState      string `json:"alertState,omitempty"`
	FailureCategory string `json:"failureCategory,omitempty"`
	FailureReason   string `json:"failureReason,omitempty"`
	QueryID         string `json:"queryId,omitempty"`
	ELFRunID        string `json:"elfRunId,omitempty"`
	AlertID         string `json:"alertId,omitempty"`
	DurationMS      int64  `json:"durationMs,omitempty"`
}

type DynatraceFact struct {
	Name            string   `json:"name"`
	Required        bool     `json:"required"`
	Status          string   `json:"status"`
	Decision        string   `json:"decision,omitempty"`
	GateMode        string   `json:"gateMode,omitempty"`
	ApplicationID   string   `json:"applicationId,omitempty"`
	FailureCategory string   `json:"failureCategory,omitempty"`
	FailureReason   string   `json:"failureReason,omitempty"`
	FailedRules     []string `json:"failedRules,omitempty"`
}

func BuildDeploymentReportFacts(run DeploymentRun) DeploymentReportFacts {
	normalizeDeploymentReport(&run.Report)
	facts := DeploymentReportFacts{
		SuiteName:       firstNonEmpty(run.Report.SuiteName, run.SuiteSnapshot.Name),
		RunID:           run.ID,
		Status:          run.Status,
		GateDecision:    run.GateDecision,
		Recommendation:  strings.TrimSpace(run.Report.Recommendation),
		FailureReason:   strings.TrimSpace(run.FailureReason),
		Environment:     strings.TrimSpace(run.Deployment.Environment),
		Version:         strings.TrimSpace(run.Deployment.Version),
		Commit:          strings.TrimSpace(run.Deployment.Commit),
		DeploymentID:    strings.TrimSpace(run.Deployment.DeploymentID),
		ApplicationID:   strings.TrimSpace(run.Deployment.ApplicationID),
		BaselineWindow:  run.Configuration.BaselineWindow,
		SampleCount:     run.Configuration.SampleCount,
		BlockingReasons: append([]string{}, run.Report.Reasons...),
		Warnings:        append([]string{}, run.Report.Warnings...),
	}
	if !run.Deployment.DeploymentStart.IsZero() {
		facts.DeploymentStart = run.Deployment.DeploymentStart.UTC().Format(time.RFC3339)
	}
	if run.StartedAt != nil && run.EndedAt != nil && !run.EndedAt.Before(*run.StartedAt) {
		seconds := int64(run.EndedAt.Sub(*run.StartedAt).Seconds())
		facts.DurationSeconds = &seconds
	}
	facts.Monitors = compactMonitors(run.Report.Monitors)
	facts.BrowserMonitors = compactBrowsers(run.Report.BrowserMonitors)
	facts.ELFChecks = compactChecks(run.Report.ELFResults)
	facts.AlertChecks = compactChecks(run.Report.AlertResults)
	facts.DynatraceChecks = compactDynatrace(run.Report.DynatraceResults)
	sortFacts(facts.Monitors, facts.BrowserMonitors, facts.ELFChecks, facts.AlertChecks, facts.DynatraceChecks)
	facts.Counts = ReportFactCounts{
		Monitors:        len(facts.Monitors),
		FailedMonitors:  countMonitors(facts.Monitors),
		BrowserMonitors: len(facts.BrowserMonitors),
		FailedBrowser:   countBrowsers(facts.BrowserMonitors),
		ELFChecks:       len(facts.ELFChecks),
		FailedELF:       countChecks(facts.ELFChecks),
		AlertChecks:     len(facts.AlertChecks),
		FailedAlerts:    countChecks(facts.AlertChecks),
		DynatraceChecks: len(facts.DynatraceChecks),
		FailedDynatrace: countDynatrace(facts.DynatraceChecks),
		BlockingReasons: len(facts.BlockingReasons),
		Warnings:        len(facts.Warnings),
	}
	return facts
}

func compactLatency(value Distribution) LatencyFact {
	return LatencyFact{
		P50MS: value.P50MS, P95MS: value.P95MS, P99MS: value.P99MS,
		AverageMS: value.AverageMS, SuccessRate: value.SuccessRate,
		SampleCount: value.SampleCount, Failures: value.FailureCount, Timeouts: value.TimeoutCount,
	}
}

func compactMonitors(items []MonitorComparison) []MonitorFact {
	out := make([]MonitorFact, 0, len(items))
	for _, item := range items {
		fact := MonitorFact{
			MonitorID: item.MonitorID, Name: item.MonitorName, Required: item.Required,
			Classification: item.Classification, DeltaPercent: item.DeltaPercent,
			Baseline: compactLatency(item.Baseline), Post: compactLatency(item.Post),
			Reasons: append([]string{}, item.Reasons...),
		}
		for _, step := range item.Steps {
			stepFact := StepFact{
				Name: step.StepName, Classification: step.Classification,
				BaselineP95MS: step.Baseline.P95MS, PostP95MS: step.Post.P95MS,
				DeltaPercent: step.DeltaPercent, PostFailures: step.Post.FailureCount,
			}
			if stepFailed(step.Classification, step.Post) {
				fact.FailedSteps = append(fact.FailedSteps, stepFact)
			} else {
				fact.PassedSteps = append(fact.PassedSteps, stepFact)
			}
		}
		for _, sample := range item.Samples {
			if samplePassed(sample.Status) {
				fact.PassedSamples++
				continue
			}
			fact.FailedSamples = append(fact.FailedSamples, SampleFact{
				Number: sample.SampleNumber, Status: sample.Status, DurationMS: sample.DurationMS,
				FailureCategory: sample.FailureCategory, MonitorRunID: sample.MonitorRunID,
			})
		}
		out = append(out, fact)
	}
	return out
}

func compactBrowsers(items []BrowserComparison) []BrowserFact {
	out := make([]BrowserFact, 0, len(items))
	for _, item := range items {
		fact := BrowserFact{
			BrowserMonitorID: item.BrowserMonitorID, Name: item.MonitorName, Required: item.Required,
			Classification: item.Classification, DeltaPercent: item.DeltaPercent,
			Baseline: compactLatency(item.Baseline), Post: compactLatency(item.Post),
			Reasons: append([]string{}, item.Reasons...),
		}
		for _, sample := range item.Samples {
			if samplePassed(sample.Status) {
				fact.PassedSamples++
				continue
			}
			fact.FailedSamples = append(fact.FailedSamples, SampleFact{
				Number: sample.SampleNumber, Status: sample.Status, DurationMS: sample.DurationMS,
				FailureCategory: sample.FailureCategory, BrowserRunID: sample.BrowserRunID,
			})
		}
		out = append(out, fact)
	}
	return out
}

func compactChecks(items []CheckResult) []CheckFact {
	out := make([]CheckFact, 0, len(items))
	for _, item := range items {
		out = append(out, CheckFact{
			Name:     firstNonEmpty(item.Name, item.ExternalTriggerName, item.ExternalMonitorName, item.QueryID),
			Required: item.Required, Status: item.Status, GateMode: item.GateMode, Decision: item.Decision,
			HitCount: item.HitCount, AlertState: item.AlertState, FailureCategory: item.FailureCategory,
			FailureReason: item.FailureReason, QueryID: item.QueryID, ELFRunID: item.ELFRunID,
			AlertID: item.AlertID, DurationMS: item.DurationMS,
		})
	}
	return out
}

func compactDynatrace(items []DynatraceComparison) []DynatraceFact {
	out := make([]DynatraceFact, 0, len(items))
	for _, item := range items {
		fact := DynatraceFact{
			Name: item.Name, Required: item.Required, Status: item.Status, Decision: item.Decision,
			GateMode: item.GateMode, ApplicationID: item.ApplicationID,
			FailureCategory: item.FailureCategory, FailureReason: item.FailureReason,
		}
		for _, rule := range item.RuleResults {
			if strings.EqualFold(rule.Status, "SUCCESS") || strings.EqualFold(rule.Status, "PASS") {
				continue
			}
			label := strings.TrimSpace(rule.RuleName)
			if reason := strings.TrimSpace(rule.Reason); reason != "" {
				if label != "" {
					label += " — " + reason
				} else {
					label = reason
				}
			}
			if label != "" {
				fact.FailedRules = append(fact.FailedRules, label)
			}
		}
		out = append(out, fact)
	}
	return out
}

func sortFacts(monitors []MonitorFact, browsers []BrowserFact, elfChecks, alerts []CheckFact, dynatrace []DynatraceFact) {
	sort.SliceStable(monitors, func(i, j int) bool {
		return factRank(monitorFailed(monitors[i]), monitors[i].Required) < factRank(monitorFailed(monitors[j]), monitors[j].Required)
	})
	sort.SliceStable(browsers, func(i, j int) bool {
		return factRank(browserFailed(browsers[i]), browsers[i].Required) < factRank(browserFailed(browsers[j]), browsers[j].Required)
	})
	sort.SliceStable(elfChecks, func(i, j int) bool {
		return factRank(checkFailed(elfChecks[i].Status), elfChecks[i].Required) < factRank(checkFailed(elfChecks[j].Status), elfChecks[j].Required)
	})
	sort.SliceStable(alerts, func(i, j int) bool {
		return factRank(checkFailed(alerts[i].Status), alerts[i].Required) < factRank(checkFailed(alerts[j].Status), alerts[j].Required)
	})
	sort.SliceStable(dynatrace, func(i, j int) bool {
		return factRank(checkFailed(dynatrace[i].Status), dynatrace[i].Required) < factRank(checkFailed(dynatrace[j].Status), dynatrace[j].Required)
	})
}

func factRank(failed, required bool) int {
	if failed && required {
		return 0
	}
	if failed {
		return 1
	}
	return 2
}

func monitorFailed(item MonitorFact) bool {
	return item.Classification == "REGRESSED" || len(item.FailedSteps) > 0 || len(item.FailedSamples) > 0 || item.Post.Failures > 0
}

func browserFailed(item BrowserFact) bool {
	return item.Classification == "REGRESSED" || len(item.FailedSamples) > 0 || item.Post.Failures > 0
}

func stepFailed(classification string, post Distribution) bool {
	return classification == "REGRESSED" || post.FailureCount > 0
}

func checkFailed(status string) bool {
	switch strings.ToUpper(strings.TrimSpace(status)) {
	case "SUCCESS", "SUCCESS_WITH_WARNINGS", "PASSED", "PASSED_WITH_WARNINGS", "PENDING", "":
		return false
	default:
		return true
	}
}

func samplePassed(status string) bool {
	switch strings.ToUpper(strings.TrimSpace(status)) {
	case "SUCCESS", "SUCCESS_WITH_WARNINGS", "PASSED", "PASSED_WITH_WARNINGS":
		return true
	default:
		return false
	}
}

func countMonitors(items []MonitorFact) int {
	count := 0
	for _, item := range items {
		if monitorFailed(item) {
			count++
		}
	}
	return count
}

func countBrowsers(items []BrowserFact) int {
	count := 0
	for _, item := range items {
		if browserFailed(item) {
			count++
		}
	}
	return count
}

func countChecks(items []CheckFact) int {
	count := 0
	for _, item := range items {
		if checkFailed(item.Status) {
			count++
		}
	}
	return count
}

func countDynatrace(items []DynatraceFact) int {
	count := 0
	for _, item := range items {
		if checkFailed(item.Status) {
			count++
		}
	}
	return count
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}
