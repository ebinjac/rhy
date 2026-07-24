package suites

import (
	"bytes"
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
	report := DeploymentReport{SuiteName: "Production gate", GateDecision: "ALLOW", Recommendation: "The deployment passed validation.", BaselineFrom: time.Now().Add(-time.Hour), BaselineTo: time.Now()}
	pdf := renderDeploymentPDF(report)
	if !bytes.HasPrefix(pdf, []byte("%PDF-1.4")) || !bytes.Contains(pdf, []byte("Production gate")) {
		t.Fatalf("unexpected PDF output: %q", pdf[:min(32, len(pdf))])
	}
}
