package monitors

import "time"

type State string

const (
	StateDraft     State = "DRAFT"
	StatePublished State = "PUBLISHED"
	StateEnabled   State = "ENABLED"
	StateDisabled  State = "DISABLED"
	StateArchived  State = "ARCHIVED"
)

type Health string

const (
	HealthUnknown Health = "UNKNOWN"
	HealthHealthy Health = "HEALTHY"
	HealthWarning Health = "WARNING"
	HealthFailing Health = "FAILING"
	HealthPaused  Health = "PAUSED"
)

type Monitor struct {
	ID                        string     `json:"id"`
	Name                      string     `json:"name"`
	Slug                      string     `json:"slug"`
	Description               string     `json:"description,omitempty"`
	OwnerID                   string     `json:"ownerId,omitempty"`
	Tags                      []string   `json:"tags"`
	EnvironmentID             string     `json:"environmentId,omitempty"`
	State                     State      `json:"state"`
	Health                    Health     `json:"health"`
	Enabled                   bool       `json:"enabled"`
	CurrentDraftRevisionID    string     `json:"currentDraftRevisionId,omitempty"`
	LatestPublishedRevisionID string     `json:"latestPublishedRevisionId,omitempty"`
	StepCount                 int        `json:"stepCount"`
	ScheduleSummary           string     `json:"scheduleSummary,omitempty"`
	SuccessRate24h            *float64   `json:"successRate24h,omitempty"`
	LastLatencyMS             *int64     `json:"lastLatencyMs,omitempty"`
	LastRunAt                 *time.Time `json:"lastRunAt,omitempty"`
	CreatedBy                 string     `json:"createdBy"`
	UpdatedBy                 string     `json:"updatedBy"`
	CreatedAt                 time.Time  `json:"createdAt"`
	UpdatedAt                 time.Time  `json:"updatedAt"`
}

type RevisionStatus string

const (
	RevisionDraft     RevisionStatus = "DRAFT"
	RevisionPublished RevisionStatus = "PUBLISHED"
)

type Revision struct {
	ID             string         `json:"id"`
	MonitorID      string         `json:"monitorId"`
	RevisionNumber int            `json:"revisionNumber"`
	Status         RevisionStatus `json:"status"`
	SchemaVersion  int            `json:"schemaVersion"`
	Definition     map[string]any `json:"definition"`
	ChangeSummary  string         `json:"changeSummary,omitempty"`
	PublishedBy    string         `json:"publishedBy,omitempty"`
	PublishedAt    *time.Time     `json:"publishedAt,omitempty"`
	CreatedBy      string         `json:"createdBy"`
	CreatedAt      time.Time      `json:"createdAt"`
}

type CreateInput struct {
	Name          string         `json:"name"`
	Slug          string         `json:"slug"`
	Description   string         `json:"description,omitempty"`
	OwnerID       string         `json:"ownerId,omitempty"`
	Tags          []string       `json:"tags,omitempty"`
	EnvironmentID string         `json:"environmentId,omitempty"`
	Definition    map[string]any `json:"definition,omitempty"`
}

type UpdateInput struct {
	Name          *string   `json:"name,omitempty"`
	Slug          *string   `json:"slug,omitempty"`
	Description   *string   `json:"description,omitempty"`
	OwnerID       *string   `json:"ownerId,omitempty"`
	Tags          *[]string `json:"tags,omitempty"`
	EnvironmentID *string   `json:"environmentId,omitempty"`
}

type DraftInput struct {
	Definition map[string]any `json:"definition"`
}

type PublishInput struct {
	ChangeSummary string `json:"changeSummary,omitempty"`
}

type CloneInput struct {
	Name string `json:"name"`
	Slug string `json:"slug"`
}
