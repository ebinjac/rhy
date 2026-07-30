package dynatrace

import (
	"context"
	"time"
)

const (
	DefaultBaseURL    = "https://amex-prod.live.dynatrace.com"
	HydraCPUMetric    = "builtin:containers.cpu.usagePercent"
	HydraMemoryMetric = "builtin:containers.memory.usagePercent"
	TIMSCPUMetric     = "builtin:host.cpu.usage"
	TIMSMemoryMetric  = "builtin:host.mem.usage"
)

var (
	ErrNotFound      = errorString("Dynatrace resource was not found")
	ErrNotConfigured = errorString("Dynatrace is not configured for this application environment")
)

type errorString string

func (e errorString) Error() string { return string(e) }

type SecretResolver interface {
	ResolveSecret(context.Context, string) (string, error)
}

type ProfileReader interface {
	Get(context.Context, string) (Profile, error)
}

type Profile struct {
	ID          string
	Name        string
	Kind        string
	ProfileType string
	Config      map[string]any
	Active      bool
	UpdatedAt   time.Time
}

type EnvironmentBinding struct {
	ID                   string    `json:"id"`
	ApplicationID        string    `json:"applicationId"`
	EnvironmentProfileID string    `json:"environmentProfileId,omitempty"`
	EnvironmentName      string    `json:"environmentName"`
	EnvironmentType      string    `json:"environmentType"`
	BaseURLHost          string    `json:"baseUrlHost,omitempty"`
	Enabled              bool      `json:"enabled"`
	DynatraceConfigured  bool      `json:"dynatraceConfigured"`
	CreatedAt            time.Time `json:"createdAt"`
	UpdatedAt            time.Time `json:"updatedAt"`
}

type EnvironmentBindingInput struct {
	EnvironmentProfileID string `json:"environmentProfileId"`
	Enabled              *bool  `json:"enabled,omitempty"`
}

type MetricMapping struct {
	CPU         string `json:"cpu,omitempty"`
	Memory      string `json:"memory,omitempty"`
	HydraCPU    string `json:"hydraCpu,omitempty"`
	HydraMemory string `json:"hydraMemory,omitempty"`
	TIMSCPU     string `json:"timsCpu,omitempty"`
	TIMSMemory  string `json:"timsMemory,omitempty"`
}

type Configuration struct {
	ID                    string            `json:"id"`
	ApplicationID         string            `json:"applicationId"`
	EnvironmentBindingID  string            `json:"environmentBindingId"`
	ConnectionProfileID   string            `json:"connectionProfileId"`
	ConnectionName        string            `json:"connectionName,omitempty"`
	BaseURL               string            `json:"baseUrl,omitempty"`
	CredentialSecretRef   string            `json:"credentialSecretRef,omitempty"`
	EffectiveCredential   string            `json:"effectiveCredential,omitempty"`
	Platforms             []string          `json:"platforms"`
	ManagementZones       []string          `json:"managementZones"`
	MetricMappings        MetricMapping     `json:"metricMappings"`
	BaselineWindowSeconds int               `json:"baselineWindowSeconds"`
	StabilizationSeconds  int               `json:"stabilizationSeconds"`
	PostWindowSeconds     int               `json:"postWindowSeconds"`
	Enabled               bool              `json:"enabled"`
	RevisionNumber        int               `json:"revisionNumber"`
	LastTestStatus        string            `json:"lastTestStatus"`
	LastTestError         string            `json:"lastTestError,omitempty"`
	LastTestAt            *time.Time        `json:"lastTestAt,omitempty"`
	ResourceMappings      []ResourceMapping `json:"resourceMappings"`
	Rules                 []Rule            `json:"rules"`
	ServiceOverrides      []ServiceConfig   `json:"serviceOverrides"`
	CreatedAt             time.Time         `json:"createdAt"`
	UpdatedAt             time.Time         `json:"updatedAt"`
}

type ConfigurationInput struct {
	ConnectionProfileID   string            `json:"connectionProfileId"`
	CredentialSecretRef   string            `json:"credentialSecretRef,omitempty"`
	Platforms             []string          `json:"platforms"`
	ManagementZones       []string          `json:"managementZones"`
	MetricMappings        MetricMapping     `json:"metricMappings"`
	BaselineWindowSeconds int               `json:"baselineWindowSeconds,omitempty"`
	StabilizationSeconds  int               `json:"stabilizationSeconds,omitempty"`
	PostWindowSeconds     int               `json:"postWindowSeconds,omitempty"`
	Enabled               *bool             `json:"enabled,omitempty"`
	ResourceMappings      []ResourceMapping `json:"resourceMappings"`
	Rules                 []Rule            `json:"rules"`
}

type ServiceConfig struct {
	ID                  string        `json:"id"`
	ServiceID           string        `json:"serviceId"`
	ServiceName         string        `json:"serviceName,omitempty"`
	CredentialSecretRef string        `json:"credentialSecretRef,omitempty"`
	EffectiveCredential string        `json:"effectiveCredential,omitempty"`
	Platforms           []string      `json:"platforms"`
	ManagementZones     []string      `json:"managementZones"`
	MetricMappings      MetricMapping `json:"metricMappings"`
	InheritResources    bool          `json:"inheritResources"`
	Enabled             bool          `json:"enabled"`
}

type ServiceConfigInput struct {
	CredentialSecretRef string        `json:"credentialSecretRef,omitempty"`
	Platforms           []string      `json:"platforms"`
	ManagementZones     []string      `json:"managementZones"`
	MetricMappings      MetricMapping `json:"metricMappings"`
	InheritResources    *bool         `json:"inheritResources,omitempty"`
	Enabled             *bool         `json:"enabled,omitempty"`
}

type ResourceMapping struct {
	ID          string `json:"id,omitempty"`
	ServiceID   string `json:"serviceId,omitempty"`
	Platform    string `json:"platform"`
	EntityType  string `json:"entityType"`
	MappingType string `json:"mappingType"`
	Value       string `json:"value"`
	Label       string `json:"label,omitempty"`
	Enabled     bool   `json:"enabled"`
}

type Rule struct {
	ID                     string   `json:"id,omitempty"`
	ServiceID              string   `json:"serviceId,omitempty"`
	Name                   string   `json:"name"`
	Metric                 string   `json:"metric"`
	Statistic              string   `json:"statistic"`
	Operator               string   `json:"operator"`
	Threshold              float64  `json:"threshold"`
	Comparison             string   `json:"comparison"`
	Scope                  string   `json:"scope"`
	GateMode               string   `json:"gateMode"`
	MinimumCoveragePercent *float64 `json:"minimumCoveragePercent,omitempty"`
	ConsecutivePoints      int      `json:"consecutivePoints"`
	Enabled                bool     `json:"enabled"`
}

type Entity struct {
	ID              string         `json:"id"`
	Type            string         `json:"type"`
	Name            string         `json:"name"`
	ManagementZones []string       `json:"managementZones"`
	Tags            []string       `json:"tags"`
	Properties      map[string]any `json:"properties,omitempty"`
	ServiceID       string         `json:"serviceId,omitempty"`
	Platform        string         `json:"platform,omitempty"`
}

type ResourcePreview struct {
	Included          []Entity `json:"included"`
	Excluded          []Entity `json:"excluded"`
	Conflicts         []string `json:"conflicts"`
	UnmatchedRules    []string `json:"unmatchedRules"`
	CompiledSelectors []string `json:"compiledSelectors"`
	Truncated         bool     `json:"truncated"`
}

type MetricDescriptor struct {
	MetricID             string   `json:"metricId"`
	DisplayName          string   `json:"displayName,omitempty"`
	Description          string   `json:"description,omitempty"`
	Unit                 string   `json:"unit,omitempty"`
	DefaultAggregation   string   `json:"defaultAggregation,omitempty"`
	AggregationTypes     []string `json:"aggregationTypes"`
	Transformations      []string `json:"transformations"`
	DimensionDefinitions []string `json:"dimensionDefinitions"`
}

type SeriesPoint struct {
	Timestamp time.Time `json:"timestamp"`
	Value     *float64  `json:"value"`
}

type Statistics struct {
	SampleCount int      `json:"sampleCount"`
	Minimum     *float64 `json:"minimum"`
	Maximum     *float64 `json:"maximum"`
	Average     *float64 `json:"average"`
	Latest      *float64 `json:"latest"`
	P50         *float64 `json:"p50"`
	P95         *float64 `json:"p95"`
}

type ResourceMetric struct {
	ResourceID   string        `json:"resourceId"`
	ResourceName string        `json:"resourceName,omitempty"`
	ResourceType string        `json:"resourceType,omitempty"`
	Metric       string        `json:"metric"`
	Aggregation  string        `json:"aggregation,omitempty"`
	Selector     string        `json:"selector,omitempty"`
	Unit         string        `json:"unit,omitempty"`
	Statistics   Statistics    `json:"statistics"`
	Series       []SeriesPoint `json:"series"`
}

type QueryInput struct {
	ServiceID       string    `json:"serviceId,omitempty"`
	Platform        string    `json:"platform,omitempty"`
	TimeFrom        time.Time `json:"timeFrom"`
	TimeTo          time.Time `json:"timeTo"`
	Resolution      string    `json:"resolution,omitempty"`
	DeploymentRunID string    `json:"deploymentRunId,omitempty"`
}

type RuleResult struct {
	RuleID          string   `json:"ruleId"`
	RuleName        string   `json:"ruleName"`
	Status          string   `json:"status"`
	GateMode        string   `json:"gateMode"`
	Metric          string   `json:"metric"`
	Statistic       string   `json:"statistic"`
	Observed        *float64 `json:"observed,omitempty"`
	Baseline        *float64 `json:"baseline,omitempty"`
	Threshold       float64  `json:"threshold"`
	Operator        string   `json:"operator"`
	CoveragePercent float64  `json:"coveragePercent"`
	Reason          string   `json:"reason"`
}

type Run struct {
	ID                   string                `json:"id"`
	ApplicationID        string                `json:"applicationId"`
	EnvironmentBindingID string                `json:"environmentBindingId"`
	ApplicationConfigID  string                `json:"applicationConfigId"`
	ConfigRevisionID     string                `json:"configRevisionId,omitempty"`
	ServiceID            string                `json:"serviceId,omitempty"`
	DeploymentRunID      string                `json:"deploymentRunId,omitempty"`
	Status               string                `json:"status"`
	Decision             string                `json:"decision"`
	Platform             string                `json:"platform,omitempty"`
	TimeFrom             time.Time             `json:"timeFrom"`
	TimeTo               time.Time             `json:"timeTo"`
	ResourceCount        int                   `json:"resourceCount"`
	CoveredResourceCount int                   `json:"coveredResourceCount"`
	CoveragePercent      float64               `json:"coveragePercent"`
	Summary              map[string]Statistics `json:"summary"`
	Resources            []ResourceMetric      `json:"resources"`
	RuleResults          []RuleResult          `json:"ruleResults"`
	RequestEvidence      map[string]any        `json:"requestEvidence"`
	FailureCategory      string                `json:"failureCategory,omitempty"`
	FailureReason        string                `json:"failureReason,omitempty"`
	CorrelationID        string                `json:"correlationId,omitempty"`
	CreatedAt            time.Time             `json:"createdAt"`
	CompletedAt          *time.Time            `json:"completedAt,omitempty"`
}

type ConnectionTest struct {
	Status         string    `json:"status"`
	BaseURL        string    `json:"baseUrl"`
	LatencyMS      int64     `json:"latencyMs"`
	EntityCount    int       `json:"entityCount"`
	RequiredScopes []string  `json:"requiredScopes"`
	CheckedAt      time.Time `json:"checkedAt"`
	SafeError      string    `json:"safeError,omitempty"`
}
