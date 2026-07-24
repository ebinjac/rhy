package runs

import "testing"

func TestCalculateBaselineClassifiesMeaningfulRegression(t *testing.T) {
	baseline := calculateBaseline([]int64{390, 400, 410, 420, 430, 440, 450, 460, 470, 480}, 650, false)
	if baseline.P50MS != 430 || baseline.P95MS != 480 || baseline.Classification != "REGRESSED" {
		t.Fatalf("unexpected regression baseline: %#v", baseline)
	}
}

func TestCalculateBaselineAvoidsNoiseAndRequiresFiveSamples(t *testing.T) {
	insufficient := calculateBaseline([]int64{100, 110, 120, 130}, 500, false)
	if insufficient.Classification != "INSUFFICIENT_HISTORY" {
		t.Fatalf("expected insufficient history: %#v", insufficient)
	}
	minor := calculateBaseline([]int64{100, 105, 110, 115, 120, 125}, 145, false)
	if minor.Classification != "NORMAL" {
		t.Fatalf("small absolute changes must not be regressions: %#v", minor)
	}
}

func TestPrimaryFailureIncludesFailedAssertion(t *testing.T) {
	run := Run{Status: StatusFailed, FailureCategory: "ASSERTION_FAILURE", FailureReason: "expected healthy", FailedStepID: "health", Steps: []StepRun{{StepDefinitionID: "health", StepName: "Health check", Status: StatusFailed, Assertions: []AssertionResult{{Type: "jsonpath", Expected: "HEALTHY", Observed: "DEGRADED", Passed: false}}}}}
	failure := primaryFailure(run)
	if failure == nil || failure.Phase != "ASSERTION" || failure.StepName != "Health check" || failure.Expected != "HEALTHY" || failure.Observed != "DEGRADED" || failure.HelpCode != "CHECK_EXPECTED_AND_OBSERVED" {
		t.Fatalf("unexpected primary failure: %#v", failure)
	}
}
