package api

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/rhythm-monitoring/rhythm/internal/authz"
	"github.com/rhythm-monitoring/rhythm/internal/browsermonitors"
)

func (s *server) browserService(w http.ResponseWriter, r *http.Request) (*browsermonitors.Service, bool) {
	if s.browserMonitors == nil {
		s.writeError(w, r, http.StatusServiceUnavailable, "BROWSER_MONITORING_UNAVAILABLE", "UI monitoring requires PostgreSQL, a browser agent, and artifact storage.", nil)
		return nil, false
	}
	return s.browserMonitors, true
}

func (s *server) listBrowserMonitors(w http.ResponseWriter, r *http.Request) {
	service, ok := s.browserService(w, r)
	if !ok {
		return
	}
	items, err := service.List(r.Context())
	if err != nil {
		s.writeError(w, r, http.StatusInternalServerError, "INTERNAL_ERROR", "Unable to list browser monitors.", nil)
		return
	}
	pageItems, page, err := paginate(r, items, 50, 200)
	if err != nil {
		s.writeError(w, r, http.StatusBadRequest, "INVALID_PAGINATION", err.Error(), nil)
		return
	}
	s.writeJSON(w, r, http.StatusOK, successResponse{Data: pageItems, Meta: s.paginatedMeta(r, page)})
}

func (s *server) createBrowserMonitor(w http.ResponseWriter, r *http.Request) {
	service, ok := s.browserService(w, r)
	if !ok {
		return
	}
	var input browsermonitors.CreateInput
	if err := decodeStrictJSON(w, r, &input); err != nil {
		s.writeError(w, r, http.StatusBadRequest, "INVALID_REQUEST", "Browser monitor input is invalid.", nil)
		return
	}
	principal, _ := authz.PrincipalFromContext(r.Context())
	item, err := service.Create(r.Context(), input, principal.ID)
	if errors.Is(err, browsermonitors.ErrConflict) {
		s.writeError(w, r, http.StatusConflict, "BROWSER_MONITOR_CONFLICT", "A browser monitor already uses this slug.", nil)
		return
	}
	if err != nil {
		s.writeError(w, r, http.StatusUnprocessableEntity, "BROWSER_MONITOR_VALIDATION_FAILED", err.Error(), nil)
		return
	}
	w.Header().Set("Location", "/api/v1/browser-monitors/"+item.ID)
	s.writeJSON(w, r, http.StatusCreated, successResponse{Data: item, Meta: s.meta(r)})
}

func (s *server) getBrowserMonitor(w http.ResponseWriter, r *http.Request) {
	service, ok := s.browserService(w, r)
	if !ok {
		return
	}
	item, err := service.Get(r.Context(), r.PathValue("monitorId"))
	if errors.Is(err, browsermonitors.ErrNotFound) {
		s.writeError(w, r, http.StatusNotFound, "BROWSER_MONITOR_NOT_FOUND", "Browser monitor was not found.", nil)
		return
	}
	if err != nil {
		s.writeError(w, r, http.StatusInternalServerError, "INTERNAL_ERROR", "Unable to load the browser monitor.", nil)
		return
	}
	s.writeJSON(w, r, http.StatusOK, successResponse{Data: item, Meta: s.meta(r)})
}

func (s *server) updateBrowserMonitor(w http.ResponseWriter, r *http.Request) {
	service, ok := s.browserService(w, r)
	if !ok {
		return
	}
	var input browsermonitors.UpdateInput
	if err := decodeStrictJSON(w, r, &input); err != nil {
		s.writeError(w, r, http.StatusBadRequest, "INVALID_REQUEST", "Browser monitor update is invalid.", nil)
		return
	}
	principal, _ := authz.PrincipalFromContext(r.Context())
	item, err := service.Update(r.Context(), r.PathValue("monitorId"), input, principal.ID)
	if errors.Is(err, browsermonitors.ErrNotFound) {
		s.writeError(w, r, http.StatusNotFound, "BROWSER_MONITOR_NOT_FOUND", "Browser monitor was not found.", nil)
		return
	}
	if err != nil {
		s.writeError(w, r, http.StatusUnprocessableEntity, "BROWSER_MONITOR_VALIDATION_FAILED", err.Error(), nil)
		return
	}
	s.writeJSON(w, r, http.StatusOK, successResponse{Data: item, Meta: s.meta(r)})
}

func (s *server) deleteBrowserMonitor(w http.ResponseWriter, r *http.Request) {
	service, ok := s.browserService(w, r)
	if !ok {
		return
	}
	if err := service.Delete(r.Context(), r.PathValue("monitorId")); errors.Is(err, browsermonitors.ErrNotFound) {
		s.writeError(w, r, http.StatusNotFound, "BROWSER_MONITOR_NOT_FOUND", "Browser monitor was not found.", nil)
		return
	} else if err != nil {
		s.writeError(w, r, http.StatusConflict, "BROWSER_MONITOR_DELETE_FAILED", "Browser monitor could not be deleted.", nil)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *server) listBrowserMonitorRevisions(w http.ResponseWriter, r *http.Request) {
	service, ok := s.browserService(w, r)
	if !ok {
		return
	}
	items, err := service.ListRevisions(r.Context(), r.PathValue("monitorId"))
	if err != nil {
		s.writeError(w, r, http.StatusInternalServerError, "INTERNAL_ERROR", "Unable to list browser-monitor revisions.", nil)
		return
	}
	s.writeJSON(w, r, http.StatusOK, successResponse{Data: items, Meta: s.meta(r)})
}

func (s *server) saveBrowserMonitorDraft(w http.ResponseWriter, r *http.Request) {
	service, ok := s.browserService(w, r)
	if !ok {
		return
	}
	var input struct {
		Definition browsermonitors.Definition `json:"definition"`
	}
	if err := decodeStrictJSON(w, r, &input); err != nil {
		s.writeError(w, r, http.StatusBadRequest, "INVALID_REQUEST", "Browser journey definition is invalid.", nil)
		return
	}
	principal, _ := authz.PrincipalFromContext(r.Context())
	item, err := service.SaveDraft(r.Context(), r.PathValue("monitorId"), input.Definition, principal.ID)
	if err != nil {
		s.writeError(w, r, http.StatusUnprocessableEntity, "BROWSER_JOURNEY_VALIDATION_FAILED", err.Error(), nil)
		return
	}
	s.writeJSON(w, r, http.StatusOK, successResponse{Data: item, Meta: s.meta(r)})
}

func (s *server) publishBrowserMonitor(w http.ResponseWriter, r *http.Request) {
	service, ok := s.browserService(w, r)
	if !ok {
		return
	}
	var input struct {
		ChangeSummary string `json:"changeSummary"`
	}
	if r.ContentLength > 0 && !s.decodeJSON(w, r, &input) {
		return
	}
	principal, _ := authz.PrincipalFromContext(r.Context())
	item, err := service.Publish(r.Context(), r.PathValue("monitorId"), principal.ID, input.ChangeSummary)
	if err != nil {
		s.writeError(w, r, http.StatusUnprocessableEntity, "BROWSER_MONITOR_PUBLISH_FAILED", err.Error(), nil)
		return
	}
	s.writeJSON(w, r, http.StatusOK, successResponse{Data: item, Meta: s.meta(r)})
}

func (s *server) getBrowserMonitorSchedule(w http.ResponseWriter, r *http.Request) {
	service, ok := s.browserService(w, r)
	if !ok {
		return
	}
	item, err := service.Get(r.Context(), r.PathValue("monitorId"))
	if err != nil {
		s.writeError(w, r, http.StatusNotFound, "BROWSER_MONITOR_NOT_FOUND", "Browser monitor was not found.", nil)
		return
	}
	s.writeJSON(w, r, http.StatusOK, successResponse{Data: map[string]any{
		"enabled": item.Enabled, "frequencySeconds": item.FrequencySeconds, "nextRunAt": item.NextRunAt,
	}, Meta: s.meta(r)})
}

func (s *server) saveBrowserMonitorSchedule(w http.ResponseWriter, r *http.Request) {
	service, ok := s.browserService(w, r)
	if !ok {
		return
	}
	var input struct {
		Enabled          bool `json:"enabled"`
		FrequencySeconds int  `json:"frequencySeconds"`
	}
	if err := decodeStrictJSON(w, r, &input); err != nil {
		s.writeError(w, r, http.StatusBadRequest, "INVALID_REQUEST", "Browser-monitor schedule is invalid.", nil)
		return
	}
	principal, _ := authz.PrincipalFromContext(r.Context())
	item, err := service.Update(r.Context(), r.PathValue("monitorId"), browsermonitors.UpdateInput{
		Enabled: &input.Enabled, FrequencySeconds: &input.FrequencySeconds,
	}, principal.ID)
	if err != nil {
		s.writeError(w, r, http.StatusUnprocessableEntity, "BROWSER_SCHEDULE_VALIDATION_FAILED", err.Error(), nil)
		return
	}
	s.writeJSON(w, r, http.StatusOK, successResponse{Data: item, Meta: s.meta(r)})
}

func (s *server) previewBrowserMonitor(w http.ResponseWriter, r *http.Request) {
	service, ok := s.browserService(w, r)
	if !ok {
		return
	}
	var input struct {
		Definition browsermonitors.Definition `json:"definition"`
	}
	if err := decodeStrictJSON(w, r, &input); err != nil {
		s.writeError(w, r, http.StatusBadRequest, "INVALID_REQUEST", "Browser preview definition is invalid.", nil)
		return
	}
	result, err := service.Preview(r.Context(), r.PathValue("monitorId"), input.Definition)
	if err != nil {
		s.writeError(w, r, http.StatusUnprocessableEntity, "BROWSER_PREVIEW_FAILED", err.Error(), nil)
		return
	}
	s.writeJSON(w, r, http.StatusOK, successResponse{Data: result, Meta: s.meta(r)})
}

func (s *server) previewUnsavedBrowserMonitor(w http.ResponseWriter, r *http.Request) {
	service, ok := s.browserService(w, r)
	if !ok {
		return
	}
	var input struct {
		EnvironmentProfileID string                     `json:"environmentProfileId"`
		Definition           browsermonitors.Definition `json:"definition"`
	}
	if err := decodeStrictJSON(w, r, &input); err != nil {
		s.writeError(w, r, http.StatusBadRequest, "INVALID_REQUEST", "Browser preview definition is invalid.", nil)
		return
	}
	result, err := service.PreviewDraft(r.Context(), input.EnvironmentProfileID, input.Definition)
	if err != nil {
		s.writeError(w, r, http.StatusUnprocessableEntity, "BROWSER_PREVIEW_FAILED", err.Error(), nil)
		return
	}
	s.writeJSON(w, r, http.StatusOK, successResponse{Data: result, Meta: s.meta(r)})
}

func (s *server) runBrowserMonitor(w http.ResponseWriter, r *http.Request) {
	service, ok := s.browserService(w, r)
	if !ok {
		return
	}
	var input struct {
		Revision string `json:"revision"`
	}
	if r.ContentLength > 0 && !s.decodeJSON(w, r, &input) {
		return
	}
	principal, _ := authz.PrincipalFromContext(r.Context())
	item, err := service.StartRun(r.Context(), r.PathValue("monitorId"), principal.ID, input.Revision, "MANUAL")
	if err != nil {
		s.writeError(w, r, http.StatusUnprocessableEntity, "BROWSER_RUN_REJECTED", err.Error(), nil)
		return
	}
	w.Header().Set("Location", "/api/v1/browser-runs/"+item.ID)
	s.writeJSON(w, r, http.StatusAccepted, successResponse{Data: map[string]any{
		"run": item, "diagnosticsUrl": "/api/v1/browser-runs/" + item.ID + "/diagnostics",
	}, Meta: s.meta(r)})
}

func (s *server) listBrowserMonitorRuns(w http.ResponseWriter, r *http.Request) {
	service, ok := s.browserService(w, r)
	if !ok {
		return
	}
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	items, err := service.ListRuns(r.Context(), r.PathValue("monitorId"), limit)
	if err != nil {
		s.writeError(w, r, http.StatusInternalServerError, "INTERNAL_ERROR", "Unable to list browser runs.", nil)
		return
	}
	s.writeJSON(w, r, http.StatusOK, successResponse{Data: items, Meta: s.meta(r)})
}

func (s *server) getBrowserRun(w http.ResponseWriter, r *http.Request) {
	service, ok := s.browserService(w, r)
	if !ok {
		return
	}
	item, err := service.GetRun(r.Context(), r.PathValue("runId"))
	if errors.Is(err, browsermonitors.ErrNotFound) {
		s.writeError(w, r, http.StatusNotFound, "BROWSER_RUN_NOT_FOUND", "Browser run was not found.", nil)
		return
	}
	if err != nil {
		s.writeError(w, r, http.StatusInternalServerError, "INTERNAL_ERROR", "Unable to load browser-run diagnostics.", nil)
		return
	}
	s.writeJSON(w, r, http.StatusOK, successResponse{Data: item, Meta: s.meta(r)})
}

func (s *server) cancelBrowserRun(w http.ResponseWriter, r *http.Request) {
	service, ok := s.browserService(w, r)
	if !ok {
		return
	}
	item, err := service.CancelRun(r.Context(), r.PathValue("runId"))
	if err != nil {
		s.writeError(w, r, http.StatusConflict, "BROWSER_RUN_CANCEL_FAILED", err.Error(), nil)
		return
	}
	s.writeJSON(w, r, http.StatusAccepted, successResponse{Data: item, Meta: s.meta(r)})
}

func (s *server) streamBrowserRunEvents(w http.ResponseWriter, r *http.Request) {
	service, ok := s.browserService(w, r)
	if !ok {
		return
	}
	flusher, ok := w.(http.Flusher)
	if !ok {
		s.writeError(w, r, http.StatusNotImplemented, "STREAMING_UNAVAILABLE", "Event streaming is unavailable.", nil)
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Connection", "keep-alive")
	deadline := time.NewTimer(25 * time.Second)
	defer deadline.Stop()
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	lastEncoded := ""
	for {
		item, err := service.GetRun(r.Context(), r.PathValue("runId"))
		if err != nil {
			fmt.Fprint(w, "event: error\ndata: {\"message\":\"Browser run is unavailable.\"}\n\n")
			flusher.Flush()
			return
		}
		encodedBytes, _ := json.Marshal(map[string]any{"status": item.Status, "events": item.Events})
		encoded := string(encodedBytes)
		if encoded != lastEncoded {
			fmt.Fprintf(w, "event: progress\ndata: %s\n\n", encoded)
			flusher.Flush()
			lastEncoded = encoded
		}
		if isBrowserTerminal(item.Status) {
			fmt.Fprintf(w, "event: complete\ndata: {\"status\":%q}\n\n", item.Status)
			flusher.Flush()
			return
		}
		select {
		case <-r.Context().Done():
			return
		case <-deadline.C:
			return
		case <-ticker.C:
		}
	}
}

func (s *server) getBrowserMonitorMetrics(w http.ResponseWriter, r *http.Request) {
	service, ok := s.browserService(w, r)
	if !ok {
		return
	}
	item, err := service.Metrics(r.Context(), r.PathValue("monitorId"), r.URL.Query().Get("range"))
	if err != nil {
		s.writeError(w, r, http.StatusInternalServerError, "INTERNAL_ERROR", "Unable to calculate browser-monitor metrics.", nil)
		return
	}
	s.writeJSON(w, r, http.StatusOK, successResponse{Data: item, Meta: s.meta(r)})
}

func (s *server) listBrowserBaselines(w http.ResponseWriter, r *http.Request) {
	service, ok := s.browserService(w, r)
	if !ok {
		return
	}
	items, err := service.ListBaselines(r.Context(), r.PathValue("monitorId"))
	if err != nil {
		s.writeError(w, r, http.StatusInternalServerError, "INTERNAL_ERROR", "Unable to list visual baselines.", nil)
		return
	}
	s.writeJSON(w, r, http.StatusOK, successResponse{Data: items, Meta: s.meta(r)})
}

func (s *server) proposeBrowserBaseline(w http.ResponseWriter, r *http.Request) {
	service, ok := s.browserService(w, r)
	if !ok {
		return
	}
	var input struct {
		RunID        string `json:"runId"`
		ArtifactID   string `json:"artifactId"`
		CheckpointID string `json:"checkpointId"`
	}
	if err := decodeStrictJSON(w, r, &input); err != nil {
		s.writeError(w, r, http.StatusBadRequest, "INVALID_REQUEST", "Visual baseline input is invalid.", nil)
		return
	}
	item, err := service.ProposeBaseline(r.Context(), r.PathValue("monitorId"), input.RunID, input.ArtifactID, input.CheckpointID)
	if err != nil {
		s.writeError(w, r, http.StatusUnprocessableEntity, "BASELINE_PROPOSAL_FAILED", err.Error(), nil)
		return
	}
	s.writeJSON(w, r, http.StatusCreated, successResponse{Data: item, Meta: s.meta(r)})
}

func (s *server) approveBrowserBaseline(w http.ResponseWriter, r *http.Request) {
	service, ok := s.browserService(w, r)
	if !ok {
		return
	}
	principal, _ := authz.PrincipalFromContext(r.Context())
	item, err := service.ApproveBaseline(r.Context(), r.PathValue("baselineId"), principal.ID)
	if err != nil {
		s.writeError(w, r, http.StatusUnprocessableEntity, "BASELINE_APPROVAL_FAILED", err.Error(), nil)
		return
	}
	s.writeJSON(w, r, http.StatusOK, successResponse{Data: item, Meta: s.meta(r)})
}

func (s *server) deleteBrowserBaseline(w http.ResponseWriter, r *http.Request) {
	service, ok := s.browserService(w, r)
	if !ok {
		return
	}
	if err := service.DeleteBaseline(r.Context(), r.PathValue("baselineId")); err != nil {
		s.writeError(w, r, http.StatusNotFound, "BASELINE_NOT_FOUND", "Visual baseline was not found.", nil)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *server) listBrowserAuthSessions(w http.ResponseWriter, r *http.Request) {
	service, ok := s.browserService(w, r)
	if !ok {
		return
	}
	items, err := service.ListAuthSessions(r.Context())
	if err != nil {
		s.writeError(w, r, http.StatusInternalServerError, "INTERNAL_ERROR", "Unable to list browser authentication sessions.", nil)
		return
	}
	s.writeJSON(w, r, http.StatusOK, successResponse{Data: items, Meta: s.meta(r)})
}

func (s *server) createBrowserAuthSession(w http.ResponseWriter, r *http.Request) {
	service, ok := s.browserService(w, r)
	if !ok {
		return
	}
	var input browsermonitors.AuthSessionInput
	if err := decodeStrictJSON(w, r, &input); err != nil {
		s.writeError(w, r, http.StatusBadRequest, "INVALID_REQUEST", "Browser authentication session is invalid.", nil)
		return
	}
	principal, _ := authz.PrincipalFromContext(r.Context())
	item, err := service.SaveAuthSession(r.Context(), input, principal.ID)
	if err != nil {
		s.writeError(w, r, http.StatusUnprocessableEntity, "BROWSER_SESSION_VALIDATION_FAILED", err.Error(), nil)
		return
	}
	s.writeJSON(w, r, http.StatusCreated, successResponse{Data: item, Meta: s.meta(r)})
}

func (s *server) validateBrowserAuthSession(w http.ResponseWriter, r *http.Request) {
	service, ok := s.browserService(w, r)
	if !ok {
		return
	}
	item, err := service.ValidateAuthSession(r.Context(), r.PathValue("sessionId"))
	if err != nil {
		s.writeError(w, r, http.StatusUnprocessableEntity, "BROWSER_SESSION_RENEWAL_REQUIRED", err.Error(), nil)
		return
	}
	s.writeJSON(w, r, http.StatusOK, successResponse{Data: item, Meta: s.meta(r)})
}

func (s *server) deleteBrowserAuthSession(w http.ResponseWriter, r *http.Request) {
	service, ok := s.browserService(w, r)
	if !ok {
		return
	}
	if err := service.DeleteAuthSession(r.Context(), r.PathValue("sessionId")); err != nil {
		s.writeError(w, r, http.StatusNotFound, "BROWSER_SESSION_NOT_FOUND", "Browser authentication session was not found.", nil)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *server) getBrowserArtifact(w http.ResponseWriter, r *http.Request) {
	service, ok := s.browserService(w, r)
	if !ok {
		return
	}
	item, store, err := service.GetArtifact(r.Context(), r.PathValue("artifactId"))
	if err != nil || store == nil {
		s.writeError(w, r, http.StatusNotFound, "BROWSER_ARTIFACT_NOT_FOUND", "Browser artifact was not found or has expired.", nil)
		return
	}
	reader, err := store.Get(r.Context(), item.ObjectKey)
	if err != nil {
		s.writeError(w, r, http.StatusGone, "BROWSER_ARTIFACT_EXPIRED", "Browser artifact is no longer retained.", nil)
		return
	}
	defer reader.Close()
	w.Header().Set("Content-Type", item.ContentType)
	w.Header().Set("Content-Length", strconv.FormatInt(item.ByteSize, 10))
	w.Header().Set("Cache-Control", "private, no-store")
	w.Header().Set("Content-Disposition", `inline; filename="browser-evidence-`+item.ID+artifactExtension(item.ContentType)+`"`)
	_, _ = io.Copy(w, io.LimitReader(reader, item.ByteSize))
}

func isBrowserTerminal(status string) bool {
	switch status {
	case browsermonitors.StatusSuccess, browsermonitors.StatusSuccessWithWarnings, browsermonitors.StatusFailed,
		browsermonitors.StatusTimedOut, browsermonitors.StatusCancelled, browsermonitors.StatusAborted:
		return true
	}
	return false
}

func artifactExtension(contentType string) string {
	switch strings.ToLower(contentType) {
	case "image/png":
		return ".png"
	case "application/json":
		return ".json"
	case "application/zip":
		return ".zip"
	default:
		return ".bin"
	}
}
