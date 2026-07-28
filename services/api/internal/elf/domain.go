package elf

import (
	"context"
	"encoding/json"
	"time"
)

type Settings struct {
	BaseURL              string    `json:"baseUrl"`
	DashboardURL         string    `json:"dashboardUrl,omitempty"`
	DefaultIndexPattern  string    `json:"defaultIndexPattern"`
	TimeoutSeconds       int       `json:"timeoutSeconds"`
	AllowedIndexPatterns []string  `json:"allowedIndexPatterns"`
	TLSProfileID         string    `json:"tlsProfileId,omitempty"`
	ProxyProfileID       string    `json:"proxyProfileId,omitempty"`
	AuthMode             string    `json:"authMode"`
	Username             string    `json:"username,omitempty"`
	CredentialSecretRef  string    `json:"credentialSecretRef,omitempty"`
	// Credential is write-only plaintext accepted on save/test; never returned by GetSettings.
	Credential string `json:"credential,omitempty"`
	// HasCredential is true when an encrypted value or secret ref is stored.
	HasCredential bool `json:"hasCredential,omitempty"`
	// EncryptedCredential is persisted ciphertext; omitted from API responses.
	EncryptedCredential string    `json:"-"`
	UpdatedBy           string    `json:"updatedBy,omitempty"`
	UpdatedAt           time.Time `json:"updatedAt,omitempty"`
}

type Application struct {
	ID                  string            `json:"id"`
	CARID               string            `json:"carId,omitempty"`
	Name                string            `json:"name"`
	Owner               string            `json:"owner,omitempty"`
	Environment         string            `json:"environment,omitempty"`
	DefaultIndexPattern string            `json:"defaultIndexPattern,omitempty"`
	DefaultTimeField    string            `json:"defaultTimeField"`
	MaskingRules        []string          `json:"maskingRules"`
	SemanticMapping     map[string]string `json:"semanticMapping"`
	AlertEmails         []string          `json:"alertEmails"`
	Active              bool              `json:"active"`
	Services            []AppService      `json:"services"`
	MonitorIDs          []string          `json:"monitorIds"`
	CreatedAt           time.Time         `json:"createdAt"`
	UpdatedAt           time.Time         `json:"updatedAt"`
}

type AppService struct {
	ID              string            `json:"id"`
	ApplicationID   string            `json:"applicationId"`
	Name            string            `json:"name"`
	IndexPattern    string            `json:"indexPattern,omitempty"`
	TimeField       string            `json:"timeField,omitempty"`
	SemanticMapping map[string]string `json:"semanticMapping"`
	CreatedAt       time.Time         `json:"createdAt"`
	UpdatedAt       time.Time         `json:"updatedAt"`
}

type ApplicationInput struct {
	CARID               string            `json:"carId,omitempty"`
	Name                string            `json:"name"`
	Owner               string            `json:"owner,omitempty"`
	Environment         string            `json:"environment,omitempty"`
	DefaultIndexPattern string            `json:"defaultIndexPattern,omitempty"`
	DefaultTimeField    string            `json:"defaultTimeField,omitempty"`
	MaskingRules        []string          `json:"maskingRules,omitempty"`
	SemanticMapping     map[string]string `json:"semanticMapping,omitempty"`
	AlertEmails         []string          `json:"alertEmails,omitempty"`
	Active              *bool             `json:"active,omitempty"`
}

type ServiceInput struct {
	Name            string            `json:"name"`
	IndexPattern    string            `json:"indexPattern,omitempty"`
	TimeField       string            `json:"timeField,omitempty"`
	SemanticMapping map[string]string `json:"semanticMapping,omitempty"`
}

type Query struct {
	ID                   string            `json:"id"`
	Name                 string            `json:"name"`
	Description          string            `json:"description,omitempty"`
	ApplicationID        string            `json:"applicationId"`
	ApplicationName      string            `json:"applicationName"`
	ServiceID            string            `json:"serviceId,omitempty"`
	ServiceName          string            `json:"serviceName,omitempty"`
	IndexOverride        string            `json:"indexOverride,omitempty"`
	Active               bool              `json:"active"`
	CurrentRevisionID    string            `json:"currentRevisionId"`
	RevisionNumber       int               `json:"revisionNumber"`
	SearchBody           json.RawMessage   `json:"searchBody"`
	DefaultWindowSeconds int               `json:"defaultWindowSeconds"`
	CheckKind            string            `json:"checkKind"`
	Criteria             map[string]any    `json:"criteria"`
	GateMode             string            `json:"gateMode"`
	DiscoveredSchema     []Field           `json:"discoveredSchema"`
	SemanticMapping      map[string]string `json:"semanticMapping"`
	LastRun              *RunSummary       `json:"lastRun,omitempty"`
	CreatedAt            time.Time         `json:"createdAt"`
	UpdatedAt            time.Time         `json:"updatedAt"`
}

type QueryInput struct {
	Name                 string            `json:"name"`
	Description          string            `json:"description,omitempty"`
	ApplicationID        string            `json:"applicationId"`
	ServiceID            string            `json:"serviceId,omitempty"`
	IndexOverride        string            `json:"indexOverride,omitempty"`
	Active               *bool             `json:"active,omitempty"`
	SearchBody           json.RawMessage   `json:"searchBody"`
	DefaultWindowSeconds int               `json:"defaultWindowSeconds,omitempty"`
	CheckKind            string            `json:"checkKind,omitempty"`
	Criteria             map[string]any    `json:"criteria,omitempty"`
	GateMode             string            `json:"gateMode,omitempty"`
	SemanticMapping      map[string]string `json:"semanticMapping,omitempty"`
}

type Field struct {
	Path    string `json:"path"`
	Type    string `json:"type"`
	Role    string `json:"role,omitempty"`
	Samples []any  `json:"samples"`
	Usage   int    `json:"usage"`
}

type ValidationProblem struct {
	Path    string `json:"path"`
	Code    string `json:"code"`
	Message string `json:"message"`
}

type ValidationResult struct {
	Valid        bool                `json:"valid"`
	Problems     []ValidationProblem `json:"problems"`
	CompiledBody json.RawMessage     `json:"compiledBody,omitempty"`
	PolicyNotes  []string            `json:"policyNotes"`
}

type ProbeInput struct {
	From            *time.Time `json:"from,omitempty"`
	To              *time.Time `json:"to,omitempty"`
	WindowSeconds   int        `json:"windowSeconds,omitempty"`
	Size            int        `json:"size,omitempty"`
	Cursor          string     `json:"cursor,omitempty"`
	DeploymentStart *time.Time `json:"deploymentStart,omitempty"`
}

type RunSummary struct {
	ID               string           `json:"id"`
	QueryID          string           `json:"queryId,omitempty"`
	RevisionID       string           `json:"revisionId,omitempty"`
	Status           string           `json:"status"`
	Decision         string           `json:"decision"`
	GateMode         string           `json:"gateMode"`
	ApplicationID    string           `json:"applicationId,omitempty"`
	ApplicationName  string           `json:"applicationName,omitempty"`
	ServiceID        string           `json:"serviceId,omitempty"`
	ServiceName      string           `json:"serviceName,omitempty"`
	ResolvedIndex    string           `json:"resolvedIndex"`
	TimeFrom         time.Time        `json:"timeFrom"`
	TimeTo           time.Time        `json:"timeTo"`
	HitCount         int64            `json:"hitCount"`
	OpenSearchTookMS int64            `json:"openSearchTookMs"`
	RoundTripMS      int64            `json:"roundTripMs"`
	ShardSummary     map[string]any   `json:"shardSummary"`
	Aggregations     map[string]any   `json:"aggregations"`
	RawResponse      map[string]any   `json:"rawResponse"`
	Samples          []map[string]any `json:"samples"`
	SampleState      string           `json:"sampleState"`
	Truncation       map[string]any   `json:"truncation"`
	Fields           []Field          `json:"fields"`
	FailureCategory  string           `json:"failureCategory,omitempty"`
	FailureReason    string           `json:"failureReason,omitempty"`
	Debug            map[string]any   `json:"debug"`
	CreatedAt        time.Time        `json:"createdAt"`
	CompletedAt      *time.Time       `json:"completedAt,omitempty"`
}

type SecretResolver interface {
	ResolveSecret(context.Context, string) (string, error)
}

// CredentialCrypto encrypts and decrypts inline ELF credentials at rest.
type CredentialCrypto interface {
	EncryptStored(plaintext string) (string, error)
	DecryptStored(ciphertext string) (string, error)
}
