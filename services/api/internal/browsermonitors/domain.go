package browsermonitors

import "time"

const (
	StatusQueued              = "QUEUED"
	StatusStarting            = "STARTING"
	StatusRunning             = "RUNNING"
	StatusAnalyzing           = "ANALYZING"
	StatusSuccess             = "SUCCESS"
	StatusSuccessWithWarnings = "SUCCESS_WITH_WARNINGS"
	StatusFailed              = "FAILED"
	StatusTimedOut            = "TIMED_OUT"
	StatusCancelled           = "CANCELLED"
	StatusAborted             = "ABORTED"
)

type Monitor struct {
	ID                        string     `json:"id"`
	Name                      string     `json:"name"`
	Slug                      string     `json:"slug"`
	Description               string     `json:"description,omitempty"`
	ApplicationID             string     `json:"applicationId,omitempty"`
	ApplicationName           string     `json:"applicationName,omitempty"`
	ServiceID                 string     `json:"serviceId,omitempty"`
	ServiceName               string     `json:"serviceName,omitempty"`
	EnvironmentProfileID      string     `json:"environmentProfileId,omitempty"`
	EnvironmentName           string     `json:"environmentName,omitempty"`
	State                     string     `json:"state"`
	Health                    string     `json:"health"`
	Enabled                   bool       `json:"enabled"`
	CurrentDraftRevisionID    string     `json:"currentDraftRevisionId,omitempty"`
	LatestPublishedRevisionID string     `json:"latestPublishedRevisionId,omitempty"`
	FrequencySeconds          int        `json:"frequencySeconds"`
	NextRunAt                 *time.Time `json:"nextRunAt,omitempty"`
	LastRunAt                 *time.Time `json:"lastRunAt,omitempty"`
	LastStatus                string     `json:"lastStatus,omitempty"`
	ConsecutiveFailures       int        `json:"consecutiveFailures"`
	CreatedBy                 string     `json:"createdBy"`
	UpdatedBy                 string     `json:"updatedBy"`
	CreatedAt                 time.Time  `json:"createdAt"`
	UpdatedAt                 time.Time  `json:"updatedAt"`
}

type Revision struct {
	ID             string     `json:"id"`
	MonitorID      string     `json:"monitorId"`
	RevisionNumber int        `json:"revisionNumber"`
	Status         string     `json:"status"`
	SchemaVersion  int        `json:"schemaVersion"`
	Definition     Definition `json:"definition"`
	ChangeSummary  string     `json:"changeSummary,omitempty"`
	PublishedBy    string     `json:"publishedBy,omitempty"`
	PublishedAt    *time.Time `json:"publishedAt,omitempty"`
	CreatedBy      string     `json:"createdBy"`
	CreatedAt      time.Time  `json:"createdAt"`
}

type Definition struct {
	SchemaVersion  int               `json:"schemaVersion"`
	StartURL       string            `json:"startUrl"`
	AllowedOrigins []string          `json:"allowedOrigins"`
	Profile        BrowserProfile    `json:"profile"`
	AuthSessionID  string            `json:"authSessionId,omitempty"`
	Agent          AgentRequirements `json:"agent"`
	Steps          []Step            `json:"steps"`
	ArtifactPolicy ArtifactPolicy    `json:"artifactPolicy"`
	MaskSelectors  []string          `json:"maskSelectors"`
}

type BrowserProfile struct {
	Browser        string  `json:"browser"`
	ViewportWidth  int     `json:"viewportWidth"`
	ViewportHeight int     `json:"viewportHeight"`
	DeviceScale    float64 `json:"deviceScaleFactor"`
	IsMobile       bool    `json:"isMobile"`
	Locale         string  `json:"locale"`
	Timezone       string  `json:"timezone"`
	ColorScheme    string  `json:"colorScheme"`
	UserAgent      string  `json:"userAgent,omitempty"`
	NetworkProfile string  `json:"networkProfile"`
}

type AgentRequirements struct {
	AgentID      string   `json:"agentId,omitempty"`
	GroupID      string   `json:"groupId,omitempty"`
	RequiredTags []string `json:"requiredTags,omitempty"`
}

type ArtifactPolicy struct {
	SuccessScreenshotHours int  `json:"successScreenshotHours"`
	FailureEvidenceDays    int  `json:"failureEvidenceDays"`
	CaptureTraceOnFailure  bool `json:"captureTraceOnFailure"`
}

type Locator struct {
	Strategy string `json:"strategy"`
	Value    string `json:"value"`
	Name     string `json:"name,omitempty"`
	Exact    bool   `json:"exact,omitempty"`
	Frame    string `json:"frame,omitempty"`
}

type Step struct {
	ID         string      `json:"id"`
	Name       string      `json:"name"`
	Type       string      `json:"type"`
	Enabled    bool        `json:"enabled"`
	Locator    *Locator    `json:"locator,omitempty"`
	Value      string      `json:"value,omitempty"`
	URL        string      `json:"url,omitempty"`
	Key        string      `json:"key,omitempty"`
	TimeoutMS  int         `json:"timeoutMs"`
	Sensitive  bool        `json:"sensitive,omitempty"`
	WaitUntil  string      `json:"waitUntil,omitempty"`
	Checks     []Check     `json:"checks,omitempty"`
	Graph      *GraphCheck `json:"graph,omitempty"`
	Screenshot *Screenshot `json:"screenshot,omitempty"`
}

type Check struct {
	ID        string   `json:"id"`
	Name      string   `json:"name"`
	Kind      string   `json:"kind"`
	Operator  string   `json:"operator"`
	Expected  string   `json:"expected,omitempty"`
	Threshold float64  `json:"threshold,omitempty"`
	GateMode  string   `json:"gateMode"`
	Locator   *Locator `json:"locator,omitempty"`
	Enabled   bool     `json:"enabled"`
}

type GraphCheck struct {
	Source             string   `json:"source"`
	ResponseURLPattern string   `json:"responseUrlPattern,omitempty"`
	ValuePath          string   `json:"valuePath,omitempty"`
	SeriesPath         string   `json:"seriesPath,omitempty"`
	TimestampPath      string   `json:"timestampPath,omitempty"`
	Aggregation        string   `json:"aggregation"`
	Operator           string   `json:"operator"`
	Threshold          float64  `json:"threshold"`
	DropPercent        float64  `json:"dropPercent,omitempty"`
	ConsecutiveRuns    int      `json:"consecutiveRuns,omitempty"`
	GateMode           string   `json:"gateMode"`
	VisualRegion       *Region  `json:"visualRegion,omitempty"`
	ExpectedSeries     []string `json:"expectedSeries,omitempty"`
}

type Region struct {
	X      float64 `json:"x"`
	Y      float64 `json:"y"`
	Width  float64 `json:"width"`
	Height float64 `json:"height"`
}

type Screenshot struct {
	FullPage      bool     `json:"fullPage"`
	CheckpointID  string   `json:"checkpointId"`
	DiffThreshold float64  `json:"diffThreshold"`
	MaskSelectors []string `json:"maskSelectors,omitempty"`
}

type CreateInput struct {
	Name                 string     `json:"name"`
	Slug                 string     `json:"slug"`
	Description          string     `json:"description,omitempty"`
	ApplicationID        string     `json:"applicationId,omitempty"`
	ServiceID            string     `json:"serviceId,omitempty"`
	EnvironmentProfileID string     `json:"environmentProfileId,omitempty"`
	FrequencySeconds     int        `json:"frequencySeconds,omitempty"`
	Enabled              bool       `json:"enabled"`
	Definition           Definition `json:"definition"`
}

type UpdateInput struct {
	Name                 *string `json:"name,omitempty"`
	Description          *string `json:"description,omitempty"`
	ApplicationID        *string `json:"applicationId,omitempty"`
	ServiceID            *string `json:"serviceId,omitempty"`
	EnvironmentProfileID *string `json:"environmentProfileId,omitempty"`
	FrequencySeconds     *int    `json:"frequencySeconds,omitempty"`
	Enabled              *bool   `json:"enabled,omitempty"`
}

type Event struct {
	Type       string         `json:"type"`
	Message    string         `json:"message"`
	StepID     string         `json:"stepId,omitempty"`
	Category   string         `json:"category,omitempty"`
	Details    map[string]any `json:"details,omitempty"`
	OccurredAt time.Time      `json:"occurredAt"`
	DurationMS int64          `json:"durationMs,omitempty"`
}

type CheckResult struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Kind     string `json:"kind"`
	GateMode string `json:"gateMode"`
	Passed   bool   `json:"passed"`
	Expected any    `json:"expected,omitempty"`
	Observed any    `json:"observed,omitempty"`
	Error    string `json:"error,omitempty"`
}

type StepRun struct {
	ID               string         `json:"id"`
	StepDefinitionID string         `json:"stepDefinitionId"`
	StepOrder        int            `json:"stepOrder"`
	Name             string         `json:"name"`
	Type             string         `json:"type"`
	Status           string         `json:"status"`
	DurationMS       int64          `json:"durationMs"`
	LocatorEvidence  map[string]any `json:"locatorEvidence"`
	CheckResults     []CheckResult  `json:"checkResults"`
	Timing           map[string]any `json:"timing"`
	FailureCategory  string         `json:"failureCategory,omitempty"`
	FailureReason    string         `json:"failureReason,omitempty"`
	StartedAt        *time.Time     `json:"startedAt,omitempty"`
	EndedAt          *time.Time     `json:"endedAt,omitempty"`
}

type Artifact struct {
	ID           string         `json:"id"`
	RunID        string         `json:"runId,omitempty"`
	MonitorID    string         `json:"monitorId"`
	Kind         string         `json:"kind"`
	ObjectKey    string         `json:"-"`
	ContentType  string         `json:"contentType"`
	ByteSize     int64          `json:"byteSize"`
	CaptureState string         `json:"captureState"`
	Masked       bool           `json:"masked"`
	Metadata     map[string]any `json:"metadata,omitempty"`
	ExpiresAt    *time.Time     `json:"expiresAt,omitempty"`
	CreatedAt    time.Time      `json:"createdAt"`
}

type Run struct {
	ID                string           `json:"id"`
	MonitorID         string           `json:"monitorId"`
	MonitorName       string           `json:"monitorName,omitempty"`
	RevisionID        string           `json:"revisionId"`
	Status            string           `json:"status"`
	TriggerType       string           `json:"triggerType"`
	TriggerSource     string           `json:"triggerSource,omitempty"`
	AgentID           string           `json:"agentId,omitempty"`
	BrowserName       string           `json:"browserName"`
	BrowserVersion    string           `json:"browserVersion,omitempty"`
	AgentImageVersion string           `json:"agentImageVersion,omitempty"`
	Viewport          map[string]any   `json:"viewport"`
	ExecutionProfile  map[string]any   `json:"executionProfile"`
	Metrics           map[string]any   `json:"metrics"`
	GraphEvidence     []map[string]any `json:"graphEvidence"`
	VisualEvidence    []map[string]any `json:"visualEvidence"`
	NetworkSummary    map[string]any   `json:"networkSummary"`
	ConsoleEvents     []map[string]any `json:"consoleEvents"`
	Events            []Event          `json:"events"`
	Steps             []StepRun        `json:"steps"`
	Artifacts         []Artifact       `json:"artifacts"`
	FailureCategory   string           `json:"failureCategory,omitempty"`
	FailureReason     string           `json:"failureReason,omitempty"`
	FailedStepID      string           `json:"failedStepId,omitempty"`
	QueueDelayMS      int64            `json:"queueDelayMs"`
	DurationMS        int64            `json:"durationMs"`
	WarningCount      int              `json:"warningCount"`
	StartedAt         *time.Time       `json:"startedAt,omitempty"`
	EndedAt           *time.Time       `json:"endedAt,omitempty"`
	CreatedAt         time.Time        `json:"createdAt"`
}

type Baseline struct {
	ID                string         `json:"id"`
	MonitorID         string         `json:"monitorId"`
	RevisionID        string         `json:"revisionId"`
	CheckpointID      string         `json:"checkpointId"`
	Fingerprint       string         `json:"fingerprint"`
	ArtifactID        string         `json:"artifactId"`
	Status            string         `json:"status"`
	BrowserVersion    string         `json:"browserVersion"`
	AgentImageVersion string         `json:"agentImageVersion"`
	Viewport          map[string]any `json:"viewport"`
	ApprovedBy        string         `json:"approvedBy,omitempty"`
	ApprovedAt        *time.Time     `json:"approvedAt,omitempty"`
	CreatedAt         time.Time      `json:"createdAt"`
}

type Statistics struct {
	SampleCount       int     `json:"sampleCount"`
	MinimumMS         *int64  `json:"minimumMs"`
	AverageMS         *int64  `json:"averageMs"`
	P50MS             *int64  `json:"p50Ms"`
	P75MS             *int64  `json:"p75Ms"`
	P90MS             *int64  `json:"p90Ms"`
	P95MS             *int64  `json:"p95Ms"`
	P99MS             *int64  `json:"p99Ms"`
	MaximumMS         *int64  `json:"maximumMs"`
	StandardDeviation float64 `json:"standardDeviation"`
}

type Metrics struct {
	MonitorID           string                `json:"monitorId"`
	Range               string                `json:"range"`
	RunCount            int                   `json:"runCount"`
	SuccessRate         float64               `json:"successRate"`
	FailureRate         float64               `json:"failureRate"`
	Journey             Statistics            `json:"journey"`
	MetricDistributions map[string]Statistics `json:"metricDistributions"`
	Series              []map[string]any      `json:"series"`
	GraphSeries         []map[string]any      `json:"graphSeries"`
	FailureCategories   map[string]int        `json:"failureCategories"`
}

type AuthSession struct {
	ID                   string     `json:"id"`
	Name                 string     `json:"name"`
	ApplicationID        string     `json:"applicationId,omitempty"`
	EnvironmentProfileID string     `json:"environmentProfileId,omitempty"`
	Mode                 string     `json:"mode"`
	AllowedOrigins       []string   `json:"allowedOrigins"`
	Status               string     `json:"status"`
	ExpiresAt            *time.Time `json:"expiresAt,omitempty"`
	LastValidatedAt      *time.Time `json:"lastValidatedAt,omitempty"`
	CreatedBy            string     `json:"createdBy"`
	UpdatedBy            string     `json:"updatedBy"`
	CreatedAt            time.Time  `json:"createdAt"`
	UpdatedAt            time.Time  `json:"updatedAt"`
}
