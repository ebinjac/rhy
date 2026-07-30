package runs

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/rhythm-monitoring/rhythm/internal/monitors"
)

func TestMetricsCalculatesPercentilesAndRollingSpikes(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, time.July, 22, 12, 0, 0, 0, time.UTC)
	monitorID := "monitor-metrics"
	monitorRepository := monitors.NewMemoryRepository([]monitors.Monitor{{ID: monitorID, Name: "Metrics monitor", Slug: "metrics-monitor"}})
	runRepository := NewMemoryRepository()
	service := NewService(monitors.NewService(monitorRepository), runRepository, NewHTTPExecutor(true))
	service.now = func() time.Time { return now }

	values := []int64{100, 110, 120, 130, 140, 400}
	for index, value := range values {
		createdAt := now.Add(time.Duration(index-len(values)) * time.Hour)
		run := Run{
			ID:         "run-" + time.Duration(index).String(),
			MonitorID:  monitorID,
			Status:     StatusSuccess,
			DurationMS: value + 30,
			CreatedAt:  createdAt,
			Steps: []StepRun{{
				Timing: map[string]any{
					"apiResponseTimeMs": value,
					"preparationMs":     int64(10),
					"postProcessingMs":  int64(5),
					"networkTotalMs":    value,
				},
				AttemptCount: 1,
			}},
		}
		if err := runRepository.Save(context.Background(), run); err != nil {
			t.Fatal(err)
		}
	}

	failedAt := now.Add(-30 * time.Minute)
	if err := runRepository.Save(context.Background(), Run{ID: "legacy-failure", MonitorID: monitorID, Status: StatusFailed, FailureCategory: "ASSERTION_FAILED", CreatedAt: failedAt, DurationMS: 50}); err != nil {
		t.Fatal(err)
	}

	metrics, err := service.Metrics(context.Background(), monitorID, "30d")
	if err != nil {
		t.Fatal(err)
	}
	if metrics.Summary.RunCount != 7 || metrics.Summary.MeasuredRunCount != 6 {
		t.Fatalf("unexpected sample counts: %+v", metrics.Summary)
	}
	if metrics.Percentiles.P50MS != 120 || metrics.Percentiles.P95MS != 400 || metrics.Percentiles.P99MS != 400 {
		t.Fatalf("unexpected percentiles: %+v", metrics.Percentiles)
	}
	if metrics.Summary.SpikeCount != 1 {
		t.Fatalf("expected one rolling spike, got %d", metrics.Summary.SpikeCount)
	}
	var spikeFound bool
	for _, point := range metrics.Points {
		if point.APIResponseTimeMS != nil && *point.APIResponseTimeMS == 400 {
			spikeFound = point.Spike
		}
	}
	if !spikeFound {
		t.Fatal("expected 400 ms point to be marked as a spike")
	}
	if metrics.Summary.SuccessRate != 85.7 || metrics.Summary.ErrorRate != 14.3 {
		t.Fatalf("unexpected reliability rates: %+v", metrics.Summary)
	}
	if metrics.FailureCategories["ASSERTION_FAILED"] != 1 {
		t.Fatalf("unexpected failure categories: %+v", metrics.FailureCategories)
	}
	if metrics.Summary.AverageResponseMS != 166 {
		t.Fatalf("unexpected average response: %d", metrics.Summary.AverageResponseMS)
	}
}

func TestMetricsRejectsUnknownWindow(t *testing.T) {
	t.Parallel()
	monitorRepository := monitors.NewMemoryRepository([]monitors.Monitor{{ID: "monitor-metrics", Name: "Metrics monitor", Slug: "metrics-monitor"}})
	service := NewService(monitors.NewService(monitorRepository), NewMemoryRepository(), NewHTTPExecutor(true))

	_, err := service.Metrics(context.Background(), "monitor-metrics", "1y")
	var validationError MetricsValidationError
	if !errors.As(err, &validationError) {
		t.Fatalf("expected MetricsValidationError, got %v", err)
	}
}

func TestSampleHistoryMetricPointsPreservesRecentRunsAndSpikes(t *testing.T) {
	t.Parallel()
	points := make([]HistoryMetricPoint, 1000)
	for index := range points {
		points[index] = HistoryMetricPoint{RunID: "run-" + time.Duration(index).String()}
	}
	points[123].Spike = true
	sampled := SampleHistoryMetricPoints(points, 400)
	if len(sampled) != 400 {
		t.Fatalf("sample count=%d", len(sampled))
	}
	seen := map[string]bool{}
	for _, point := range sampled {
		seen[point.RunID] = true
	}
	if !seen[points[123].RunID] {
		t.Fatal("detected spike was removed from the chart sample")
	}
	for index := 950; index < 1000; index++ {
		if !seen[points[index].RunID] {
			t.Fatalf("recent run %d was removed from the chart sample", index)
		}
	}
}
