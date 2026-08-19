package ai

import (
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/rhythm-monitoring/rhythm/internal/runs"
)

func TestSystemPromptTeachesChartBlocks(t *testing.T) {
	t.Parallel()
	if !strings.Contains(systemPrompt, "language chart") {
		t.Fatal("system prompt should teach the chart fence convention")
	}
	if !strings.Contains(systemPrompt, "metrics.series") {
		t.Fatal("system prompt should point at the compact metrics series")
	}
	if strings.Contains(systemPrompt, "text/event-stream") {
		t.Fatal("system prompt must not reintroduce streaming")
	}
}

func TestCompactMonitorMetricsOmitsRawPoints(t *testing.T) {
	t.Parallel()
	ms := int64(180)
	metrics := runs.HistoryMetrics{
		Window: "24h",
		Points: []runs.HistoryMetricPoint{
			{CreatedAt: time.Now().Add(-time.Hour).UTC(), APIResponseTimeMS: &ms, Status: "SUCCESS"},
			{CreatedAt: time.Now().UTC(), APIResponseTimeMS: &ms, Status: "SUCCESS"},
		},
		StatusDistribution: map[string]int{"SUCCESS": 2},
	}
	compact := compactMonitorMetrics(metrics, nil, errors.New("no projected series"))
	if _, ok := compact["points"]; ok {
		t.Fatal("raw metric points must not be forwarded to the model")
	}
	series, _ := compact["series"].([]map[string]any)
	if len(series) != 2 {
		t.Fatalf("series length = %d", len(series))
	}
	if series[0]["apiResponseTimeMs"] != ms {
		t.Fatalf("apiResponseTimeMs = %v", series[0]["apiResponseTimeMs"])
	}
}

func TestSpecialistInstructionUsesGroundedRoles(t *testing.T) {
	t.Parallel()
	if got := specialistInstruction("INCIDENT_ANALYST"); got == "" {
		t.Fatal("incident analyst should add a specialist instruction")
	}
	if got := specialistInstruction("ELF_ANALYST"); !strings.Contains(got, "ELF") {
		t.Fatalf("elf analyst instruction = %q", got)
	}
	if got := specialistInstruction("MONITOR_AUTHORING_ASSISTANT"); got != "" {
		t.Fatalf("authoring specialist is not backed by tools, got %q", got)
	}
	if got := specialistInstruction("unknown"); got != "" {
		t.Fatalf("unknown specialist should be ignored, got %q", got)
	}
}

func TestDeploymentReportPromptIsOperationalAndNonStreaming(t *testing.T) {
	t.Parallel()
	if !strings.Contains(deploymentReportPrompt, "gate decision") {
		t.Fatal("deployment report prompt should require a gate decision")
	}
	if !strings.Contains(deploymentReportPrompt, "governed JSON facts") {
		t.Fatal("deployment report prompt should bind the model to supplied facts")
	}
	if strings.Contains(deploymentReportPrompt, "text/event-stream") {
		t.Fatal("deployment report prompt must not reintroduce streaming")
	}
}
