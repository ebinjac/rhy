package investigation

import (
	"context"
	"io"
	"log/slog"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/rhythm-monitoring/rhythm/internal/dynatrace"
	"github.com/rhythm-monitoring/rhythm/internal/elf"
)

func TestParseChecksFromPublishedDefinition(t *testing.T) {
	checks := ParseChecks(map[string]any{
		"investigationChecks": []any{
			map[string]any{"id": "elf-1", "kind": "ELF_QUERY", "label": "Error logs", "queryId": "q-1"},
			map[string]any{"id": "dt-1", "kind": "DYNATRACE", "applicationId": "app-1", "environmentBindingId": "bind-1"},
			map[string]any{"id": "bad", "kind": "NOTE"},
		},
	})
	if len(checks) != 2 {
		t.Fatalf("expected 2 checks, got %#v", checks)
	}
	if checks[0].QueryID != "q-1" || checks[1].Kind != KindDynatrace {
		t.Fatalf("unexpected checks: %#v", checks)
	}
}

func TestPendingFromPlaybookEmptyWhenNoChecks(t *testing.T) {
	if rows := pendingFromPlaybook(nil, "alert", "monitor", "run", "app", time.Now()); len(rows) != 0 {
		t.Fatalf("expected no pending rows, got %#v", rows)
	}
}

func TestSkipReasons(t *testing.T) {
	if got := skipReason(Result{Kind: KindELFQuery, QueryID: "q"}, false, true); got != "ELF is not configured." {
		t.Fatalf("elf skip: %q", got)
	}
	if got := skipReason(Result{Kind: KindDynatrace, ApplicationID: "app", EnvironmentBindingID: "bind"}, true, false); got != "Dynatrace is not configured." {
		t.Fatalf("dynatrace skip: %q", got)
	}
	if got := skipReason(Result{Kind: KindELFQuery}, true, true); got != "ELF query is missing." {
		t.Fatalf("missing query: %q", got)
	}
	if got := skipReason(Result{Kind: KindELFQuery, QueryID: "q"}, true, true); got != "" {
		t.Fatalf("configured ELF should run, got %q", got)
	}
}

func TestMapELFAndDynatraceResults(t *testing.T) {
	status, summary, _ := mapELFResult(elf.RunSummary{Status: "SUCCESS", Decision: "PASS", HitCount: 3}, nil)
	if status != StatusPassed || summary == "" {
		t.Fatalf("expected ELF pass, got %s %q", status, summary)
	}
	status, _, _ = mapELFResult(elf.RunSummary{Status: "FAILED", Decision: "FAIL", FailureReason: "too many errors"}, nil)
	if status != StatusFailed {
		t.Fatalf("expected ELF fail, got %s", status)
	}
	status, _, _ = mapDynatraceResult(dynatrace.Run{Decision: "BLOCK", FailureReason: "CPU"}, nil)
	if status != StatusFailed {
		t.Fatalf("expected dynatrace fail, got %s", status)
	}
	status, _, _ = mapDynatraceResult(dynatrace.Run{Decision: "ALLOW_WITH_WARNINGS"}, nil)
	if status != StatusPassed {
		t.Fatalf("expected dynatrace warning pass, got %s", status)
	}
}

type fakeELF struct {
	summary elf.RunSummary
	err     error
	calls   int
}

func (f *fakeELF) Run(context.Context, string, string, elf.ProbeInput, bool) (elf.RunSummary, error) {
	f.calls++
	return f.summary, f.err
}

type fakeDT struct {
	run   dynatrace.Run
	err   error
	calls int
}

func (f *fakeDT) Query(context.Context, string, string, dynatrace.QueryInput, string) (dynatrace.Run, error) {
	f.calls++
	return f.run, f.err
}

func testService(elfRunner ELFRunner, dt DynatraceQuerier) *Service {
	now := time.Date(2026, 8, 19, 12, 0, 0, 0, time.UTC)
	return &Service{
		elf:       elfRunner,
		dynatrace: dt,
		logger:    slog.New(slog.NewTextHandler(io.Discard, nil)),
		now:       func() time.Time { return now },
		store:     newMemoryBackend(),
	}
}

func TestEnqueueSkipWhenEmptyAndInsertWhenPlaybookPresent(t *testing.T) {
	now := time.Date(2026, 8, 19, 12, 0, 0, 0, time.UTC)
	if rows := pendingFromPlaybook(ParseChecks(map[string]any{}), "a", "m", "r", "app", now); len(rows) != 0 {
		t.Fatalf("empty playbook should not enqueue")
	}
	rows := pendingFromPlaybook(ParseChecks(map[string]any{
		"investigationChecks": []any{
			map[string]any{"id": "elf-1", "kind": "ELF_QUERY", "queryId": "q-1", "label": "Errors"},
		},
	}), "alert-1", "monitor-1", "run-1", "app-1", now)
	if len(rows) != 1 || rows[0].Status != StatusPending || rows[0].Attempt != 1 {
		t.Fatalf("expected one pending row, got %#v", rows)
	}
}

func TestWorkerSkipsUnconfiguredAndPassesConfigured(t *testing.T) {
	ctx := context.Background()
	skipped := testService(nil, nil)
	status, summary, _, _ := skipped.execute(ctx, Result{Kind: KindELFQuery, QueryID: "q-1"}, "tester")
	if status != StatusSkipped || summary == "" {
		t.Fatalf("expected skip, got %s %q", status, summary)
	}

	runner := &fakeELF{summary: elf.RunSummary{Status: "SUCCESS", Decision: "PASS", HitCount: 2}}
	service := testService(runner, nil)
	status, _, _, _ = service.execute(ctx, Result{Kind: KindELFQuery, QueryID: "q-1"}, "tester")
	if status != StatusPassed || runner.calls != 1 {
		t.Fatalf("expected pass with one ELF call, got %s calls=%d", status, runner.calls)
	}
}

func TestRerunIncrementsAttempt(t *testing.T) {
	ctx := context.Background()
	runner := &fakeELF{summary: elf.RunSummary{Status: "SUCCESS", Decision: "PASS", HitCount: 1}}
	service := testService(runner, nil)
	now := service.now()
	rows := pendingFromPlaybook(ParseChecks(map[string]any{
		"investigationChecks": []any{
			map[string]any{"id": "elf-1", "kind": "ELF_QUERY", "queryId": "q-1", "label": "Errors"},
		},
	}), "alert-1", "monitor-1", "run-1", "app-1", now)
	if err := service.store.insertPending(ctx, rows[0]); err != nil {
		t.Fatal(err)
	}
	if err := service.processOne(ctx); err != nil {
		t.Fatal(err)
	}
	first, err := service.ListByAlert(ctx, "alert-1")
	if err != nil || len(first.Items) != 1 || first.Items[0].Attempt != 1 {
		t.Fatalf("first result: %#v %v", first, err)
	}
	item, err := service.Rerun(ctx, "alert-1", "elf-1", "operator")
	if err != nil {
		t.Fatal(err)
	}
	if item.Attempt != 2 {
		t.Fatalf("expected attempt 2, got %#v", item)
	}
	latest, err := service.ListByAlert(ctx, "alert-1")
	if err != nil || latest.Items[0].Attempt != 2 {
		t.Fatalf("latest should be attempt 2: %#v %v", latest, err)
	}
}

type memoryBackend struct {
	mu       sync.Mutex
	rows     []Result
	runTimes map[string]time.Time
}

func newMemoryBackend() *memoryBackend {
	return &memoryBackend{runTimes: map[string]time.Time{}}
}

func (m *memoryBackend) insertPending(_ context.Context, row Result) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, existing := range m.rows {
		if existing.AlertID == row.AlertID && existing.CheckID == row.CheckID && existing.Attempt == row.Attempt {
			return nil
		}
	}
	m.rows = append(m.rows, row)
	return nil
}

func (m *memoryBackend) listLatest(_ context.Context, alertID string) ([]Result, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	latest := map[string]Result{}
	for _, row := range m.rows {
		if row.AlertID != alertID {
			continue
		}
		current, ok := latest[row.CheckID]
		if !ok || row.Attempt > current.Attempt {
			latest[row.CheckID] = row
		}
	}
	items := make([]Result, 0, len(latest))
	for _, row := range latest {
		items = append(items, row)
	}
	sortResults(items)
	return items, nil
}

func (m *memoryBackend) latestByCheck(_ context.Context, alertID, checkID string) (Result, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	found := Result{}
	ok := false
	for _, row := range m.rows {
		if row.AlertID == alertID && row.CheckID == checkID && (!ok || row.Attempt > found.Attempt) {
			found = row
			ok = true
		}
	}
	if !ok {
		return Result{}, pgx.ErrNoRows
	}
	return found, nil
}

func (m *memoryBackend) claim(_ context.Context) (Result, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for index, row := range m.rows {
		if row.Status == StatusPending {
			row.Status = StatusRunning
			now := time.Now().UTC()
			row.StartedAt = &now
			m.rows[index] = row
			return row, nil
		}
	}
	return Result{}, pgx.ErrNoRows
}

func (m *memoryBackend) complete(_ context.Context, item Result) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	for index, row := range m.rows {
		if row.ID == item.ID {
			m.rows[index] = item
			return nil
		}
	}
	m.rows = append(m.rows, item)
	return nil
}

func (m *memoryBackend) alertForRun(_ context.Context, runID string) (string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for i := len(m.rows) - 1; i >= 0; i-- {
		if m.rows[i].RunID == runID {
			return m.rows[i].AlertID, nil
		}
	}
	return "", pgx.ErrNoRows
}

func (m *memoryBackend) runTime(_ context.Context, runID string) (time.Time, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	value, ok := m.runTimes[runID]
	return value, ok
}
