package runs

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
)

type recordingTargetLimiter struct {
	mu      sync.Mutex
	target  string
	limit   int
	acquire int
	err     error
}

func (l *recordingTargetLimiter) Acquire(_ context.Context, target string, limit int) (func(), error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.target = target
	l.limit = limit
	l.acquire++
	if l.err != nil {
		return nil, l.err
	}
	return func() {}, nil
}

func TestExecutorUsesDistributedTargetLimiter(t *testing.T) {
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))
	defer target.Close()

	limiter := &recordingTargetLimiter{}
	executor := NewHTTPExecutor(true)
	executor.SetTargetHostConcurrency(3)
	executor.SetTargetConcurrencyLimiter(limiter)
	result := executor.Execute(context.Background(), StepDefinition{
		ID: "step-1", Name: "limited request", Type: "HTTP_REQUEST", Enabled: true,
		Request: RequestConfig{
			Method: "GET", URL: target.URL,
			Settings: SettingsConfig{TimeoutMS: 5_000, Compression: true},
		},
	})
	if result.Status != StatusSuccess {
		t.Fatalf("expected successful execution, got %s (%s)", result.Status, result.ErrorMessage)
	}
	if limiter.acquire != 1 || limiter.limit != 3 || limiter.target != "127.0.0.1" {
		t.Fatalf("unexpected limiter call: target=%q limit=%d count=%d", limiter.target, limiter.limit, limiter.acquire)
	}
}

func TestExecutorFailsSafelyWhenDistributedLimiterIsUnavailable(t *testing.T) {
	limiter := &recordingTargetLimiter{err: ErrTargetLimiterUnavailable}
	executor := NewHTTPExecutor(true)
	executor.SetTargetConcurrencyLimiter(limiter)
	result := executor.Execute(context.Background(), StepDefinition{
		ID: "step-1", Name: "limited request", Type: "HTTP_REQUEST", Enabled: true,
		Request: RequestConfig{
			Method: "GET", URL: "http://127.0.0.1:65534",
			Settings: SettingsConfig{TimeoutMS: 5_000, Compression: true},
		},
	})
	if result.Status != StatusFailed || result.FailureCategory != "TARGET_CONCURRENCY_UNAVAILABLE" {
		t.Fatalf("expected a safe limiter failure, got %s/%s", result.Status, result.FailureCategory)
	}
}

func TestRedisTargetLimiterRejectsMissingClientAndHidesTargetName(t *testing.T) {
	if _, err := NewRedisTargetLimiter(nil).Acquire(context.Background(), "payments.internal", 2); !errors.Is(err, ErrTargetLimiterUnavailable) {
		t.Fatalf("expected unavailable limiter error, got %v", err)
	}
	key := targetLimiterKey("payments.internal")
	if strings.Contains(key, "payments") || key != targetLimiterKey("payments.internal") {
		t.Fatalf("target limiter key should be stable and opaque, got %q", key)
	}
}
