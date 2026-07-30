package runs

import (
	"time"

	"github.com/rhythm-monitoring/rhythm/internal/scripts"
)

type Status string

const (
	StatusQueued              Status = "QUEUED"
	StatusStarting            Status = "STARTING"
	StatusRunning             Status = "RUNNING"
	StatusSuccess             Status = "SUCCESS"
	StatusSuccessWithWarnings Status = "SUCCESS_WITH_WARNINGS"
	StatusFailed              Status = "FAILED"
	StatusTimedOut            Status = "TIMED_OUT"
	StatusCancelled           Status = "CANCELLED"
	StatusAborted             Status = "ABORTED"
	StatusSkipped             Status = "SKIPPED_CONDITION"
)

type Run struct {
	ID               string          `json:"id"`
	MonitorID        string          `json:"monitorId"`
	RevisionID       string          `json:"revisionId"`
	Status           Status          `json:"status"`
	TriggerType      string          `json:"triggerType"`
	TriggerSource    string          `json:"triggerSource,omitempty"`
	AgentID          string          `json:"agentId,omitempty"`
	FailureCategory  string          `json:"failureCategory,omitempty"`
	FailureReason    string          `json:"failureReason,omitempty"`
	FailedStepID     string          `json:"failedStepId,omitempty"`
	QueueDelayMS      int64           `json:"queueDelayMs,omitempty"`
	WarningCount      int             `json:"warningCount"`
	DurationMS        int64           `json:"durationMs"`
	APIResponseTimeMS *int64          `json:"apiResponseTimeMs,omitempty"`
	StartedAt         *time.Time      `json:"startedAt,omitempty"`
	EndedAt           *time.Time      `json:"endedAt,omitempty"`
	CreatedAt         time.Time       `json:"createdAt"`
	ExecutionContext  map[string]any  `json:"executionContext,omitempty"`
	AlertImpact       map[string]any  `json:"alertImpact,omitempty"`
	Events            []RunEvent      `json:"events,omitempty"`
	Steps             []StepRun       `json:"steps,omitempty"`
	SetupScript       *scripts.Result `json:"setupScript,omitempty"`
}

type RunEvent struct {
	ID            string         `json:"id"`
	Sequence      int            `json:"sequence"`
	Type          string         `json:"type"`
	Status        Status         `json:"status,omitempty"`
	StepRunID     string         `json:"stepRunId,omitempty"`
	StepID        string         `json:"stepId,omitempty"`
	AttemptNumber int            `json:"attemptNumber,omitempty"`
	Category      string         `json:"category,omitempty"`
	Message       string         `json:"message"`
	Details       map[string]any `json:"details,omitempty"`
	OccurredAt    time.Time      `json:"occurredAt"`
	DurationMS    int64          `json:"durationMs,omitempty"`
}

type StepRun struct {
	ID               string            `json:"id"`
	RunID            string            `json:"runId"`
	StepDefinitionID string            `json:"stepDefinitionId"`
	StepOrder        int               `json:"stepOrder"`
	StepName         string            `json:"stepName"`
	StepType         string            `json:"stepType"`
	Status           Status            `json:"status"`
	RequestSummary   map[string]any    `json:"requestSummary,omitempty"`
	ResponseSummary  map[string]any    `json:"responseSummary,omitempty"`
	Timing           map[string]any    `json:"timing,omitempty"`
	TLS              map[string]any    `json:"tls,omitempty"`
	Proxy            map[string]any    `json:"proxy,omitempty"`
	AttemptCount     int               `json:"attemptCount"`
	Attempts         []AttemptRun      `json:"attempts,omitempty"`
	Extractors       []ExtractorResult `json:"extractors"`
	Assertions       []AssertionResult `json:"assertions"`
	Outputs          map[string]any    `json:"outputs,omitempty"`
	// PrivateOutputs carries sensitive extractor values between workflow steps.
	// It is never serialized or persisted with run evidence.
	PrivateOutputs   map[string]string `json:"-"`
	FailureCategory  string            `json:"failureCategory,omitempty"`
	ErrorMessage     string            `json:"errorMessage,omitempty"`
	DurationMS       int64             `json:"durationMs"`
	StartedAt        *time.Time        `json:"startedAt,omitempty"`
	EndedAt          *time.Time        `json:"endedAt,omitempty"`
	PreRequestScript *scripts.Result   `json:"preRequestScript,omitempty"`
	TestScript       *scripts.Result   `json:"testScript,omitempty"`
}

type AttemptRun struct {
	ID              string           `json:"id"`
	AttemptNumber   int              `json:"attemptNumber"`
	Status          Status           `json:"status"`
	ResponseStatus  int              `json:"responseStatus,omitempty"`
	FailureCategory string           `json:"failureCategory,omitempty"`
	ErrorMessage    string           `json:"errorMessage,omitempty"`
	RequestSummary  map[string]any   `json:"requestSummary,omitempty"`
	ResponseSummary map[string]any   `json:"responseSummary,omitempty"`
	Timing          map[string]any   `json:"timing,omitempty"`
	TLS             map[string]any   `json:"tls,omitempty"`
	Proxy           map[string]any   `json:"proxy,omitempty"`
	Redirects       []map[string]any `json:"redirects,omitempty"`
	RetryBackoffMS  int64            `json:"retryBackoffMs,omitempty"`
	StartedAt       time.Time        `json:"startedAt"`
	EndedAt         time.Time        `json:"endedAt"`
	DurationMS      int64            `json:"durationMs"`
}

type ExtractorResult struct {
	Variable  string `json:"variable"`
	Source    string `json:"source"`
	Value     any    `json:"value,omitempty"`
	Sensitive bool   `json:"sensitive"`
	Success   bool   `json:"success"`
	Error     string `json:"error,omitempty"`
}

type AssertionResult struct {
	Type       string `json:"type"`
	Expression string `json:"expression"`
	Expected   string `json:"expected"`
	Observed   any    `json:"observed,omitempty"`
	Passed     bool   `json:"passed"`
	Error      string `json:"error,omitempty"`
}

type Definition struct {
	SchemaVersion int               `json:"schemaVersion,omitempty"`
	Scripts       DefinitionScripts `json:"scripts,omitempty"`
	Steps         []StepDefinition  `json:"steps"`
	Agent         AgentRequirements `json:"agent,omitempty"`
}

type DefinitionScripts struct {
	PreRequest scripts.Script `json:"preRequest,omitempty"`
}

type AgentRequirements struct {
	AgentID              string   `json:"agentId,omitempty"`
	GroupID              string   `json:"groupId,omitempty"`
	RequiredTags         []string `json:"requiredTags,omitempty"`
	RequiredCapabilities []string `json:"requiredCapabilities,omitempty"`
}

type StepDefinition struct {
	ID        string                 `json:"id"`
	Name      string                 `json:"name"`
	Type      string                 `json:"type"`
	Enabled   bool                   `json:"enabled"`
	TimeoutMS int                    `json:"timeoutMs"`
	Request   RequestConfig          `json:"request"`
	Actions   []ActionConfig         `json:"actions"`
	Condition string                 `json:"condition,omitempty"`
	Metric    MetricValidationConfig `json:"metric,omitempty"`
}

type MetricValidationConfig struct {
	Provider          string  `json:"provider"`
	ProfileID         string  `json:"profileId"`
	MetricSelector    string  `json:"metricSelector"`
	EntitySelector    string  `json:"entitySelector,omitempty"`
	Aggregation       string  `json:"aggregation"`
	Window            string  `json:"window"`
	Resolution        string  `json:"resolution,omitempty"`
	BaselineWindow    string  `json:"baselineWindow,omitempty"`
	Operator          string  `json:"operator"`
	Threshold         float64 `json:"threshold"`
	MissingDataPolicy string  `json:"missingDataPolicy"`
}

type KeyValue struct {
	Enabled   bool   `json:"enabled"`
	Key       string `json:"key"`
	Value     string `json:"value"`
	Sensitive bool   `json:"sensitive"`
}

type RequestConfig struct {
	Method           string            `json:"method"`
	URL              string            `json:"url"`
	Params           []KeyValue        `json:"params"`
	Headers          []KeyValue        `json:"headers"`
	Cookies          []CookieConfig    `json:"cookies"`
	PersistCookies   bool              `json:"persistCookies"`
	Auth             AuthConfig        `json:"auth"`
	Body             BodyConfig        `json:"body"`
	PreRequest       []ActionConfig    `json:"preRequest"`
	PreRequestScript scripts.Script    `json:"preRequestScript,omitempty"`
	TestScript       scripts.Script    `json:"testScript,omitempty"`
	Extractors       []ExtractorConfig `json:"extractors"`
	Assertions       []AssertionConfig `json:"assertions"`
	Settings         SettingsConfig    `json:"settings"`
	TLS              TLSConfig         `json:"tls"`
	Proxy            ProxyConfig       `json:"proxy"`
}

type CookieConfig struct {
	Enabled   bool   `json:"enabled"`
	Key       string `json:"key"`
	Value     string `json:"value"`
	Domain    string `json:"domain"`
	Path      string `json:"path"`
	Sensitive bool   `json:"sensitive"`
}

type AuthConfig struct {
	Type   string            `json:"type"`
	Fields map[string]string `json:"fields"`
}

type BodyConfig struct {
	Type    string `json:"type"`
	Content string `json:"content"`
}

type ActionConfig struct {
	Enabled    bool              `json:"enabled"`
	Type       string            `json:"type"`
	Output     string            `json:"output"`
	Expression string            `json:"expression"`
	Sensitive  bool              `json:"sensitive"`
	Fields     map[string]string `json:"fields,omitempty"`
}

type ExtractorConfig struct {
	Enabled    bool   `json:"enabled"`
	Source     string `json:"source"`
	Variable   string `json:"variable"`
	Expression string `json:"expression"`
	Sensitive  bool   `json:"sensitive"`
}

type AssertionConfig struct {
	Enabled    bool   `json:"enabled"`
	Type       string `json:"type"`
	Expression string `json:"expression"`
	Expected   string `json:"expected"`
	Operator   string `json:"operator,omitempty"`
}

type SettingsConfig struct {
	FollowRedirects bool   `json:"followRedirects"`
	MaxRedirects    int    `json:"maxRedirects"`
	Compression     bool   `json:"compression"`
	TimeoutMS       int    `json:"timeoutMs"`
	CaptureBody     bool   `json:"captureBody"`
	MaxBodyBytes    int    `json:"maxBodyBytes"`
	Retries         int    `json:"retries"`
	RetryBackoff    string `json:"retryBackoff"`
}

type TLSConfig struct {
	CertificateProfileID string `json:"certificateProfileId"`
	CAProfileID          string `json:"caProfileId"`
	MinimumVersion       string `json:"minimumVersion"`
	VerifyHostname       *bool  `json:"verifyHostname"`
}

type ProxyConfig struct {
	Mode              string `json:"mode"`
	ProfileID         string `json:"profileId"`
	URL               string `json:"url"`
	NoProxy           string `json:"noProxy"`
	UsernameSecretRef string `json:"usernameSecretRef"`
	PasswordSecretRef string `json:"passwordSecretRef"`
}
