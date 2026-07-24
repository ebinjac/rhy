package notifications

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
)

type fakeSecrets struct{ value string }

func (f fakeSecrets) ResolveSecret(context.Context, string) (string, error) { return f.value, nil }

func TestWebhookNotificationResolvesEndpointAndSendsSafePayload(t *testing.T) {
	var received map[string]any
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Content-Type") != "application/json" {
			t.Fatalf("missing JSON content type")
		}
		if err := json.NewDecoder(r.Body).Decode(&received); err != nil {
			t.Fatal(err)
		}
		w.WriteHeader(http.StatusAccepted)
	}))
	defer target.Close()
	service := &Service{secrets: fakeSecrets{value: target.URL}, logger: slog.Default(), client: target.Client()}
	item := delivery{ID: "delivery", EventType: "ALERT_OPENED", ChannelType: "WEBHOOK", Config: map[string]any{"urlSecretRef": "secret://webhook"}, AlertID: "alert", MonitorID: "monitor", MonitorName: "Payments", Severity: "CRITICAL", Title: "Payments is failing", Description: "Assertion failed"}
	if err := service.deliver(context.Background(), item); err != nil {
		t.Fatal(err)
	}
	if received["event"] != "ALERT_OPENED" || received["monitorName"] != "Payments" {
		t.Fatalf("unexpected webhook payload: %#v", received)
	}
}

func TestSlackNotificationUsesTextPayload(t *testing.T) {
	var received map[string]any
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewDecoder(r.Body).Decode(&received)
		w.WriteHeader(http.StatusOK)
	}))
	defer target.Close()
	service := &Service{secrets: fakeSecrets{value: target.URL}, logger: slog.Default(), client: target.Client()}
	if err := service.deliver(context.Background(), delivery{EventType: "ALERT_RECOVERED", ChannelType: "SLACK", Config: map[string]any{"urlSecretRef": "secret://slack"}, MonitorName: "Checkout", Severity: "INFO", Title: "Checkout recovered"}); err != nil {
		t.Fatal(err)
	}
	if _, ok := received["text"]; !ok {
		t.Fatalf("Slack text payload missing: %#v", received)
	}
}
