package investigation

import "time"

const (
	KindELFQuery   = "ELF_QUERY"
	KindDynatrace  = "DYNATRACE"
	StatusPending  = "PENDING"
	StatusRunning  = "RUNNING"
	StatusPassed   = "PASSED"
	StatusFailed   = "FAILED"
	StatusError    = "ERROR"
	StatusSkipped  = "SKIPPED"
	MaxPlaybookLen = 20
)

type Check struct {
	ID                   string   `json:"id"`
	Kind                 string   `json:"kind"`
	Label                string   `json:"label"`
	QueryID              string   `json:"queryId,omitempty"`
	ApplicationID        string   `json:"applicationId,omitempty"`
	EnvironmentBindingID string   `json:"environmentBindingId,omitempty"`
	ServiceIDs           []string `json:"serviceIds,omitempty"`
	Blocking             bool     `json:"blocking,omitempty"`
}

type Result struct {
	ID                   string         `json:"id"`
	AlertID              string         `json:"alertId"`
	CheckID              string         `json:"checkId"`
	MonitorID            string         `json:"monitorId,omitempty"`
	RunID                string         `json:"runId,omitempty"`
	Kind                 string         `json:"kind"`
	Label                string         `json:"label"`
	QueryID              string         `json:"queryId,omitempty"`
	ApplicationID        string         `json:"applicationId,omitempty"`
	EnvironmentBindingID string         `json:"environmentBindingId,omitempty"`
	ServiceIDs           []string       `json:"serviceIds,omitempty"`
	Status               string         `json:"status"`
	Attempt              int            `json:"attempt"`
	Position             int            `json:"position"`
	Summary              string         `json:"summary"`
	Evidence             map[string]any `json:"evidence"`
	LastError            string         `json:"lastError,omitempty"`
	StartedAt            *time.Time     `json:"startedAt,omitempty"`
	EndedAt              *time.Time     `json:"endedAt,omitempty"`
	CreatedAt            time.Time      `json:"createdAt"`
	UpdatedAt            time.Time      `json:"updatedAt"`
}

type Item struct {
	ID                   string         `json:"id"`
	Kind                 string         `json:"kind"`
	Label                string         `json:"label"`
	QueryID              string         `json:"queryId,omitempty"`
	ApplicationID        string         `json:"applicationId,omitempty"`
	EnvironmentBindingID string         `json:"environmentBindingId,omitempty"`
	ServiceIDs           []string       `json:"serviceIds,omitempty"`
	Status               string         `json:"status"`
	Attempt              int            `json:"attempt"`
	Summary              string         `json:"summary"`
	Evidence             map[string]any `json:"evidence"`
	LastError            string         `json:"lastError,omitempty"`
	StartedAt            *time.Time     `json:"startedAt,omitempty"`
	EndedAt              *time.Time     `json:"endedAt,omitempty"`
	ELFHref              string         `json:"elfHref,omitempty"`
	DynatraceHref        string         `json:"dynatraceHref,omitempty"`
}

type Report struct {
	AlertID string `json:"alertId"`
	RunID   string `json:"runId,omitempty"`
	Items   []Item `json:"items"`
}
