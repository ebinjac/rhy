package runs

import (
	"context"
	"math"
	"sort"
	"strings"
	"time"
)

type HistoryMetricPoint struct {
	RunID               string                   `json:"runId"`
	RevisionID          string                   `json:"revisionId,omitempty"`
	Status              Status                   `json:"status"`
	FailureCategory     string                   `json:"failureCategory,omitempty"`
	CreatedAt           time.Time                `json:"createdAt"`
	APIResponseTimeMS   *int64                   `json:"apiResponseTimeMs,omitempty"`
	ExecutionDurationMS int64                    `json:"executionDurationMs"`
	PreparationMS       int64                    `json:"preparationMs"`
	PostProcessingMS    int64                    `json:"postProcessingMs"`
	NetworkTotalMS      int64                    `json:"networkTotalMs"`
	RetryBackoffMS      int64                    `json:"retryBackoffMs"`
	QueueDelayMS        int64                    `json:"queueDelayMs"`
	RetryCount          int                      `json:"retryCount"`
	WarningCount        int                      `json:"warningCount"`
	Spike               bool                     `json:"spike"`
	Steps               []HistoryStepMetricPoint `json:"steps,omitempty"`
}

type HistoryStepMetricPoint struct {
	StepDefinitionID  string `json:"stepDefinitionId"`
	StepName          string `json:"stepName"`
	StepType          string `json:"stepType"`
	Status            Status `json:"status"`
	APIResponseTimeMS *int64 `json:"apiResponseTimeMs,omitempty"`
}

type PercentileMetrics struct {
	MinMS int64 `json:"minMs,omitempty"`
	P50MS int64 `json:"p50Ms,omitempty"`
	P75MS int64 `json:"p75Ms,omitempty"`
	P90MS int64 `json:"p90Ms,omitempty"`
	P95MS int64 `json:"p95Ms,omitempty"`
	P99MS int64 `json:"p99Ms,omitempty"`
	MaxMS int64 `json:"maxMs,omitempty"`
}

type HistoryMetricSummary struct {
	RunCount             int     `json:"runCount"`
	MeasuredRunCount     int     `json:"measuredRunCount"`
	SuccessRate          float64 `json:"successRate"`
	ErrorRate            float64 `json:"errorRate"`
	TimeoutRate          float64 `json:"timeoutRate"`
	AverageResponseMS    int64   `json:"averageResponseMs,omitempty"`
	LatestResponseMS     int64   `json:"latestResponseMs,omitempty"`
	LatestChangePercent  float64 `json:"latestChangePercent,omitempty"`
	StandardDeviationMS  float64 `json:"standardDeviationMs,omitempty"`
	RunsPerHour          float64 `json:"runsPerHour"`
	SpikeCount           int     `json:"spikeCount"`
	AveragePreparationMS int64   `json:"averagePreparationMs,omitempty"`
	AveragePostProcessMS int64   `json:"averagePostProcessingMs,omitempty"`
	AverageExecutionMS   int64   `json:"averageExecutionMs,omitempty"`
	AverageQueueDelayMS  int64   `json:"averageQueueDelayMs,omitempty"`
}

type HistoryMetrics struct {
	Window             string               `json:"window"`
	WindowStart        time.Time            `json:"windowStart"`
	WindowEnd          time.Time            `json:"windowEnd"`
	Summary            HistoryMetricSummary `json:"summary"`
	Percentiles        PercentileMetrics    `json:"percentiles"`
	StatusDistribution map[string]int       `json:"statusDistribution"`
	FailureCategories  map[string]int       `json:"failureCategories"`
	Points             []HistoryMetricPoint `json:"points"`
}

type MetricsRepository interface {
	MetricPoints(context.Context, string, time.Time, int) ([]HistoryMetricPoint, error)
}

type DeploymentMetricsRepository interface {
	MetricPointsBetween(context.Context, string, string, time.Time, time.Time, int) ([]HistoryMetricPoint, error)
}

func (s *Service) DeploymentMetricPoints(ctx context.Context, monitorID, revisionID string, from, to time.Time, limit int) ([]HistoryMetricPoint, error) {
	if _, err := s.monitors.Get(ctx, monitorID); err != nil {
		return nil, err
	}
	repository, ok := s.repository.(DeploymentMetricsRepository)
	if !ok {
		return nil, MetricsValidationError{Message: "Deployment metrics are unavailable."}
	}
	if limit <= 0 || limit > 5000 {
		limit = 5000
	}
	return repository.MetricPointsBetween(ctx, monitorID, revisionID, from, to, limit)
}

type MetricsValidationError struct{ Message string }

func (e MetricsValidationError) Error() string { return e.Message }

func (s *Service) Metrics(ctx context.Context, monitorID, window string) (HistoryMetrics, error) {
	if _, err := s.monitors.Get(ctx, monitorID); err != nil {
		return HistoryMetrics{}, err
	}
	durations := map[string]time.Duration{"24h": 24 * time.Hour, "7d": 7 * 24 * time.Hour, "30d": 30 * 24 * time.Hour, "90d": 90 * 24 * time.Hour}
	duration, ok := durations[strings.ToLower(window)]
	if !ok {
		return HistoryMetrics{}, MetricsValidationError{Message: "Metrics window must be 24h, 7d, 30d, or 90d."}
	}
	repository, ok := s.repository.(MetricsRepository)
	if !ok {
		return HistoryMetrics{}, MetricsValidationError{Message: "Run metrics are unavailable."}
	}
	end := s.now()
	start := end.Add(-duration)
	points, err := repository.MetricPoints(ctx, monitorID, start, 1000)
	if err != nil {
		return HistoryMetrics{}, err
	}
	sort.Slice(points, func(i, j int) bool { return points[i].CreatedAt.Before(points[j].CreatedAt) })
	result := HistoryMetrics{Window: strings.ToLower(window), WindowStart: start, WindowEnd: end, Points: points, StatusDistribution: map[string]int{}, FailureCategories: map[string]int{}}
	responseValues := make([]int64, 0, len(points))
	var successCount, completedCount, errorCount, timeoutCount int
	var responseTotal, preparationTotal, postTotal, executionTotal, queueTotal int64
	for _, point := range points {
		result.StatusDistribution[string(point.Status)]++
		if point.FailureCategory != "" {
			result.FailureCategories[point.FailureCategory]++
		}
		if point.Status != StatusQueued && point.Status != StatusStarting && point.Status != StatusRunning && point.Status != StatusCancelled && point.Status != StatusSkipped {
			completedCount++
			if point.Status == StatusSuccess || point.Status == StatusSuccessWithWarnings {
				successCount++
			} else {
				errorCount++
			}
			if point.Status == StatusTimedOut {
				timeoutCount++
			}
		}
		preparationTotal += point.PreparationMS
		postTotal += point.PostProcessingMS
		executionTotal += point.ExecutionDurationMS
		queueTotal += point.QueueDelayMS
		if point.APIResponseTimeMS != nil {
			responseValues = append(responseValues, *point.APIResponseTimeMS)
			responseTotal += *point.APIResponseTimeMS
		}
	}
	result.Summary.RunCount = len(points)
	result.Summary.MeasuredRunCount = len(responseValues)
	if completedCount > 0 {
		result.Summary.SuccessRate = roundedPercent(successCount, completedCount)
		result.Summary.ErrorRate = roundedPercent(errorCount, completedCount)
		result.Summary.TimeoutRate = roundedPercent(timeoutCount, completedCount)
	}
	if len(points) > 0 {
		count := int64(len(points))
		result.Summary.AveragePreparationMS = preparationTotal / count
		result.Summary.AveragePostProcessMS = postTotal / count
		result.Summary.AverageExecutionMS = executionTotal / count
		result.Summary.AverageQueueDelayMS = queueTotal / count
	}
	result.Summary.RunsPerHour = math.Round((float64(len(points))/duration.Hours())*100) / 100
	if len(responseValues) > 0 {
		sorted := append([]int64(nil), responseValues...)
		sort.Slice(sorted, func(i, j int) bool { return sorted[i] < sorted[j] })
		result.Percentiles = PercentileMetrics{MinMS: sorted[0], P50MS: percentile(sorted, .50), P75MS: percentile(sorted, .75), P90MS: percentile(sorted, .90), P95MS: percentile(sorted, .95), P99MS: percentile(sorted, .99), MaxMS: sorted[len(sorted)-1]}
		result.Summary.AverageResponseMS = responseTotal / int64(len(responseValues))
		result.Summary.StandardDeviationMS = standardDeviation(responseValues, float64(result.Summary.AverageResponseMS))
		for index := len(points) - 1; index >= 0; index-- {
			if points[index].APIResponseTimeMS != nil {
				result.Summary.LatestResponseMS = *points[index].APIResponseTimeMS
				break
			}
		}
		if len(responseValues) > 1 && responseValues[len(responseValues)-2] > 0 {
			result.Summary.LatestChangePercent = math.Round(((float64(responseValues[len(responseValues)-1]-responseValues[len(responseValues)-2])/float64(responseValues[len(responseValues)-2]))*100)*10) / 10
		}
		history := make([]int64, 0, 50)
		for index := range result.Points {
			value := result.Points[index].APIResponseTimeMS
			if value == nil {
				continue
			}
			if len(history) >= 5 {
				baseline := append([]int64(nil), history...)
				sort.Slice(baseline, func(i, j int) bool { return baseline[i] < baseline[j] })
				median, threshold := percentile(baseline, .50), percentile(baseline, .95)
				if *value > threshold && *value-median >= 100 && float64(*value) >= float64(median)*1.25 {
					result.Points[index].Spike = true
					result.Summary.SpikeCount++
				}
			}
			history = append(history, *value)
			if len(history) > 50 {
				history = history[len(history)-50:]
			}
		}
	}
	return result, nil
}

func roundedPercent(value, total int) float64 {
	return math.Round((float64(value)/float64(total)*100)*10) / 10
}

// SampleHistoryMetricPoints bounds the chart payload while preserving recent
// executions, detected spikes, and an even chronological trend sample. Summary
// statistics are calculated before sampling and therefore remain exact.
func SampleHistoryMetricPoints(points []HistoryMetricPoint, limit int) []HistoryMetricPoint {
	if limit <= 0 || len(points) <= limit {
		return points
	}
	keep := make(map[int]bool, limit)
	recentCount := min(50, limit)
	for index := len(points) - recentCount; index < len(points); index++ {
		keep[index] = true
	}
	for index, point := range points {
		if point.Spike && len(keep) < limit {
			keep[index] = true
		}
	}
	remaining := limit - len(keep)
	olderCount := len(points) - recentCount
	if remaining > 0 && olderCount > 0 {
		step := float64(olderCount) / float64(remaining)
		for sample := 0; sample < remaining; sample++ {
			index := min(olderCount-1, int(math.Floor(float64(sample)*step)))
			for index < olderCount && keep[index] {
				index++
			}
			if index < olderCount {
				keep[index] = true
			}
		}
	}
	out := make([]HistoryMetricPoint, 0, len(keep))
	for index, point := range points {
		if keep[index] {
			out = append(out, point)
		}
	}
	return out
}

func standardDeviation(values []int64, mean float64) float64 {
	if len(values) < 2 {
		return 0
	}
	var sum float64
	for _, value := range values {
		delta := float64(value) - mean
		sum += delta * delta
	}
	return math.Round(math.Sqrt(sum/float64(len(values)))*10) / 10
}
