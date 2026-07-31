package scheduler

import (
	"testing"
	"time"
)

func TestIntervalJitterDoesNotAccumulate(t *testing.T) {
	service := &Service{}
	config := Config{
		ID:              "deterministic-schedule",
		Type:            "INTERVAL",
		IntervalSeconds: 60,
		JitterSeconds:   30,
		Timezone:        "UTC",
	}
	start := time.Date(2026, time.July, 31, 0, 0, 0, 0, time.UTC)
	first, err := service.next(config, start, true)
	if err != nil {
		t.Fatal(err)
	}
	second, err := service.next(config, first, false)
	if err != nil {
		t.Fatal(err)
	}
	if second.Sub(first) != time.Minute {
		t.Fatalf("jitter accumulated between intervals: got %s", second.Sub(first))
	}
	if first.Sub(start) < time.Minute || first.Sub(start) > 90*time.Second {
		t.Fatalf("initial deterministic jitter is outside the configured range: %s", first.Sub(start))
	}
}

func TestDeterministicJitterIsStable(t *testing.T) {
	first := deterministicJitter("schedule-1", 30)
	second := deterministicJitter("schedule-1", 30)
	if first != second {
		t.Fatalf("jitter must be stable: %s != %s", first, second)
	}
	if first < 0 || first > 30*time.Second {
		t.Fatalf("jitter is outside the configured range: %s", first)
	}
}
