package api

import (
	"context"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/rhythm-monitoring/rhythm/internal/alerts"
	"github.com/rhythm-monitoring/rhythm/internal/authz"
)

type webhookRateWindow struct {
	started time.Time
	count   int
}

func (s *server) allowWebhook(ctx context.Context, receiverID string) (bool, error) {
	if s.webhookRateLimiter != nil {
		return s.webhookRateLimiter(ctx, receiverID)
	}
	s.webhookMu.Lock()
	defer s.webhookMu.Unlock()
	now := time.Now()
	window := s.webhookLimits[receiverID]
	if window == nil || now.Sub(window.started) >= time.Minute {
		s.webhookLimits[receiverID] = &webhookRateWindow{started: now, count: 1}
		return true, nil
	}
	if window.count >= 120 {
		return false, nil
	}
	window.count++
	return true, nil
}

func (s *server) listOpenSearchAlertReceivers(w http.ResponseWriter, r *http.Request) {
	s.listReceivers(w, r, r.PathValue("applicationId"))
}

func (s *server) listAllOpenSearchAlertReceivers(w http.ResponseWriter, r *http.Request) {
	s.listReceivers(w, r, r.URL.Query().Get("applicationId"))
}

func (s *server) listReceivers(w http.ResponseWriter, r *http.Request, applicationID string) {
	if s.alerts == nil {
		s.writeError(w, r, http.StatusServiceUnavailable, "ALERTING_UNAVAILABLE", "OpenSearch alert receivers require PostgreSQL.", nil)
		return
	}
	items, err := s.alerts.ListReceivers(r.Context(), applicationID)
	if err != nil {
		s.writeError(w, r, http.StatusInternalServerError, "INTERNAL_ERROR", "Unable to list OpenSearch alert receivers.", nil)
		return
	}
	s.writeJSON(w, r, http.StatusOK, successResponse{Data: items, Meta: s.meta(r)})
}

func (s *server) assignOpenSearchAlertsToService(w http.ResponseWriter, r *http.Request) {
	if s.alerts == nil {
		s.writeError(w, r, http.StatusServiceUnavailable, "ALERTING_UNAVAILABLE", "OpenSearch alert assignment requires PostgreSQL.", nil)
		return
	}
	var input alerts.ServiceAssignmentInput
	if err := decodeStrictJSON(w, r, &input); err != nil {
		s.writeError(w, r, http.StatusBadRequest, "INVALID_REQUEST", "Request body is invalid.", nil)
		return
	}
	principal, _ := authz.PrincipalFromContext(r.Context())
	result, err := s.alerts.AssignOpenSearchAlertsToService(
		r.Context(),
		r.PathValue("applicationId"),
		input,
		principal.ID,
	)
	switch {
	case errors.Is(err, alerts.ErrServiceNotFound):
		s.writeError(w, r, http.StatusUnprocessableEntity, "SERVICE_NOT_FOUND", err.Error(), nil)
	case errors.Is(err, alerts.ErrAlertScopeMismatch):
		s.writeError(w, r, http.StatusConflict, "ALERT_SCOPE_MISMATCH", err.Error(), nil)
	case errors.Is(err, alerts.ErrInvalidServiceAssignment):
		s.writeError(w, r, http.StatusUnprocessableEntity, "ALERT_ASSIGNMENT_INVALID", err.Error(), nil)
	case err != nil:
		s.writeError(w, r, http.StatusInternalServerError, "INTERNAL_ERROR", "Unable to assign the selected alerts.", nil)
	default:
		s.writeJSON(w, r, http.StatusOK, successResponse{Data: result, Meta: s.meta(r)})
	}
}

func (s *server) getOpenSearchAlertReceiver(w http.ResponseWriter, r *http.Request) {
	if s.alerts == nil {
		s.writeError(w, r, http.StatusServiceUnavailable, "ALERTING_UNAVAILABLE", "OpenSearch alert receivers require PostgreSQL.", nil)
		return
	}
	item, err := s.alerts.GetReceiver(r.Context(), r.PathValue("receiverId"))
	if errors.Is(err, alerts.ErrNotFound) {
		s.writeError(w, r, http.StatusNotFound, "RECEIVER_NOT_FOUND", "OpenSearch alert receiver was not found.", nil)
		return
	}
	if err != nil {
		s.writeError(w, r, http.StatusInternalServerError, "INTERNAL_ERROR", "Unable to load OpenSearch alert receiver.", nil)
		return
	}
	s.writeJSON(w, r, http.StatusOK, successResponse{Data: item, Meta: s.meta(r)})
}

func (s *server) createOpenSearchAlertReceiver(w http.ResponseWriter, r *http.Request) {
	if s.alerts == nil {
		s.writeError(w, r, http.StatusServiceUnavailable, "ALERTING_UNAVAILABLE", "OpenSearch alert receivers require PostgreSQL.", nil)
		return
	}
	var input alerts.ReceiverInput
	if err := decodeStrictJSON(w, r, &input); err != nil {
		s.writeError(w, r, http.StatusBadRequest, "INVALID_REQUEST", "Request body is invalid.", nil)
		return
	}
	principal, _ := authz.PrincipalFromContext(r.Context())
	item, err := s.alerts.CreateReceiver(r.Context(), r.PathValue("applicationId"), input, principal.ID)
	if err != nil {
		s.writeError(w, r, http.StatusUnprocessableEntity, "RECEIVER_INVALID", err.Error(), nil)
		return
	}
	w.Header().Set("Location", "/api/v1/opensearch-alert-receivers/"+item.ID)
	s.writeJSON(w, r, http.StatusCreated, successResponse{Data: item, Meta: s.meta(r)})
}

func (s *server) updateOpenSearchAlertReceiver(w http.ResponseWriter, r *http.Request) {
	if s.alerts == nil {
		s.writeError(w, r, http.StatusServiceUnavailable, "ALERTING_UNAVAILABLE", "OpenSearch alert receivers require PostgreSQL.", nil)
		return
	}
	var input alerts.ReceiverInput
	if err := decodeStrictJSON(w, r, &input); err != nil {
		s.writeError(w, r, http.StatusBadRequest, "INVALID_REQUEST", "Request body is invalid.", nil)
		return
	}
	principal, _ := authz.PrincipalFromContext(r.Context())
	item, err := s.alerts.UpdateReceiver(r.Context(), r.PathValue("receiverId"), input, principal.ID)
	if errors.Is(err, alerts.ErrNotFound) {
		s.writeError(w, r, http.StatusNotFound, "RECEIVER_NOT_FOUND", "OpenSearch alert receiver was not found.", nil)
		return
	}
	if err != nil {
		s.writeError(w, r, http.StatusUnprocessableEntity, "RECEIVER_INVALID", err.Error(), nil)
		return
	}
	s.writeJSON(w, r, http.StatusOK, successResponse{Data: item, Meta: s.meta(r)})
}

func (s *server) deleteOpenSearchAlertReceiver(w http.ResponseWriter, r *http.Request) {
	if s.alerts == nil {
		s.writeError(w, r, http.StatusServiceUnavailable, "ALERTING_UNAVAILABLE", "OpenSearch alert receivers require PostgreSQL.", nil)
		return
	}
	err := s.alerts.DeleteReceiver(r.Context(), r.PathValue("receiverId"))
	if errors.Is(err, alerts.ErrNotFound) {
		s.writeError(w, r, http.StatusNotFound, "RECEIVER_NOT_FOUND", "OpenSearch alert receiver was not found.", nil)
		return
	}
	if err != nil {
		s.writeError(w, r, http.StatusInternalServerError, "INTERNAL_ERROR", "Unable to delete receiver.", nil)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *server) rotateOpenSearchAlertReceiverToken(w http.ResponseWriter, r *http.Request) {
	if s.alerts == nil {
		s.writeError(w, r, http.StatusServiceUnavailable, "ALERTING_UNAVAILABLE", "OpenSearch alert receivers require PostgreSQL.", nil)
		return
	}
	principal, _ := authz.PrincipalFromContext(r.Context())
	item, err := s.alerts.RotateToken(r.Context(), r.PathValue("receiverId"), principal.ID)
	if errors.Is(err, alerts.ErrNotFound) {
		s.writeError(w, r, http.StatusNotFound, "RECEIVER_NOT_FOUND", "OpenSearch alert receiver was not found.", nil)
		return
	}
	if err != nil {
		s.writeError(w, r, http.StatusInternalServerError, "INTERNAL_ERROR", "Unable to rotate receiver token.", nil)
		return
	}
	s.writeJSON(w, r, http.StatusOK, successResponse{Data: item, Meta: s.meta(r)})
}

func (s *server) getOpenSearchAlertReceiverSetup(w http.ResponseWriter, r *http.Request) {
	if s.alerts == nil {
		s.writeError(w, r, http.StatusServiceUnavailable, "ALERTING_UNAVAILABLE", "OpenSearch alert receivers require PostgreSQL.", nil)
		return
	}
	item, err := s.alerts.GetReceiver(r.Context(), r.PathValue("receiverId"))
	if errors.Is(err, alerts.ErrNotFound) {
		s.writeError(w, r, http.StatusNotFound, "RECEIVER_NOT_FOUND", "OpenSearch alert receiver was not found.", nil)
		return
	}
	if err != nil {
		s.writeError(w, r, http.StatusInternalServerError, "INTERNAL_ERROR", "Unable to load receiver setup.", nil)
		return
	}
	proto := r.Header.Get("X-Forwarded-Proto")
	if proto == "" {
		proto = "http"
	}
	host := r.Header.Get("X-Forwarded-Host")
	if host == "" {
		host = r.Host
	}
	setup := s.alerts.Setup(item, proto+"://"+host)
	s.writeJSON(w, r, http.StatusOK, successResponse{Data: setup, Meta: s.meta(r)})
}

func (s *server) testOpenSearchAlertReceiver(w http.ResponseWriter, r *http.Request) {
	if s.alerts == nil {
		s.writeError(w, r, http.StatusServiceUnavailable, "ALERTING_UNAVAILABLE", "OpenSearch alert receivers require PostgreSQL.", nil)
		return
	}
	item, err := s.alerts.Test(r.Context(), r.PathValue("receiverId"))
	if err != nil {
		s.writeError(w, r, http.StatusUnprocessableEntity, "RECEIVER_TEST_FAILED", "Unable to create the sanitized test event.", nil)
		return
	}
	s.writeJSON(w, r, http.StatusCreated, successResponse{Data: item, Meta: s.meta(r)})
}

func (s *server) reconcileOpenSearchAlertReceiver(w http.ResponseWriter, r *http.Request) {
	if s.alerts == nil {
		s.writeError(w, r, http.StatusServiceUnavailable, "ALERTING_UNAVAILABLE", "OpenSearch alert receivers require PostgreSQL.", nil)
		return
	}
	result, err := s.alerts.Reconcile(r.Context(), r.PathValue("receiverId"))
	if errors.Is(err, alerts.ErrNotFound) {
		s.writeError(w, r, http.StatusNotFound, "RECEIVER_NOT_FOUND", "OpenSearch alert receiver was not found.", nil)
		return
	}
	if err != nil {
		s.writeError(w, r, http.StatusBadGateway, "RECONCILIATION_FAILED", "OpenSearch alerts could not be reconciled. Check the ELF connection and Alerting API permissions.", nil)
		return
	}
	s.writeJSON(w, r, http.StatusOK, successResponse{Data: result, Meta: s.meta(r)})
}

func (s *server) listOpenSearchAlertDeliveries(w http.ResponseWriter, r *http.Request) {
	if s.alerts == nil {
		s.writeError(w, r, http.StatusServiceUnavailable, "ALERTING_UNAVAILABLE", "OpenSearch alert receivers require PostgreSQL.", nil)
		return
	}
	items, err := s.alerts.Deliveries(r.Context(), r.PathValue("receiverId"))
	if err != nil {
		s.writeError(w, r, http.StatusInternalServerError, "INTERNAL_ERROR", "Unable to load webhook deliveries.", nil)
		return
	}
	s.writeJSON(w, r, http.StatusOK, successResponse{Data: items, Meta: s.meta(r)})
}

func (s *server) receiveOpenSearchAlert(w http.ResponseWriter, r *http.Request) {
	if s.alerts == nil {
		s.writeError(w, r, http.StatusServiceUnavailable, "RECEIVER_UNAVAILABLE", "Receiver is unavailable.", nil)
		return
	}
	receiverID := r.PathValue("receiverId")
	allowed, limitErr := s.allowWebhook(r.Context(), receiverID)
	if limitErr != nil {
		s.writeError(w, r, http.StatusServiceUnavailable, "RECEIVER_UNAVAILABLE", "Receiver capacity is temporarily unavailable.", nil)
		return
	}
	if !allowed {
		s.writeError(w, r, http.StatusTooManyRequests, "RATE_LIMITED", "Receiver rate limit exceeded.", nil)
		return
	}
	if media := strings.ToLower(strings.TrimSpace(strings.Split(r.Header.Get("Content-Type"), ";")[0])); media != "application/json" {
		s.writeError(w, r, http.StatusUnsupportedMediaType, "UNSUPPORTED_MEDIA_TYPE", "Content-Type must be application/json.", nil)
		return
	}
	auth := strings.TrimSpace(r.Header.Get("Authorization"))
	if !strings.HasPrefix(strings.ToLower(auth), "bearer ") {
		s.writeError(w, r, http.StatusUnauthorized, "INVALID_RECEIVER_CREDENTIAL", "Receiver credential is invalid.", nil)
		return
	}
	token := strings.TrimSpace(auth[len("Bearer "):])
	r.Body = http.MaxBytesReader(w, r.Body, 256*1024)
	raw, err := io.ReadAll(r.Body)
	if err != nil {
		s.writeError(w, r, http.StatusRequestEntityTooLarge, "PAYLOAD_TOO_LARGE", "Webhook payload exceeds the 256 KB limit.", nil)
		return
	}
	delivery, duplicate, err := s.alerts.Ingest(r.Context(), receiverID, token, raw)
	if errors.Is(err, alerts.ErrUnauthorized) {
		s.writeError(w, r, http.StatusUnauthorized, "INVALID_RECEIVER_CREDENTIAL", "Receiver credential is invalid.", nil)
		return
	}
	if err != nil {
		s.writeError(w, r, http.StatusBadRequest, "INVALID_ALERT_ENVELOPE", err.Error(), nil)
		return
	}
	status := http.StatusAccepted
	if duplicate {
		status = http.StatusOK
	}
	s.writeJSON(w, r, status, successResponse{Data: map[string]any{"deliveryId": delivery.ID, "status": delivery.Status, "duplicate": duplicate}, Meta: s.meta(r)})
}
