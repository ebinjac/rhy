package api

import (
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/rhythm-monitoring/rhythm/internal/authz"
	"github.com/rhythm-monitoring/rhythm/internal/dynatrace"
)

func (s *server) dynatraceUnavailable(w http.ResponseWriter, r *http.Request) bool {
	if s.dynatrace != nil {
		return false
	}
	s.writeError(w, r, http.StatusServiceUnavailable, "DYNATRACE_UNAVAILABLE", "Dynatrace integration requires persistent storage.", nil)
	return true
}

func (s *server) listApplicationEnvironments(w http.ResponseWriter, r *http.Request) {
	if s.dynatraceUnavailable(w, r) {
		return
	}
	items, err := s.dynatrace.ListEnvironmentBindings(r.Context(), r.PathValue("applicationId"))
	if err != nil {
		s.writeError(w, r, http.StatusInternalServerError, "INTERNAL_ERROR", "Unable to list application environments.", nil)
		return
	}
	s.writeJSON(w, r, http.StatusOK, successResponse{Data: items, Meta: s.meta(r)})
}

func (s *server) saveApplicationEnvironment(w http.ResponseWriter, r *http.Request, bindingID string, status int) {
	if s.dynatraceUnavailable(w, r) {
		return
	}
	var input dynatrace.EnvironmentBindingInput
	if err := decodeStrictJSON(w, r, &input); err != nil {
		s.writeError(w, r, http.StatusBadRequest, "INVALID_REQUEST", "Request body is invalid.", nil)
		return
	}
	principal, _ := authz.PrincipalFromContext(r.Context())
	item, err := s.dynatrace.SaveEnvironmentBinding(r.Context(), r.PathValue("applicationId"), bindingID, input, principal.ID)
	if errors.Is(err, dynatrace.ErrNotFound) {
		s.writeError(w, r, http.StatusNotFound, "APPLICATION_ENVIRONMENT_NOT_FOUND", "Application environment was not found.", nil)
		return
	}
	if err != nil {
		s.writeError(w, r, http.StatusUnprocessableEntity, "APPLICATION_ENVIRONMENT_INVALID", err.Error(), nil)
		return
	}
	s.writeJSON(w, r, status, successResponse{Data: item, Meta: s.meta(r)})
}

func (s *server) createApplicationEnvironment(w http.ResponseWriter, r *http.Request) {
	s.saveApplicationEnvironment(w, r, "", http.StatusCreated)
}

func (s *server) ensureApplicationDynatraceContext(w http.ResponseWriter, r *http.Request) {
	if s.dynatraceUnavailable(w, r) {
		return
	}
	principal, _ := authz.PrincipalFromContext(r.Context())
	item, err := s.dynatrace.EnsureDefaultEnvironmentBinding(r.Context(), r.PathValue("applicationId"), principal.ID)
	if errors.Is(err, dynatrace.ErrNotFound) {
		s.writeError(w, r, http.StatusNotFound, "APPLICATION_NOT_FOUND", "Application was not found.", nil)
		return
	}
	if err != nil {
		s.writeError(w, r, http.StatusInternalServerError, "DYNATRACE_CONTEXT_FAILED", "Unable to prepare Dynatrace for this application.", nil)
		return
	}
	s.writeJSON(w, r, http.StatusOK, successResponse{Data: item, Meta: s.meta(r)})
}

func (s *server) updateApplicationEnvironment(w http.ResponseWriter, r *http.Request) {
	s.saveApplicationEnvironment(w, r, r.PathValue("environmentBindingId"), http.StatusOK)
}

func (s *server) deleteApplicationEnvironment(w http.ResponseWriter, r *http.Request) {
	if s.dynatraceUnavailable(w, r) {
		return
	}
	err := s.dynatrace.DeleteEnvironmentBinding(r.Context(), r.PathValue("applicationId"), r.PathValue("environmentBindingId"))
	if errors.Is(err, dynatrace.ErrNotFound) {
		s.writeError(w, r, http.StatusNotFound, "APPLICATION_ENVIRONMENT_NOT_FOUND", "Application environment was not found.", nil)
		return
	}
	if err != nil {
		s.writeError(w, r, http.StatusConflict, "APPLICATION_ENVIRONMENT_IN_USE", "Unable to delete this application environment.", nil)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *server) getApplicationDynatrace(w http.ResponseWriter, r *http.Request) {
	if s.dynatraceUnavailable(w, r) {
		return
	}
	item, err := s.dynatrace.GetConfiguration(r.Context(), r.PathValue("applicationId"), r.PathValue("environmentBindingId"))
	if errors.Is(err, dynatrace.ErrNotConfigured) {
		s.writeError(w, r, http.StatusNotFound, "DYNATRACE_NOT_CONFIGURED", "Dynatrace is not configured for this application environment.", nil)
		return
	}
	if err != nil {
		s.writeError(w, r, http.StatusInternalServerError, "INTERNAL_ERROR", "Unable to load Dynatrace configuration.", nil)
		return
	}
	s.writeJSON(w, r, http.StatusOK, successResponse{Data: item, Meta: s.meta(r)})
}

func (s *server) saveApplicationDynatrace(w http.ResponseWriter, r *http.Request) {
	if s.dynatraceUnavailable(w, r) {
		return
	}
	var input dynatrace.ConfigurationInput
	if err := decodeStrictJSON(w, r, &input); err != nil {
		s.writeError(w, r, http.StatusBadRequest, "INVALID_REQUEST", "Request body is invalid.", nil)
		return
	}
	principal, _ := authz.PrincipalFromContext(r.Context())
	item, err := s.dynatrace.SaveConfiguration(r.Context(), r.PathValue("applicationId"), r.PathValue("environmentBindingId"), input, principal.ID)
	if err != nil {
		s.writeError(w, r, http.StatusUnprocessableEntity, "DYNATRACE_CONFIGURATION_INVALID", err.Error(), nil)
		return
	}
	s.writeJSON(w, r, http.StatusOK, successResponse{Data: item, Meta: s.meta(r)})
}

func (s *server) testApplicationDynatrace(w http.ResponseWriter, r *http.Request) {
	if s.dynatraceUnavailable(w, r) {
		return
	}
	result, err := s.dynatrace.TestConnection(r.Context(), r.PathValue("applicationId"), r.PathValue("environmentBindingId"))
	if err != nil {
		s.writeJSON(w, r, http.StatusOK, successResponse{Data: result, Meta: s.meta(r)})
		return
	}
	s.writeJSON(w, r, http.StatusOK, successResponse{Data: result, Meta: s.meta(r)})
}

func (s *server) listDynatraceManagementZones(w http.ResponseWriter, r *http.Request) {
	if s.dynatraceUnavailable(w, r) {
		return
	}
	items, err := s.dynatrace.ListManagementZones(r.Context(), r.PathValue("applicationId"), r.PathValue("environmentBindingId"))
	if err != nil {
		s.writeError(w, r, http.StatusBadGateway, "DYNATRACE_QUERY_FAILED", err.Error(), nil)
		return
	}
	s.writeJSON(w, r, http.StatusOK, successResponse{Data: items, Meta: s.meta(r)})
}

func (s *server) previewDynatraceResources(w http.ResponseWriter, r *http.Request) {
	if s.dynatraceUnavailable(w, r) {
		return
	}
	serviceID := strings.TrimSpace(r.URL.Query().Get("serviceId"))
	if r.Method == http.MethodPost {
		var input struct {
			ServiceID string `json:"serviceId,omitempty"`
		}
		if err := decodeStrictJSON(w, r, &input); err != nil {
			s.writeError(w, r, http.StatusBadRequest, "INVALID_REQUEST", "Request body is invalid.", nil)
			return
		}
		serviceID = input.ServiceID
	}
	result, err := s.dynatrace.PreviewResources(r.Context(), r.PathValue("applicationId"), r.PathValue("environmentBindingId"), serviceID)
	if err != nil {
		s.writeError(w, r, http.StatusUnprocessableEntity, "DYNATRACE_RESOURCE_PREVIEW_FAILED", err.Error(), nil)
		return
	}
	s.writeJSON(w, r, http.StatusOK, successResponse{Data: result, Meta: s.meta(r)})
}

func (s *server) discoverDynatraceResources(w http.ResponseWriter, r *http.Request) {
	if s.dynatraceUnavailable(w, r) {
		return
	}
	var input struct {
		Platform        string   `json:"platform"`
		ManagementZones []string `json:"managementZones"`
	}
	if err := decodeStrictJSON(w, r, &input); err != nil {
		s.writeError(w, r, http.StatusBadRequest, "INVALID_REQUEST", "Request body is invalid.", nil)
		return
	}
	items, err := s.dynatrace.DiscoverResources(
		r.Context(),
		r.PathValue("applicationId"),
		r.PathValue("environmentBindingId"),
		input.Platform,
		input.ManagementZones,
	)
	if err != nil {
		s.writeError(w, r, http.StatusBadGateway, "DYNATRACE_DISCOVERY_FAILED", err.Error(), nil)
		return
	}
	s.writeJSON(w, r, http.StatusOK, successResponse{Data: items, Meta: s.meta(r)})
}

func (s *server) listDynatraceRules(w http.ResponseWriter, r *http.Request) {
	if s.dynatraceUnavailable(w, r) {
		return
	}
	config, err := s.dynatrace.GetConfiguration(r.Context(), r.PathValue("applicationId"), r.PathValue("environmentBindingId"))
	if err != nil {
		s.writeError(w, r, http.StatusNotFound, "DYNATRACE_NOT_CONFIGURED", "Dynatrace is not configured for this environment.", nil)
		return
	}
	s.writeJSON(w, r, http.StatusOK, successResponse{Data: config.Rules, Meta: s.meta(r)})
}

func (s *server) saveDynatraceRules(w http.ResponseWriter, r *http.Request) {
	if s.dynatraceUnavailable(w, r) {
		return
	}
	var rules []dynatrace.Rule
	if err := decodeStrictJSON(w, r, &rules); err != nil {
		s.writeError(w, r, http.StatusBadRequest, "INVALID_REQUEST", "Request body is invalid.", nil)
		return
	}
	current, err := s.dynatrace.GetConfiguration(r.Context(), r.PathValue("applicationId"), r.PathValue("environmentBindingId"))
	if err != nil {
		s.writeError(w, r, http.StatusNotFound, "DYNATRACE_NOT_CONFIGURED", "Dynatrace is not configured for this environment.", nil)
		return
	}
	enabled := current.Enabled
	principal, _ := authz.PrincipalFromContext(r.Context())
	updated, err := s.dynatrace.SaveConfiguration(r.Context(), current.ApplicationID, current.EnvironmentBindingID, dynatrace.ConfigurationInput{
		ConnectionProfileID: current.ConnectionProfileID, CredentialSecretRef: current.CredentialSecretRef,
		Platforms: current.Platforms, ManagementZones: current.ManagementZones, MetricMappings: current.MetricMappings,
		BaselineWindowSeconds: current.BaselineWindowSeconds, StabilizationSeconds: current.StabilizationSeconds,
		PostWindowSeconds: current.PostWindowSeconds, Enabled: &enabled, ResourceMappings: current.ResourceMappings, Rules: rules,
	}, principal.ID)
	if err != nil {
		s.writeError(w, r, http.StatusUnprocessableEntity, "DYNATRACE_RULES_INVALID", err.Error(), nil)
		return
	}
	s.writeJSON(w, r, http.StatusOK, successResponse{Data: updated.Rules, Meta: s.meta(r)})
}

func (s *server) queryApplicationDynatrace(w http.ResponseWriter, r *http.Request) {
	if s.dynatraceUnavailable(w, r) {
		return
	}
	var input dynatrace.QueryInput
	if err := decodeStrictJSON(w, r, &input); err != nil {
		s.writeError(w, r, http.StatusBadRequest, "INVALID_REQUEST", "Request body is invalid.", nil)
		return
	}
	principal, _ := authz.PrincipalFromContext(r.Context())
	run, err := s.dynatrace.Query(r.Context(), r.PathValue("applicationId"), r.PathValue("environmentBindingId"), input, principal.ID)
	if err != nil && run.ID == "" {
		s.writeError(w, r, http.StatusUnprocessableEntity, "DYNATRACE_QUERY_INVALID", err.Error(), nil)
		return
	}
	s.writeJSON(w, r, http.StatusOK, successResponse{Data: run, Meta: s.meta(r)})
}

func (s *server) getServiceDynatrace(w http.ResponseWriter, r *http.Request) {
	if s.dynatraceUnavailable(w, r) {
		return
	}
	config, err := s.dynatrace.GetConfiguration(r.Context(), r.PathValue("applicationId"), r.PathValue("environmentBindingId"))
	if err != nil {
		s.writeError(w, r, http.StatusNotFound, "DYNATRACE_NOT_CONFIGURED", "Dynatrace is not configured for this environment.", nil)
		return
	}
	for _, item := range config.ServiceOverrides {
		if item.ServiceID == r.PathValue("serviceId") {
			s.writeJSON(w, r, http.StatusOK, successResponse{Data: item, Meta: s.meta(r)})
			return
		}
	}
	s.writeError(w, r, http.StatusNotFound, "DYNATRACE_SERVICE_NOT_CONFIGURED", "This service inherits the application Dynatrace configuration.", nil)
}

func (s *server) saveServiceDynatrace(w http.ResponseWriter, r *http.Request) {
	if s.dynatraceUnavailable(w, r) {
		return
	}
	var input dynatrace.ServiceConfigInput
	if err := decodeStrictJSON(w, r, &input); err != nil {
		s.writeError(w, r, http.StatusBadRequest, "INVALID_REQUEST", "Request body is invalid.", nil)
		return
	}
	principal, _ := authz.PrincipalFromContext(r.Context())
	item, err := s.dynatrace.SaveServiceConfiguration(r.Context(), r.PathValue("applicationId"), r.PathValue("environmentBindingId"), r.PathValue("serviceId"), input, principal.ID)
	if err != nil {
		s.writeError(w, r, http.StatusUnprocessableEntity, "DYNATRACE_SERVICE_CONFIGURATION_INVALID", err.Error(), nil)
		return
	}
	s.writeJSON(w, r, http.StatusOK, successResponse{Data: item, Meta: s.meta(r)})
}

func (s *server) listDynatraceRuns(w http.ResponseWriter, r *http.Request) {
	if s.dynatraceUnavailable(w, r) {
		return
	}
	items, err := s.dynatrace.ListRuns(r.Context(), r.URL.Query().Get("applicationId"), r.URL.Query().Get("environmentBindingId"))
	if err != nil {
		s.writeError(w, r, http.StatusInternalServerError, "INTERNAL_ERROR", "Unable to list Dynatrace query runs.", nil)
		return
	}
	pageItems, page, pageErr := paginate(r, items, 50, 200)
	if pageErr != nil {
		s.writeError(w, r, http.StatusBadRequest, "INVALID_PAGINATION", pageErr.Error(), nil)
		return
	}
	s.writeJSON(w, r, http.StatusOK, successResponse{Data: pageItems, Meta: s.paginatedMeta(r, page)})
}

func (s *server) getDynatraceRun(w http.ResponseWriter, r *http.Request) {
	if s.dynatraceUnavailable(w, r) {
		return
	}
	item, err := s.dynatrace.GetRun(r.Context(), r.PathValue("runId"))
	if errors.Is(err, dynatrace.ErrNotFound) {
		s.writeError(w, r, http.StatusNotFound, "DYNATRACE_RUN_NOT_FOUND", "Dynatrace query run was not found.", nil)
		return
	}
	if err != nil {
		s.writeError(w, r, http.StatusInternalServerError, "INTERNAL_ERROR", "Unable to load Dynatrace query run.", nil)
		return
	}
	s.writeJSON(w, r, http.StatusOK, successResponse{Data: item, Meta: s.meta(r)})
}

func (s *server) cancelDynatraceRun(w http.ResponseWriter, r *http.Request) {
	if s.dynatraceUnavailable(w, r) {
		return
	}
	item, err := s.dynatrace.GetRun(r.Context(), r.PathValue("runId"))
	if err != nil {
		s.writeError(w, r, http.StatusNotFound, "DYNATRACE_RUN_NOT_FOUND", "Dynatrace query run was not found.", nil)
		return
	}
	if item.CompletedAt != nil || !strings.EqualFold(item.Status, "RUNNING") {
		s.writeError(w, r, http.StatusConflict, "DYNATRACE_RUN_NOT_ACTIVE", "This Dynatrace query has already completed.", nil)
		return
	}
	s.writeError(w, r, http.StatusConflict, "DYNATRACE_RUN_NOT_ACTIVE", "This Dynatrace query cannot be cancelled.", nil)
}

var _ = time.RFC3339
