package runs

import (
	"testing"
	"time"
)

func TestLastAttemptResponseStatusUsesFinalAttemptOnly(t *testing.T) {
	t.Parallel()
	status, ok := LastAttemptResponseStatus([]StepRun{{
		Attempts: []AttemptRun{
			{AttemptNumber: 1, ResponseStatus: 500},
			{AttemptNumber: 2, ResponseStatus: 200},
		},
	}})
	if !ok || status != 200 {
		t.Fatalf("last attempt should win: status=%d ok=%t", status, ok)
	}

	status, ok = LastAttemptResponseStatus([]StepRun{{
		Attempts: []AttemptRun{
			{AttemptNumber: 1, ResponseStatus: 200},
			{AttemptNumber: 2, ResponseStatus: 0},
		},
	}})
	if ok || status != 0 {
		t.Fatalf("missing last-attempt status must not fall back to 200: status=%d ok=%t", status, ok)
	}

	if _, ok := LastAttemptResponseStatus([]StepRun{{Status: StatusFailed}}); ok {
		t.Fatal("script failure before a request must not invent a status code")
	}
}

func TestHTTPStatusClassDoesNotInventCodes(t *testing.T) {
	t.Parallel()
	if got := HTTPStatusClass(StatusSuccess, 201, true); got != StatusClass2xx {
		t.Fatalf("201: %s", got)
	}
	if got := HTTPStatusClass(StatusFailed, 503, true); got != StatusClass5xx {
		t.Fatalf("503: %s", got)
	}
	if got := HTTPStatusClass(StatusTimedOut, 0, false); got != StatusClassTimeout {
		t.Fatalf("timeout: %s", got)
	}
	if got := HTTPStatusClass(StatusFailed, 0, false); got != StatusClassNoResponse {
		t.Fatalf("no response: %s", got)
	}
}

func TestAttachSeriesBucketCountsAggregatesHTTPClasses(t *testing.T) {
	t.Parallel()
	start := time.Date(2026, time.August, 19, 12, 0, 0, 0, time.UTC)
	code := func(value int) *int { return &value }
	latency := func(value int64) *int64 { return &value }
	points := []HistoryMetricPoint{
		{RunID: "ok", Status: StatusSuccess, CreatedAt: start.Add(time.Minute), APIResponseTimeMS: latency(80), ResponseStatus: code(200)},
		{RunID: "created", Status: StatusSuccess, CreatedAt: start.Add(2 * time.Minute), APIResponseTimeMS: latency(90), ResponseStatus: code(201)},
		{RunID: "client", Status: StatusFailed, CreatedAt: start.Add(3 * time.Minute), APIResponseTimeMS: latency(40), ResponseStatus: code(404)},
		{RunID: "script", Status: StatusFailed, CreatedAt: start.Add(4 * time.Minute)},
		{RunID: "timeout", Status: StatusTimedOut, CreatedAt: start.Add(5 * time.Minute)},
	}
	series := AttachSeriesBucketCounts(points, start, 24*time.Hour, 50)
	if len(series) != 1 {
		t.Fatalf("expected one bucket, got %d", len(series))
	}
	counts := series[0].BucketCounts
	if counts == nil {
		t.Fatal("bucket counts missing")
	}
	if counts.Success != 2 || counts.Failed != 2 || counts.Timeout != 1 {
		t.Fatalf("outcome counts: %+v", counts)
	}
	if counts.Class2xx != 2 || counts.Class4xx != 1 || counts.NoResponse != 1 || counts.HTTPTimeout != 1 {
		t.Fatalf("HTTP class counts: %+v", counts)
	}
	if series[0].APIResponseTimeMS == nil || *series[0].APIResponseTimeMS != 90 {
		t.Fatalf("representative latency should be the slowest measured run: %+v", series[0])
	}
}
