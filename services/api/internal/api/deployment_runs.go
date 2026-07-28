package api

import (
	"errors"
	"fmt"
	"net/http"
	"strings"

	"github.com/rhythm-monitoring/rhythm/internal/authz"
	"github.com/rhythm-monitoring/rhythm/internal/suites"
)

func (s *server) createDeploymentRun(w http.ResponseWriter, r *http.Request) {
	if s.suites == nil {
		s.writeError(w, r, http.StatusServiceUnavailable, "SUITES_UNAVAILABLE", "Deployment validation is unavailable.", nil)
		return
	}
	var input suites.DeploymentRunInput
	if err := decodeStrictJSON(w, r, &input); err != nil {
		s.writeError(w, r, http.StatusBadRequest, "INVALID_REQUEST", "Request body is invalid.", nil)
		return
	}
	principal, _ := authz.PrincipalFromContext(r.Context())
	run, err := s.suites.CreateDeploymentRun(r.Context(), r.PathValue("suiteId"), principal.ID, input)
	if errors.Is(err, suites.ErrNotFound) {
		s.writeError(w, r, http.StatusNotFound, "SUITE_NOT_FOUND", "Validation suite was not found.", nil)
		return
	}
	if err != nil {
		s.writeError(w, r, http.StatusUnprocessableEntity, "DEPLOYMENT_VALIDATION_INVALID", err.Error(), nil)
		return
	}
	w.Header().Set("Location", "/api/v1/deployment-runs/"+run.ID)
	s.writeJSON(w, r, http.StatusAccepted, successResponse{Data: run, Meta: s.meta(r)})
}

func (s *server) previewDeploymentBaseline(w http.ResponseWriter, r *http.Request) {
	if s.suites == nil {
		s.writeError(w, r, http.StatusServiceUnavailable, "SUITES_UNAVAILABLE", "Deployment validation is unavailable.", nil)
		return
	}
	var input suites.BaselinePreviewInput
	if err := decodeStrictJSON(w, r, &input); err != nil {
		s.writeError(w, r, http.StatusBadRequest, "INVALID_REQUEST", "Request body is invalid.", nil)
		return
	}
	preview, err := s.suites.PreviewDeploymentBaseline(r.Context(), r.PathValue("suiteId"), input)
	if errors.Is(err, suites.ErrNotFound) {
		s.writeError(w, r, http.StatusNotFound, "SUITE_NOT_FOUND", "Validation suite was not found.", nil)
		return
	}
	if err != nil {
		s.writeError(w, r, http.StatusUnprocessableEntity, "BASELINE_PREVIEW_INVALID", err.Error(), nil)
		return
	}
	s.writeJSON(w, r, http.StatusOK, successResponse{Data: preview, Meta: s.meta(r)})
}

func (s *server) listDeploymentRuns(w http.ResponseWriter, r *http.Request) {
	if s.suites == nil {
		s.writeError(w, r, http.StatusServiceUnavailable, "SUITES_UNAVAILABLE", "Deployment validation is unavailable.", nil)
		return
	}
	filter := suites.DeploymentFilter{SuiteID: r.URL.Query().Get("suiteId"), ApplicationID: r.URL.Query().Get("applicationId"), Environment: r.URL.Query().Get("environment"), Status: r.URL.Query().Get("status"), Decision: r.URL.Query().Get("decision")}
	runs, err := s.suites.ListDeploymentRuns(r.Context(), filter)
	if err != nil {
		s.writeError(w, r, http.StatusInternalServerError, "INTERNAL_ERROR", "Unable to list deployment validations.", nil)
		return
	}
	pageItems, page, pageErr := paginate(r, runs, 50, 200)
	if pageErr != nil {
		s.writeError(w, r, http.StatusBadRequest, "INVALID_PAGINATION", pageErr.Error(), nil)
		return
	}
	s.writeJSON(w, r, http.StatusOK, successResponse{Data: pageItems, Meta: s.paginatedMeta(r, page)})
}
func (s *server) getDeploymentRun(w http.ResponseWriter, r *http.Request) {
	run, err := s.suites.GetDeploymentRun(r.Context(), r.PathValue("deploymentRunId"))
	if errors.Is(err, suites.ErrNotFound) {
		s.writeError(w, r, http.StatusNotFound, "DEPLOYMENT_RUN_NOT_FOUND", "Deployment validation was not found.", nil)
		return
	}
	if err != nil {
		s.writeError(w, r, http.StatusInternalServerError, "INTERNAL_ERROR", "Unable to load deployment validation.", nil)
		return
	}
	s.writeJSON(w, r, http.StatusOK, successResponse{Data: run, Meta: s.meta(r)})
}
func (s *server) cancelDeploymentRun(w http.ResponseWriter, r *http.Request) {
	run, err := s.suites.CancelDeploymentRun(r.Context(), r.PathValue("deploymentRunId"))
	if errors.Is(err, suites.ErrNotFound) {
		s.writeError(w, r, http.StatusNotFound, "DEPLOYMENT_RUN_NOT_FOUND", "Deployment validation was not found.", nil)
		return
	}
	if err != nil {
		s.writeError(w, r, http.StatusConflict, "DEPLOYMENT_RUN_NOT_RUNNING", err.Error(), nil)
		return
	}
	s.writeJSON(w, r, http.StatusAccepted, successResponse{Data: run, Meta: s.meta(r)})
}
func safeReportFilename(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return "deployment-validation"
	}
	var out strings.Builder
	for _, char := range value {
		if char >= 'a' && char <= 'z' || char >= 'A' && char <= 'Z' || char >= '0' && char <= '9' || char == '-' || char == '_' {
			out.WriteRune(char)
		} else if char == ' ' {
			out.WriteByte('-')
		}
	}
	if out.Len() == 0 {
		return "deployment-validation"
	}
	return out.String()
}
func (s *server) downloadDeploymentReportJSON(w http.ResponseWriter, r *http.Request) {
	run, err := s.suites.GetDeploymentRun(r.Context(), r.PathValue("deploymentRunId"))
	if err != nil {
		s.writeError(w, r, http.StatusNotFound, "DEPLOYMENT_RUN_NOT_FOUND", "Deployment validation was not found.", nil)
		return
	}
	body, err := s.suites.DeploymentReportJSON(r.Context(), run.ID)
	if err != nil {
		s.writeError(w, r, http.StatusInternalServerError, "REPORT_FAILED", "Unable to generate JSON report.", nil)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s.json"`, safeReportFilename(run.Report.SuiteName)))
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(body)
}
func (s *server) downloadDeploymentReportPDF(w http.ResponseWriter, r *http.Request) {
	run, err := s.suites.GetDeploymentRun(r.Context(), r.PathValue("deploymentRunId"))
	if err != nil {
		s.writeError(w, r, http.StatusNotFound, "DEPLOYMENT_RUN_NOT_FOUND", "Deployment validation was not found.", nil)
		return
	}
	body, err := s.suites.DeploymentReportPDF(r.Context(), run.ID)
	if err != nil {
		s.writeError(w, r, http.StatusInternalServerError, "REPORT_FAILED", "Unable to generate PDF report.", nil)
		return
	}
	w.Header().Set("Content-Type", "application/pdf")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s.pdf"`, safeReportFilename(run.Report.SuiteName)))
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(body)
}
