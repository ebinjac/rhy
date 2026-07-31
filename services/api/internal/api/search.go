package api

import (
	"net/http"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/rhythm-monitoring/rhythm/internal/alerts"
	"github.com/rhythm-monitoring/rhythm/internal/monitors"
	"github.com/rhythm-monitoring/rhythm/internal/runs"
	"github.com/rhythm-monitoring/rhythm/internal/suites"
)

const (
	searchMinQueryRunes = 2
	searchDefaultLimit  = 8
	searchMaxLimit      = 20
	searchRecentRuns    = 100
)

type searchMonitorHit struct {
	ID          string   `json:"id"`
	Name        string   `json:"name"`
	Slug        string   `json:"slug"`
	Description string   `json:"description,omitempty"`
	State       string   `json:"state"`
	Health      string   `json:"health"`
	Tags        []string `json:"tags"`
}

type searchRunHit struct {
	ID              string `json:"id"`
	MonitorID       string `json:"monitorId"`
	MonitorName     string `json:"monitorName,omitempty"`
	Status          string `json:"status"`
	TriggerType     string `json:"triggerType,omitempty"`
	FailureCategory string `json:"failureCategory,omitempty"`
	CreatedAt       string `json:"createdAt"`
}

type searchAlertHit struct {
	ID              string `json:"id"`
	Title           string `json:"title"`
	State           string `json:"state"`
	Severity        string `json:"severity"`
	SourceType      string `json:"sourceType"`
	MonitorID       string `json:"monitorId,omitempty"`
	MonitorName     string `json:"monitorName,omitempty"`
	ApplicationName string `json:"applicationName,omitempty"`
	ServiceName     string `json:"serviceName,omitempty"`
	Description     string `json:"description,omitempty"`
}

type searchResourceHit struct {
	Kind          string `json:"kind"`
	ID            string `json:"id"`
	Name          string `json:"name"`
	Description   string `json:"description,omitempty"`
	Context       string `json:"context,omitempty"`
	ApplicationID string `json:"applicationId,omitempty"`
	QueryID       string `json:"queryId,omitempty"`
	Status        string `json:"status,omitempty"`
}

type searchResponse struct {
	Query     string              `json:"query"`
	Monitors  []searchMonitorHit  `json:"monitors"`
	Runs      []searchRunHit      `json:"runs"`
	Alerts    []searchAlertHit    `json:"alerts"`
	Resources []searchResourceHit `json:"resources"`
}

func (s *server) searchWorkspace(w http.ResponseWriter, r *http.Request) {
	query := strings.TrimSpace(r.URL.Query().Get("q"))
	limit := searchDefaultLimit
	if raw := strings.TrimSpace(r.URL.Query().Get("limit")); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed < 1 || parsed > searchMaxLimit {
			s.writeError(w, r, http.StatusBadRequest, "INVALID_LIMIT", "Search limit must be between 1 and 20.", nil)
			return
		}
		limit = parsed
	}

	result := searchResponse{
		Query:     query,
		Monitors:  []searchMonitorHit{},
		Runs:      []searchRunHit{},
		Alerts:    []searchAlertHit{},
		Resources: []searchResourceHit{},
	}
	if utf8.RuneCountInString(query) < searchMinQueryRunes {
		s.writeJSON(w, r, http.StatusOK, successResponse{Data: result, Meta: s.meta(r)})
		return
	}

	needle := strings.ToLower(query)
	monitorItems, err := s.monitors.List(r.Context())
	if err != nil {
		s.writeError(w, r, http.StatusInternalServerError, "INTERNAL_ERROR", "Unable to search monitors.", nil)
		return
	}
	monitorByID := make(map[string]monitors.Monitor, len(monitorItems))
	for _, monitor := range monitorItems {
		monitorByID[monitor.ID] = monitor
		if len(result.Monitors) >= limit {
			continue
		}
		if matchMonitor(monitor, needle) {
			result.Monitors = append(result.Monitors, searchMonitorHit{
				ID:          monitor.ID,
				Name:        monitor.Name,
				Slug:        monitor.Slug,
				Description: monitor.Description,
				State:       string(monitor.State),
				Health:      string(monitor.Health),
				Tags:        append([]string{}, monitor.Tags...),
			})
		}
	}

	runItems, err := s.runs.ListRecent(r.Context(), searchRecentRuns)
	if err != nil {
		s.writeError(w, r, http.StatusInternalServerError, "INTERNAL_ERROR", "Unable to search runs.", nil)
		return
	}
	for _, run := range runItems {
		if len(result.Runs) >= limit {
			break
		}
		monitorName := ""
		if monitor, ok := monitorByID[run.MonitorID]; ok {
			monitorName = monitor.Name
		}
		if matchRun(run, monitorName, needle) {
			result.Runs = append(result.Runs, searchRunHit{
				ID:              run.ID,
				MonitorID:       run.MonitorID,
				MonitorName:     monitorName,
				Status:          string(run.Status),
				TriggerType:     run.TriggerType,
				FailureCategory: run.FailureCategory,
				CreatedAt:       run.CreatedAt.UTC().Format("2006-01-02T15:04:05Z"),
			})
		}
	}

	if s.alerts != nil {
		alertItems, alertErr := s.alerts.ListFiltered(r.Context(), alerts.Filter{})
		if alertErr != nil {
			s.writeError(w, r, http.StatusInternalServerError, "INTERNAL_ERROR", "Unable to search alerts.", nil)
			return
		}
		for _, alert := range alertItems {
			if len(result.Alerts) >= limit {
				break
			}
			if matchAlert(alert, needle) {
				result.Alerts = append(result.Alerts, searchAlertHit{
					ID:              alert.ID,
					Title:           alert.Title,
					State:           alert.State,
					Severity:        alert.Severity,
					SourceType:      alert.SourceType,
					MonitorID:       alert.MonitorID,
					MonitorName:     alert.MonitorName,
					ApplicationName: alert.ApplicationName,
					ServiceName:     alert.ServiceName,
					Description:     alert.Description,
				})
			}
		}
	}

	s.appendWorkspaceResources(r, &result, needle, limit)

	s.writeJSON(w, r, http.StatusOK, successResponse{Data: result, Meta: s.meta(r)})
}

func (s *server) appendWorkspaceResources(r *http.Request, result *searchResponse, needle string, limit int) {
	appendHit := func(hit searchResourceHit, fields ...string) {
		if len(result.Resources) >= limit || !containsAny(fields, needle) {
			return
		}
		result.Resources = append(result.Resources, hit)
	}

	if s.browserMonitors != nil {
		if monitors, err := s.browserMonitors.List(r.Context()); err == nil {
			for _, monitor := range monitors {
				appendHit(searchResourceHit{
					Kind: "BROWSER_MONITOR", ID: monitor.ID, Name: monitor.Name,
					Description: monitor.Description, Context: monitor.ApplicationName + " · " + monitor.ServiceName,
					ApplicationID: monitor.ApplicationID, Status: monitor.Health,
				}, monitor.ID, monitor.Name, monitor.Slug, monitor.Description, monitor.ApplicationName,
					monitor.ServiceName, monitor.EnvironmentName, monitor.Health, monitor.LastStatus)
			}
		}
	}

	if s.elf != nil {
		if applications, err := s.elf.ListApplications(r.Context()); err == nil {
			for _, application := range applications {
				appendHit(searchResourceHit{
					Kind: "APPLICATION", ID: application.ID, Name: application.Name,
					Description: application.Owner, Context: application.CARID + " · " + application.Environment,
					ApplicationID: application.ID, Status: map[bool]string{true: "ACTIVE", false: "PAUSED"}[application.Active],
				}, application.ID, application.Name, application.Owner, application.CARID, application.Environment, application.DefaultIndexPattern)
				for _, service := range application.Services {
					appendHit(searchResourceHit{
						Kind: "SERVICE", ID: service.ID, Name: service.Name,
						Context: application.Name, ApplicationID: application.ID,
					}, service.ID, service.Name, service.IndexPattern, service.TimeField, application.Name, application.CARID)
				}
			}
		}
		if queries, err := s.elf.ListQueries(r.Context()); err == nil {
			for _, query := range queries {
				appendHit(searchResourceHit{
					Kind: "ELF_QUERY", ID: query.ID, Name: query.Name,
					Description: query.Description, Context: query.ApplicationName + " · " + query.ServiceName,
					ApplicationID: query.ApplicationID, QueryID: query.ID,
					Status: map[bool]string{true: "ACTIVE", false: "PAUSED"}[query.Active],
				}, query.ID, query.Name, query.Description, query.ApplicationName, query.ServiceName, query.GateMode)
			}
		}
		if elfRuns, err := s.elf.ListRuns(r.Context()); err == nil {
			for _, run := range elfRuns {
				appendHit(searchResourceHit{
					Kind: "ELF_RUN", ID: run.ID, Name: run.ApplicationName + " log execution",
					Context: run.ResolvedIndex, ApplicationID: run.ApplicationID,
					QueryID: run.QueryID, Status: run.Decision,
				}, run.ID, run.QueryID, run.ApplicationName, run.ServiceName, run.ResolvedIndex, run.Decision, run.Status)
			}
		}
	}

	if s.suites != nil {
		if suiteItems, err := s.suites.List(r.Context()); err == nil {
			for _, suite := range suiteItems {
				appendHit(searchResourceHit{
					Kind: "SUITE", ID: suite.ID, Name: suite.Name,
					Description: suite.Description, Context: suite.Environment,
				}, suite.ID, suite.Name, suite.Description, suite.Environment)
			}
		}
		if deploymentRuns, err := s.suites.ListDeploymentRuns(r.Context(), suites.DeploymentFilter{}); err == nil {
			for _, run := range deploymentRuns {
				name := run.SuiteSnapshot.Name
				if run.Deployment.Version != "" {
					name += " · " + run.Deployment.Version
				}
				appendHit(searchResourceHit{
					Kind: "DEPLOYMENT_RUN", ID: run.ID, Name: name,
					Description: run.Deployment.Commit, Context: run.Deployment.Environment,
					ApplicationID: run.Deployment.ApplicationID, Status: run.GateDecision,
				}, run.ID, run.SuiteID, name, run.Deployment.DeploymentID, run.Deployment.Version, run.Deployment.Commit, run.Deployment.Environment, run.GateDecision, run.Status)
			}
		}
	}

	if s.library != nil {
		for _, kind := range []string{"ENVIRONMENT", "CERTIFICATE", "PROXY", "AUTH", "NOTIFICATION", "TELEMETRY"} {
			profiles, err := s.library.List(r.Context(), kind)
			if err != nil {
				continue
			}
			for _, profile := range profiles {
				appendHit(searchResourceHit{
					Kind: "CONFIGURATION", ID: profile.ID, Name: profile.Name,
					Description: profile.Description, Context: profile.Kind,
					Status: map[bool]string{true: "ACTIVE", false: "PAUSED"}[profile.Active],
				}, profile.ID, profile.Name, profile.Description, profile.Kind, profile.ProfileType)
			}
		}
	}
}

func matchMonitor(monitor monitors.Monitor, needle string) bool {
	fields := []string{
		monitor.ID,
		monitor.Name,
		monitor.Slug,
		monitor.Description,
		monitor.OwnerID,
		string(monitor.State),
		string(monitor.Health),
		monitor.ScheduleSummary,
	}
	if containsAny(fields, needle) {
		return true
	}
	for _, tag := range monitor.Tags {
		if strings.Contains(strings.ToLower(tag), needle) {
			return true
		}
	}
	return false
}

func matchRun(run runs.Run, monitorName, needle string) bool {
	return containsAny([]string{
		run.ID,
		run.MonitorID,
		monitorName,
		string(run.Status),
		run.TriggerType,
		run.FailureCategory,
		run.FailureReason,
	}, needle)
}

func matchAlert(alert alerts.Alert, needle string) bool {
	return containsAny([]string{
		alert.ID,
		alert.Title,
		alert.Description,
		alert.State,
		alert.Severity,
		alert.MonitorID,
		alert.MonitorName,
		alert.BrowserMonitorID,
		alert.BrowserMonitorName,
		alert.ApplicationName,
		alert.ApplicationCARID,
		alert.ServiceName,
		alert.FailureCategory,
		alert.ExternalMonitorName,
		alert.ExternalTriggerName,
		alert.ExternalAlertID,
		alert.BucketKey,
	}, needle)
}

func containsAny(fields []string, needle string) bool {
	for _, field := range fields {
		if field == "" {
			continue
		}
		if strings.Contains(strings.ToLower(field), needle) {
			return true
		}
	}
	return false
}
