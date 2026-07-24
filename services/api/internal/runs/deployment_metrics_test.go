package runs

import (
	"context"
	"testing"
	"time"
)

func TestDeploymentMetricPointsAreRevisionAndWindowBounded(t *testing.T) {
	repository := NewMemoryRepository()
	from := time.Date(2026, 7, 22, 10, 0, 0, 0, time.UTC)
	value := func(api int64) StepRun {
		return StepRun{StepDefinitionID: "request", StepName: "Request", StepType: "HTTP_REQUEST", Status: StatusSuccess, Timing: map[string]any{"apiResponseTimeMs": api, "preparationMs": 999}}
	}
	for _, run := range []Run{
		{ID: "inside", MonitorID: "monitor", RevisionID: "revision-a", Status: StatusSuccess, CreatedAt: from.Add(time.Hour), Steps: []StepRun{value(120)}},
		{ID: "at-end", MonitorID: "monitor", RevisionID: "revision-a", Status: StatusSuccess, CreatedAt: from.Add(2 * time.Hour), Steps: []StepRun{value(200)}},
		{ID: "other-revision", MonitorID: "monitor", RevisionID: "revision-b", Status: StatusSuccess, CreatedAt: from.Add(time.Hour), Steps: []StepRun{value(300)}},
	} {
		if err := repository.Save(context.Background(), run); err != nil {
			t.Fatal(err)
		}
	}
	points, err := repository.MetricPointsBetween(context.Background(), "monitor", "revision-a", from, from.Add(2*time.Hour), 100)
	if err != nil {
		t.Fatal(err)
	}
	if len(points) != 1 || points[0].RunID != "inside" || points[0].APIResponseTimeMS == nil || *points[0].APIResponseTimeMS != 120 {
		t.Fatalf("window or revision leaked into baseline: %#v", points)
	}
	if len(points[0].Steps) != 1 || *points[0].Steps[0].APIResponseTimeMS != 120 {
		t.Fatalf("API-only step timing was not retained: %#v", points[0].Steps)
	}
}
