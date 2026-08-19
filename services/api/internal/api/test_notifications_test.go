package api

import (
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/smtp"
	"strings"
	"testing"
	"time"

	"github.com/rhythm-monitoring/rhythm/internal/authz"
	"github.com/rhythm-monitoring/rhythm/internal/notifications"
	"github.com/rhythm-monitoring/rhythm/internal/sahara"
)

func testNotificationHandler(notificationsService *notifications.Service, saharaService *sahara.Service) http.Handler {
	return NewServer(Dependencies{
		Logger:        slog.New(slog.NewTextHandler(io.Discard, nil)),
		Notifications: notificationsService,
		Sahara:        saharaService,
		Authenticator: authz.NewDevelopmentAuthenticator("test-admin"),
		AllowedOrigin: "http://localhost:3000",
	})
}

func TestGetTestNotificationStatusReportsSMTPAndSahara(t *testing.T) {
	mailer := notifications.New(nil, nil, slog.New(slog.NewTextHandler(io.Discard, nil)))
	mailer.ConfigureSMTP(notifications.SMTPConfig{
		Host:     "usphx-smtp-qa.axp.com",
		Port:     25,
		From:     "no-reply@rythm.test.com",
		FromName: "rythm_support",
	})
	ingest := sahara.New(nil, sahara.Config{IngestURL: "https://saharaingest-dev.aexp.com/api/v1/events"}, slog.Default())
	response := performRequest(testNotificationHandler(mailer, ingest), http.MethodGet, "/api/v1/internal/test-notifications", "")
	if response.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
	var body struct {
		Data testNotificationStatus `json:"data"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if !body.Data.Email.Configured || body.Data.Email.SMTPHost != "usphx-smtp-qa.axp.com" || body.Data.Email.From != "no-reply@rythm.test.com" {
		t.Fatalf("unexpected email status: %+v", body.Data.Email)
	}
	if !body.Data.Sahara.Configured || body.Data.Sahara.Host != "saharaingest-dev.aexp.com" {
		t.Fatalf("unexpected sahara status: %+v", body.Data.Sahara)
	}
}

func TestSendTestNotificationEmailRequiresTo(t *testing.T) {
	mailer := notifications.New(nil, nil, slog.New(slog.NewTextHandler(io.Discard, nil)))
	mailer.ConfigureSMTP(notifications.SMTPConfig{Host: "usphx-smtp-qa.axp.com", From: "no-reply@rythm.test.com"})
	response := performRequest(testNotificationHandler(mailer, nil), http.MethodPost, "/api/v1/internal/test-notifications/email", `{"subject":"x"}`)
	if response.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
	if !strings.Contains(response.Body.String(), "destination email is required") {
		t.Fatalf("expected To validation, got %s", response.Body.String())
	}
}

func TestSendTestNotificationEmailUsesFakeSMTP(t *testing.T) {
	var gotAddr, gotFrom string
	var gotTo []string
	mailer := notifications.New(nil, nil, slog.New(slog.NewTextHandler(io.Discard, nil)))
	mailer.ConfigureSMTP(notifications.SMTPConfig{Host: "usphx-smtp-qa.axp.com", Port: 25, From: "no-reply@rythm.test.com"})
	mailer.UseMailSender(func(addr string, a smtp.Auth, from string, to []string, msg []byte) error {
		gotAddr, gotFrom, gotTo = addr, from, append([]string{}, to...)
		if a != nil {
			t.Fatalf("expected no SMTP auth")
		}
		if !strings.Contains(string(msg), "Subject: SMTP test") {
			t.Fatalf("missing subject: %s", msg)
		}
		return nil
	})
	response := performRequest(testNotificationHandler(mailer, nil), http.MethodPost, "/api/v1/internal/test-notifications/email", `{"to":"ops@example.com","subject":"SMTP test","body":"hello"}`)
	if response.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
	if gotAddr != "usphx-smtp-qa.axp.com:25" || gotFrom != "no-reply@rythm.test.com" || len(gotTo) != 1 || gotTo[0] != "ops@example.com" {
		t.Fatalf("unexpected SMTP call addr=%q from=%q to=%#v", gotAddr, gotFrom, gotTo)
	}
}

func TestSendTestNotificationSaharaRequiresAssignmentGroup(t *testing.T) {
	ingest := sahara.New(nil, sahara.Config{IngestURL: "https://saharaingest-dev.aexp.com/api/v1/events"}, slog.Default())
	response := performRequest(testNotificationHandler(nil, ingest), http.MethodPost, "/api/v1/internal/test-notifications/sahara", `{"summary":"test"}`)
	if response.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
	if !strings.Contains(response.Body.String(), "assignment group is required") {
		t.Fatalf("expected assignment validation, got %s", response.Body.String())
	}
}

func TestSendTestNotificationSaharaPostsThroughClient(t *testing.T) {
	var received sahara.Event
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := json.NewDecoder(r.Body).Decode(&received); err != nil {
			t.Errorf("decode payload: %v", err)
		}
		w.WriteHeader(http.StatusAccepted)
	}))
	defer target.Close()
	ingest := sahara.New(nil, sahara.Config{IngestURL: target.URL, Timeout: time.Second}, slog.Default())
	response := performRequest(testNotificationHandler(nil, ingest), http.MethodPost, "/api/v1/internal/test-notifications/sahara", `{"assignmentGroup":"DP_KMS_VRS_TKS_Support","environmentAffected":"E3","severity":"Sev4"}`)
	if response.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
	if received.Ticketing.AssignmentGroup != "DP_KMS_VRS_TKS_Support" || received.Ticketing.EnvironmentAffected != "E3" {
		t.Fatalf("unexpected ingest payload: %+v", received)
	}
}
