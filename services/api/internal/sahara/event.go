package sahara

import (
	"strings"
	"time"
	"unicode/utf8"
)

const (
	defaultEventGenerator  = "Rhythm"
	defaultNumericSeverity = 4
	eventClass             = "Synthetic"
	monitorFailureType     = "Monitor Failure"
	browserFailureType     = "Browser Monitor Failure"
)

type ApplicationSettings struct {
	Enabled             bool
	Name                string
	AssignmentGroup     string
	ReporterGroup       string
	EnvironmentAffected string
	EventGenerator      string
	DefaultSeverity     string
}

type AlertContext struct {
	AlertID          string
	MonitorID        string
	BrowserMonitorID string
	MonitorName      string
	SourceType       string
	Severity         string
	Title            string
	Description      string
	FailureCategory  string
	RunID            string
	OccurredAt       time.Time
}

type Event struct {
	EventGenerator string    `json:"event_generator"`
	SourceID       string    `json:"source_id"`
	Source         string    `json:"source"`
	EventUniqueID  string    `json:"event_unique_id"`
	Severity       int       `json:"severity"`
	Description    string    `json:"description"`
	Class          string    `json:"class"`
	Type           string    `json:"type"`
	Timestamp      string    `json:"timestamp"`
	Ticketing      Ticketing `json:"ticketing"`
}

type Ticketing struct {
	Enabled             bool   `json:"enabled"`
	AssignmentGroup     string `json:"assignment_group"`
	ReporterGroup       string `json:"reporter_group"`
	Summary             string `json:"summary"`
	EnvironmentAffected string `json:"environment_affected,omitempty"`
	Severity            string `json:"severity"`
}

// Prepare builds a Sahara incident payload. A non-empty skip reason means
// dispatch should be recorded as skipped and no HTTP call should be made.
func Prepare(app *ApplicationSettings, ingestURL string, alert AlertContext) (Event, string) {
	if strings.TrimSpace(ingestURL) == "" {
		return Event{}, "ingest url not configured"
	}
	if app == nil {
		return Event{}, "no application"
	}
	if !app.Enabled {
		return Event{}, "disabled"
	}
	assignment := strings.TrimSpace(app.AssignmentGroup)
	if assignment == "" {
		return Event{}, "incomplete"
	}

	source := firstNonEmpty(strings.TrimSpace(app.Name), strings.TrimSpace(alert.MonitorName), "rhythm")
	sourceID := firstNonEmpty(strings.TrimSpace(alert.MonitorID), strings.TrimSpace(alert.BrowserMonitorID), strings.TrimSpace(alert.AlertID))
	monitorPart := firstNonEmpty(strings.TrimSpace(alert.MonitorID), strings.TrimSpace(alert.BrowserMonitorID), strings.TrimSpace(alert.FailureCategory), "alert")
	reporter := strings.TrimSpace(app.ReporterGroup)
	if reporter == "" {
		reporter = assignment
	}
	occurred := alert.OccurredAt
	if occurred.IsZero() {
		occurred = time.Now().UTC()
	}

	event := Event{
		EventGenerator: firstNonEmpty(strings.TrimSpace(app.EventGenerator), defaultEventGenerator),
		SourceID:       sourceID,
		Source:         source,
		EventUniqueID:  source + "::" + monitorPart + "::" + strings.TrimSpace(alert.AlertID),
		Severity:       NumericSeverity(alert.Severity),
		Description:    clip(failureDescription(alert), 4000),
		Class:          eventClass,
		Type:           eventType(alert.SourceType),
		Timestamp:      occurred.UTC().Format(time.RFC3339Nano),
		Ticketing: Ticketing{
			Enabled:             true,
			AssignmentGroup:     assignment,
			ReporterGroup:       reporter,
			Summary:             clip(failureSummary(alert), 255),
			EnvironmentAffected: strings.TrimSpace(app.EnvironmentAffected),
			Severity:            TicketSeverity(app.DefaultSeverity, alert.Severity),
		},
	}
	return event, ""
}

func NumericSeverity(value string) int {
	switch strings.ToUpper(strings.TrimSpace(value)) {
	case "1", "CRITICAL":
		return 1
	case "2", "HIGH":
		return 2
	case "3", "WARNING", "MEDIUM":
		return 3
	case "4", "LOW", "INFO":
		return 4
	default:
		return defaultNumericSeverity
	}
}

func TicketSeverity(applicationDefault, alertSeverity string) string {
	if normalized := normalizeTicketSeverity(applicationDefault); normalized != "" {
		return normalized
	}
	switch strings.ToUpper(strings.TrimSpace(alertSeverity)) {
	case "CRITICAL", "1":
		return "Sev1"
	case "HIGH", "2":
		return "Sev2"
	case "WARNING", "MEDIUM", "3":
		return "Sev3"
	default:
		return "Sev4"
	}
}

func normalizeTicketSeverity(value string) string {
	switch strings.TrimSpace(value) {
	case "Sev1", "Sev2", "Sev3", "Sev4":
		return strings.TrimSpace(value)
	default:
		return ""
	}
}

func alertSeverityFromTicket(value string) string {
	switch normalizeTicketSeverity(value) {
	case "Sev1":
		return "CRITICAL"
	case "Sev2":
		return "HIGH"
	case "Sev3":
		return "WARNING"
	default:
		return "INFO"
	}
}

func eventType(sourceType string) string {
	if strings.EqualFold(strings.TrimSpace(sourceType), "RHYTHM_BROWSER_MONITOR") {
		return browserFailureType
	}
	return monitorFailureType
}

func failureSummary(alert AlertContext) string {
	if title := strings.TrimSpace(alert.Title); title != "" {
		return title
	}
	name := strings.TrimSpace(alert.MonitorName)
	if name == "" {
		name = "Monitor"
	}
	return name + " is failing"
}

func failureDescription(alert AlertContext) string {
	parts := make([]string, 0, 3)
	if reason := strings.TrimSpace(alert.Description); reason != "" {
		parts = append(parts, reason)
	}
	if name := strings.TrimSpace(alert.MonitorName); name != "" {
		parts = append(parts, "Monitor: "+name)
	}
	if runID := strings.TrimSpace(alert.RunID); runID != "" {
		parts = append(parts, "Run: "+runID)
	}
	if len(parts) == 0 {
		return failureSummary(alert)
	}
	return strings.Join(parts, " · ")
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func clip(value string, max int) string {
	if max <= 0 || utf8.RuneCountInString(value) <= max {
		return value
	}
	runes := []rune(value)
	return string(runes[:max])
}
