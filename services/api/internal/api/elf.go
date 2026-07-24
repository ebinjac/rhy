package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/rhythm-monitoring/rhythm/internal/authz"
	"github.com/rhythm-monitoring/rhythm/internal/elf"
)

func (s *server) elfAvailable(w http.ResponseWriter, r *http.Request) bool {
	if s.elf == nil {
		s.writeError(w, r, http.StatusServiceUnavailable, "ELF_UNAVAILABLE", "ELF requires persistent storage.", nil)
		return false
	}
	return true
}
func actor(r *http.Request) string {
	principal, _ := authz.PrincipalFromContext(r.Context())
	return principal.ID
}
func (s *server) elfFailure(w http.ResponseWriter, r *http.Request, err error, message string) {
	status := http.StatusUnprocessableEntity
	code := "ELF_REQUEST_FAILED"
	if errors.Is(err, elf.ErrNotFound) {
		status = http.StatusNotFound
		code = "ELF_NOT_FOUND"
	}
	if errors.Is(err, elf.ErrNotConfigured) {
		status = http.StatusPreconditionRequired
		code = "ELF_NOT_CONFIGURED"
	}
	if errors.Is(err, elf.ErrConflict) {
		status = http.StatusConflict
		code = "ELF_CONFLICT"
	}
	s.writeError(w, r, status, code, message+" "+err.Error(), nil)
}

func (s *server) listApplications(w http.ResponseWriter, r *http.Request) {
	if !s.elfAvailable(w, r) {
		return
	}
	items, err := s.elf.ListApplications(r.Context())
	if err != nil {
		s.elfFailure(w, r, err, "Unable to list applications.")
		return
	}
	s.writeJSON(w, r, http.StatusOK, successResponse{Data: items, Meta: s.meta(r)})
}
func (s *server) createApplication(w http.ResponseWriter, r *http.Request) {
	if !s.elfAvailable(w, r) {
		return
	}
	var input elf.ApplicationInput
	if decodeStrictJSON(w, r, &input) != nil {
		s.writeError(w, r, 400, "INVALID_REQUEST", "Application input is invalid.", nil)
		return
	}
	item, err := s.elf.CreateApplication(r.Context(), input, actor(r))
	if err != nil {
		s.elfFailure(w, r, err, "Unable to create application.")
		return
	}
	w.Header().Set("Location", "/api/v1/applications/"+item.ID)
	s.writeJSON(w, r, http.StatusCreated, successResponse{Data: item, Meta: s.meta(r)})
}
func (s *server) getApplication(w http.ResponseWriter, r *http.Request) {
	if !s.elfAvailable(w, r) {
		return
	}
	item, err := s.elf.GetApplication(r.Context(), r.PathValue("applicationId"))
	if err != nil {
		s.elfFailure(w, r, err, "Unable to load application.")
		return
	}
	s.writeJSON(w, r, 200, successResponse{Data: item, Meta: s.meta(r)})
}
func (s *server) updateApplication(w http.ResponseWriter, r *http.Request) {
	if !s.elfAvailable(w, r) {
		return
	}
	var input elf.ApplicationInput
	if decodeStrictJSON(w, r, &input) != nil {
		s.writeError(w, r, 400, "INVALID_REQUEST", "Application input is invalid.", nil)
		return
	}
	item, err := s.elf.UpdateApplication(r.Context(), r.PathValue("applicationId"), input, actor(r))
	if err != nil {
		s.elfFailure(w, r, err, "Unable to update application.")
		return
	}
	s.writeJSON(w, r, 200, successResponse{Data: item, Meta: s.meta(r)})
}
func (s *server) deleteApplication(w http.ResponseWriter, r *http.Request) {
	if !s.elfAvailable(w, r) {
		return
	}
	if err := s.elf.DeleteApplication(r.Context(), r.PathValue("applicationId")); err != nil {
		s.elfFailure(w, r, err, "Unable to delete application.")
		return
	}
	s.writeJSON(w, r, 200, successResponse{Data: map[string]bool{"deleted": true}, Meta: s.meta(r)})
}
func (s *server) saveApplicationService(w http.ResponseWriter, r *http.Request, serviceID string, status int) {
	if !s.elfAvailable(w, r) {
		return
	}
	var input elf.ServiceInput
	if decodeStrictJSON(w, r, &input) != nil {
		s.writeError(w, r, 400, "INVALID_REQUEST", "Service input is invalid.", nil)
		return
	}
	item, err := s.elf.SaveService(r.Context(), r.PathValue("applicationId"), serviceID, input)
	if err != nil {
		s.elfFailure(w, r, err, "Unable to save service.")
		return
	}
	s.writeJSON(w, r, status, successResponse{Data: item, Meta: s.meta(r)})
}
func (s *server) createApplicationService(w http.ResponseWriter, r *http.Request) {
	s.saveApplicationService(w, r, "", http.StatusCreated)
}
func (s *server) updateApplicationService(w http.ResponseWriter, r *http.Request) {
	s.saveApplicationService(w, r, r.PathValue("serviceId"), http.StatusOK)
}
func (s *server) deleteApplicationService(w http.ResponseWriter, r *http.Request) {
	if !s.elfAvailable(w, r) {
		return
	}
	if err := s.elf.DeleteService(r.Context(), r.PathValue("applicationId"), r.PathValue("serviceId")); err != nil {
		s.elfFailure(w, r, err, "Unable to delete service.")
		return
	}
	s.writeJSON(w, r, 200, successResponse{Data: map[string]bool{"deleted": true}, Meta: s.meta(r)})
}
func (s *server) linkApplicationMonitor(w http.ResponseWriter, r *http.Request) {
	s.applicationMonitorLink(w, r, true)
}
func (s *server) unlinkApplicationMonitor(w http.ResponseWriter, r *http.Request) {
	s.applicationMonitorLink(w, r, false)
}
func (s *server) applicationMonitorLink(w http.ResponseWriter, r *http.Request, link bool) {
	if !s.elfAvailable(w, r) {
		return
	}
	if err := s.elf.LinkMonitor(r.Context(), r.PathValue("applicationId"), r.PathValue("monitorId"), link); err != nil {
		s.elfFailure(w, r, err, "Unable to update monitor link.")
		return
	}
	s.writeJSON(w, r, 200, successResponse{Data: map[string]bool{"linked": link}, Meta: s.meta(r)})
}

func (s *server) getELFSettings(w http.ResponseWriter, r *http.Request) {
	if !s.elfAvailable(w, r) {
		return
	}
	item, err := s.elf.GetSettings(r.Context())
	if err != nil {
		s.elfFailure(w, r, err, "Unable to load ELF settings.")
		return
	}
	s.writeJSON(w, r, 200, successResponse{Data: item, Meta: s.meta(r)})
}
func (s *server) saveELFSettings(w http.ResponseWriter, r *http.Request) {
	if !s.elfAvailable(w, r) {
		return
	}
	var input elf.Settings
	if decodeStrictJSON(w, r, &input) != nil {
		s.writeError(w, r, 400, "INVALID_REQUEST", "ELF settings are invalid.", nil)
		return
	}
	item, err := s.elf.SaveSettings(r.Context(), input, actor(r))
	if err != nil {
		s.elfFailure(w, r, err, "Unable to save ELF settings.")
		return
	}
	s.writeJSON(w, r, 200, successResponse{Data: item, Meta: s.meta(r)})
}
func (s *server) testELFSettings(w http.ResponseWriter, r *http.Request) {
	if !s.elfAvailable(w, r) {
		return
	}
	var input *elf.Settings
	if r.ContentLength > 0 {
		var value elf.Settings
		if decodeStrictJSON(w, r, &value) != nil {
			s.writeError(w, r, 400, "INVALID_REQUEST", "ELF settings are invalid.", nil)
			return
		}
		input = &value
	}
	item, err := s.elf.TestSettings(r.Context(), input)
	if err != nil {
		s.elfFailure(w, r, err, "Unable to test ELF settings.")
		return
	}
	s.writeJSON(w, r, 200, successResponse{Data: item, Meta: s.meta(r)})
}

func (s *server) listELFQueries(w http.ResponseWriter, r *http.Request) {
	if !s.elfAvailable(w, r) {
		return
	}
	items, err := s.elf.ListQueries(r.Context())
	if err != nil {
		s.elfFailure(w, r, err, "Unable to list ELF queries.")
		return
	}
	s.writeJSON(w, r, 200, successResponse{Data: items, Meta: s.meta(r)})
}
func (s *server) createELFQuery(w http.ResponseWriter, r *http.Request) {
	s.saveELFQuery(w, r, "", http.StatusCreated)
}
func (s *server) updateELFQuery(w http.ResponseWriter, r *http.Request) {
	s.saveELFQuery(w, r, r.PathValue("queryId"), http.StatusOK)
}
func (s *server) saveELFQuery(w http.ResponseWriter, r *http.Request, queryID string, status int) {
	if !s.elfAvailable(w, r) {
		return
	}
	var input elf.QueryInput
	if decodeStrictJSON(w, r, &input) != nil {
		s.writeError(w, r, 400, "INVALID_REQUEST", "ELF query input is invalid.", nil)
		return
	}
	item, err := s.elf.SaveQuery(r.Context(), queryID, input, actor(r))
	if err != nil {
		s.elfFailure(w, r, err, "Unable to save ELF query.")
		return
	}
	w.Header().Set("Location", "/api/v1/elf/queries/"+item.ID)
	s.writeJSON(w, r, status, successResponse{Data: item, Meta: s.meta(r)})
}
func (s *server) getELFQuery(w http.ResponseWriter, r *http.Request) {
	if !s.elfAvailable(w, r) {
		return
	}
	item, err := s.elf.GetQuery(r.Context(), r.PathValue("queryId"))
	if err != nil {
		s.elfFailure(w, r, err, "Unable to load ELF query.")
		return
	}
	s.writeJSON(w, r, 200, successResponse{Data: item, Meta: s.meta(r)})
}
func (s *server) deleteELFQuery(w http.ResponseWriter, r *http.Request) {
	if !s.elfAvailable(w, r) {
		return
	}
	if err := s.elf.DeleteQuery(r.Context(), r.PathValue("queryId")); err != nil {
		s.elfFailure(w, r, err, "Unable to delete ELF query.")
		return
	}
	s.writeJSON(w, r, 200, successResponse{Data: map[string]bool{"deleted": true}, Meta: s.meta(r)})
}
func (s *server) bulkDeleteELFQueries(w http.ResponseWriter, r *http.Request) {
	if !s.elfAvailable(w, r) {
		return
	}
	var input struct {
		QueryIDs []string `json:"queryIds"`
	}
	if decodeStrictJSON(w, r, &input) != nil {
		s.writeError(w, r, http.StatusBadRequest, "INVALID_REQUEST", "ELF query deletion input is invalid.", nil)
		return
	}
	deletedCount, err := s.elf.DeleteQueries(r.Context(), input.QueryIDs)
	if err != nil {
		s.elfFailure(w, r, err, "Unable to delete the selected ELF queries.")
		return
	}
	s.writeJSON(w, r, http.StatusOK, successResponse{Data: map[string]int64{"deletedCount": deletedCount}, Meta: s.meta(r)})
}
func (s *server) validateELFQuery(w http.ResponseWriter, r *http.Request) {
	if !s.elfAvailable(w, r) {
		return
	}
	now := time.Now().UTC()
	result, err := s.elf.ValidateQuery(r.Context(), r.PathValue("queryId"), now.Add(-15*time.Minute), now)
	if err != nil {
		s.elfFailure(w, r, err, "Unable to validate ELF query.")
		return
	}
	s.writeJSON(w, r, 200, successResponse{Data: result, Meta: s.meta(r)})
}
func (s *server) probeELFQuery(w http.ResponseWriter, r *http.Request) {
	s.executeELFQuery(w, r, false)
}
func (s *server) testELFQuery(w http.ResponseWriter, r *http.Request) { s.executeELFQuery(w, r, true) }
func (s *server) executeELFQuery(w http.ResponseWriter, r *http.Request, evaluate bool) {
	if !s.elfAvailable(w, r) {
		return
	}
	var input elf.ProbeInput
	if r.ContentLength > 0 && decodeStrictJSON(w, r, &input) != nil {
		s.writeError(w, r, 400, "INVALID_REQUEST", "ELF execution input is invalid.", nil)
		return
	}
	item, err := s.elf.Run(r.Context(), r.PathValue("queryId"), actor(r), input, evaluate)
	if err != nil {
		s.elfFailure(w, r, err, "Unable to execute ELF query.")
		return
	}
	s.writeJSON(w, r, 200, successResponse{Data: item, Meta: s.meta(r)})
}
func (s *server) validateELFCheck(w http.ResponseWriter, r *http.Request) {
	var input struct {
		SearchBody json.RawMessage `json:"searchBody"`
		TimeField  string          `json:"timeField"`
	}
	if decodeStrictJSON(w, r, &input) != nil {
		s.writeError(w, r, 400, "INVALID_REQUEST", "ELF check draft is invalid.", nil)
		return
	}
	if input.TimeField == "" {
		input.TimeField = "@timestamp"
	}
	now := time.Now().UTC()
	result := elf.ValidateAndCompile(input.SearchBody, input.TimeField, now.Add(-15*time.Minute), now, 100)
	s.writeJSON(w, r, 200, successResponse{Data: result, Meta: s.meta(r)})
}
func (s *server) closeELFSearchSession(w http.ResponseWriter, r *http.Request) {
	s.writeJSON(w, r, 200, successResponse{Data: map[string]any{"closed": true, "sessionId": r.PathValue("sessionId")}, Meta: s.meta(r)})
}
func (s *server) listELFRuns(w http.ResponseWriter, r *http.Request) {
	if !s.elfAvailable(w, r) {
		return
	}
	items, err := s.elf.ListRuns(r.Context())
	if err != nil {
		s.elfFailure(w, r, err, "Unable to list ELF runs.")
		return
	}
	s.writeJSON(w, r, 200, successResponse{Data: items, Meta: s.meta(r)})
}
func (s *server) getELFRun(w http.ResponseWriter, r *http.Request) {
	if !s.elfAvailable(w, r) {
		return
	}
	item, err := s.elf.GetRun(r.Context(), r.PathValue("runId"))
	if err != nil {
		s.elfFailure(w, r, err, "Unable to load ELF run.")
		return
	}
	s.writeJSON(w, r, 200, successResponse{Data: item, Meta: s.meta(r)})
}
