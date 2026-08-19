package suites

import (
	"bytes"
	"encoding/json"
	"strings"
	"testing"
	"time"
)

func TestDeploymentRegressionRequiresBothGuardrails(t *testing.T) {
	config := DeploymentConfiguration{MinimumSamples: 5, RegressionPercent: 25, RegressionMinimumMS: 100}
	base := Distribution{SampleCount: 10, P95MS: 400}
	classification, delta, change := classify(base, Distribution{SampleCount: 10, P95MS: 500}, config)
	if classification != "REGRESSED" || delta != 100 || change != 25 {
		t.Fatalf("expected threshold regression, got %s %d %.1f", classification, delta, change)
	}
	classification, _, _ = classify(base, Distribution{SampleCount: 10, P95MS: 499}, config)
	if classification != "NORMAL" {
		t.Fatalf("expected normal below absolute guardrail, got %s", classification)
	}
	classification, _, _ = classify(Distribution{SampleCount: 4, P95MS: 400}, Distribution{SampleCount: 10, P95MS: 900}, config)
	if classification != "INSUFFICIENT_HISTORY" {
		t.Fatalf("expected insufficient history, got %s", classification)
	}
}

func TestDeploymentDecisionIncludesStepRegressionsAndELFGates(t *testing.T) {
	monitors := []MonitorComparison{{MonitorName: "Checkout", Required: true, Classification: "NORMAL", Post: Distribution{}, Steps: []StepComparison{{StepName: "Create order", Classification: "REGRESSED"}}}}
	decision, _, reasons := deploymentDecision(monitors, nil)
	if decision != "BLOCK" || len(reasons) != 1 {
		t.Fatalf("required step regression did not block: %s %#v", decision, reasons)
	}
	monitors[0].Required = false
	decision, warnings, _ := deploymentDecision(monitors, []CheckResult{{Name: "500 errors", Required: false, Status: "FAILED"}})
	if decision != "ALLOW_WITH_WARNINGS" || len(warnings) != 2 {
		t.Fatalf("optional failures should warn: %s %#v", decision, warnings)
	}
	decision, _, _ = deploymentDecision(nil, []CheckResult{{Name: "500 errors", Required: true, Status: "FAILED"}})
	if decision != "BLOCK" {
		t.Fatalf("blocking ELF failure should block, got %s", decision)
	}
	decision, _, reasons = deploymentDecision(nil, nil, []CheckResult{{Name: "p95 high", Required: true, Status: "FAILED"}})
	if decision != "BLOCK" || len(reasons) != 1 {
		t.Fatalf("blocking OpenSearch alert failure should block: %s %#v", decision, reasons)
	}
}

func TestDeploymentPDFIsValidAndContainsReportText(t *testing.T) {
	report := DeploymentReport{
		SuiteName: "Production gate", GateDecision: "ALLOW",
		Recommendation: "The deployment passed validation.",
		BaselineFrom:   time.Now().Add(-time.Hour), BaselineTo: time.Now(),
		BrowserMonitors: []BrowserComparison{{
			MonitorName: "Customer portal", Classification: "NORMAL",
			Baseline: Distribution{SampleCount: 10, P95MS: 1200},
			Post:     Distribution{SampleCount: 5, P95MS: 1300},
		}},
	}
	pdf := renderDeploymentPDF(report)
	if !bytes.HasPrefix(pdf, []byte("%PDF-1.4")) ||
		!bytes.Contains(pdf, []byte("Production gate")) ||
		!bytes.Contains(pdf, []byte("UI journey validation")) {
		t.Fatalf("unexpected PDF output: %q", pdf[:min(32, len(pdf))])
	}
}

func TestRequiredBrowserFailureBlocksDeployment(t *testing.T) {
	browser := []BrowserComparison{{
		MonitorName: "Customer portal", Required: true,
		Classification: "INSUFFICIENT_HISTORY",
		Post:           Distribution{FailureCount: 1},
	}}
	decision, warnings, reasons := deploymentDecisionWithBrowser(
		nil, browser, nil, nil,
	)
	if decision != "BLOCK" || len(reasons) != 1 || len(warnings) != 1 {
		t.Fatalf(
			"required browser failure should block and retain history warning: %s %#v %#v",
			decision, warnings, reasons,
		)
	}
}

func TestNormalizeDeploymentReportCoercesNilCollections(t *testing.T) {
	report := DeploymentReport{
		Monitors: []MonitorComparison{{
			Post:  Distribution{},
			Steps: []StepComparison{{Post: Distribution{}}},
		}},
		BrowserMonitors: []BrowserComparison{{
			Post: Distribution{},
		}},
	}
	normalizeDeploymentReport(&report)

	body, err := json.Marshal(report)
	if err != nil {
		t.Fatalf("marshal report: %v", err)
	}
	encoded := string(body)
	for _, needle := range []string{`"series":null`, `"failureCategories":null`, `"elfResults":null`, `"alertResults":null`, `"warnings":null`, `"reasons":null`, `"steps":null`, `"samples":null`} {
		if strings.Contains(encoded, needle) {
			t.Fatalf("expected empty collections, found %s in %s", needle, encoded)
		}
	}
	if report.Monitors[0].Post.Series == nil || report.Monitors[0].Post.FailureCategories == nil {
		t.Fatal("post distribution collections should be non-nil")
	}
	if report.Monitors[0].Steps[0].Post.Series == nil {
		t.Fatal("step post series should be non-nil")
	}
	if report.BrowserMonitors[0].Post.Series == nil ||
		report.BrowserMonitors[0].Samples == nil {
		t.Fatal("browser report collections should be non-nil")
	}
	if report.ELFResults == nil || report.AlertResults == nil {
		t.Fatal("report result slices should be non-nil")
	}
}

func TestBuildDeploymentReportFactsOmitsSeriesAndLeadsWithFailures(t *testing.T) {
	started := time.Date(2026, 8, 19, 12, 0, 0, 0, time.UTC)
	ended := started.Add(90 * time.Second)
	run := DeploymentRun{
		ID: "run-1", Status: "FAILED", GateDecision: "BLOCK", FailureReason: "Required monitor regressed",
		StartedAt: &started, EndedAt: &ended,
		Deployment: DeploymentDetails{Version: "v2.18.0", Environment: "prod", Commit: "7f31c2a", DeploymentStart: started},
		Configuration: DeploymentConfiguration{BaselineWindow: "24h", SampleCount: 10},
		SuiteSnapshot: Suite{Name: "Checkout gate"},
		Report: DeploymentReport{
			SuiteName: "Checkout gate", Recommendation: "Block the release.",
			Reasons:  []string{"Checkout p95 crossed both guardrails."},
			Warnings: []string{"Optional ELF check failed."},
			Monitors: []MonitorComparison{
				{
					MonitorID: "mon-ok", MonitorName: "Health", Required: true, Classification: "NORMAL",
					Baseline: Distribution{P95MS: 80, SuccessRate: 100, SampleCount: 10, Series: []MetricSeriesPoint{{ValueMS: 80}}},
					Post:     Distribution{P95MS: 82, SuccessRate: 100, SampleCount: 10},
					Samples:  []DeploymentSample{{SampleNumber: 1, Status: "SUCCESS", MonitorRunID: "ok-run"}},
				},
				{
					MonitorID: "mon-fail", MonitorName: "Checkout", Required: true, Classification: "REGRESSED",
					Reasons: []string{"p95 400ms → 900ms"},
					Baseline: Distribution{P95MS: 400, SuccessRate: 100, SampleCount: 10},
					Post:     Distribution{P95MS: 900, SuccessRate: 50, SampleCount: 10, FailureCount: 5},
					Steps: []StepComparison{
						{StepName: "Pay", Classification: "REGRESSED", Baseline: Distribution{P95MS: 200}, Post: Distribution{P95MS: 800, FailureCount: 2}},
						{StepName: "Lookup", Classification: "NORMAL", Baseline: Distribution{P95MS: 40}, Post: Distribution{P95MS: 42}},
					},
					Samples: []DeploymentSample{
						{SampleNumber: 1, Status: "FAILED", FailureCategory: "ASSERTION", MonitorRunID: "fail-run", DurationMS: 910},
						{SampleNumber: 2, Status: "SUCCESS", MonitorRunID: "ok-run-2"},
					},
				},
			},
			ELFResults: []CheckResult{{Name: "500 errors", Required: false, Status: "FAILED", FailureReason: "12 hits after deploy", QueryID: "q-1"}},
		},
	}
	facts := BuildDeploymentReportFacts(run)
	if facts.SuiteName != "Checkout gate" || facts.GateDecision != "BLOCK" || facts.Environment != "prod" {
		t.Fatalf("unexpected identity: %#v", facts)
	}
	if facts.DurationSeconds == nil || *facts.DurationSeconds != 90 {
		t.Fatalf("duration = %#v", facts.DurationSeconds)
	}
	if facts.Counts.FailedMonitors != 1 || facts.Counts.FailedELF != 1 {
		t.Fatalf("counts = %#v", facts.Counts)
	}
	if len(facts.Monitors) != 2 || facts.Monitors[0].Name != "Checkout" {
		t.Fatalf("failed monitors should sort first: %#v", facts.Monitors)
	}
	if len(facts.Monitors[0].FailedSteps) != 1 || facts.Monitors[0].FailedSteps[0].Name != "Pay" {
		t.Fatalf("failed steps = %#v", facts.Monitors[0].FailedSteps)
	}
	if facts.Monitors[0].PassedSamples != 1 || len(facts.Monitors[0].FailedSamples) != 1 {
		t.Fatalf("sample split = passed %d failed %#v", facts.Monitors[0].PassedSamples, facts.Monitors[0].FailedSamples)
	}
	body, err := json.Marshal(facts)
	if err != nil {
		t.Fatalf("marshal facts: %v", err)
	}
	encoded := string(body)
	if strings.Contains(encoded, `"series"`) || strings.Contains(encoded, "password") {
		t.Fatalf("facts leaked series or secrets: %s", encoded)
	}
}
