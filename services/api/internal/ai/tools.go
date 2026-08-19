package ai

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/rhythm-monitoring/rhythm/internal/alerts"
	"github.com/rhythm-monitoring/rhythm/internal/elf"
	"github.com/rhythm-monitoring/rhythm/internal/monitors"
	"github.com/rhythm-monitoring/rhythm/internal/runs"
)

type RhythmTools struct {
	monitors *monitors.Service
	runs     *runs.Service
	alerts   *alerts.Service
	elf      *elf.Service
}

func NewRhythmTools(monitorsService *monitors.Service, runService *runs.Service, alertService *alerts.Service, elfService *elf.Service) *RhythmTools {
	return &RhythmTools{monitors: monitorsService, runs: runService, alerts: alertService, elf: elfService}
}

func (t *RhythmTools) Definitions() []ToolDefinition {
	stringProperty := func(description string) map[string]any {
		return map[string]any{"type": "string", "description": description}
	}
	return []ToolDefinition{
		{Name: "search_rhythm_resources", Description: "Search Rhythm monitors, applications, services, and ELF queries by name or identifier before requesting detailed evidence.", InputSchema: map[string]any{"type": "object", "properties": map[string]any{"query": stringProperty("Name, slug, CAR ID, service, or resource identifier to search for.")}, "required": []string{"query"}, "additionalProperties": false}},
		{Name: "get_monitor_health", Description: "Load the current definition, operational state, recent API-only metrics (summary, percentiles, distributions, and a compact time series for charting), and latest run summary for one API monitor.", InputSchema: map[string]any{"type": "object", "properties": map[string]any{"monitorId": stringProperty("Exact Rhythm monitor ID."), "window": map[string]any{"type": "string", "enum": []string{"24h", "7d", "30d"}}}, "required": []string{"monitorId"}, "additionalProperties": false}},
		{Name: "get_run_diagnostics", Description: "Load the incident-grade diagnostic summary for an exact API monitor run.", InputSchema: map[string]any{"type": "object", "properties": map[string]any{"runId": stringProperty("Exact Rhythm run ID.")}, "required": []string{"runId"}, "additionalProperties": false}},
		{Name: "get_application_health", Description: "Load trusted application ownership, services, linked monitors, linked ELF queries, and current alert evidence.", InputSchema: map[string]any{"type": "object", "properties": map[string]any{"applicationId": stringProperty("Exact Rhythm application ID.")}, "required": []string{"applicationId"}, "additionalProperties": false}},
		{Name: "list_active_alerts", Description: "List current actionable alerts, optionally limited to one application.", InputSchema: map[string]any{"type": "object", "properties": map[string]any{"applicationId": stringProperty("Optional exact Rhythm application ID.")}, "additionalProperties": false}},
	}
}

func (t *RhythmTools) Execute(ctx context.Context, name string, arguments json.RawMessage) (ToolResult, error) {
	switch name {
	case "search_rhythm_resources":
		var input struct {
			Query string `json:"query"`
		}
		if err := decodeToolArguments(arguments, &input); err != nil {
			return ToolResult{}, err
		}
		return t.search(ctx, input.Query)
	case "get_monitor_health":
		var input struct {
			MonitorID string `json:"monitorId"`
			Window    string `json:"window"`
		}
		if err := decodeToolArguments(arguments, &input); err != nil {
			return ToolResult{}, err
		}
		return t.monitorHealth(ctx, input.MonitorID, input.Window)
	case "get_run_diagnostics":
		var input struct {
			RunID string `json:"runId"`
		}
		if err := decodeToolArguments(arguments, &input); err != nil {
			return ToolResult{}, err
		}
		return t.runDiagnostics(ctx, input.RunID)
	case "get_application_health":
		var input struct {
			ApplicationID string `json:"applicationId"`
		}
		if err := decodeToolArguments(arguments, &input); err != nil {
			return ToolResult{}, err
		}
		return t.applicationHealth(ctx, input.ApplicationID)
	case "list_active_alerts":
		var input struct {
			ApplicationID string `json:"applicationId"`
		}
		if err := decodeToolArguments(arguments, &input); err != nil {
			return ToolResult{}, err
		}
		return t.activeAlerts(ctx, input.ApplicationID)
	default:
		return ToolResult{}, errors.New("tool is not allowed")
	}
}

func decodeToolArguments(raw json.RawMessage, target any) error {
	if len(raw) == 0 {
		raw = json.RawMessage(`{}`)
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return errors.New("tool arguments did not match the governed schema")
	}
	return nil
}

func marshalTool(value any, citations ...Citation) (ToolResult, error) {
	encoded, err := json.Marshal(value)
	if err != nil {
		return ToolResult{}, err
	}
	if len(encoded) > 65536 {
		return ToolResult{}, errors.New("tool result exceeded 64 KB")
	}
	return ToolResult{Content: string(encoded), Citations: citations}, nil
}

func (t *RhythmTools) search(ctx context.Context, query string) (ToolResult, error) {
	query = strings.ToLower(strings.TrimSpace(query))
	if len(query) < 2 {
		return ToolResult{}, errors.New("search query must contain at least two characters")
	}
	result := map[string]any{"monitors": []any{}, "applications": []any{}, "services": []any{}, "elfQueries": []any{}}
	monitorHits := []map[string]any{}
	if t.monitors != nil {
		items, err := t.monitors.List(ctx)
		if err != nil {
			return ToolResult{}, err
		}
		for _, item := range items {
			if contains(query, item.ID, item.Name, item.Slug, item.Description, strings.Join(item.Tags, " ")) {
				monitorHits = append(monitorHits, map[string]any{"id": item.ID, "name": item.Name, "slug": item.Slug, "state": item.State, "health": item.Health, "enabled": item.Enabled})
				if len(monitorHits) >= 8 {
					break
				}
			}
		}
	}
	result["monitors"] = monitorHits
	applicationHits := []map[string]any{}
	serviceHits := []map[string]any{}
	queryHits := []map[string]any{}
	if t.elf != nil {
		applications, err := t.elf.ListApplications(ctx)
		if err == nil {
			for _, application := range applications {
				if contains(query, application.ID, application.Name, application.CARID, application.Owner) {
					applicationHits = append(applicationHits, map[string]any{"id": application.ID, "name": application.Name, "carId": application.CARID, "environment": application.Environment})
				}
				for _, service := range application.Services {
					if contains(query, service.ID, service.Name, application.Name) {
						serviceHits = append(serviceHits, map[string]any{"id": service.ID, "name": service.Name, "applicationId": application.ID, "applicationName": application.Name})
					}
				}
			}
		}
		queries, err := t.elf.ListQueries(ctx)
		if err == nil {
			for _, item := range queries {
				if contains(query, item.ID, item.Name, item.Description, item.ApplicationName, item.ServiceName) {
					queryHits = append(queryHits, map[string]any{"id": item.ID, "name": item.Name, "applicationId": item.ApplicationID, "applicationName": item.ApplicationName, "serviceName": item.ServiceName, "gateMode": item.GateMode, "active": item.Active})
					if len(queryHits) >= 8 {
						break
					}
				}
			}
		}
	}
	result["applications"] = applicationHits
	result["services"] = serviceHits
	result["elfQueries"] = queryHits
	return marshalTool(result)
}

func contains(needle string, values ...string) bool {
	for _, value := range values {
		if strings.Contains(strings.ToLower(value), needle) {
			return true
		}
	}
	return false
}

func (t *RhythmTools) monitorHealth(ctx context.Context, monitorID, window string) (ToolResult, error) {
	if t.monitors == nil || t.runs == nil {
		return ToolResult{}, errors.New("monitor evidence is unavailable")
	}
	monitorID = strings.TrimSpace(monitorID)
	if monitorID == "" {
		return ToolResult{}, errors.New("monitorId is required")
	}
	monitor, err := t.monitors.Get(ctx, monitorID)
	if err != nil {
		return ToolResult{}, err
	}
	if window == "" {
		window = "24h"
	}
	metrics, metricsErr := t.runs.MetricsSummary(ctx, monitorID, window)
	recent, runErr := t.runs.ListRecent(ctx, 100)
	var latest any = nil
	if runErr == nil {
		for _, run := range recent {
			if run.MonitorID == monitorID {
				latest = run
				break
			}
		}
	}
	data := map[string]any{"monitor": map[string]any{"id": monitor.ID, "name": monitor.Name, "slug": monitor.Slug, "state": monitor.State, "health": monitor.Health, "enabled": monitor.Enabled, "schedule": monitor.ScheduleSummary, "publishedRevisionId": monitor.LatestPublishedRevisionID, "lastRunAt": monitor.LastRunAt}, "latestRun": latest, "window": window}
	if metricsErr == nil {
		series, seriesErr := t.runs.MetricSeries(ctx, monitorID, window, 50)
		data["metrics"] = compactMonitorMetrics(metrics, series, seriesErr)
	} else {
		data["metricsState"] = "NOT_RECORDED"
	}
	return marshalTool(data, Citation{Label: monitor.Name, ResourceType: "MONITOR", ResourceID: monitor.ID, Href: "/monitors/" + monitor.ID})
}

func compactMonitorMetrics(metrics runs.HistoryMetrics, series []runs.HistoryMetricPoint, seriesErr error) map[string]any {
	points := series
	if seriesErr != nil || len(points) == 0 {
		points = runs.SampleHistoryMetricPoints(metrics.Points, 50)
	}
	compactSeries := make([]map[string]any, 0, len(points))
	for _, point := range points {
		item := map[string]any{
			"at":     point.CreatedAt.UTC().Format(time.RFC3339),
			"status": point.Status,
			"spike":  point.Spike,
		}
		if point.APIResponseTimeMS != nil {
			item["apiResponseTimeMs"] = *point.APIResponseTimeMS
		}
		compactSeries = append(compactSeries, item)
	}
	return map[string]any{
		"window":                     metrics.Window,
		"summary":                    metrics.Summary,
		"percentiles":                metrics.Percentiles,
		"statusDistribution":         metrics.StatusDistribution,
		"failureCategories":          metrics.FailureCategories,
		"responseStatusDistribution": metrics.ResponseStatusDistribution,
		"series":                     compactSeries,
	}
}

func (t *RhythmTools) runDiagnostics(ctx context.Context, runID string) (ToolResult, error) {
	if t.runs == nil {
		return ToolResult{}, errors.New("run evidence is unavailable")
	}
	runID = strings.TrimSpace(runID)
	if runID == "" {
		return ToolResult{}, errors.New("runId is required")
	}
	diagnostics, err := t.runs.DiagnosticsSummary(ctx, runID)
	if err != nil {
		return ToolResult{}, err
	}
	return marshalTool(diagnostics, Citation{Label: "Run " + shortID(runID), ResourceType: "RUN", ResourceID: runID, Href: "/monitors/" + diagnostics.Run.MonitorID + "/runs/" + runID})
}

func (t *RhythmTools) applicationHealth(ctx context.Context, applicationID string) (ToolResult, error) {
	if t.elf == nil {
		return ToolResult{}, errors.New("application evidence is unavailable")
	}
	applicationID = strings.TrimSpace(applicationID)
	if applicationID == "" {
		return ToolResult{}, errors.New("applicationId is required")
	}
	application, err := t.elf.GetApplication(ctx, applicationID)
	if err != nil {
		return ToolResult{}, err
	}
	queries, queryErr := t.elf.ListQueries(ctx)
	linkedQueries := []any{}
	if queryErr == nil {
		for _, query := range queries {
			if query.ApplicationID == applicationID {
				linkedQueries = append(linkedQueries, map[string]any{"id": query.ID, "name": query.Name, "serviceName": query.ServiceName, "active": query.Active, "gateMode": query.GateMode, "lastRun": query.LastRun})
			}
		}
	}
	alertItems := []alerts.Alert{}
	if t.alerts != nil {
		alertItems, _ = t.alerts.ListFiltered(ctx, alerts.Filter{ApplicationID: applicationID})
	}
	active := []alerts.Alert{}
	for _, alert := range alertItems {
		if alert.State != "RESOLVED" {
			active = append(active, alert)
		}
	}
	data := map[string]any{"application": application, "elfQueries": linkedQueries, "activeAlerts": active}
	return marshalTool(data, Citation{Label: application.Name, ResourceType: "APPLICATION", ResourceID: application.ID, Href: "/applications/" + application.ID})
}

func (t *RhythmTools) activeAlerts(ctx context.Context, applicationID string) (ToolResult, error) {
	if t.alerts == nil {
		return ToolResult{}, errors.New("alert evidence is unavailable")
	}
	items, err := t.alerts.ListFiltered(ctx, alerts.Filter{ApplicationID: strings.TrimSpace(applicationID)})
	if err != nil {
		return ToolResult{}, err
	}
	active := []map[string]any{}
	citations := []Citation{}
	for _, item := range items {
		if item.State == "RESOLVED" {
			continue
		}
		active = append(active, map[string]any{"id": item.ID, "title": item.Title, "state": item.State, "severity": item.Severity, "sourceType": item.SourceType, "applicationId": item.ApplicationID, "applicationName": item.ApplicationName, "serviceName": item.ServiceName, "failureCategory": item.FailureCategory, "lastTriggeredAt": item.LastTriggeredAt})
		citations = append(citations, Citation{Label: item.Title, ResourceType: "ALERT", ResourceID: item.ID, Href: "/alerts/" + item.ID})
		if len(active) >= 20 {
			break
		}
	}
	return marshalTool(map[string]any{"count": len(active), "alerts": active}, citations...)
}

func shortID(value string) string {
	if len(value) > 8 {
		return value[:8]
	}
	return value
}
