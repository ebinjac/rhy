package suites

import (
	"testing"
	"time"

	"github.com/rhythm-monitoring/rhythm/internal/alerts"
)

func TestApplyOpenSearchAlertGatePassesWhenNotObserved(t *testing.T) {
	result := CheckResult{Name: "Checkout errors", Required: true}
	applyOpenSearchAlertGate(&result, nil, nil)
	if result.Status != "SUCCESS" || result.Decision != "PASS" {
		t.Fatalf("unobserved alert should pass deploy gate, got %#v", result)
	}
}

func TestApplyOpenSearchAlertGateFailsWhenFiring(t *testing.T) {
	result := CheckResult{Name: "Checkout errors", Required: true}
	applyOpenSearchAlertGate(&result, []alerts.Alert{{
		ID: "alert-1", Title: "Checkout errors", State: "OPEN", UpstreamState: "ACTIVE",
	}}, nil)
	if result.Status != "FAILED" || result.FailureCategory != "ALERT_FIRING" || result.AlertID != "alert-1" {
		t.Fatalf("open alert should fail, got %#v", result)
	}
}

func TestApplyOpenSearchAlertGateFailsPostDeployTrigger(t *testing.T) {
	deployed := time.Date(2026, 7, 24, 10, 0, 0, 0, time.UTC)
	triggered := deployed.Add(2 * time.Minute)
	result := CheckResult{Name: "Checkout errors", Required: true}
	applyOpenSearchAlertGate(&result, []alerts.Alert{{
		ID: "alert-2", Title: "Checkout errors", State: "RESOLVED", LastTriggeredAt: &triggered,
	}}, &deployed)
	if result.Status != "FAILED" || result.FailureCategory != "ALERT_TRIGGERED_POST_DEPLOY" {
		t.Fatalf("post-deploy trigger should fail, got %#v", result)
	}
}

func TestApplyOpenSearchAlertGateIgnoresPreDeployHistory(t *testing.T) {
	deployed := time.Date(2026, 7, 24, 10, 0, 0, 0, time.UTC)
	triggered := deployed.Add(-time.Hour)
	result := CheckResult{Name: "Checkout errors", Required: true}
	applyOpenSearchAlertGate(&result, []alerts.Alert{{
		ID: "alert-3", Title: "Checkout errors", State: "RESOLVED", LastTriggeredAt: &triggered,
	}}, &deployed)
	if result.Status != "SUCCESS" {
		t.Fatalf("resolved pre-deploy alert should pass, got %#v", result)
	}
}

func TestSuiteRejectsOpenSearchAlertWithoutIdentity(t *testing.T) {
	service := New(NewMemoryRepository(), nil)
	_, err := service.Create(t.Context(), Input{
		Name: "Alert gate", Parallelism: 1, TimeoutSeconds: 30,
		Stages: []Stage{{ID: "alerts", Name: "Alerts", Checks: []Check{{
			ID: "os-1", Kind: "OPENSEARCH_ALERT", ReceiverID: "receiver-1", Required: true,
		}}}},
	}, "tester")
	if err == nil {
		t.Fatal("expected identity validation error")
	}
}

func TestSuiteAcceptsOpenSearchAlertCheck(t *testing.T) {
	service := New(NewMemoryRepository(), nil)
	suite, err := service.Create(t.Context(), Input{
		Name: "Alert gate", Parallelism: 1, TimeoutSeconds: 30,
		Stages: []Stage{{ID: "alerts", Name: "Alerts", Checks: []Check{{
			ID: "os-1", Kind: "OPENSEARCH_ALERT", ReceiverID: "receiver-1",
			ExternalMonitorName: "payments-latency", ExternalTriggerName: "p95 high",
			Name: "p95 high", Required: true,
		}}}},
	}, "tester")
	if err != nil {
		t.Fatal(err)
	}
	if suite.Stages[0].Checks[0].Kind != "OPENSEARCH_ALERT" || suite.Stages[0].Checks[0].ReceiverID != "receiver-1" {
		t.Fatalf("unexpected persisted check: %#v", suite.Stages[0].Checks[0])
	}
}
