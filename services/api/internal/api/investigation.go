package api

import (
	"errors"
	"net/http"

	"github.com/rhythm-monitoring/rhythm/internal/authz"
	"github.com/rhythm-monitoring/rhythm/internal/investigation"
)

func (s *server) getAlertInvestigation(w http.ResponseWriter, r *http.Request) {
	if s.investigation == nil {
		s.writeError(w, r, http.StatusServiceUnavailable, "INVESTIGATION_UNAVAILABLE", "Investigation requires PostgreSQL.", nil)
		return
	}
	report, err := s.investigation.ListByAlert(r.Context(), r.PathValue("alertId"))
	if err != nil {
		s.writeError(w, r, http.StatusInternalServerError, "INTERNAL_ERROR", "Unable to load investigation.", nil)
		return
	}
	s.writeJSON(w, r, http.StatusOK, successResponse{Data: report, Meta: s.meta(r)})
}

func (s *server) getRunInvestigation(w http.ResponseWriter, r *http.Request) {
	if s.investigation == nil {
		s.writeError(w, r, http.StatusServiceUnavailable, "INVESTIGATION_UNAVAILABLE", "Investigation requires PostgreSQL.", nil)
		return
	}
	report, err := s.investigation.ListByRun(r.Context(), r.PathValue("runId"))
	if err != nil {
		s.writeError(w, r, http.StatusInternalServerError, "INTERNAL_ERROR", "Unable to load investigation.", nil)
		return
	}
	s.writeJSON(w, r, http.StatusOK, successResponse{Data: report, Meta: s.meta(r)})
}

func (s *server) runAlertInvestigation(w http.ResponseWriter, r *http.Request) {
	if s.investigation == nil {
		s.writeError(w, r, http.StatusServiceUnavailable, "INVESTIGATION_UNAVAILABLE", "Investigation requires PostgreSQL.", nil)
		return
	}
	actor := "system"
	if principal, ok := authz.PrincipalFromContext(r.Context()); ok && principal.ID != "" {
		actor = principal.ID
	}
	item, err := s.investigation.Rerun(r.Context(), r.PathValue("alertId"), r.PathValue("checkId"), actor)
	if errors.Is(err, investigation.ErrNotFound) {
		s.writeError(w, r, http.StatusNotFound, "INVESTIGATION_CHECK_NOT_FOUND", "Investigation check was not found.", nil)
		return
	}
	if err != nil {
		s.writeError(w, r, http.StatusInternalServerError, "INTERNAL_ERROR", "Unable to re-run investigation check.", nil)
		return
	}
	s.writeJSON(w, r, http.StatusOK, successResponse{Data: item, Meta: s.meta(r)})
}
