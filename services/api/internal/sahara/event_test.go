package sahara

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestPrepareMapsMonitorFailurePayload(t *testing.T) {
	occurred := time.Date(2026, 8, 19, 4, 53, 0, 0, time.UTC)
	event, skip := Prepare(&ApplicationSettings{
		Enabled:             true,
		Name:                "Checkout",
		AssignmentGroup:     "DP_KMS_VRS_TKS_Support",
		EnvironmentAffected: "E3",
		DefaultSeverity:     "Sev2",
	}, "https://saharaingest-dev.aexp.com/api/v1/events", AlertContext{
		AlertID:         "alert-1",
		MonitorID:       "monitor-9",
		MonitorName:     "Checkout health",
		SourceType:      "RHYTHM_MONITOR",
		Severity:        "CRITICAL",
		Title:           "Checkout health is failing",
		Description:     "Assertion failed",
		FailureCategory: "ASSERTION",
		RunID:           "run-22",
		OccurredAt:      occurred,
	})
	if skip != "" {
		t.Fatalf("unexpected skip: %s", skip)
	}
	if event.EventGenerator != "Rhythm" || event.Source != "Checkout" || event.SourceID != "monitor-9" {
		t.Fatalf("unexpected identity: %+v", event)
	}
	if event.EventUniqueID != "Checkout::monitor-9::alert-1" {
		t.Fatalf("event_unique_id=%q", event.EventUniqueID)
	}
	if event.Severity != 1 || event.Class != "Synthetic" || event.Type != "Monitor Failure" {
		t.Fatalf("unexpected classification: %+v", event)
	}
	if !strings.Contains(event.Description, "Assertion failed") || !strings.Contains(event.Description, "run-22") {
		t.Fatalf("description=%q", event.Description)
	}
	if event.Ticketing.AssignmentGroup != "DP_KMS_VRS_TKS_Support" || event.Ticketing.ReporterGroup != "DP_KMS_VRS_TKS_Support" {
		t.Fatalf("unexpected ticketing groups: %+v", event.Ticketing)
	}
	if event.Ticketing.EnvironmentAffected != "E3" || event.Ticketing.Severity != "Sev2" || !event.Ticketing.Enabled {
		t.Fatalf("unexpected ticketing: %+v", event.Ticketing)
	}
	if event.Timestamp != occurred.Format(time.RFC3339Nano) {
		t.Fatalf("timestamp=%q", event.Timestamp)
	}
}

func TestPrepareUsesBrowserTypeAndReporterFallback(t *testing.T) {
	event, skip := Prepare(&ApplicationSettings{
		Enabled:         true,
		Name:            "Identity",
		AssignmentGroup: "IDP_Support",
		ReporterGroup:   "IDP_Reporters",
		EventGenerator:  "Rhythm Browser",
	}, "https://example.test/events", AlertContext{
		AlertID:          "alert-b",
		BrowserMonitorID: "browser-3",
		MonitorName:      "Login journey",
		SourceType:       "RHYTHM_BROWSER_MONITOR",
		Severity:         "HIGH",
		Title:            "Login journey browser journey is failing",
	})
	if skip != "" {
		t.Fatalf("unexpected skip: %s", skip)
	}
	if event.Type != "Browser Monitor Failure" || event.SourceID != "browser-3" {
		t.Fatalf("unexpected browser mapping: %+v", event)
	}
	if event.EventGenerator != "Rhythm Browser" || event.Ticketing.ReporterGroup != "IDP_Reporters" {
		t.Fatalf("unexpected generator/reporter: %+v", event)
	}
	if event.Severity != 2 || event.Ticketing.Severity != "Sev2" {
		t.Fatalf("unexpected derived severity: numeric=%d ticket=%s", event.Severity, event.Ticketing.Severity)
	}
}

func TestPrepareSkipsWhenDisabled(t *testing.T) {
	_, skip := Prepare(&ApplicationSettings{
		Enabled:         false,
		Name:            "Checkout",
		AssignmentGroup: "Support",
	}, "https://example.test/events", AlertContext{AlertID: "alert-1", MonitorID: "monitor-1"})
	if skip != "disabled" {
		t.Fatalf("skip=%q, want disabled", skip)
	}
}

func TestPrepareSkipsWhenNoApplication(t *testing.T) {
	_, skip := Prepare(nil, "https://example.test/events", AlertContext{AlertID: "alert-1"})
	if skip != "no application" {
		t.Fatalf("skip=%q, want no application", skip)
	}
}

func TestPrepareSkipsIncompleteAndMissingIngest(t *testing.T) {
	_, skip := Prepare(&ApplicationSettings{Enabled: true, Name: "Checkout"}, "https://example.test/events", AlertContext{AlertID: "a"})
	if skip != "incomplete" {
		t.Fatalf("skip=%q, want incomplete", skip)
	}
	_, skip = Prepare(&ApplicationSettings{Enabled: true, AssignmentGroup: "Support"}, "", AlertContext{AlertID: "a"})
	if skip != "ingest url not configured" {
		t.Fatalf("skip=%q, want ingest url not configured", skip)
	}
}

func TestNumericSeverityDefaultsToFour(t *testing.T) {
	if got := NumericSeverity(""); got != 4 {
		t.Fatalf("empty severity=%d, want 4", got)
	}
	if got := NumericSeverity("INFO"); got != 4 {
		t.Fatalf("info severity=%d, want 4", got)
	}
}

func TestPostSendsIncidentJSON(t *testing.T) {
	var received Event
	var contentType, accept string
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		contentType = r.Header.Get("Content-Type")
		accept = r.Header.Get("Accept")
		if err := json.NewDecoder(r.Body).Decode(&received); err != nil {
			t.Errorf("decode payload: %v", err)
		}
		w.WriteHeader(http.StatusAccepted)
	}))
	defer target.Close()

	service := New(nil, Config{IngestURL: target.URL, Timeout: time.Second}, slog.Default())
	service.client = target.Client()
	event, skip := Prepare(&ApplicationSettings{
		Enabled:         true,
		Name:            "Checkout",
		AssignmentGroup: "DP_SUPPORT",
	}, target.URL, AlertContext{
		AlertID:     "alert-1",
		MonitorID:   "monitor-9",
		MonitorName: "Checkout health",
		Severity:    "WARNING",
		Title:       "Checkout health is failing",
		Description: "status was 500",
		OccurredAt:  time.Date(2026, 8, 19, 4, 53, 0, 0, time.UTC),
	})
	if skip != "" {
		t.Fatalf("unexpected skip: %s", skip)
	}
	if err := service.post(context.Background(), event); err != nil {
		t.Fatal(err)
	}
	if contentType != "application/json" || accept != "application/json" {
		t.Fatalf("headers content-type=%q accept=%q", contentType, accept)
	}
	if received.EventUniqueID != event.EventUniqueID || received.Ticketing.AssignmentGroup != "DP_SUPPORT" {
		t.Fatalf("unexpected posted payload: %+v", received)
	}
}

func TestPostReturnsErrorWhenIngestUnavailable(t *testing.T) {
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.Copy(io.Discard, r.Body)
		w.WriteHeader(http.StatusBadGateway)
	}))
	defer target.Close()

	service := New(nil, Config{IngestURL: target.URL, Timeout: time.Second}, slog.Default())
	service.client = target.Client()
	err := service.post(context.Background(), Event{
		EventGenerator: "Rhythm",
		SourceID:       "monitor-9",
		Source:         "Checkout",
		EventUniqueID:  "Checkout::monitor-9::alert-1",
		Severity:       4,
		Description:    "failed",
		Class:          "Synthetic",
		Type:           "Monitor Failure",
		Timestamp:      time.Now().UTC().Format(time.RFC3339Nano),
		Ticketing:      Ticketing{Enabled: true, AssignmentGroup: "Support", ReporterGroup: "Support", Summary: "failed", Severity: "Sev4"},
	})
	if err == nil || !strings.Contains(err.Error(), "status 502") {
		t.Fatalf("expected ingest status error, got %v", err)
	}
}

func TestProcessOneWaitsWhenIngestURLMissing(t *testing.T) {
	service := New(nil, Config{}, slog.Default())
	if err := service.processOne(context.Background()); err != nil {
		t.Fatal(err)
	}
}

func TestSendTestEventPostsThroughClient(t *testing.T) {
	var received Event
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := json.NewDecoder(r.Body).Decode(&received); err != nil {
			t.Errorf("decode payload: %v", err)
		}
		w.WriteHeader(http.StatusAccepted)
	}))
	defer target.Close()

	service := New(nil, Config{IngestURL: target.URL, Timeout: time.Second}, slog.Default())
	event, err := service.SendTestEvent(context.Background(), TestEventInput{
		AssignmentGroup:     "DP_KMS_VRS_TKS_Support",
		EnvironmentAffected: "E3",
		Severity:            "Sev4",
		Summary:             "Rhythm Sahara ingest test",
		EventGenerator:      "Rhythm",
	})
	if err != nil {
		t.Fatal(err)
	}
	if received.Ticketing.AssignmentGroup != "DP_KMS_VRS_TKS_Support" || received.EventGenerator != "Rhythm" {
		t.Fatalf("unexpected posted payload: %+v", received)
	}
	if event.EventUniqueID == "" || received.EventUniqueID != event.EventUniqueID {
		t.Fatalf("event unique id missing: sent=%q received=%q", event.EventUniqueID, received.EventUniqueID)
	}
	if received.Ticketing.EnvironmentAffected != "E3" || received.Ticketing.Severity != "Sev4" {
		t.Fatalf("unexpected ticketing: %+v", received.Ticketing)
	}
}

func TestSendTestEventRequiresAssignmentGroup(t *testing.T) {
	service := New(nil, Config{IngestURL: "https://saharaingest-dev.aexp.com/api/v1/events"}, slog.Default())
	_, err := service.SendTestEvent(context.Background(), TestEventInput{})
	if !errors.Is(err, ErrAssignmentRequired) {
		t.Fatalf("expected assignment error, got %v", err)
	}
}

func TestSendTestEventRequiresIngestURL(t *testing.T) {
	service := New(nil, Config{}, slog.Default())
	_, err := service.SendTestEvent(context.Background(), TestEventInput{AssignmentGroup: "Support"})
	if !errors.Is(err, ErrIngestNotConfigured) {
		t.Fatalf("expected ingest configuration error, got %v", err)
	}
}

func TestIngestStatusExposesHostOnly(t *testing.T) {
	service := New(nil, Config{IngestURL: "https://saharaingest-dev.aexp.com/api/v1/events"}, slog.Default())
	status := service.IngestStatus()
	if !status.Configured || status.Host != "saharaingest-dev.aexp.com" || status.Scheme != "https" {
		t.Fatalf("unexpected status: %+v", status)
	}
}
