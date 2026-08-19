package scheduler

import (
	"testing"
	"time"
)

func TestEnabledIntervalScheduleHasFutureUTCNextRun(t *testing.T) {
	service := &Service{}
	config := Config{
		Type:            "INTERVAL",
		IntervalSeconds: 300,
		Timezone:        "Asia/Kolkata",
		JitterSeconds:   0,
		MissedRunPolicy: "SKIP",
	}
	now := time.Date(2026, time.August, 19, 5, 34, 0, 0, time.UTC)
	if err := service.applyRuntimeState(&config, true, now); err != nil {
		t.Fatal(err)
	}
	if !config.Active {
		t.Fatal("enabled INTERVAL schedule must be active")
	}
	if config.NextRunAt == nil {
		t.Fatal("enabled INTERVAL schedule must persist nextRunAt")
	}
	next := config.NextRunAt.UTC()
	if next.Location() != time.UTC {
		t.Fatalf("nextRunAt must be stored in UTC, got %s", next.Location())
	}
	if !next.After(now) {
		t.Fatalf("nextRunAt must be in the future: now=%s next=%s", now, next)
	}
	if next.Sub(now) != 5*time.Minute {
		t.Fatalf("expected next run now+interval, got %s", next.Sub(now))
	}
}

func TestIntervalNextRunIgnoresLocalTimezoneOffset(t *testing.T) {
	service := &Service{}
	now := time.Date(2026, time.August, 19, 5, 34, 0, 0, time.UTC)
	kolkata := Config{Type: "INTERVAL", IntervalSeconds: 60, Timezone: "Asia/Kolkata"}
	phoenix := Config{Type: "INTERVAL", IntervalSeconds: 60, Timezone: "America/Phoenix"}
	kiritimati := Config{Type: "INTERVAL", IntervalSeconds: 60, Timezone: "Pacific/Kiritimati"}
	left, err := service.next(kolkata, now, false)
	if err != nil {
		t.Fatal(err)
	}
	middle, err := service.next(phoenix, now, false)
	if err != nil {
		t.Fatal(err)
	}
	right, err := service.next(kiritimati, now, false)
	if err != nil {
		t.Fatal(err)
	}
	if !left.Equal(middle) || !left.Equal(right) {
		t.Fatalf("INTERVAL next run must be timezone-independent: kolkata=%s phoenix=%s kiritimati=%s", left, middle, right)
	}
	if left.Location() != time.UTC {
		t.Fatalf("INTERVAL next run must be UTC, got %s", left.Location())
	}
}

func TestUnknownTimezoneFallsBackToUTCAndStillEnables(t *testing.T) {
	if got := normalizeTimezone("Not/AZone"); got != "UTC" {
		t.Fatalf("invalid timezone should fall back to UTC, got %q", got)
	}
	if got := normalizeTimezone("Asia/Kolkata"); got != "Asia/Kolkata" {
		t.Fatalf("valid timezone should be preserved, got %q", got)
	}
	service := &Service{}
	config := Config{
		Type:            "INTERVAL",
		IntervalSeconds: 10,
		Timezone:        normalizeTimezone("Not/AZone"),
		JitterSeconds:   0,
	}
	now := time.Now().UTC()
	if err := service.applyRuntimeState(&config, true, now); err != nil {
		t.Fatal(err)
	}
	if !config.Active || config.NextRunAt == nil || !config.NextRunAt.After(now) {
		t.Fatalf("enabled INTERVAL with unknown TZ must still start: %+v", config)
	}
}

func TestDisabledIntervalScheduleHasNoNextRun(t *testing.T) {
	service := &Service{}
	config := Config{Type: "INTERVAL", IntervalSeconds: 300, Timezone: "UTC"}
	if err := service.applyRuntimeState(&config, false, time.Now().UTC()); err != nil {
		t.Fatal(err)
	}
	if config.Active {
		t.Fatal("draft INTERVAL schedule must not be active")
	}
	if config.NextRunAt != nil {
		t.Fatalf("draft INTERVAL schedule must not persist nextRunAt, got %s", config.NextRunAt)
	}
}

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
