package api

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/rhythm-monitoring/rhythm/internal/agents"
	"github.com/rhythm-monitoring/rhythm/internal/alerts"
	"github.com/rhythm-monitoring/rhythm/internal/audit"
	"github.com/rhythm-monitoring/rhythm/internal/authz"
	"github.com/rhythm-monitoring/rhythm/internal/elf"
	"github.com/rhythm-monitoring/rhythm/internal/id"
	"github.com/rhythm-monitoring/rhythm/internal/library"
	"github.com/rhythm-monitoring/rhythm/internal/monitors"
	"github.com/rhythm-monitoring/rhythm/internal/notifications"
	"github.com/rhythm-monitoring/rhythm/internal/runs"
	"github.com/rhythm-monitoring/rhythm/internal/scheduler"
	"github.com/rhythm-monitoring/rhythm/internal/scripts"
	"github.com/rhythm-monitoring/rhythm/internal/suites"
)

type Dependencies struct {
	Logger              *slog.Logger
	Monitors            *monitors.Service
	Runs                *runs.Service
	Scheduler           *scheduler.Service
	Alerts              *alerts.Service
	Audit               *audit.Service
	Library             *library.Service
	Suites              *suites.Service
	Agents              *agents.Service
	Notifications       *notifications.Service
	Scripts             *scripts.Client
	ELF                 *elf.Service
	Authenticator       authz.Authenticator
	AllowedOrigin       string
	AllowPrivateTargets bool
	Checks              map[string]func(context.Context) error
}

type server struct {
	logger              *slog.Logger
	monitors            *monitors.Service
	runs                *runs.Service
	scheduler           *scheduler.Service
	alerts              *alerts.Service
	audit               *audit.Service
	library             *library.Service
	suites              *suites.Service
	agents              *agents.Service
	notifications       *notifications.Service
	scripts             *scripts.Client
	elf                 *elf.Service
	authenticator       authz.Authenticator
	allowedOrigin       string
	allowPrivateTargets bool
	checks              map[string]func(context.Context) error
	webhookMu           sync.Mutex
	webhookLimits       map[string]*webhookRateWindow
}

type responseMeta struct {
	RequestID string `json:"requestId"`
}

type successResponse struct {
	Data any          `json:"data"`
	Meta responseMeta `json:"meta"`
}

type errorBody struct {
	Code    string `json:"code"`
	Message string `json:"message"`
	Details any    `json:"details,omitempty"`
}

type errorResponse struct {
	Error errorBody    `json:"error"`
	Meta  responseMeta `json:"meta"`
}

type requestIDContextKey struct{}

func NewServer(dependencies Dependencies) http.Handler {
	s := &server{logger: dependencies.Logger, monitors: dependencies.Monitors, runs: dependencies.Runs, scheduler: dependencies.Scheduler, alerts: dependencies.Alerts, audit: dependencies.Audit, library: dependencies.Library, suites: dependencies.Suites, agents: dependencies.Agents, notifications: dependencies.Notifications, scripts: dependencies.Scripts, elf: dependencies.ELF, authenticator: dependencies.Authenticator, allowedOrigin: dependencies.AllowedOrigin, allowPrivateTargets: dependencies.AllowPrivateTargets, checks: dependencies.Checks, webhookLimits: map[string]*webhookRateWindow{}}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", s.health)
	mux.HandleFunc("GET /api/v1/monitors", s.listMonitors)
	mux.HandleFunc("POST /api/v1/monitors", s.createMonitor)
	mux.HandleFunc("POST /api/v1/monitors/bulk-delete", s.bulkDeleteMonitors)
	mux.HandleFunc("GET /api/v1/monitors/{monitorId}", s.getMonitor)
	mux.HandleFunc("PATCH /api/v1/monitors/{monitorId}", s.updateMonitor)
	mux.HandleFunc("DELETE /api/v1/monitors/{monitorId}", s.deleteMonitor)
	mux.HandleFunc("PUT /api/v1/monitors/{monitorId}/draft", s.saveMonitorDraft)
	mux.HandleFunc("POST /api/v1/monitors/{monitorId}/clone", s.cloneMonitor)
	mux.HandleFunc("POST /api/v1/monitors/{monitorId}/validate", s.validateMonitor)
	mux.HandleFunc("POST /api/v1/monitors/{monitorId}/publish", s.publishMonitor)
	mux.HandleFunc("POST /api/v1/monitors/{monitorId}/enable", s.enableMonitor)
	mux.HandleFunc("POST /api/v1/monitors/{monitorId}/disable", s.disableMonitor)
	mux.HandleFunc("POST /api/v1/monitors/{monitorId}/archive", s.archiveMonitor)
	mux.HandleFunc("POST /api/v1/monitors/{monitorId}/restore", s.restoreMonitor)
	mux.HandleFunc("GET /api/v1/monitors/{monitorId}/schedule", s.getMonitorSchedule)
	mux.HandleFunc("PUT /api/v1/monitors/{monitorId}/schedule", s.configureMonitorSchedule)
	mux.HandleFunc("GET /api/v1/monitors/{monitorId}/revisions", s.listMonitorRevisions)
	mux.HandleFunc("GET /api/v1/monitors/{monitorId}/revisions/{revisionId}", s.getMonitorRevision)
	mux.HandleFunc("POST /api/v1/scripts/validate", s.validateScript)
	mux.HandleFunc("POST /api/v1/monitors/{monitorId}/revisions/{revisionId}/scripts/preview", s.previewScript)
	mux.HandleFunc("POST /api/v1/monitors/{monitorId}/revisions/{revisionId}/restore", s.restoreMonitorRevision)
	mux.HandleFunc("GET /api/v1/monitors/{monitorId}/diff", s.diffMonitorRevisions)
	mux.HandleFunc("GET /api/v1/monitors/{monitorId}/export", s.exportMonitor)
	mux.HandleFunc("POST /api/v1/monitors/{monitorId}/runs", s.runMonitor)
	mux.HandleFunc("GET /api/v1/monitors/{monitorId}/runs", s.listMonitorRuns)
	mux.HandleFunc("GET /api/v1/monitors/{monitorId}/metrics", s.getMonitorMetrics)
	mux.HandleFunc("GET /api/v1/runs/{runId}", s.getRun)
	mux.HandleFunc("GET /api/v1/runs/{runId}/diagnostics", s.getRunDiagnostics)
	mux.HandleFunc("POST /api/v1/runs/{runId}/cancel", s.cancelRun)
	mux.HandleFunc("GET /api/v1/runs", s.listRecentRuns)
	mux.HandleFunc("GET /api/v1/alerts", s.listAlerts)
	mux.HandleFunc("GET /api/v1/alerts/{alertId}", s.getAlert)
	mux.HandleFunc("GET /api/v1/alerts/{alertId}/events", s.listAlertEvents)
	mux.HandleFunc("POST /api/v1/alerts/{alertId}/acknowledge", s.acknowledgeAlert)
	mux.HandleFunc("POST /api/v1/alerts/{alertId}/resolve", s.resolveAlert)
	mux.HandleFunc("PUT /api/v1/monitors/{monitorId}/alert-policy", s.saveAlertPolicy)
	mux.HandleFunc("GET /api/v1/audit-events", s.listAuditEvents)
	mux.HandleFunc("GET /api/v1/config/{kind}", s.listConfigurationProfiles)
	mux.HandleFunc("POST /api/v1/config/{kind}", s.createConfigurationProfile)
	mux.HandleFunc("DELETE /api/v1/config/{kind}/{profileId}", s.deleteConfigurationProfile)
	mux.HandleFunc("GET /api/v1/suites", s.listSuites)
	mux.HandleFunc("POST /api/v1/suites", s.createSuite)
	mux.HandleFunc("GET /api/v1/suites/{suiteId}", s.getSuite)
	mux.HandleFunc("PATCH /api/v1/suites/{suiteId}", s.updateSuite)
	mux.HandleFunc("DELETE /api/v1/suites/{suiteId}", s.deleteSuite)
	mux.HandleFunc("POST /api/v1/suites/{suiteId}/runs", s.runSuite)
	mux.HandleFunc("GET /api/v1/suite-runs/{suiteRunId}", s.getSuiteRun)
	mux.HandleFunc("POST /api/v1/suite-runs/{suiteRunId}/cancel", s.cancelSuiteRun)
	mux.HandleFunc("POST /api/v1/suites/{suiteId}/deployment-runs", s.createDeploymentRun)
	mux.HandleFunc("GET /api/v1/deployment-runs", s.listDeploymentRuns)
	mux.HandleFunc("GET /api/v1/deployment-runs/{deploymentRunId}", s.getDeploymentRun)
	mux.HandleFunc("POST /api/v1/deployment-runs/{deploymentRunId}/cancel", s.cancelDeploymentRun)
	mux.HandleFunc("GET /api/v1/deployment-runs/{deploymentRunId}/report.json", s.downloadDeploymentReportJSON)
	mux.HandleFunc("GET /api/v1/deployment-runs/{deploymentRunId}/report.pdf", s.downloadDeploymentReportPDF)
	mux.HandleFunc("GET /api/v1/agents", s.listAgents)
	mux.HandleFunc("POST /api/v1/agents/register", s.registerAgent)
	mux.HandleFunc("POST /api/v1/agents/{agentId}/heartbeat", s.heartbeatAgent)
	mux.HandleFunc("POST /api/v1/agents/{agentId}/drain", s.drainAgent)
	mux.HandleFunc("POST /api/v1/agents/{agentId}/activate", s.activateAgent)
	mux.HandleFunc("POST /api/v1/agents/{agentId}/revoke", s.revokeAgent)
	mux.HandleFunc("GET /api/v1/notification-deliveries", s.listNotificationDeliveries)
	mux.HandleFunc("GET /api/v1/applications", s.listApplications)
	mux.HandleFunc("POST /api/v1/applications", s.createApplication)
	mux.HandleFunc("GET /api/v1/applications/{applicationId}", s.getApplication)
	mux.HandleFunc("PATCH /api/v1/applications/{applicationId}", s.updateApplication)
	mux.HandleFunc("DELETE /api/v1/applications/{applicationId}", s.deleteApplication)
	mux.HandleFunc("POST /api/v1/applications/{applicationId}/services", s.createApplicationService)
	mux.HandleFunc("PATCH /api/v1/applications/{applicationId}/services/{serviceId}", s.updateApplicationService)
	mux.HandleFunc("DELETE /api/v1/applications/{applicationId}/services/{serviceId}", s.deleteApplicationService)
	mux.HandleFunc("PUT /api/v1/applications/{applicationId}/monitors/{monitorId}", s.linkApplicationMonitor)
	mux.HandleFunc("DELETE /api/v1/applications/{applicationId}/monitors/{monitorId}", s.unlinkApplicationMonitor)
	mux.HandleFunc("GET /api/v1/applications/{applicationId}/opensearch-alert-receivers", s.listOpenSearchAlertReceivers)
	mux.HandleFunc("POST /api/v1/applications/{applicationId}/opensearch-alert-receivers", s.createOpenSearchAlertReceiver)
	mux.HandleFunc("GET /api/v1/opensearch-alert-receivers", s.listAllOpenSearchAlertReceivers)
	mux.HandleFunc("GET /api/v1/opensearch-alert-receivers/{receiverId}", s.getOpenSearchAlertReceiver)
	mux.HandleFunc("PATCH /api/v1/opensearch-alert-receivers/{receiverId}", s.updateOpenSearchAlertReceiver)
	mux.HandleFunc("DELETE /api/v1/opensearch-alert-receivers/{receiverId}", s.deleteOpenSearchAlertReceiver)
	mux.HandleFunc("POST /api/v1/opensearch-alert-receivers/{receiverId}/rotate-token", s.rotateOpenSearchAlertReceiverToken)
	mux.HandleFunc("GET /api/v1/opensearch-alert-receivers/{receiverId}/setup-template", s.getOpenSearchAlertReceiverSetup)
	mux.HandleFunc("POST /api/v1/opensearch-alert-receivers/{receiverId}/test", s.testOpenSearchAlertReceiver)
	mux.HandleFunc("POST /api/v1/opensearch-alert-receivers/{receiverId}/reconcile", s.reconcileOpenSearchAlertReceiver)
	mux.HandleFunc("GET /api/v1/opensearch-alert-receivers/{receiverId}/deliveries", s.listOpenSearchAlertDeliveries)
	mux.HandleFunc("POST /hooks/v1/opensearch-alerting/{receiverId}", s.receiveOpenSearchAlert)
	mux.HandleFunc("GET /api/v1/elf/settings", s.getELFSettings)
	mux.HandleFunc("PUT /api/v1/elf/settings", s.saveELFSettings)
	mux.HandleFunc("POST /api/v1/elf/settings/test", s.testELFSettings)
	mux.HandleFunc("GET /api/v1/elf/queries", s.listELFQueries)
	mux.HandleFunc("POST /api/v1/elf/queries", s.createELFQuery)
	mux.HandleFunc("POST /api/v1/elf/queries/bulk-delete", s.bulkDeleteELFQueries)
	mux.HandleFunc("GET /api/v1/elf/queries/{queryId}", s.getELFQuery)
	mux.HandleFunc("PATCH /api/v1/elf/queries/{queryId}", s.updateELFQuery)
	mux.HandleFunc("DELETE /api/v1/elf/queries/{queryId}", s.deleteELFQuery)
	mux.HandleFunc("POST /api/v1/elf/queries/{queryId}/validate", s.validateELFQuery)
	mux.HandleFunc("POST /api/v1/elf/queries/{queryId}/probe", s.probeELFQuery)
	mux.HandleFunc("POST /api/v1/elf/queries/{queryId}/test", s.testELFQuery)
	mux.HandleFunc("POST /api/v1/elf/queries/{queryId}/validate-check", s.validateELFCheck)
	mux.HandleFunc("DELETE /api/v1/elf/search-sessions/{sessionId}", s.closeELFSearchSession)
	mux.HandleFunc("GET /api/v1/elf/runs", s.listELFRuns)
	mux.HandleFunc("GET /api/v1/elf/runs/{runId}", s.getELFRun)
	return s.recoverPanic(s.logRequest(s.cors(s.requestID(s.authenticate(s.authorize(s.auditMutations(mux)))))))
}

func (s *server) health(w http.ResponseWriter, r *http.Request) {
	status := http.StatusOK
	components := make(map[string]string, len(s.checks))
	checkContext, cancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer cancel()
	for name, check := range s.checks {
		if err := check(checkContext); err != nil {
			components[name] = "unavailable"
			status = http.StatusServiceUnavailable
		} else {
			components[name] = "ok"
		}
	}
	overall := "ok"
	if status != http.StatusOK {
		overall = "degraded"
	}
	s.writeJSON(w, r, status, successResponse{Data: map[string]any{"status": overall, "service": "rhythm-api", "components": components}, Meta: s.meta(r)})
}

func (s *server) listSuites(w http.ResponseWriter, r *http.Request) {
	if s.suites == nil {
		s.writeError(w, r, http.StatusServiceUnavailable, "SUITES_UNAVAILABLE", "Validation suites require persistent storage.", nil)
		return
	}
	items, err := s.suites.List(r.Context())
	if err != nil {
		s.writeError(w, r, http.StatusInternalServerError, "INTERNAL_ERROR", "Unable to list validation suites.", nil)
		return
	}
	s.writeJSON(w, r, http.StatusOK, successResponse{Data: items, Meta: s.meta(r)})
}

func (s *server) listAgents(w http.ResponseWriter, r *http.Request) {
	if s.agents == nil {
		s.writeError(w, r, http.StatusServiceUnavailable, "AGENTS_UNAVAILABLE", "Execution agents are unavailable.", nil)
		return
	}
	items, err := s.agents.List(r.Context())
	if err != nil {
		s.writeError(w, r, http.StatusInternalServerError, "INTERNAL_ERROR", "Unable to list execution agents.", nil)
		return
	}
	s.writeJSON(w, r, http.StatusOK, successResponse{Data: items, Meta: s.meta(r)})
}

func (s *server) listNotificationDeliveries(w http.ResponseWriter, r *http.Request) {
	if s.notifications == nil {
		s.writeError(w, r, http.StatusServiceUnavailable, "NOTIFICATIONS_UNAVAILABLE", "Notification delivery history is unavailable.", nil)
		return
	}
	items, err := s.notifications.List(r.Context())
	if err != nil {
		s.writeError(w, r, http.StatusInternalServerError, "INTERNAL_ERROR", "Unable to list notification deliveries.", nil)
		return
	}
	s.writeJSON(w, r, http.StatusOK, successResponse{Data: items, Meta: s.meta(r)})
}

func (s *server) registerAgent(w http.ResponseWriter, r *http.Request) {
	if s.agents == nil {
		s.writeError(w, r, http.StatusServiceUnavailable, "AGENTS_UNAVAILABLE", "Execution agents are unavailable.", nil)
		return
	}
	var input agents.RegisterInput
	if err := decodeStrictJSON(w, r, &input); err != nil {
		s.writeError(w, r, http.StatusBadRequest, "INVALID_REQUEST", "Request body is invalid.", nil)
		return
	}
	item, err := s.agents.Register(r.Context(), input)
	if err != nil {
		s.writeError(w, r, http.StatusUnprocessableEntity, "AGENT_VALIDATION_FAILED", err.Error(), nil)
		return
	}
	w.Header().Set("Location", "/api/v1/agents/"+item.ID)
	s.writeJSON(w, r, http.StatusCreated, successResponse{Data: item, Meta: s.meta(r)})
}

func (s *server) heartbeatAgent(w http.ResponseWriter, r *http.Request) {
	if s.agents == nil {
		s.writeError(w, r, http.StatusServiceUnavailable, "AGENTS_UNAVAILABLE", "Execution agents are unavailable.", nil)
		return
	}
	var input agents.HeartbeatInput
	if err := decodeStrictJSON(w, r, &input); err != nil {
		s.writeError(w, r, http.StatusBadRequest, "INVALID_REQUEST", "Request body is invalid.", nil)
		return
	}
	item, err := s.agents.Heartbeat(r.Context(), r.PathValue("agentId"), input)
	if errors.Is(err, agents.ErrNotFound) {
		s.writeError(w, r, http.StatusNotFound, "AGENT_NOT_FOUND", "Execution agent was not found or has been revoked.", nil)
		return
	}
	if err != nil {
		s.writeError(w, r, http.StatusUnprocessableEntity, "AGENT_HEARTBEAT_REJECTED", err.Error(), nil)
		return
	}
	s.writeJSON(w, r, http.StatusOK, successResponse{Data: item, Meta: s.meta(r)})
}

func (s *server) drainAgent(w http.ResponseWriter, r *http.Request) {
	s.changeAgentStatus(w, r, "DRAINING")
}
func (s *server) activateAgent(w http.ResponseWriter, r *http.Request) {
	s.changeAgentStatus(w, r, "ACTIVE")
}
func (s *server) revokeAgent(w http.ResponseWriter, r *http.Request) {
	s.changeAgentStatus(w, r, "REVOKED")
}
func (s *server) changeAgentStatus(w http.ResponseWriter, r *http.Request, status string) {
	if s.agents == nil {
		s.writeError(w, r, http.StatusServiceUnavailable, "AGENTS_UNAVAILABLE", "Execution agents are unavailable.", nil)
		return
	}
	item, err := s.agents.SetStatus(r.Context(), r.PathValue("agentId"), status)
	if errors.Is(err, agents.ErrNotFound) {
		s.writeError(w, r, http.StatusNotFound, "AGENT_NOT_FOUND", "Execution agent was not found.", nil)
		return
	}
	if err != nil {
		s.writeError(w, r, http.StatusConflict, "AGENT_STATE_CHANGE_FAILED", err.Error(), nil)
		return
	}
	s.writeJSON(w, r, http.StatusOK, successResponse{Data: item, Meta: s.meta(r)})
}

func (s *server) createSuite(w http.ResponseWriter, r *http.Request) {
	if s.suites == nil {
		s.writeError(w, r, http.StatusServiceUnavailable, "SUITES_UNAVAILABLE", "Validation suites are unavailable.", nil)
		return
	}
	var input suites.Input
	if err := decodeStrictJSON(w, r, &input); err != nil {
		s.writeError(w, r, http.StatusBadRequest, "INVALID_REQUEST", "Request body is invalid.", nil)
		return
	}
	principal, _ := authz.PrincipalFromContext(r.Context())
	item, err := s.suites.Create(r.Context(), input, principal.ID)
	if err != nil {
		s.writeError(w, r, http.StatusUnprocessableEntity, "SUITE_VALIDATION_FAILED", err.Error(), nil)
		return
	}
	w.Header().Set("Location", "/api/v1/suites/"+item.ID)
	s.writeJSON(w, r, http.StatusCreated, successResponse{Data: item, Meta: s.meta(r)})
}

func (s *server) getSuite(w http.ResponseWriter, r *http.Request) {
	if s.suites == nil {
		s.writeError(w, r, http.StatusServiceUnavailable, "SUITES_UNAVAILABLE", "Validation suites are unavailable.", nil)
		return
	}
	item, err := s.suites.Get(r.Context(), r.PathValue("suiteId"))
	if errors.Is(err, suites.ErrNotFound) {
		s.writeError(w, r, http.StatusNotFound, "SUITE_NOT_FOUND", "Validation suite was not found.", nil)
		return
	}
	if err != nil {
		s.writeError(w, r, http.StatusInternalServerError, "INTERNAL_ERROR", "Unable to load validation suite.", nil)
		return
	}
	s.writeJSON(w, r, http.StatusOK, successResponse{Data: item, Meta: s.meta(r)})
}

func (s *server) updateSuite(w http.ResponseWriter, r *http.Request) {
	if s.suites == nil {
		s.writeError(w, r, http.StatusServiceUnavailable, "SUITES_UNAVAILABLE", "Validation suites are unavailable.", nil)
		return
	}
	var input suites.Input
	if err := decodeStrictJSON(w, r, &input); err != nil {
		s.writeError(w, r, http.StatusBadRequest, "INVALID_REQUEST", "Request body is invalid.", nil)
		return
	}
	principal, _ := authz.PrincipalFromContext(r.Context())
	item, err := s.suites.Update(r.Context(), r.PathValue("suiteId"), input, principal.ID)
	if errors.Is(err, suites.ErrNotFound) {
		s.writeError(w, r, http.StatusNotFound, "SUITE_NOT_FOUND", "Validation suite was not found.", nil)
		return
	}
	if err != nil {
		s.writeError(w, r, http.StatusUnprocessableEntity, "SUITE_VALIDATION_FAILED", err.Error(), nil)
		return
	}
	s.writeJSON(w, r, http.StatusOK, successResponse{Data: item, Meta: s.meta(r)})
}

func (s *server) deleteSuite(w http.ResponseWriter, r *http.Request) {
	if s.suites == nil {
		s.writeError(w, r, http.StatusServiceUnavailable, "SUITES_UNAVAILABLE", "Validation suites are unavailable.", nil)
		return
	}
	err := s.suites.Delete(r.Context(), r.PathValue("suiteId"))
	if errors.Is(err, suites.ErrNotFound) {
		s.writeError(w, r, http.StatusNotFound, "SUITE_NOT_FOUND", "Validation suite was not found.", nil)
		return
	}
	if err != nil {
		s.writeError(w, r, http.StatusInternalServerError, "INTERNAL_ERROR", "Unable to delete validation suite.", nil)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *server) runSuite(w http.ResponseWriter, r *http.Request) {
	if s.suites == nil {
		s.writeError(w, r, http.StatusServiceUnavailable, "SUITES_UNAVAILABLE", "Validation suites are unavailable.", nil)
		return
	}
	var input suites.RunInput
	if r.ContentLength != 0 {
		if err := decodeStrictJSON(w, r, &input); err != nil {
			s.writeError(w, r, http.StatusBadRequest, "INVALID_REQUEST", "Request body is invalid.", nil)
			return
		}
	}
	principal, _ := authz.PrincipalFromContext(r.Context())
	item, err := s.suites.RunWithInput(r.Context(), r.PathValue("suiteId"), principal.ID, input)
	if errors.Is(err, suites.ErrNotFound) {
		s.writeError(w, r, http.StatusNotFound, "SUITE_NOT_FOUND", "Validation suite was not found.", nil)
		return
	}
	if err != nil {
		s.writeError(w, r, http.StatusInternalServerError, "SUITE_RUN_FAILED", "Unable to run validation suite.", nil)
		return
	}
	s.writeJSON(w, r, http.StatusCreated, successResponse{Data: item, Meta: s.meta(r)})
}

func (s *server) getSuiteRun(w http.ResponseWriter, r *http.Request) {
	if s.suites == nil {
		s.writeError(w, r, http.StatusServiceUnavailable, "SUITES_UNAVAILABLE", "Validation suites are unavailable.", nil)
		return
	}
	item, err := s.suites.GetRun(r.Context(), r.PathValue("suiteRunId"))
	if errors.Is(err, suites.ErrNotFound) {
		s.writeError(w, r, http.StatusNotFound, "SUITE_RUN_NOT_FOUND", "Validation suite run was not found.", nil)
		return
	}
	if err != nil {
		s.writeError(w, r, http.StatusInternalServerError, "INTERNAL_ERROR", "Unable to load validation suite run.", nil)
		return
	}
	s.writeJSON(w, r, http.StatusOK, successResponse{Data: item, Meta: s.meta(r)})
}

func (s *server) cancelSuiteRun(w http.ResponseWriter, r *http.Request) {
	if s.suites == nil {
		s.writeError(w, r, http.StatusServiceUnavailable, "SUITES_UNAVAILABLE", "Validation suites are unavailable.", nil)
		return
	}
	if !s.suites.Cancel(r.PathValue("suiteRunId")) {
		s.writeError(w, r, http.StatusConflict, "SUITE_RUN_NOT_RUNNING", "Validation suite run is not active on this API instance.", nil)
		return
	}
	s.writeJSON(w, r, http.StatusAccepted, successResponse{Data: map[string]any{"id": r.PathValue("suiteRunId"), "status": "CANCELLING"}, Meta: s.meta(r)})
}

func decodeStrictJSON(w http.ResponseWriter, r *http.Request, target any) error {
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return err
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return errors.New("request body must contain one JSON object")
	}
	return nil
}

func (s *server) listMonitors(w http.ResponseWriter, r *http.Request) {
	items, err := s.monitors.List(r.Context())
	if err != nil {
		s.writeError(w, r, http.StatusInternalServerError, "INTERNAL_ERROR", "Unable to list monitors.", nil)
		return
	}
	s.writeJSON(w, r, http.StatusOK, successResponse{Data: items, Meta: s.meta(r)})
}

func (s *server) getMonitor(w http.ResponseWriter, r *http.Request) {
	monitor, err := s.monitors.Get(r.Context(), r.PathValue("monitorId"))
	if errors.Is(err, monitors.ErrNotFound) {
		s.writeError(w, r, http.StatusNotFound, "MONITOR_NOT_FOUND", "Monitor was not found.", nil)
		return
	}
	if err != nil {
		s.writeError(w, r, http.StatusInternalServerError, "INTERNAL_ERROR", "Unable to load the monitor.", nil)
		return
	}
	w.Header().Set("ETag", monitorETag(monitor))
	s.writeJSON(w, r, http.StatusOK, successResponse{Data: monitor, Meta: s.meta(r)})
}

func (s *server) createMonitor(w http.ResponseWriter, r *http.Request) {
	var input monitors.CreateInput
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&input); err != nil {
		s.writeError(w, r, http.StatusBadRequest, "INVALID_REQUEST", "Request body is invalid.", nil)
		return
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		s.writeError(w, r, http.StatusBadRequest, "INVALID_REQUEST", "Request body must contain exactly one JSON object.", nil)
		return
	}
	principal, _ := authz.PrincipalFromContext(r.Context())
	monitor, err := s.monitors.Create(r.Context(), input, principal.ID)
	var validationError monitors.ValidationError
	if errors.As(err, &validationError) {
		s.writeError(w, r, http.StatusUnprocessableEntity, "MONITOR_VALIDATION_FAILED", validationError.Error(), validationError)
		return
	}
	if err != nil {
		s.writeError(w, r, http.StatusInternalServerError, "INTERNAL_ERROR", "Unable to create the monitor.", nil)
		return
	}
	w.Header().Set("Location", "/api/v1/monitors/"+monitor.ID)
	s.writeJSON(w, r, http.StatusCreated, successResponse{Data: monitor, Meta: s.meta(r)})
}

func (s *server) updateMonitor(w http.ResponseWriter, r *http.Request) {
	expectedUpdatedAt, err := parseIfMatch(r.Header.Get("If-Match"))
	if err != nil {
		s.writeError(w, r, http.StatusPreconditionRequired, "PRECONDITION_REQUIRED", "A valid If-Match monitor ETag is required.", nil)
		return
	}
	var input monitors.UpdateInput
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&input); err != nil {
		s.writeError(w, r, http.StatusBadRequest, "INVALID_REQUEST", "Request body is invalid.", nil)
		return
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		s.writeError(w, r, http.StatusBadRequest, "INVALID_REQUEST", "Request body must contain exactly one JSON object.", nil)
		return
	}
	principal, _ := authz.PrincipalFromContext(r.Context())
	monitor, err := s.monitors.Update(r.Context(), r.PathValue("monitorId"), input, principal.ID, expectedUpdatedAt)
	var validationError monitors.ValidationError
	switch {
	case errors.As(err, &validationError):
		s.writeError(w, r, http.StatusUnprocessableEntity, "MONITOR_VALIDATION_FAILED", validationError.Error(), validationError)
		return
	case errors.Is(err, monitors.ErrNotFound):
		s.writeError(w, r, http.StatusNotFound, "MONITOR_NOT_FOUND", "Monitor was not found.", nil)
		return
	case errors.Is(err, monitors.ErrPreconditionFailed):
		s.writeError(w, r, http.StatusPreconditionFailed, "MONITOR_VERSION_CONFLICT", "The monitor changed since it was loaded. Reload it and try again.", nil)
		return
	case err != nil:
		s.writeError(w, r, http.StatusInternalServerError, "INTERNAL_ERROR", "Unable to update the monitor.", nil)
		return
	}
	w.Header().Set("ETag", monitorETag(monitor))
	s.writeJSON(w, r, http.StatusOK, successResponse{Data: monitor, Meta: s.meta(r)})
}

func (s *server) deleteMonitor(w http.ResponseWriter, r *http.Request) {
	principal, _ := authz.PrincipalFromContext(r.Context())
	err := s.monitors.Delete(r.Context(), r.PathValue("monitorId"), principal.ID)
	if errors.Is(err, monitors.ErrNotFound) {
		s.writeError(w, r, http.StatusNotFound, "MONITOR_NOT_FOUND", "Monitor was not found.", nil)
		return
	}
	if err != nil {
		s.writeError(w, r, http.StatusInternalServerError, "INTERNAL_ERROR", "Unable to delete the monitor.", nil)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *server) bulkDeleteMonitors(w http.ResponseWriter, r *http.Request) {
	var input struct {
		MonitorIDs []string `json:"monitorIds"`
	}
	if !s.decodeJSON(w, r, &input) {
		return
	}
	deletedCount, err := s.monitors.PermanentDelete(r.Context(), input.MonitorIDs)
	var validationError monitors.ValidationError
	switch {
	case errors.As(err, &validationError):
		s.writeError(w, r, http.StatusUnprocessableEntity, "MONITOR_DELETE_VALIDATION_FAILED", validationError.Error(), validationError)
		return
	case errors.Is(err, monitors.ErrNotFound):
		s.writeError(w, r, http.StatusNotFound, "MONITOR_NOT_FOUND", "One or more selected monitors were not found.", nil)
		return
	case err != nil:
		s.writeError(w, r, http.StatusInternalServerError, "INTERNAL_ERROR", "Unable to permanently delete the selected monitors.", nil)
		return
	}
	s.writeJSON(w, r, http.StatusOK, successResponse{Data: map[string]any{"deletedCount": deletedCount}, Meta: s.meta(r)})
}

func (s *server) listMonitorRevisions(w http.ResponseWriter, r *http.Request) {
	items, err := s.monitors.ListRevisions(r.Context(), r.PathValue("monitorId"))
	if errors.Is(err, monitors.ErrNotFound) {
		s.writeError(w, r, http.StatusNotFound, "MONITOR_NOT_FOUND", "Monitor was not found.", nil)
		return
	}
	if err != nil {
		s.writeError(w, r, http.StatusInternalServerError, "INTERNAL_ERROR", "Unable to list monitor revisions.", nil)
		return
	}
	s.writeJSON(w, r, http.StatusOK, successResponse{Data: items, Meta: s.meta(r)})
}

func (s *server) getMonitorRevision(w http.ResponseWriter, r *http.Request) {
	revision, err := s.monitors.GetRevision(r.Context(), r.PathValue("monitorId"), r.PathValue("revisionId"))
	if errors.Is(err, monitors.ErrNotFound) {
		s.writeError(w, r, http.StatusNotFound, "REVISION_NOT_FOUND", "Monitor revision was not found.", nil)
		return
	}
	if err != nil {
		s.writeError(w, r, http.StatusInternalServerError, "INTERNAL_ERROR", "Unable to load monitor revision.", nil)
		return
	}
	s.writeJSON(w, r, http.StatusOK, successResponse{Data: revision, Meta: s.meta(r)})
}

func (s *server) diffMonitorRevisions(w http.ResponseWriter, r *http.Request) {
	result, err := s.monitors.Diff(r.Context(), r.PathValue("monitorId"), r.URL.Query().Get("from"), r.URL.Query().Get("to"))
	if errors.Is(err, monitors.ErrNotFound) {
		s.writeError(w, r, http.StatusNotFound, "REVISION_NOT_FOUND", "One or both revisions were not found.", nil)
		return
	}
	if err != nil {
		s.writeError(w, r, http.StatusInternalServerError, "INTERNAL_ERROR", "Unable to compare revisions.", nil)
		return
	}
	s.writeJSON(w, r, http.StatusOK, successResponse{Data: result, Meta: s.meta(r)})
}
func (s *server) exportMonitor(w http.ResponseWriter, r *http.Request) {
	result, err := s.monitors.Export(r.Context(), r.PathValue("monitorId"))
	if errors.Is(err, monitors.ErrNotFound) {
		s.writeError(w, r, http.StatusNotFound, "MONITOR_NOT_FOUND", "Monitor was not found.", nil)
		return
	}
	if err != nil {
		s.writeError(w, r, http.StatusInternalServerError, "INTERNAL_ERROR", "Unable to export monitor.", nil)
		return
	}
	w.Header().Set("Content-Disposition", `attachment; filename="rhythm-monitor.json"`)
	s.writeJSON(w, r, http.StatusOK, successResponse{Data: result, Meta: s.meta(r)})
}
func (s *server) restoreMonitorRevision(w http.ResponseWriter, r *http.Request) {
	principal, _ := authz.PrincipalFromContext(r.Context())
	monitor, revision, err := s.monitors.RestoreRevision(r.Context(), r.PathValue("monitorId"), r.PathValue("revisionId"), principal.ID)
	if s.handleMonitorMutationError(w, r, err) {
		return
	}
	s.writeJSON(w, r, http.StatusOK, successResponse{Data: map[string]any{"monitor": monitor, "revision": revision}, Meta: s.meta(r)})
}

func (s *server) saveMonitorDraft(w http.ResponseWriter, r *http.Request) {
	var input monitors.DraftInput
	if !s.decodeJSON(w, r, &input) {
		return
	}
	principal, _ := authz.PrincipalFromContext(r.Context())
	monitor, revision, err := s.monitors.SaveDraft(r.Context(), r.PathValue("monitorId"), input, principal.ID)
	if s.handleMonitorMutationError(w, r, err) {
		return
	}
	w.Header().Set("ETag", monitorETag(monitor))
	s.writeJSON(w, r, http.StatusOK, successResponse{Data: map[string]any{"monitor": monitor, "revision": revision}, Meta: s.meta(r)})
}

func (s *server) validateMonitor(w http.ResponseWriter, r *http.Request) {
	fields, err := s.monitors.Validate(r.Context(), r.PathValue("monitorId"))
	if errors.Is(err, monitors.ErrNotFound) {
		s.writeError(w, r, http.StatusNotFound, "MONITOR_NOT_FOUND", "Monitor was not found.", nil)
		return
	}
	if err != nil {
		s.writeError(w, r, http.StatusInternalServerError, "INTERNAL_ERROR", "Unable to validate monitor.", nil)
		return
	}
	s.writeJSON(w, r, http.StatusOK, successResponse{Data: map[string]any{"valid": len(fields) == 0, "fields": fields}, Meta: s.meta(r)})
}

func (s *server) publishMonitor(w http.ResponseWriter, r *http.Request) {
	var input monitors.PublishInput
	if r.ContentLength != 0 && !s.decodeJSON(w, r, &input) {
		return
	}
	principal, _ := authz.PrincipalFromContext(r.Context())
	monitor, revision, err := s.monitors.Publish(r.Context(), r.PathValue("monitorId"), input, principal.ID)
	if s.handleMonitorMutationError(w, r, err) {
		return
	}
	w.Header().Set("ETag", monitorETag(monitor))
	s.writeJSON(w, r, http.StatusOK, successResponse{Data: map[string]any{"monitor": monitor, "revision": revision}, Meta: s.meta(r)})
}

func (s *server) cloneMonitor(w http.ResponseWriter, r *http.Request) {
	var input monitors.CloneInput
	if !s.decodeJSON(w, r, &input) {
		return
	}
	principal, _ := authz.PrincipalFromContext(r.Context())
	monitor, err := s.monitors.Clone(r.Context(), r.PathValue("monitorId"), input, principal.ID)
	if s.handleMonitorMutationError(w, r, err) {
		return
	}
	w.Header().Set("Location", "/api/v1/monitors/"+monitor.ID)
	s.writeJSON(w, r, http.StatusCreated, successResponse{Data: monitor, Meta: s.meta(r)})
}

func (s *server) enableMonitor(w http.ResponseWriter, r *http.Request) {
	s.changeMonitorState(w, r, s.monitors.Enable)
}
func (s *server) disableMonitor(w http.ResponseWriter, r *http.Request) {
	s.changeMonitorState(w, r, s.monitors.Disable)
}
func (s *server) archiveMonitor(w http.ResponseWriter, r *http.Request) {
	s.changeMonitorState(w, r, s.monitors.Archive)
}
func (s *server) restoreMonitor(w http.ResponseWriter, r *http.Request) {
	s.changeMonitorState(w, r, s.monitors.Restore)
}

func (s *server) changeMonitorState(w http.ResponseWriter, r *http.Request, mutation func(context.Context, string, string) (monitors.Monitor, error)) {
	principal, _ := authz.PrincipalFromContext(r.Context())
	monitor, err := mutation(r.Context(), r.PathValue("monitorId"), principal.ID)
	if s.handleMonitorMutationError(w, r, err) {
		return
	}
	w.Header().Set("ETag", monitorETag(monitor))
	s.writeJSON(w, r, http.StatusOK, successResponse{Data: monitor, Meta: s.meta(r)})
}

func (s *server) handleMonitorMutationError(w http.ResponseWriter, r *http.Request, err error) bool {
	var validationError monitors.ValidationError
	switch {
	case err == nil:
		return false
	case errors.As(err, &validationError):
		s.writeError(w, r, http.StatusUnprocessableEntity, "MONITOR_VALIDATION_FAILED", validationError.Error(), validationError)
	case errors.Is(err, monitors.ErrNotFound):
		s.writeError(w, r, http.StatusNotFound, "MONITOR_NOT_FOUND", "Monitor was not found.", nil)
	case errors.Is(err, monitors.ErrConflict):
		s.writeError(w, r, http.StatusConflict, "MONITOR_STATE_CONFLICT", "The monitor changed while this action was running.", nil)
	default:
		s.writeError(w, r, http.StatusInternalServerError, "INTERNAL_ERROR", "Unable to change the monitor.", nil)
	}
	return true
}

func (s *server) decodeJSON(w http.ResponseWriter, r *http.Request, target any) bool {
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 2<<20))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		s.writeError(w, r, http.StatusBadRequest, "INVALID_REQUEST", "Request body is invalid.", nil)
		return false
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		s.writeError(w, r, http.StatusBadRequest, "INVALID_REQUEST", "Request body must contain exactly one JSON object.", nil)
		return false
	}
	return true
}

func (s *server) validateScript(w http.ResponseWriter, r *http.Request) {
	if s.scripts == nil {
		s.writeError(w, r, http.StatusServiceUnavailable, "SCRIPT_RUNTIME_UNAVAILABLE", "JavaScript validation is unavailable.", nil)
		return
	}
	var input struct {
		Code string `json:"code"`
	}
	if !s.decodeJSON(w, r, &input) {
		return
	}
	result, err := s.scripts.Validate(r.Context(), input.Code)
	if err != nil {
		s.writeError(w, r, http.StatusServiceUnavailable, "SCRIPT_RUNTIME_UNAVAILABLE", "JavaScript validation is unavailable.", nil)
		return
	}
	s.writeJSON(w, r, http.StatusOK, successResponse{Data: result, Meta: s.meta(r)})
}

func (s *server) previewScript(w http.ResponseWriter, r *http.Request) {
	if s.scripts == nil {
		s.writeError(w, r, http.StatusServiceUnavailable, "SCRIPT_RUNTIME_UNAVAILABLE", "JavaScript preview is unavailable.", nil)
		return
	}
	if _, err := s.monitors.Get(r.Context(), r.PathValue("monitorId")); err != nil {
		s.writeError(w, r, http.StatusNotFound, "MONITOR_NOT_FOUND", "Monitor was not found.", nil)
		return
	}
	if _, err := s.monitors.GetRevision(r.Context(), r.PathValue("monitorId"), r.PathValue("revisionId")); err != nil {
		s.writeError(w, r, http.StatusNotFound, "REVISION_NOT_FOUND", "Monitor revision was not found.", nil)
		return
	}
	var input struct {
		Scope     string            `json:"scope"`
		StepID    string            `json:"stepId"`
		Code      string            `json:"code"`
		Variables map[string]string `json:"variables"`
		Request   *scripts.Request  `json:"request"`
	}
	if !s.decodeJSON(w, r, &input) {
		return
	}
	if input.Scope != "monitor" && input.Scope != "request" {
		s.writeError(w, r, http.StatusUnprocessableEntity, "SCRIPT_SCOPE_INVALID", "Script scope must be monitor or request.", nil)
		return
	}
	result, err := s.scripts.Execute(r.Context(), scripts.Input{Script: scripts.Script{Enabled: true, Language: "javascript", Code: input.Code, RuntimeVersion: scripts.RuntimeVersion}, Scope: input.Scope, Preview: true, AllowPrivateTargets: s.allowPrivateTargets, Variables: input.Variables, Environment: map[string]string{}, Collection: map[string]string{}, Globals: map[string]string{}, Secrets: map[string]string{}, Request: input.Request, TimeoutMS: 2000, Info: scripts.Info{MonitorID: r.PathValue("monitorId"), RevisionID: r.PathValue("revisionId"), StepID: input.StepID, EventName: "prerequest", RuntimeVersion: scripts.RuntimeVersion}})
	if err != nil {
		s.writeError(w, r, http.StatusServiceUnavailable, "SCRIPT_RUNTIME_UNAVAILABLE", "JavaScript preview is unavailable.", nil)
		return
	}
	result.InternalVariables = nil
	result.InternalEnvironment = nil
	result.InternalCollection = nil
	result.InternalCookies = nil
	result.InternalRequest = nil
	s.writeJSON(w, r, http.StatusOK, successResponse{Data: result, Meta: s.meta(r)})
}

func (s *server) runMonitor(w http.ResponseWriter, r *http.Request) {
	principal, _ := authz.PrincipalFromContext(r.Context())
	mode := r.URL.Query().Get("revision")
	if mode == "" {
		mode = "draft"
	}
	var run runs.Run
	var err error
	if r.URL.Query().Get("wait") == "true" {
		run, err = s.runs.Run(r.Context(), r.PathValue("monitorId"), principal.ID, mode)
	} else {
		run, err = s.runs.Start(r.Context(), r.PathValue("monitorId"), principal.ID, mode)
	}
	if errors.Is(err, monitors.ErrNotFound) {
		s.writeError(w, r, http.StatusNotFound, "MONITOR_NOT_FOUND", "Monitor was not found.", nil)
		return
	}
	if err != nil {
		s.writeError(w, r, http.StatusUnprocessableEntity, "MONITOR_NOT_EXECUTABLE", err.Error(), nil)
		return
	}
	diagnosticsURL := "/api/v1/runs/" + run.ID + "/diagnostics"
	w.Header().Set("Location", diagnosticsURL)
	status := http.StatusAccepted
	if r.URL.Query().Get("wait") == "true" {
		status = http.StatusCreated
	}
	s.writeJSON(w, r, status, successResponse{Data: map[string]any{"run": run, "runId": run.ID, "status": run.Status, "diagnosticsUrl": diagnosticsURL}, Meta: s.meta(r)})
}

func (s *server) listMonitorRuns(w http.ResponseWriter, r *http.Request) {
	items, err := s.runs.List(r.Context(), r.PathValue("monitorId"))
	if errors.Is(err, monitors.ErrNotFound) {
		s.writeError(w, r, http.StatusNotFound, "MONITOR_NOT_FOUND", "Monitor was not found.", nil)
		return
	}
	if err != nil {
		s.writeError(w, r, http.StatusInternalServerError, "INTERNAL_ERROR", "Unable to list monitor runs.", nil)
		return
	}
	s.writeJSON(w, r, http.StatusOK, successResponse{Data: items, Meta: s.meta(r)})
}

func (s *server) getMonitorMetrics(w http.ResponseWriter, r *http.Request) {
	window := r.URL.Query().Get("window")
	if window == "" {
		window = "30d"
	}
	metrics, err := s.runs.Metrics(r.Context(), r.PathValue("monitorId"), window)
	var validationError runs.MetricsValidationError
	switch {
	case errors.As(err, &validationError):
		s.writeError(w, r, http.StatusBadRequest, "INVALID_METRICS_WINDOW", validationError.Error(), nil)
		return
	case errors.Is(err, monitors.ErrNotFound):
		s.writeError(w, r, http.StatusNotFound, "MONITOR_NOT_FOUND", "Monitor was not found.", nil)
		return
	case err != nil:
		s.writeError(w, r, http.StatusInternalServerError, "INTERNAL_ERROR", "Unable to calculate monitor metrics.", nil)
		return
	}
	s.writeJSON(w, r, http.StatusOK, successResponse{Data: metrics, Meta: s.meta(r)})
}

func (s *server) getRun(w http.ResponseWriter, r *http.Request) {
	run, err := s.runs.Get(r.Context(), r.PathValue("runId"))
	if errors.Is(err, runs.ErrNotFound) {
		s.writeError(w, r, http.StatusNotFound, "RUN_NOT_FOUND", "Run was not found.", nil)
		return
	}
	if err != nil {
		s.writeError(w, r, http.StatusInternalServerError, "INTERNAL_ERROR", "Unable to load the run.", nil)
		return
	}
	s.writeJSON(w, r, http.StatusOK, successResponse{Data: run, Meta: s.meta(r)})
}

func (s *server) getRunDiagnostics(w http.ResponseWriter, r *http.Request) {
	diagnostics, err := s.runs.Diagnostics(r.Context(), r.PathValue("runId"))
	if errors.Is(err, runs.ErrNotFound) {
		s.writeError(w, r, http.StatusNotFound, "RUN_NOT_FOUND", "Run was not found.", nil)
		return
	}
	if err != nil {
		s.writeError(w, r, http.StatusInternalServerError, "INTERNAL_ERROR", "Unable to load run diagnostics.", nil)
		return
	}
	s.writeJSON(w, r, http.StatusOK, successResponse{Data: diagnostics, Meta: s.meta(r)})
}

func (s *server) cancelRun(w http.ResponseWriter, r *http.Request) {
	run, err := s.runs.Cancel(r.Context(), r.PathValue("runId"))
	if errors.Is(err, runs.ErrNotFound) {
		s.writeError(w, r, http.StatusNotFound, "RUN_NOT_FOUND", "Run was not found.", nil)
		return
	}
	if err != nil {
		s.writeError(w, r, http.StatusConflict, "RUN_NOT_CANCELLABLE", err.Error(), nil)
		return
	}
	s.writeJSON(w, r, http.StatusAccepted, successResponse{Data: map[string]any{"runId": run.ID, "status": "CANCELLING"}, Meta: s.meta(r)})
}

func (s *server) listRecentRuns(w http.ResponseWriter, r *http.Request) {
	limit := 50
	if raw := strings.TrimSpace(r.URL.Query().Get("limit")); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed < 1 || parsed > 200 {
			s.writeError(w, r, http.StatusBadRequest, "INVALID_LIMIT", "Run limit must be between 1 and 200.", nil)
			return
		}
		limit = parsed
	}
	items, err := s.runs.ListRecent(r.Context(), limit)
	if err != nil {
		s.writeError(w, r, http.StatusInternalServerError, "INTERNAL_ERROR", "Unable to list recent runs.", nil)
		return
	}
	s.writeJSON(w, r, http.StatusOK, successResponse{Data: items, Meta: s.meta(r)})
}

func (s *server) getMonitorSchedule(w http.ResponseWriter, r *http.Request) {
	if s.scheduler == nil {
		s.writeError(w, r, http.StatusServiceUnavailable, "SCHEDULER_UNAVAILABLE", "Scheduling requires PostgreSQL and Redis.", nil)
		return
	}
	config, err := s.scheduler.Get(r.Context(), r.PathValue("monitorId"))
	if errors.Is(err, monitors.ErrNotFound) {
		s.writeError(w, r, http.StatusNotFound, "SCHEDULE_NOT_FOUND", "Monitor schedule was not found.", nil)
		return
	}
	if err != nil {
		s.writeError(w, r, http.StatusInternalServerError, "INTERNAL_ERROR", "Unable to load monitor schedule.", nil)
		return
	}
	s.writeJSON(w, r, http.StatusOK, successResponse{Data: config, Meta: s.meta(r)})
}

func (s *server) configureMonitorSchedule(w http.ResponseWriter, r *http.Request) {
	if s.scheduler == nil {
		s.writeError(w, r, http.StatusServiceUnavailable, "SCHEDULER_UNAVAILABLE", "Scheduling requires PostgreSQL and Redis.", nil)
		return
	}
	var input scheduler.Config
	if !s.decodeJSON(w, r, &input) {
		return
	}
	config, err := s.scheduler.Configure(r.Context(), r.PathValue("monitorId"), input)
	var validationError scheduler.ValidationError
	if errors.As(err, &validationError) {
		s.writeError(w, r, http.StatusUnprocessableEntity, "SCHEDULE_VALIDATION_FAILED", validationError.Error(), nil)
		return
	}
	if errors.Is(err, monitors.ErrNotFound) {
		s.writeError(w, r, http.StatusNotFound, "MONITOR_NOT_FOUND", "Monitor was not found.", nil)
		return
	}
	if err != nil {
		s.writeError(w, r, http.StatusInternalServerError, "INTERNAL_ERROR", "Unable to configure monitor schedule.", nil)
		return
	}
	s.writeJSON(w, r, http.StatusOK, successResponse{Data: config, Meta: s.meta(r)})
}

func (s *server) listAlerts(w http.ResponseWriter, r *http.Request) {
	if s.alerts == nil {
		s.writeError(w, r, http.StatusServiceUnavailable, "ALERTING_UNAVAILABLE", "Alerting requires PostgreSQL.", nil)
		return
	}
	items, err := s.alerts.ListFiltered(r.Context(), alerts.Filter{State: strings.ToUpper(r.URL.Query().Get("state")), SourceType: strings.ToUpper(r.URL.Query().Get("sourceType")), ApplicationID: r.URL.Query().Get("applicationId"), ServiceID: r.URL.Query().Get("serviceId"), Severity: strings.ToUpper(r.URL.Query().Get("severity"))})
	if err != nil {
		s.writeError(w, r, http.StatusInternalServerError, "INTERNAL_ERROR", "Unable to list alerts.", nil)
		return
	}
	s.writeJSON(w, r, http.StatusOK, successResponse{Data: items, Meta: s.meta(r)})
}

func (s *server) getAlert(w http.ResponseWriter, r *http.Request) {
	if s.alerts == nil {
		s.writeError(w, r, http.StatusServiceUnavailable, "ALERTING_UNAVAILABLE", "Alerting requires PostgreSQL.", nil)
		return
	}
	item, err := s.alerts.Get(r.Context(), r.PathValue("alertId"))
	if errors.Is(err, alerts.ErrNotFound) {
		s.writeError(w, r, http.StatusNotFound, "ALERT_NOT_FOUND", "Alert was not found.", nil)
		return
	}
	if err != nil {
		s.writeError(w, r, http.StatusInternalServerError, "INTERNAL_ERROR", "Unable to load alert.", nil)
		return
	}
	s.writeJSON(w, r, http.StatusOK, successResponse{Data: item, Meta: s.meta(r)})
}

func (s *server) listAlertEvents(w http.ResponseWriter, r *http.Request) {
	if s.alerts == nil {
		s.writeError(w, r, http.StatusServiceUnavailable, "ALERTING_UNAVAILABLE", "Alerting requires PostgreSQL.", nil)
		return
	}
	items, err := s.alerts.Events(r.Context(), r.PathValue("alertId"))
	if err != nil {
		s.writeError(w, r, http.StatusInternalServerError, "INTERNAL_ERROR", "Unable to load alert events.", nil)
		return
	}
	s.writeJSON(w, r, http.StatusOK, successResponse{Data: items, Meta: s.meta(r)})
}
func (s *server) acknowledgeAlert(w http.ResponseWriter, r *http.Request) {
	s.transitionAlert(w, r, true)
}
func (s *server) resolveAlert(w http.ResponseWriter, r *http.Request) { s.transitionAlert(w, r, false) }
func (s *server) transitionAlert(w http.ResponseWriter, r *http.Request, acknowledge bool) {
	if s.alerts == nil {
		s.writeError(w, r, http.StatusServiceUnavailable, "ALERTING_UNAVAILABLE", "Alerting requires PostgreSQL.", nil)
		return
	}
	principal, _ := authz.PrincipalFromContext(r.Context())
	var item alerts.Alert
	var err error
	if acknowledge {
		item, err = s.alerts.Acknowledge(r.Context(), r.PathValue("alertId"), principal.ID)
	} else {
		item, err = s.alerts.Resolve(r.Context(), r.PathValue("alertId"), principal.ID)
	}
	if errors.Is(err, alerts.ErrNotFound) {
		s.writeError(w, r, http.StatusNotFound, "ALERT_NOT_FOUND", "Open alert was not found.", nil)
		return
	}
	if errors.Is(err, alerts.ErrExternalResolve) {
		s.writeError(w, r, http.StatusConflict, "EXTERNAL_ALERT_ACTIVE", err.Error(), nil)
		return
	}
	if err != nil {
		s.writeError(w, r, http.StatusInternalServerError, "INTERNAL_ERROR", "Unable to change alert.", nil)
		return
	}
	s.writeJSON(w, r, http.StatusOK, successResponse{Data: item, Meta: s.meta(r)})
}
func (s *server) saveAlertPolicy(w http.ResponseWriter, r *http.Request) {
	if s.alerts == nil {
		s.writeError(w, r, http.StatusServiceUnavailable, "ALERTING_UNAVAILABLE", "Alerting requires PostgreSQL.", nil)
		return
	}
	var input alerts.Policy
	if !s.decodeJSON(w, r, &input) {
		return
	}
	policy, err := s.alerts.SavePolicy(r.Context(), r.PathValue("monitorId"), input)
	if err != nil {
		s.writeError(w, r, http.StatusUnprocessableEntity, "ALERT_POLICY_INVALID", err.Error(), nil)
		return
	}
	s.writeJSON(w, r, http.StatusOK, successResponse{Data: policy, Meta: s.meta(r)})
}

func (s *server) listAuditEvents(w http.ResponseWriter, r *http.Request) {
	if s.audit == nil {
		s.writeError(w, r, http.StatusServiceUnavailable, "AUDIT_UNAVAILABLE", "Audit history requires PostgreSQL.", nil)
		return
	}
	items, err := s.audit.List(r.Context(), 100)
	if err != nil {
		s.writeError(w, r, http.StatusInternalServerError, "INTERNAL_ERROR", "Unable to list audit events.", nil)
		return
	}
	s.writeJSON(w, r, http.StatusOK, successResponse{Data: items, Meta: s.meta(r)})
}

func (s *server) listConfigurationProfiles(w http.ResponseWriter, r *http.Request) {
	if s.library == nil {
		s.writeError(w, r, http.StatusServiceUnavailable, "CONFIGURATION_UNAVAILABLE", "Configuration library requires PostgreSQL.", nil)
		return
	}
	items, err := s.library.List(r.Context(), r.PathValue("kind"))
	if err != nil {
		s.writeError(w, r, http.StatusBadRequest, "CONFIGURATION_KIND_INVALID", err.Error(), nil)
		return
	}
	s.writeJSON(w, r, http.StatusOK, successResponse{Data: items, Meta: s.meta(r)})
}
func (s *server) createConfigurationProfile(w http.ResponseWriter, r *http.Request) {
	if s.library == nil {
		s.writeError(w, r, http.StatusServiceUnavailable, "CONFIGURATION_UNAVAILABLE", "Configuration library requires PostgreSQL.", nil)
		return
	}
	var input library.Input
	if !s.decodeJSON(w, r, &input) {
		return
	}
	principal, _ := authz.PrincipalFromContext(r.Context())
	profile, err := s.library.Create(r.Context(), r.PathValue("kind"), input, principal.ID)
	if err != nil {
		s.writeError(w, r, http.StatusUnprocessableEntity, "CONFIGURATION_PROFILE_INVALID", err.Error(), nil)
		return
	}
	s.writeJSON(w, r, http.StatusCreated, successResponse{Data: profile, Meta: s.meta(r)})
}
func (s *server) deleteConfigurationProfile(w http.ResponseWriter, r *http.Request) {
	if s.library == nil {
		s.writeError(w, r, http.StatusServiceUnavailable, "CONFIGURATION_UNAVAILABLE", "Configuration library requires PostgreSQL.", nil)
		return
	}
	principal, _ := authz.PrincipalFromContext(r.Context())
	err := s.library.Delete(r.Context(), r.PathValue("profileId"), principal.ID)
	if errors.Is(err, library.ErrNotFound) {
		s.writeError(w, r, http.StatusNotFound, "CONFIGURATION_PROFILE_NOT_FOUND", "Configuration profile was not found.", nil)
		return
	}
	if err != nil {
		s.writeError(w, r, http.StatusInternalServerError, "INTERNAL_ERROR", "Unable to delete configuration profile.", nil)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (w *statusRecorder) WriteHeader(status int) {
	w.status = status
	w.ResponseWriter.WriteHeader(status)
}
func (w *statusRecorder) Write(body []byte) (int, error) {
	if w.status == 0 {
		w.status = http.StatusOK
	}
	return w.ResponseWriter.Write(body)
}

func (s *server) auditMutations(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if s.audit == nil || r.Method == http.MethodGet || r.Method == http.MethodOptions {
			next.ServeHTTP(w, r)
			return
		}
		recorder := &statusRecorder{ResponseWriter: w}
		next.ServeHTTP(recorder, r)
		principal, _ := authz.PrincipalFromContext(r.Context())
		resourceType, resourceID, action := auditDescriptor(r)
		outcome := "SUCCESS"
		if recorder.status >= 400 {
			outcome = "FAILURE"
		}
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		if err := s.audit.Record(ctx, audit.Event{ActorID: principal.ID, Action: action, ResourceType: resourceType, ResourceID: resourceID, Outcome: outcome, CorrelationID: requestIDFromRequest(r)}); err != nil {
			s.logger.Error("record audit event", "error", err)
		}
	})
}

func auditDescriptor(r *http.Request) (string, string, string) {
	parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
	resourceType, resourceID := "API", "collection"
	if len(parts) >= 3 {
		resourceType = strings.ToUpper(strings.TrimSuffix(parts[2], "s"))
	}
	if len(parts) >= 4 {
		resourceID = parts[3]
	}
	action := r.Method
	if len(parts) >= 5 {
		action = strings.ToUpper(parts[len(parts)-1])
	} else if r.Method == http.MethodPost {
		action = "CREATE"
	} else if r.Method == http.MethodPatch || r.Method == http.MethodPut {
		action = "UPDATE"
	} else if r.Method == http.MethodDelete {
		action = "DELETE"
	}
	return resourceType, resourceID, action
}

func (s *server) authenticate(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/healthz" || strings.HasPrefix(r.URL.Path, "/hooks/v1/opensearch-alerting/") || r.Method == http.MethodOptions {
			next.ServeHTTP(w, r)
			return
		}
		principal, err := s.authenticator.Authenticate(r)
		if err != nil {
			s.writeError(w, r, http.StatusUnauthorized, "UNAUTHENTICATED", "Authentication is required.", nil)
			return
		}
		next.ServeHTTP(w, r.WithContext(authz.WithPrincipal(r.Context(), principal)))
	})
}

func (s *server) authorize(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/healthz" || strings.HasPrefix(r.URL.Path, "/hooks/v1/opensearch-alerting/") || r.Method == http.MethodOptions {
			next.ServeHTTP(w, r)
			return
		}
		principal, ok := authz.PrincipalFromContext(r.Context())
		if !ok || !authz.Can(principal, r.Method, r.URL.Path) {
			s.writeError(w, r, http.StatusForbidden, "FORBIDDEN", "Your role does not allow this operation.", nil)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (s *server) requestID(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestID := strings.TrimSpace(r.Header.Get("X-Request-ID"))
		if requestID == "" || len(requestID) > 128 {
			requestID = id.NewRequestID()
		}
		r.Header.Set("X-Request-ID", requestID)
		w.Header().Set("X-Request-ID", requestID)
		next.ServeHTTP(w, r.WithContext(contextWithRequestID(r, requestID)))
	})
}

func (s *server) cors(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if s.allowedOrigin != "" && r.Header.Get("Origin") == s.allowedOrigin {
			w.Header().Set("Access-Control-Allow-Origin", s.allowedOrigin)
			w.Header().Set("Vary", "Origin")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, If-Match, X-Request-ID")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
		}
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (s *server) logRequest(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		started := time.Now()
		next.ServeHTTP(w, r)
		s.logger.Info("http request", "method", r.Method, "path", r.URL.Path, "requestId", requestIDFromRequest(r), "durationMs", time.Since(started).Milliseconds())
	})
}

func (s *server) recoverPanic(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if recovered := recover(); recovered != nil {
				s.logger.Error("request panic", "error", recovered, "requestId", requestIDFromRequest(r))
				s.writeError(w, r, http.StatusInternalServerError, "INTERNAL_ERROR", "An unexpected error occurred.", nil)
			}
		}()
		next.ServeHTTP(w, r)
	})
}

func (s *server) writeError(w http.ResponseWriter, r *http.Request, status int, code, message string, details any) {
	s.writeJSON(w, r, status, errorResponse{Error: errorBody{Code: code, Message: message, Details: details}, Meta: s.meta(r)})
}

func (s *server) writeJSON(w http.ResponseWriter, _ *http.Request, status int, body any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(body); err != nil {
		s.logger.Error("encode response", "error", err)
	}
}

func (s *server) meta(r *http.Request) responseMeta {
	return responseMeta{RequestID: requestIDFromRequest(r)}
}

func monitorETag(monitor monitors.Monitor) string {
	return `W/"` + monitor.UpdatedAt.Format(time.RFC3339Nano) + `"`
}

func parseIfMatch(value string) (time.Time, error) {
	value = strings.TrimSpace(value)
	if !strings.HasPrefix(value, `W/"`) || !strings.HasSuffix(value, `"`) {
		return time.Time{}, errors.New("invalid monitor ETag")
	}
	return time.Parse(time.RFC3339Nano, strings.TrimSuffix(strings.TrimPrefix(value, `W/"`), `"`))
}
