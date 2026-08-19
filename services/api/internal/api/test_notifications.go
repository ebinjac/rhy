package api

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/rhythm-monitoring/rhythm/internal/notifications"
	"github.com/rhythm-monitoring/rhythm/internal/sahara"
)

type testNotificationStatus struct {
	Email  testNotificationEmailStatus  `json:"email"`
	Sahara testNotificationSaharaStatus `json:"sahara"`
}

type testNotificationEmailStatus struct {
	Configured bool   `json:"configured"`
	From       string `json:"from"`
	FromName   string `json:"fromName"`
	SMTPHost   string `json:"smtpHost"`
	SMTPPort   int    `json:"smtpPort"`
}

type testNotificationSaharaStatus struct {
	Configured bool   `json:"configured"`
	Host       string `json:"host,omitempty"`
	Scheme     string `json:"scheme,omitempty"`
}

func (s *server) getTestNotificationStatus(w http.ResponseWriter, r *http.Request) {
	status := testNotificationStatus{}
	if s.notifications != nil {
		smtp := s.notifications.SMTPSettings()
		status.Email = testNotificationEmailStatus{
			Configured: strings.TrimSpace(smtp.Host) != "",
			From:       smtp.From,
			FromName:   smtp.FromName,
			SMTPHost:   smtp.Host,
			SMTPPort:   smtp.Port,
		}
	}
	if s.sahara != nil {
		ingest := s.sahara.IngestStatus()
		status.Sahara = testNotificationSaharaStatus{
			Configured: ingest.Configured,
			Host:       ingest.Host,
			Scheme:     ingest.Scheme,
		}
	}
	s.writeJSON(w, r, http.StatusOK, successResponse{Data: status, Meta: s.meta(r)})
}

func (s *server) sendTestNotificationEmail(w http.ResponseWriter, r *http.Request) {
	if s.notifications == nil {
		s.writeError(w, r, http.StatusServiceUnavailable, "NOTIFICATIONS_UNAVAILABLE", "Notification delivery is unavailable.", nil)
		return
	}
	var input notifications.DirectEmailInput
	if !s.decodeJSON(w, r, &input) {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()
	err := s.notifications.SendDirectEmail(ctx, input)
	if err != nil {
		status := http.StatusUnprocessableEntity
		code := "SMTP_TEST_FAILED"
		if isTestNotificationValidation(err) {
			code = "TEST_NOTIFICATION_INVALID"
		}
		s.writeError(w, r, status, code, err.Error(), nil)
		return
	}
	smtp := s.notifications.SMTPSettings()
	s.writeJSON(w, r, http.StatusOK, successResponse{Data: map[string]any{
		"sent": true,
		"to":   strings.TrimSpace(input.To),
		"host": smtpHostPort(smtp),
	}, Meta: s.meta(r)})
}

func (s *server) sendTestNotificationSahara(w http.ResponseWriter, r *http.Request) {
	if s.sahara == nil {
		s.writeError(w, r, http.StatusServiceUnavailable, "SAHARA_UNAVAILABLE", "Sahara dispatch is unavailable.", nil)
		return
	}
	var input sahara.TestEventInput
	if !s.decodeJSON(w, r, &input) {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()
	event, err := s.sahara.SendTestEvent(ctx, input)
	if err != nil {
		status := http.StatusUnprocessableEntity
		code := "SAHARA_TEST_FAILED"
		switch {
		case errors.Is(err, sahara.ErrIngestNotConfigured):
			status = http.StatusServiceUnavailable
			code = "SAHARA_NOT_CONFIGURED"
		case errors.Is(err, sahara.ErrAssignmentRequired) || isTestNotificationValidation(err):
			code = "TEST_NOTIFICATION_INVALID"
		}
		s.writeError(w, r, status, code, err.Error(), nil)
		return
	}
	s.writeJSON(w, r, http.StatusOK, successResponse{Data: map[string]any{
		"sent":            true,
		"eventUniqueId":   event.EventUniqueID,
		"assignmentGroup": event.Ticketing.AssignmentGroup,
		"host":            s.sahara.IngestStatus().Host,
	}, Meta: s.meta(r)})
}

func isTestNotificationValidation(err error) bool {
	if err == nil {
		return false
	}
	message := strings.ToLower(err.Error())
	return strings.Contains(message, "required") ||
		strings.Contains(message, "invalid email") ||
		strings.Contains(message, "from address") ||
		strings.Contains(message, "exceeds")
}

func smtpHostPort(cfg notifications.SMTPConfig) string {
	host := strings.TrimSpace(cfg.Host)
	if host == "" {
		return ""
	}
	port := cfg.Port
	if port <= 0 {
		port = 25
	}
	return host + ":" + strconv.Itoa(port)
}
