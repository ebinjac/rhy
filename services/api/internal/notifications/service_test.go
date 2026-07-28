package notifications

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/smtp"
	"strings"
	"testing"
)

type fakeSecrets struct {
	value   string
	decrypt map[string]string
}

func (f fakeSecrets) ResolveSecret(context.Context, string) (string, error) { return f.value, nil }

func (f fakeSecrets) DecryptStored(ciphertext string) (string, error) {
	if f.decrypt != nil {
		if value, ok := f.decrypt[ciphertext]; ok {
			return value, nil
		}
	}
	return "", errors.New("unknown ciphertext")
}

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

func TestEmailNotificationMergesApplicationRecipientsWithoutAuth(t *testing.T) {
	var gotAddr, gotFrom string
	var gotTo []string
	var gotMsg []byte
	service := &Service{
		logger: slog.Default(),
		sendMail: func(addr string, a smtp.Auth, from string, to []string, msg []byte) error {
			gotAddr, gotFrom, gotTo, gotMsg = addr, from, append([]string{}, to...), append([]byte{}, msg...)
			if a != nil {
				t.Fatalf("expected no SMTP auth for unauthenticated servers")
			}
			return nil
		},
	}
	err := service.email(context.Background(), delivery{
		EventType:         "ALERT_OPENED",
		ChannelType:       "EMAIL",
		Config:            map[string]any{"smtpHost": "smtp.freesmtpservers.com", "smtpPort": 25, "from": "alerts@rhythm.local", "to": []any{"fallback@example.com"}},
		MonitorName:       "Payments",
		Severity:          "CRITICAL",
		Title:             "Payments is failing",
		Description:       "Assertion failed",
		ApplicationEmails: []string{"oncall@example.com", "fallback@example.com"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if gotAddr != "smtp.freesmtpservers.com:25" || gotFrom != "alerts@rhythm.local" {
		t.Fatalf("unexpected envelope: addr=%q from=%q", gotAddr, gotFrom)
	}
	if len(gotTo) != 2 || gotTo[0] != "oncall@example.com" || gotTo[1] != "fallback@example.com" {
		t.Fatalf("unexpected recipients: %#v", gotTo)
	}
	body := string(gotMsg)
	if !strings.Contains(body, "Subject: [CRITICAL] Payments is failing") || !strings.Contains(body, "Assertion failed") {
		t.Fatalf("unexpected message body: %s", body)
	}
}

func TestEmailNotificationUsesInlineEncryptedCredentials(t *testing.T) {
	var gotAuth smtp.Auth
	service := &Service{
		logger: slog.Default(),
		secrets: fakeSecrets{decrypt: map[string]string{
			"v1:user": "smtp-user",
			"v1:pass": "smtp-pass",
		}},
		sendMail: func(addr string, a smtp.Auth, from string, to []string, msg []byte) error {
			gotAuth = a
			return nil
		},
	}
	err := service.email(context.Background(), delivery{
		Config: map[string]any{
			"smtpHost":          "smtp.example.com",
			"smtpPort":          587,
			"from":              "alerts@example.com",
			"to":                []any{"oncall@example.com"},
			"encryptedUsername": "v1:user",
			"encryptedPassword": "v1:pass",
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if gotAuth == nil {
		t.Fatal("expected SMTP auth from inline encrypted credentials")
	}
}

func TestEmailNotificationRequiresRecipients(t *testing.T) {
	service := &Service{logger: slog.Default(), sendMail: func(string, smtp.Auth, string, []string, []byte) error {
		t.Fatal("sendMail should not be called")
		return nil
	}}
	err := service.email(context.Background(), delivery{
		Config: map[string]any{"smtpHost": "smtp.example.com", "from": "alerts@example.com"},
	})
	if err == nil || !strings.Contains(err.Error(), "no recipients") {
		t.Fatalf("expected recipients error, got %v", err)
	}
}

func TestMergeRecipientsPrefersApplicationThenFallback(t *testing.T) {
	got := mergeRecipients([]string{"fallback@example.com", "shared@example.com"}, []string{"app@example.com", "shared@example.com"})
	if len(got) != 3 || got[0] != "app@example.com" || got[1] != "shared@example.com" || got[2] != "fallback@example.com" {
		t.Fatalf("unexpected merge order: %#v", got)
	}
}
