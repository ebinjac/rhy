package suites

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/rhythm-monitoring/rhythm/internal/monitors"
	"github.com/rhythm-monitoring/rhythm/internal/runs"
)

func TestSuiteRunReturnsMachineReadableGateDecision(t *testing.T) {
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/required" {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		w.WriteHeader(http.StatusServiceUnavailable)
	}))
	defer target.Close()
	monitorRepository := monitors.NewMemoryRepository(nil)
	monitorService := monitors.NewService(monitorRepository)
	required := createPublishedMonitor(t, monitorService, "required-check", target.URL+"/required", "204")
	optional := createPublishedMonitor(t, monitorService, "optional-check", target.URL+"/optional", "200")
	runService := runs.NewService(monitorService, runs.NewMemoryRepository(), runs.NewHTTPExecutor(true))
	service := New(NewMemoryRepository(), runService)
	suite, err := service.Create(context.Background(), Input{Name: "Deployment gate", Parallelism: 2, FailFast: true, TimeoutSeconds: 30, Stages: []Stage{{ID: "smoke", Name: "Smoke", Checks: []Check{{ID: "required", MonitorID: required.ID, Required: true}, {ID: "optional", MonitorID: optional.ID, Required: false}}}}}, "tester")
	if err != nil {
		t.Fatal(err)
	}
	result, err := service.Run(context.Background(), suite.ID, "pipeline", "CI_CD_WEBHOOK")
	if err != nil {
		t.Fatal(err)
	}
	if result.Status != "PASSED_WITH_WARNINGS" || result.GateDecision != "ALLOW_WITH_WARNINGS" || len(result.Results) != 2 {
		t.Fatalf("unexpected suite gate result: %#v", result)
	}
	persisted, err := service.GetRun(context.Background(), result.ID)
	if err != nil || persisted.GateDecision != "ALLOW_WITH_WARNINGS" {
		t.Fatalf("suite result was not persisted: %#v %v", persisted, err)
	}
}

func createPublishedMonitor(t *testing.T, service *monitors.Service, slug, target, expected string) monitors.Monitor {
	t.Helper()
	definition := map[string]any{
		"steps": []any{
			map[string]any{
				"id": "request", "name": "Request", "type": "HTTP_REQUEST", "enabled": true,
				"request": map[string]any{
					"method": "GET", "url": target,
					"settings":   map[string]any{"timeoutMs": 1000},
					"assertions": []any{map[string]any{"enabled": true, "type": "status", "expected": expected}},
				},
			},
		},
	}
	monitor, err := service.Create(context.Background(), monitors.CreateInput{Name: slug, Slug: slug, Definition: definition}, "tester")
	if err != nil {
		t.Fatal(err)
	}
	monitor, _, err = service.Publish(context.Background(), monitor.ID, monitors.PublishInput{ChangeSummary: "suite test"}, "tester")
	if err != nil {
		t.Fatal(err)
	}
	return monitor
}
