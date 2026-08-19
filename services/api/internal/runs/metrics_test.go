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
	if err := runRepository.Save(context.Background(), Run{ID: "unmeasured-failure", MonitorID: monitorID, Status: StatusFailed, FailureCategory: "ASSERTION_FAILED", CreatedAt: failedAt, DurationMS: 50}); err != nil {
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

func TestMetricsRecordsLastAttemptHTTPStatus(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, time.August, 19, 12, 0, 0, 0, time.UTC)
	monitorID := "monitor-http-status"
	monitorRepository := monitors.NewMemoryRepository([]monitors.Monitor{{ID: monitorID, Name: "HTTP status", Slug: "http-status"}})
	runRepository := NewMemoryRepository()
	service := NewService(monitors.NewService(monitorRepository), runRepository, NewHTTPExecutor(true))
	service.now = func() time.Time { return now }

	runsToSave := []Run{
		{
			ID: "ok-200", MonitorID: monitorID, Status: StatusSuccess, DurationMS: 120,
			CreatedAt: now.Add(-4 * time.Hour),
			Steps: []StepRun{{
				Timing: map[string]any{"apiResponseTimeMs": int64(100)},
				Attempts: []AttemptRun{
					{AttemptNumber: 1, ResponseStatus: 500},
					{AttemptNumber: 2, ResponseStatus: 200},
				},
			}},
		},
		{
			ID: "fail-503", MonitorID: monitorID, Status: StatusFailed, DurationMS: 80,
			CreatedAt: now.Add(-3 * time.Hour),
			Steps: []StepRun{{
				Timing:   map[string]any{"apiResponseTimeMs": int64(70)},
				Attempts: []AttemptRun{{AttemptNumber: 1, ResponseStatus: 503}},
			}},
		},
		{
			ID: "script-fail", MonitorID: monitorID, Status: StatusFailed, FailureCategory: "SCRIPT_ERROR", DurationMS: 20,
			CreatedAt: now.Add(-2 * time.Hour),
			Steps:     []StepRun{{Attempts: []AttemptRun{{AttemptNumber: 1, ResponseStatus: 0}}}},
		},
		{
			ID: "timeout", MonitorID: monitorID, Status: StatusTimedOut, DurationMS: 5000,
			CreatedAt: now.Add(-time.Hour),
		},
	}
	for _, run := range runsToSave {
		if err := runRepository.Save(context.Background(), run); err != nil {
			t.Fatal(err)
		}
	}

	metrics, err := service.Metrics(context.Background(), monitorID, "24h")
	if err != nil {
		t.Fatal(err)
	}
	if metrics.ResponseStatusDistribution["200"] != 1 || metrics.ResponseStatusDistribution["503"] != 1 {
		t.Fatalf("recorded codes: %+v", metrics.ResponseStatusDistribution)
	}
	if metrics.ResponseStatusDistribution[NoResponseStatusKey] != 2 {
		t.Fatalf("missing HTTP status should be No response, not invented: %+v", metrics.ResponseStatusDistribution)
	}
	byID := map[string]HistoryMetricPoint{}
	for _, point := range metrics.Points {
		byID[point.RunID] = point
	}
	okPoint := byID["ok-200"]
	if okPoint.ResponseStatus == nil || *okPoint.ResponseStatus != 200 {
		t.Fatalf("last attempt 200 should win over earlier 500: %+v", okPoint)
	}
	if byID["script-fail"].ResponseStatus != nil {
		t.Fatalf("script failure before request invented a code: %+v", byID["script-fail"])
	}

	series, err := service.MetricSeries(context.Background(), monitorID, "24h", 50)
	if err != nil {
		t.Fatal(err)
	}
	var class2xx, class5xx, noResponse, httpTimeout int
	for _, point := range series {
		if point.BucketCounts == nil {
			continue
		}
		class2xx += point.BucketCounts.Class2xx
		class5xx += point.BucketCounts.Class5xx
		noResponse += point.BucketCounts.NoResponse
		httpTimeout += point.BucketCounts.HTTPTimeout
	}
	if class2xx != 1 || class5xx != 1 || noResponse != 1 || httpTimeout != 1 {
		t.Fatalf("series class totals 2xx=%d 5xx=%d noResponse=%d timeout=%d", class2xx, class5xx, noResponse, httpTimeout)
	}
}

func TestMetricsSummaryCountsEveryRunInTheWindow(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, time.August, 19, 12, 0, 0, 0, time.UTC)
	monitorID := "monitor-window-count"
	monitorRepository := monitors.NewMemoryRepository([]monitors.Monitor{{ID: monitorID, Name: "Window count", Slug: "window-count"}})
	runRepository := NewMemoryRepository()
	service := NewService(monitors.NewService(monitorRepository), runRepository, NewHTTPExecutor(true))
	service.now = func() time.Time { return now }
	for index := 0; index < 80; index++ {
		value := int64(100 + index)
		if err := runRepository.Save(context.Background(), Run{
			ID:         "run-" + time.Duration(index).String(),
			MonitorID:  monitorID,
			Status:     StatusSuccess,
			DurationMS: value,
			CreatedAt:  now.Add(-time.Duration(index) * time.Minute),
			Steps: []StepRun{{
				Timing:       map[string]any{"apiResponseTimeMs": value},
				AttemptCount: 1,
			}},
		}); err != nil {
			t.Fatal(err)
		}
	}

	metrics, err := service.MetricsSummary(context.Background(), monitorID, "24h")
	if err != nil {
		t.Fatal(err)
	}
	if metrics.Summary.RunCount != 80 || metrics.Summary.MeasuredRunCount != 80 {
		t.Fatalf("metrics were capped instead of using the time window: %+v", metrics.Summary)
	}
}

func TestMetricsMapsHistoricalTimingKeys(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, time.August, 19, 12, 0, 0, 0, time.UTC)
	monitorID := "monitor-historical-timing"
	monitorRepository := monitors.NewMemoryRepository([]monitors.Monitor{{ID: monitorID, Name: "Historical", Slug: "historical"}})
	runRepository := NewMemoryRepository()
	service := NewService(monitors.NewService(monitorRepository), runRepository, NewHTTPExecutor(true))
	service.now = func() time.Time { return now }
	if err := runRepository.Save(context.Background(), Run{
		ID:         "old-network",
		MonitorID:  monitorID,
		Status:     StatusSuccess,
		DurationMS: 140,
		CreatedAt:  now.Add(-2 * time.Hour),
		Steps: []StepRun{{
			Timing: map[string]any{
				"networkTotalMs": int64(110),
				"preparationMs":  int64(20),
			},
			AttemptCount: 1,
		}},
	}); err != nil {
		t.Fatal(err)
	}
	if err := runRepository.Save(context.Background(), Run{
		ID:         "old-phases",
		MonitorID:  monitorID,
		Status:     StatusSuccess,
		DurationMS: 90,
		CreatedAt:  now.Add(-time.Hour),
		Steps: []StepRun{{
			Timing: map[string]any{
				"dnsMs":              int64(5),
				"tlsHandshakeMs":     int64(15),
				"serverWaitMs":       int64(40),
				"preRequestScriptMs": int64(12),
			},
			AttemptCount: 1,
		}},
	}); err != nil {
		t.Fatal(err)
	}

	metrics, err := service.Metrics(context.Background(), monitorID, "24h")
	if err != nil {
		t.Fatal(err)
	}
	if metrics.Summary.MeasuredRunCount != 2 {
		t.Fatalf("historical timing keys were not measured: %+v", metrics.Summary)
	}
	byID := map[string]HistoryMetricPoint{}
	for _, point := range metrics.Points {
		byID[point.RunID] = point
	}
	network := byID["old-network"]
	if network.APIResponseTimeMS == nil || *network.APIResponseTimeMS != 110 || network.PreparationMS != 20 {
		t.Fatalf("networkTotalMs was not mapped: %+v", network)
	}
	phases := byID["old-phases"]
	if phases.APIResponseTimeMS == nil || *phases.APIResponseTimeMS != 60 || phases.PreparationMS != 12 {
		t.Fatalf("phase keys were not mapped: %+v", phases)
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
