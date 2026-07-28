package alerts

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"regexp"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/rhythm-monitoring/rhythm/internal/id"
	"github.com/rhythm-monitoring/rhythm/internal/notifications"
)

var ErrNotFound = errors.New("alert not found")
var ErrUnauthorized = errors.New("invalid receiver credential")
var ErrExternalResolve = errors.New("OpenSearch alerts resolve when the upstream alert completes")

const EnvelopeSchema = "rhythm.opensearch-alert.v1"

type Alert struct {
	ID                  string         `json:"id"`
	SourceType          string         `json:"sourceType"`
	MonitorID           string         `json:"monitorId,omitempty"`
	MonitorName         string         `json:"monitorName,omitempty"`
	ApplicationID       string         `json:"applicationId,omitempty"`
	ApplicationName     string         `json:"applicationName,omitempty"`
	ApplicationCARID    string         `json:"applicationCarId,omitempty"`
	ServiceID           string         `json:"serviceId,omitempty"`
	ServiceName         string         `json:"serviceName,omitempty"`
	ReceiverID          string         `json:"receiverId,omitempty"`
	State               string         `json:"state"`
	UpstreamState       string         `json:"upstreamState,omitempty"`
	Severity            string         `json:"severity"`
	Title               string         `json:"title"`
	Description         string         `json:"description,omitempty"`
	FailureCategory     string         `json:"failureCategory,omitempty"`
	FailedStepID        string         `json:"failedStepId,omitempty"`
	ConsecutiveFailures int            `json:"consecutiveFailures"`
	ExternalMonitorID   string         `json:"externalMonitorId,omitempty"`
	ExternalMonitorName string         `json:"externalMonitorName,omitempty"`
	ExternalMonitorType string         `json:"externalMonitorType,omitempty"`
	ExternalTriggerID   string         `json:"externalTriggerId,omitempty"`
	ExternalTriggerName string         `json:"externalTriggerName,omitempty"`
	ExternalAlertID     string         `json:"externalAlertId,omitempty"`
	BucketKey           string         `json:"bucketKey,omitempty"`
	HitCount            *int64         `json:"hitCount,omitempty"`
	Evidence            map[string]any `json:"evidence"`
	DashboardURL        string         `json:"dashboardUrl,omitempty"`
	FirstTriggeredAt    *time.Time     `json:"firstTriggeredAt,omitempty"`
	LastTriggeredAt     *time.Time     `json:"lastTriggeredAt,omitempty"`
	LastReceivedAt      *time.Time     `json:"lastReceivedAt,omitempty"`
	LastReconciledAt    *time.Time     `json:"lastReconciledAt,omitempty"`
	AcknowledgedAt      *time.Time     `json:"acknowledgedAt,omitempty"`
	AcknowledgedBy      string         `json:"acknowledgedBy,omitempty"`
	ResolvedAt          *time.Time     `json:"resolvedAt,omitempty"`
	CreatedAt           time.Time      `json:"createdAt"`
	UpdatedAt           time.Time      `json:"updatedAt"`
}

type AlertEvent struct {
	ID            string         `json:"id"`
	EventType     string         `json:"eventType"`
	UpstreamState string         `json:"upstreamState,omitempty"`
	Summary       string         `json:"summary"`
	Evidence      map[string]any `json:"evidence"`
	OccurredAt    time.Time      `json:"occurredAt"`
}

type Filter struct {
	State, SourceType, ApplicationID, ServiceID, Severity string
}

type Policy struct {
	FailureThreshold  int    `json:"failureThreshold"`
	RecoveryThreshold int    `json:"recoveryThreshold"`
	Severity          string `json:"severity"`
	CooldownSeconds   int    `json:"cooldownSeconds"`
}

type Receiver struct {
	ID                            string     `json:"id"`
	ApplicationID                 string     `json:"applicationId"`
	ApplicationName               string     `json:"applicationName"`
	ApplicationCARID              string     `json:"applicationCarId,omitempty"`
	ServiceID                     string     `json:"serviceId,omitempty"`
	ServiceName                   string     `json:"serviceName,omitempty"`
	Name                          string     `json:"name"`
	Enabled                       bool       `json:"enabled"`
	DashboardURL                  string     `json:"dashboardUrl,omitempty"`
	ExpectedMonitorTypes          []string   `json:"expectedMonitorTypes"`
	ReconciliationIntervalSeconds int        `json:"reconciliationIntervalSeconds"`
	LastDeliveryAt                *time.Time `json:"lastDeliveryAt,omitempty"`
	LastReconciledAt              *time.Time `json:"lastReconciledAt,omitempty"`
	LastReconciliationStatus      string     `json:"lastReconciliationStatus"`
	LastReconciliationError       string     `json:"lastReconciliationError,omitempty"`
	CreatedAt                     time.Time  `json:"createdAt"`
	UpdatedAt                     time.Time  `json:"updatedAt"`
	Token                         string     `json:"token,omitempty"`
}

type ReceiverInput struct {
	Name                          string   `json:"name"`
	ServiceID                     string   `json:"serviceId,omitempty"`
	Enabled                       *bool    `json:"enabled,omitempty"`
	DashboardURL                  string   `json:"dashboardUrl,omitempty"`
	ExpectedMonitorTypes          []string `json:"expectedMonitorTypes,omitempty"`
	ReconciliationIntervalSeconds int      `json:"reconciliationIntervalSeconds,omitempty"`
}

type Setup struct {
	ReceiverID        string            `json:"receiverId"`
	WebhookPath       string            `json:"webhookPath"`
	WebhookURL        string            `json:"webhookUrl,omitempty"`
	Headers           map[string]string `json:"headers"`
	QueryTemplate     string            `json:"queryTemplate"`
	BucketTemplate    string            `json:"bucketTemplate"`
	DocumentTemplate  string            `json:"documentTemplate"`
	DashboardSteps    []string          `json:"dashboardSteps"`
	CredentialWarning string            `json:"credentialWarning"`
}

type Delivery struct {
	ID            string         `json:"id"`
	Status        string         `json:"status"`
	SchemaVersion string         `json:"schemaVersion"`
	EventCount    int            `json:"eventCount"`
	SafeError     string         `json:"safeError,omitempty"`
	Evidence      map[string]any `json:"evidence"`
	ReceivedAt    time.Time      `json:"receivedAt"`
	ProcessedAt   *time.Time     `json:"processedAt,omitempty"`
}

type Envelope struct {
	Schema  string          `json:"schema"`
	Events  []ExternalEvent `json:"events,omitempty"`
	Event   *ExternalEvent  `json:"event,omitempty"`
	Message json.RawMessage `json:"message,omitempty"`
}

type ExternalEvent struct {
	MonitorID     string           `json:"monitorId"`
	MonitorName   string           `json:"monitorName"`
	MonitorType   string           `json:"monitorType"`
	TriggerID     string           `json:"triggerId"`
	TriggerName   string           `json:"triggerName"`
	Severity      string           `json:"severity"`
	AlertID       string           `json:"alertId"`
	BucketKey     string           `json:"bucketKey,omitempty"`
	State         string           `json:"state"`
	PeriodStart   string           `json:"periodStart,omitempty"`
	PeriodEnd     string           `json:"periodEnd,omitempty"`
	HitCount      *int64           `json:"hitCount,omitempty"`
	Error         string           `json:"error,omitempty"`
	FindingIDs    []string         `json:"findingIds,omitempty"`
	DocumentIDs   []string         `json:"documentIds,omitempty"`
	Samples       []map[string]any `json:"samples,omitempty"`
	ResultSummary map[string]any   `json:"resultSummary,omitempty"`
	OccurredAt    *time.Time       `json:"occurredAt,omitempty"`
}

type AlertingFetcher interface {
	FetchAlertingAlerts(context.Context) (json.RawMessage, error)
}

type Service struct {
	pool    *pgxpool.Pool
	fetcher AlertingFetcher
}

func New(pool *pgxpool.Pool, fetcher ...AlertingFetcher) *Service {
	s := &Service{pool: pool}
	if len(fetcher) > 0 {
		s.fetcher = fetcher[0]
	}
	return s
}

const alertSelect = `SELECT a.id::text,a.source_type,COALESCE(a.monitor_id::text,''),COALESCE(m.name,''),COALESCE(a.application_id::text,''),COALESCE(ap.name,''),COALESCE(ap.car_id,''),COALESCE(a.service_id::text,''),COALESCE(s.name,''),COALESCE(a.receiver_id::text,''),a.state,COALESCE(a.upstream_state,''),a.severity,a.title,COALESCE(a.description,''),COALESCE(a.failure_category,''),COALESCE(a.failed_step_id,''),a.consecutive_failures,COALESCE(a.external_monitor_id,''),COALESCE(a.external_monitor_name,''),COALESCE(a.external_monitor_type,''),COALESCE(a.external_trigger_id,''),COALESCE(a.external_trigger_name,''),COALESCE(a.external_alert_id,''),COALESCE(a.bucket_key,''),a.hit_count,a.evidence,COALESCE(a.dashboard_url,''),a.first_triggered_at,a.last_triggered_at,a.last_received_at,a.last_reconciled_at,a.acknowledged_at,COALESCE(a.acknowledged_by,''),a.resolved_at,a.created_at,a.updated_at FROM alerts a LEFT JOIN monitors m ON m.id=a.monitor_id LEFT JOIN applications ap ON ap.id=a.application_id LEFT JOIN application_services s ON s.id=a.service_id`

func scanAlert(row pgx.Row) (Alert, error) {
	var a Alert
	var evidence []byte
	err := row.Scan(&a.ID, &a.SourceType, &a.MonitorID, &a.MonitorName, &a.ApplicationID, &a.ApplicationName, &a.ApplicationCARID, &a.ServiceID, &a.ServiceName, &a.ReceiverID, &a.State, &a.UpstreamState, &a.Severity, &a.Title, &a.Description, &a.FailureCategory, &a.FailedStepID, &a.ConsecutiveFailures, &a.ExternalMonitorID, &a.ExternalMonitorName, &a.ExternalMonitorType, &a.ExternalTriggerID, &a.ExternalTriggerName, &a.ExternalAlertID, &a.BucketKey, &a.HitCount, &evidence, &a.DashboardURL, &a.FirstTriggeredAt, &a.LastTriggeredAt, &a.LastReceivedAt, &a.LastReconciledAt, &a.AcknowledgedAt, &a.AcknowledgedBy, &a.ResolvedAt, &a.CreatedAt, &a.UpdatedAt)
	if err == nil {
		a.Evidence = map[string]any{}
		_ = json.Unmarshal(evidence, &a.Evidence)
	}
	return a, err
}

func (s *Service) List(ctx context.Context, state string) ([]Alert, error) {
	return s.ListFiltered(ctx, Filter{State: state})
}

func (s *Service) ListFiltered(ctx context.Context, filter Filter) ([]Alert, error) {
	rows, err := s.pool.Query(ctx, alertSelect+` WHERE ($1='' OR a.state=$1) AND ($2='' OR a.source_type=$2) AND ($3='' OR a.application_id::text=$3) AND ($4='' OR a.service_id::text=$4) AND ($5='' OR a.severity=$5) ORDER BY a.updated_at DESC LIMIT 200`, filter.State, filter.SourceType, filter.ApplicationID, filter.ServiceID, filter.Severity)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]Alert, 0)
	for rows.Next() {
		a, scanErr := scanAlert(rows)
		if scanErr != nil {
			return nil, scanErr
		}
		items = append(items, a)
	}
	return items, rows.Err()
}

// OpenSearchAlertMatch identifies OpenSearch Alerting notifications ingested via a receiver.
// Prefer external IDs when present; names are a fallback for older deliveries.
type OpenSearchAlertMatch struct {
	ReceiverID          string
	ExternalMonitorID   string
	ExternalTriggerID   string
	ExternalMonitorName string
	ExternalTriggerName string
}

func (s *Service) MatchOpenSearchAlerts(ctx context.Context, query OpenSearchAlertMatch) ([]Alert, error) {
	query.ReceiverID = strings.TrimSpace(query.ReceiverID)
	query.ExternalMonitorID = strings.TrimSpace(query.ExternalMonitorID)
	query.ExternalTriggerID = strings.TrimSpace(query.ExternalTriggerID)
	query.ExternalMonitorName = strings.TrimSpace(query.ExternalMonitorName)
	query.ExternalTriggerName = strings.TrimSpace(query.ExternalTriggerName)
	if query.ReceiverID == "" {
		return nil, errors.New("receiverId is required to match OpenSearch alerts")
	}
	if query.ExternalMonitorID == "" && query.ExternalMonitorName == "" && query.ExternalTriggerID == "" && query.ExternalTriggerName == "" {
		return nil, errors.New("OpenSearch alert match requires a monitor or trigger identity")
	}
	rows, err := s.pool.Query(ctx, alertSelect+`
 WHERE a.source_type='OPENSEARCH_ALERTING'
   AND a.receiver_id::text=$1
   AND ($2='' OR a.external_monitor_id=$2)
   AND ($3='' OR a.external_trigger_id=$3)
   AND ($4='' OR LOWER(a.external_monitor_name)=LOWER($4))
   AND ($5='' OR LOWER(a.external_trigger_name)=LOWER($5))
 ORDER BY a.updated_at DESC
 LIMIT 50`, query.ReceiverID, query.ExternalMonitorID, query.ExternalTriggerID, query.ExternalMonitorName, query.ExternalTriggerName)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]Alert, 0)
	for rows.Next() {
		a, scanErr := scanAlert(rows)
		if scanErr != nil {
			return nil, scanErr
		}
		items = append(items, a)
	}
	return items, rows.Err()
}

func (s *Service) Get(ctx context.Context, alertID string) (Alert, error) {
	a, err := scanAlert(s.pool.QueryRow(ctx, alertSelect+` WHERE a.id=$1`, alertID))
	if errors.Is(err, pgx.ErrNoRows) {
		return Alert{}, ErrNotFound
	}
	return a, err
}

func (s *Service) Events(ctx context.Context, alertID string) ([]AlertEvent, error) {
	rows, err := s.pool.Query(ctx, `SELECT id::text,event_type,COALESCE(upstream_state,''),summary,evidence,occurred_at FROM alert_events WHERE alert_id=$1 ORDER BY occurred_at DESC LIMIT 200`, alertID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]AlertEvent, 0)
	for rows.Next() {
		var event AlertEvent
		var evidence []byte
		if err := rows.Scan(&event.ID, &event.EventType, &event.UpstreamState, &event.Summary, &evidence, &event.OccurredAt); err != nil {
			return nil, err
		}
		event.Evidence = map[string]any{}
		_ = json.Unmarshal(evidence, &event.Evidence)
		items = append(items, event)
	}
	return items, rows.Err()
}

func (s *Service) Acknowledge(ctx context.Context, alertID, actor string) (Alert, error) {
	now := time.Now().UTC()
	tag, err := s.pool.Exec(ctx, `UPDATE alerts SET state='ACKNOWLEDGED',acknowledged_at=$2,acknowledged_by=$3,updated_at=$2 WHERE id=$1 AND state IN ('OPEN','ERROR')`, alertID, now, actor)
	if err != nil {
		return Alert{}, err
	}
	if tag.RowsAffected() == 0 {
		return Alert{}, ErrNotFound
	}
	_ = s.recordEvent(ctx, alertID, "ACKNOWLEDGED", "", "Acknowledged in Rhythm", nil)
	return s.Get(ctx, alertID)
}

func (s *Service) Resolve(ctx context.Context, alertID, actor string) (Alert, error) {
	current, err := s.Get(ctx, alertID)
	if err != nil {
		return Alert{}, err
	}
	if current.SourceType == "OPENSEARCH_ALERTING" && (current.UpstreamState == "ACTIVE" || current.UpstreamState == "ACKNOWLEDGED") {
		return Alert{}, ErrExternalResolve
	}
	now := time.Now().UTC()
	tag, err := s.pool.Exec(ctx, `UPDATE alerts SET state='RESOLVED',resolved_at=$2,updated_at=$2 WHERE id=$1 AND state IN ('OPEN','ACKNOWLEDGED','ERROR')`, alertID, now)
	if err != nil {
		return Alert{}, err
	}
	if tag.RowsAffected() == 0 {
		return Alert{}, ErrNotFound
	}
	_ = s.recordEvent(ctx, alertID, "RESOLVED", "", "Resolved in Rhythm", map[string]any{"actor": actor})
	return s.Get(ctx, alertID)
}

func (s *Service) SavePolicy(ctx context.Context, monitorID string, p Policy) (Policy, error) {
	if p.FailureThreshold < 1 || p.FailureThreshold > 100 || p.RecoveryThreshold < 1 || p.RecoveryThreshold > 100 {
		return Policy{}, fmt.Errorf("thresholds must be between 1 and 100")
	}
	if p.Severity == "" {
		p.Severity = "CRITICAL"
	}
	if p.Severity != "INFO" && p.Severity != "WARNING" && p.Severity != "CRITICAL" {
		return Policy{}, fmt.Errorf("severity is invalid")
	}
	_, err := s.pool.Exec(ctx, `INSERT INTO monitor_alert_policies(monitor_id,failure_threshold,recovery_threshold,severity,cooldown_seconds) VALUES($1,$2,$3,$4,$5) ON CONFLICT(monitor_id) DO UPDATE SET failure_threshold=EXCLUDED.failure_threshold,recovery_threshold=EXCLUDED.recovery_threshold,severity=EXCLUDED.severity,cooldown_seconds=EXCLUDED.cooldown_seconds,updated_at=NOW()`, monitorID, p.FailureThreshold, p.RecoveryThreshold, p.Severity, p.CooldownSeconds)
	return p, err
}

const receiverSelect = `SELECT r.id::text,r.application_id::text,a.name,COALESCE(a.car_id,''),COALESCE(r.service_id::text,''),COALESCE(s.name,''),r.name,r.enabled,r.dashboard_url,r.expected_monitor_types,r.reconciliation_interval_seconds,r.last_delivery_at,r.last_reconciled_at,r.last_reconciliation_status,r.last_reconciliation_error,r.created_at,r.updated_at FROM opensearch_alert_receivers r JOIN applications a ON a.id=r.application_id LEFT JOIN application_services s ON s.id=r.service_id`

func scanReceiver(row pgx.Row) (Receiver, error) {
	var r Receiver
	var types []byte
	err := row.Scan(&r.ID, &r.ApplicationID, &r.ApplicationName, &r.ApplicationCARID, &r.ServiceID, &r.ServiceName, &r.Name, &r.Enabled, &r.DashboardURL, &types, &r.ReconciliationIntervalSeconds, &r.LastDeliveryAt, &r.LastReconciledAt, &r.LastReconciliationStatus, &r.LastReconciliationError, &r.CreatedAt, &r.UpdatedAt)
	if err == nil {
		_ = json.Unmarshal(types, &r.ExpectedMonitorTypes)
	}
	return r, err
}

func (s *Service) ListReceivers(ctx context.Context, applicationID string) ([]Receiver, error) {
	rows, err := s.pool.Query(ctx, receiverSelect+` WHERE ($1='' OR r.application_id::text=$1) ORDER BY r.updated_at DESC`, applicationID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]Receiver, 0)
	for rows.Next() {
		r, scanErr := scanReceiver(rows)
		if scanErr != nil {
			return nil, scanErr
		}
		items = append(items, r)
	}
	return items, rows.Err()
}

func (s *Service) GetReceiver(ctx context.Context, receiverID string) (Receiver, error) {
	r, err := scanReceiver(s.pool.QueryRow(ctx, receiverSelect+` WHERE r.id=$1`, receiverID))
	if errors.Is(err, pgx.ErrNoRows) {
		return Receiver{}, ErrNotFound
	}
	return r, err
}

func normalizeReceiverInput(input ReceiverInput) (ReceiverInput, error) {
	input.Name = strings.TrimSpace(input.Name)
	input.DashboardURL = strings.TrimRight(strings.TrimSpace(input.DashboardURL), "/")
	if input.Name == "" {
		return input, errors.New("receiver name is required")
	}
	if input.ReconciliationIntervalSeconds == 0 {
		input.ReconciliationIntervalSeconds = 60
	}
	if input.ReconciliationIntervalSeconds < 30 || input.ReconciliationIntervalSeconds > 3600 {
		return input, errors.New("reconciliation interval must be between 30 and 3600 seconds")
	}
	if len(input.ExpectedMonitorTypes) == 0 {
		input.ExpectedMonitorTypes = []string{"QUERY_LEVEL", "BUCKET_LEVEL", "DOCUMENT_LEVEL"}
	}
	allowed := map[string]bool{"QUERY_LEVEL": true, "BUCKET_LEVEL": true, "DOCUMENT_LEVEL": true}
	for i, value := range input.ExpectedMonitorTypes {
		value = strings.ToUpper(strings.TrimSpace(value))
		if !allowed[value] {
			return input, errors.New("expected monitor type is invalid")
		}
		input.ExpectedMonitorTypes[i] = value
	}
	return input, nil
}

func (s *Service) CreateReceiver(ctx context.Context, applicationID string, input ReceiverInput, actor string) (Receiver, error) {
	input, err := normalizeReceiverInput(input)
	if err != nil {
		return Receiver{}, err
	}
	identifier, _ := id.NewUUID()
	token, hash, err := newToken()
	if err != nil {
		return Receiver{}, err
	}
	types, _ := json.Marshal(input.ExpectedMonitorTypes)
	enabled := true
	if input.Enabled != nil {
		enabled = *input.Enabled
	}
	_, err = s.pool.Exec(ctx, `INSERT INTO opensearch_alert_receivers(id,application_id,service_id,name,enabled,dashboard_url,expected_monitor_types,reconciliation_interval_seconds,token_hash,created_by,updated_by) VALUES($1,$2,NULLIF($3,'')::uuid,$4,$5,$6,$7,$8,$9,$10,$10)`, identifier, applicationID, input.ServiceID, input.Name, enabled, input.DashboardURL, types, input.ReconciliationIntervalSeconds, hash, actor)
	if err != nil {
		return Receiver{}, err
	}
	receiver, err := s.GetReceiver(ctx, identifier)
	receiver.Token = token
	return receiver, err
}

func (s *Service) UpdateReceiver(ctx context.Context, receiverID string, input ReceiverInput, actor string) (Receiver, error) {
	input, err := normalizeReceiverInput(input)
	if err != nil {
		return Receiver{}, err
	}
	current, err := s.GetReceiver(ctx, receiverID)
	if err != nil {
		return Receiver{}, err
	}
	enabled := current.Enabled
	if input.Enabled != nil {
		enabled = *input.Enabled
	}
	types, _ := json.Marshal(input.ExpectedMonitorTypes)
	tag, err := s.pool.Exec(ctx, `UPDATE opensearch_alert_receivers SET service_id=NULLIF($2,'')::uuid,name=$3,enabled=$4,dashboard_url=$5,expected_monitor_types=$6,reconciliation_interval_seconds=$7,updated_by=$8,updated_at=NOW() WHERE id=$1`, receiverID, input.ServiceID, input.Name, enabled, input.DashboardURL, types, input.ReconciliationIntervalSeconds, actor)
	if err != nil {
		return Receiver{}, err
	}
	if tag.RowsAffected() == 0 {
		return Receiver{}, ErrNotFound
	}
	return s.GetReceiver(ctx, receiverID)
}

func (s *Service) DeleteReceiver(ctx context.Context, receiverID string) error {
	tag, err := s.pool.Exec(ctx, `DELETE FROM opensearch_alert_receivers WHERE id=$1`, receiverID)
	if err == nil && tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return err
}

func (s *Service) RotateToken(ctx context.Context, receiverID, actor string) (Receiver, error) {
	token, hash, err := newToken()
	if err != nil {
		return Receiver{}, err
	}
	tag, err := s.pool.Exec(ctx, `UPDATE opensearch_alert_receivers SET previous_token_hash=token_hash,previous_token_expires_at=NOW()+INTERVAL '15 minutes',token_hash=$2,updated_by=$3,updated_at=NOW() WHERE id=$1`, receiverID, hash, actor)
	if err != nil {
		return Receiver{}, err
	}
	if tag.RowsAffected() == 0 {
		return Receiver{}, ErrNotFound
	}
	r, err := s.GetReceiver(ctx, receiverID)
	r.Token = token
	return r, err
}

func newToken() (string, string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", "", err
	}
	token := "rhy_os_" + hex.EncodeToString(b)
	sum := sha256.Sum256([]byte(token))
	return token, hex.EncodeToString(sum[:]), nil
}

func (s *Service) Setup(receiver Receiver, baseURL string) Setup {
	path := "/hooks/v1/opensearch-alerting/" + receiver.ID
	baseURL = strings.TrimRight(baseURL, "/")
	query := `{"schema":"rhythm.opensearch-alert.v1","event":{"monitorId":"{{ctx.monitor.id}}","monitorName":"{{ctx.monitor.name}}","monitorType":"QUERY_LEVEL","triggerId":"{{ctx.trigger.id}}","triggerName":"{{ctx.trigger.name}}","severity":"{{ctx.trigger.severity}}","alertId":"{{ctx.alert.id}}","state":"ACTIVE","periodStart":"{{ctx.periodStart}}","periodEnd":"{{ctx.periodEnd}}","hitCount":{{ctx.results.0.hits.total.value}},"error":"{{ctx.error}}"}}`
	bucket := `{"schema":"rhythm.opensearch-alert.v1","event":{"monitorId":"{{ctx.monitor.id}}","monitorName":"{{ctx.monitor.name}}","monitorType":"BUCKET_LEVEL","triggerId":"{{ctx.trigger.id}}","triggerName":"{{ctx.trigger.name}}","severity":"{{ctx.trigger.severity}}","alertId":"{{ctx.newAlerts.0.id}}","bucketKey":"{{ctx.newAlerts.0.bucket_keys}}","state":"ACTIVE","periodStart":"{{ctx.periodStart}}","periodEnd":"{{ctx.periodEnd}}","error":"{{ctx.error}}"}}`
	document := `{"schema":"rhythm.opensearch-alert.v1","event":{"monitorId":"{{ctx.monitor.id}}","monitorName":"{{ctx.monitor.name}}","monitorType":"DOCUMENT_LEVEL","triggerId":"{{ctx.trigger.id}}","triggerName":"{{ctx.trigger.name}}","severity":"{{ctx.trigger.severity}}","alertId":"{{ctx.alerts.0.id}}","state":"ACTIVE","periodStart":"{{ctx.periodStart}}","periodEnd":"{{ctx.periodEnd}}","error":"{{ctx.error}}"}}`
	return Setup{ReceiverID: receiver.ID, WebhookPath: path, WebhookURL: baseURL + path, Headers: map[string]string{"Authorization": "Bearer <receiver-token>", "Content-Type": "application/json"}, QueryTemplate: query, BucketTemplate: bucket, DocumentTemplate: document, DashboardSteps: []string{"Open Notifications → Channels and create a Custom webhook channel.", "Paste the receiver URL and add the generated Authorization and Content-Type headers.", "In the Alerting monitor trigger, add an action using this channel.", "Paste the template matching the monitor type and send a test notification."}, CredentialWarning: "OpenSearch stores custom webhook headers in plain text. Use only the scoped receiver token and rotate it if the OpenSearch configuration is exposed."}
}

func (s *Service) Deliveries(ctx context.Context, receiverID string) ([]Delivery, error) {
	rows, err := s.pool.Query(ctx, `SELECT id::text,status,schema_version,event_count,safe_error,normalized_evidence,received_at,processed_at FROM opensearch_alert_deliveries WHERE receiver_id=$1 ORDER BY received_at DESC LIMIT 100`, receiverID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]Delivery, 0)
	for rows.Next() {
		var d Delivery
		var evidence []byte
		if err := rows.Scan(&d.ID, &d.Status, &d.SchemaVersion, &d.EventCount, &d.SafeError, &evidence, &d.ReceivedAt, &d.ProcessedAt); err != nil {
			return nil, err
		}
		d.Evidence = map[string]any{}
		_ = json.Unmarshal(evidence, &d.Evidence)
		items = append(items, d)
	}
	return items, rows.Err()
}

func (s *Service) Test(ctx context.Context, receiverID string) (Alert, error) {
	receiver, err := s.GetReceiver(ctx, receiverID)
	if err != nil {
		return Alert{}, err
	}
	var masksJSON []byte
	_ = s.pool.QueryRow(ctx, `SELECT masking_rules FROM applications WHERE id=$1`, receiver.ApplicationID).Scan(&masksJSON)
	var masks []string
	_ = json.Unmarshal(masksJSON, &masks)
	testID, _ := id.NewUUID()
	event := ExternalEvent{MonitorID: "rhythm-receiver-test", MonitorName: "Rhythm receiver test", MonitorType: "QUERY_LEVEL", TriggerID: "connectivity-test", TriggerName: "Receiver connectivity test", Severity: "5", AlertID: testID, State: "COMPLETED", ResultSummary: map[string]any{"test": true}, OccurredAt: func() *time.Time { v := time.Now().UTC(); return &v }()}
	if err := s.applyEvent(ctx, receiver, event, masks, false); err != nil {
		return Alert{}, err
	}
	return scanAlert(s.pool.QueryRow(ctx, alertSelect+` WHERE a.receiver_id=$1 AND a.external_alert_id=$2`, receiverID, testID))
}

func (s *Service) Ingest(ctx context.Context, receiverID, token string, raw []byte) (Delivery, bool, error) {
	receiver, tokenHash, previousHash, previousExpiry, masks, err := s.receiverForIngest(ctx, receiverID)
	if err != nil {
		return Delivery{}, false, ErrUnauthorized
	}
	if !receiver.Enabled || !validToken(token, tokenHash, previousHash, previousExpiry) {
		return Delivery{}, false, ErrUnauthorized
	}
	envelope, err := decodeEnvelope(raw)
	if err != nil {
		return Delivery{}, false, err
	}
	events := envelope.Events
	if envelope.Event != nil {
		events = append(events, *envelope.Event)
	}
	if len(events) == 0 || len(events) > 100 {
		return Delivery{}, false, errors.New("webhook must contain between 1 and 100 events")
	}
	bodySum := sha256.Sum256(raw)
	bodyHash := hex.EncodeToString(bodySum[:])
	deliveryID, _ := id.NewUUID()
	now := time.Now().UTC()
	_, err = s.pool.Exec(ctx, `INSERT INTO opensearch_alert_deliveries(id,receiver_id,body_hash,schema_version,status,event_count,received_at) VALUES($1,$2,$3,$4,'ACCEPTED',$5,$6) ON CONFLICT(receiver_id,body_hash) DO NOTHING`, deliveryID, receiverID, bodyHash, envelope.Schema, len(events), now)
	if err != nil {
		return Delivery{}, false, err
	}
	var storedID string
	err = s.pool.QueryRow(ctx, `SELECT id::text FROM opensearch_alert_deliveries WHERE receiver_id=$1 AND body_hash=$2`, receiverID, bodyHash).Scan(&storedID)
	if err != nil {
		return Delivery{}, false, err
	}
	if storedID != deliveryID {
		deliveries, _ := s.Deliveries(ctx, receiverID)
		for _, d := range deliveries {
			if d.ID == storedID {
				return d, true, nil
			}
		}
		return Delivery{ID: storedID, Status: "DUPLICATE", SchemaVersion: envelope.Schema, EventCount: len(events), ReceivedAt: now}, true, nil
	}
	processed := 0
	for i := range events {
		normalizeEvent(&events[i])
		if err := validateEvent(events[i], receiver.ExpectedMonitorTypes); err != nil {
			s.rejectDelivery(ctx, deliveryID, err.Error())
			return Delivery{}, false, err
		}
		if err := s.applyEvent(ctx, receiver, events[i], masks, false); err != nil {
			s.rejectDelivery(ctx, deliveryID, "Unable to normalize alert event.")
			return Delivery{}, false, errors.New("alert event could not be processed")
		}
		processed++
	}
	evidence := map[string]any{"processedEvents": processed, "monitorTypes": receiver.ExpectedMonitorTypes}
	evidenceJSON, _ := json.Marshal(evidence)
	_, _ = s.pool.Exec(ctx, `UPDATE opensearch_alert_deliveries SET status='PROCESSED',normalized_evidence=$2,processed_at=NOW() WHERE id=$1`, deliveryID, evidenceJSON)
	_, _ = s.pool.Exec(ctx, `UPDATE opensearch_alert_receivers SET last_delivery_at=NOW(),updated_at=NOW() WHERE id=$1`, receiverID)
	return Delivery{ID: deliveryID, Status: "PROCESSED", SchemaVersion: envelope.Schema, EventCount: processed, Evidence: evidence, ReceivedAt: now, ProcessedAt: &now}, false, nil
}

func decodeEnvelope(raw []byte) (Envelope, error) {
	var envelope Envelope
	if err := json.Unmarshal(raw, &envelope); err != nil {
		return envelope, errors.New("request body must be valid JSON")
	}
	if envelope.Schema == "" && len(envelope.Message) > 0 {
		var message string
		if json.Unmarshal(envelope.Message, &message) == nil {
			if err := json.Unmarshal([]byte(message), &envelope); err != nil {
				return envelope, errors.New("notification message does not contain a valid Rhythm envelope")
			}
		} else {
			if err := json.Unmarshal(envelope.Message, &envelope); err != nil {
				return envelope, errors.New("notification wrapper is invalid")
			}
		}
	}
	if envelope.Schema != EnvelopeSchema {
		return envelope, errors.New("unsupported webhook schema")
	}
	return envelope, nil
}

func normalizeEvent(event *ExternalEvent) {
	event.MonitorID = html.UnescapeString(strings.TrimSpace(event.MonitorID))
	event.MonitorName = html.UnescapeString(strings.TrimSpace(event.MonitorName))
	event.MonitorType = strings.ToUpper(strings.TrimSpace(event.MonitorType))
	event.TriggerID = html.UnescapeString(strings.TrimSpace(event.TriggerID))
	event.TriggerName = html.UnescapeString(strings.TrimSpace(event.TriggerName))
	event.State = strings.ToUpper(strings.TrimSpace(event.State))
	event.Severity = strings.ToUpper(strings.TrimSpace(event.Severity))
	event.AlertID = html.UnescapeString(strings.TrimSpace(event.AlertID))
	event.BucketKey = html.UnescapeString(strings.TrimSpace(event.BucketKey))
	event.Error = html.UnescapeString(strings.TrimSpace(event.Error))
	if event.State == "" {
		event.State = "ACTIVE"
	}
	if event.AlertID == "" {
		event.AlertID = event.MonitorID + ":" + event.TriggerID + ":" + event.BucketKey
	}
}

func validateEvent(event ExternalEvent, expected []string) error {
	if event.MonitorID == "" || event.TriggerID == "" || event.AlertID == "" {
		return errors.New("monitorId, triggerId, and alertId are required")
	}
	allowedState := map[string]bool{"ACTIVE": true, "ACKNOWLEDGED": true, "COMPLETED": true, "DELETED": true, "ERROR": true}
	if !allowedState[event.State] {
		return errors.New("upstream alert state is invalid")
	}
	allowedType := false
	for _, v := range expected {
		if event.MonitorType == v {
			allowedType = true
		}
	}
	if !allowedType {
		return errors.New("monitor type is not enabled for this receiver")
	}
	return nil
}

func (s *Service) receiverForIngest(ctx context.Context, receiverID string) (Receiver, string, string, *time.Time, []string, error) {
	receiver, err := s.GetReceiver(ctx, receiverID)
	if err != nil {
		return Receiver{}, "", "", nil, nil, err
	}
	var tokenHash, previous string
	var expiry *time.Time
	var masksJSON []byte
	err = s.pool.QueryRow(ctx, `SELECT token_hash,COALESCE(previous_token_hash,''),previous_token_expires_at,a.masking_rules FROM opensearch_alert_receivers r JOIN applications a ON a.id=r.application_id WHERE r.id=$1`, receiverID).Scan(&tokenHash, &previous, &expiry, &masksJSON)
	var masks []string
	_ = json.Unmarshal(masksJSON, &masks)
	return receiver, tokenHash, previous, expiry, masks, err
}

func validToken(token, current, previous string, expiry *time.Time) bool {
	sum := sha256.Sum256([]byte(strings.TrimSpace(token)))
	candidate := hex.EncodeToString(sum[:])
	if subtle.ConstantTimeCompare([]byte(candidate), []byte(current)) == 1 {
		return true
	}
	return previous != "" && expiry != nil && expiry.After(time.Now()) && subtle.ConstantTimeCompare([]byte(candidate), []byte(previous)) == 1
}

var sensitiveKey = regexp.MustCompile(`(?i)(authorization|cookie|password|passwd|secret|token|api[-_]?key|private[-_]?key|session)`)

func maskValue(value any, path string, patterns []string) any {
	switch v := value.(type) {
	case map[string]any:
		out := map[string]any{}
		for key, item := range v {
			child := key
			if path != "" {
				child = path + "." + key
			}
			masked := sensitiveKey.MatchString(child)
			for _, p := range patterns {
				if strings.EqualFold(p, child) || strings.EqualFold(p, key) {
					masked = true
				}
			}
			if masked {
				out[key] = "MASKED"
			} else {
				out[key] = maskValue(item, child, patterns)
			}
		}
		return out
	case []any:
		limit := len(v)
		if limit > 20 {
			limit = 20
		}
		out := make([]any, limit)
		for i := 0; i < limit; i++ {
			out[i] = maskValue(v[i], path, patterns)
		}
		return out
	case []map[string]any:
		limit := len(v)
		if limit > 20 {
			limit = 20
		}
		out := make([]map[string]any, limit)
		for i := 0; i < limit; i++ {
			out[i] = maskValue(v[i], path, patterns).(map[string]any)
		}
		return out
	default:
		return value
	}
}

func (s *Service) applyEvent(ctx context.Context, receiver Receiver, event ExternalEvent, masks []string, reconciled bool) error {
	now := time.Now().UTC()
	occurred := now
	if event.OccurredAt != nil {
		occurred = *event.OccurredAt
	}
	state := mapState(event.State)
	severity := mapSeverity(event.Severity)
	dedup := fmt.Sprintf("opensearch:%s:%s:%s:%s:%s", receiver.ID, event.MonitorID, event.TriggerID, event.AlertID, event.BucketKey)
	evidence := map[string]any{"periodStart": event.PeriodStart, "periodEnd": event.PeriodEnd, "findingIds": event.FindingIDs, "documentIds": event.DocumentIDs, "samples": event.Samples, "resultSummary": event.ResultSummary, "error": event.Error}
	evidence = maskValue(evidence, "", masks).(map[string]any)
	encoded, _ := json.Marshal(evidence)
	if len(encoded) > 256*1024 {
		evidence = map[string]any{"captureState": "TRUNCATED", "error": event.Error}
		encoded, _ = json.Marshal(evidence)
	}
	var existingID, existingState string
	isNew := false
	err := s.pool.QueryRow(ctx, `SELECT id::text,state FROM alerts WHERE deduplication_key=$1 ORDER BY created_at DESC LIMIT 1`, dedup).Scan(&existingID, &existingState)
	if errors.Is(err, pgx.ErrNoRows) {
		isNew = true
		existingID, _ = id.NewUUID()
		title := event.TriggerName
		if title == "" {
			title = event.MonitorName
		}
		if title == "" {
			title = "OpenSearch alert"
		}
		description := event.MonitorName
		if event.Error != "" {
			description = event.Error
		}
		_, err = s.pool.Exec(ctx, `INSERT INTO alerts(id,monitor_id,deduplication_key,state,severity,title,description,failure_category,consecutive_failures,first_triggered_at,last_triggered_at,created_at,updated_at,source_type,application_id,service_id,receiver_id,external_monitor_id,external_monitor_name,external_monitor_type,external_trigger_id,external_trigger_name,external_alert_id,bucket_key,upstream_state,hit_count,evidence,dashboard_url,last_received_at,last_reconciled_at,sample_expires_at,resolved_at) VALUES($1,NULL,$2,$3::varchar,$4,$5,$6,$7,1,$8::timestamptz,$8::timestamptz,$8::timestamptz,$8::timestamptz,'OPENSEARCH_ALERTING',$9,NULLIF($10,'')::uuid,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$8::timestamptz,CASE WHEN $23 THEN $8::timestamptz ELSE NULL END,$8::timestamptz+INTERVAL '7 days',CASE WHEN $3::varchar='RESOLVED'::varchar THEN $8::timestamptz ELSE NULL END)`, existingID, dedup, state, severity, title, description, category(event), occurred, receiver.ApplicationID, receiver.ServiceID, receiver.ID, event.MonitorID, event.MonitorName, event.MonitorType, event.TriggerID, event.TriggerName, event.AlertID, event.BucketKey, event.State, event.HitCount, encoded, receiver.DashboardURL, reconciled)
		if err != nil {
			return err
		}
	} else if err != nil {
		return err
	} else {
		if existingState == "ACKNOWLEDGED" && (state == "OPEN" || state == "ERROR") {
			state = "ACKNOWLEDGED"
		}
		_, err = s.pool.Exec(ctx, `UPDATE alerts SET state=$2::varchar,upstream_state=$3,severity=$4,description=CASE WHEN $5<>'' THEN $5 ELSE description END,hit_count=$6,evidence=$7,last_triggered_at=$8::timestamptz,last_received_at=CASE WHEN NOT $9 THEN $8::timestamptz ELSE last_received_at END,last_reconciled_at=CASE WHEN $9 THEN $8::timestamptz ELSE last_reconciled_at END,resolved_at=CASE WHEN $2::varchar='RESOLVED'::varchar THEN $8::timestamptz ELSE NULL END,updated_at=$8::timestamptz,sample_expires_at=$8::timestamptz+INTERVAL '7 days' WHERE id=$1`, existingID, state, event.State, severity, event.Error, event.HitCount, encoded, occurred, reconciled)
		if err != nil {
			return err
		}
	}
	if err := s.recordEvent(ctx, existingID, "OPENSEARCH_"+event.State, event.State, "OpenSearch alert state received", evidence); err != nil {
		return err
	}
	return s.enqueueOpenSearchNotifications(ctx, existingID, existingState, state, isNew, occurred)
}

func (s *Service) enqueueOpenSearchNotifications(ctx context.Context, alertID, previousState, state string, isNew bool, now time.Time) error {
	switch {
	case isNew && (state == "OPEN" || state == "ERROR"):
		return notifications.EnqueueWithPool(ctx, s.pool, alertID, "ALERT_OPENED", now)
	case !isNew && previousState != state && (state == "OPEN" || state == "ERROR") && previousState != "ACKNOWLEDGED":
		return notifications.EnqueueWithPool(ctx, s.pool, alertID, "ALERT_OPENED", now)
	case !isNew && previousState != state && state == "RESOLVED" && (previousState == "OPEN" || previousState == "ACKNOWLEDGED" || previousState == "ERROR"):
		return notifications.EnqueueWithPool(ctx, s.pool, alertID, "ALERT_RECOVERED", now)
	default:
		return nil
	}
}

func mapState(value string) string {
	switch value {
	case "ACKNOWLEDGED":
		return "ACKNOWLEDGED"
	case "COMPLETED", "DELETED":
		return "RESOLVED"
	case "ERROR":
		return "ERROR"
	default:
		return "OPEN"
	}
}
func mapSeverity(value string) string {
	switch value {
	case "1", "CRITICAL":
		return "CRITICAL"
	case "2", "HIGH":
		return "HIGH"
	case "3", "WARNING", "MEDIUM":
		return "WARNING"
	case "4", "LOW":
		return "LOW"
	default:
		return "INFO"
	}
}
func category(event ExternalEvent) string {
	if event.State == "ERROR" {
		return "OPENSEARCH_MONITOR_ERROR"
	}
	return "OPENSEARCH_ALERT"
}
func (s *Service) recordEvent(ctx context.Context, alertID, eventType, upstream, summary string, evidence map[string]any) error {
	identifier, _ := id.NewUUID()
	if evidence == nil {
		evidence = map[string]any{}
	}
	encoded, _ := json.Marshal(evidence)
	_, err := s.pool.Exec(ctx, `INSERT INTO alert_events(id,alert_id,event_type,upstream_state,summary,evidence)VALUES($1,$2,$3,NULLIF($4,''),$5,$6)`, identifier, alertID, eventType, upstream, summary, encoded)
	return err
}
func (s *Service) rejectDelivery(ctx context.Context, deliveryID, message string) {
	if len(message) > 500 {
		message = message[:500]
	}
	_, _ = s.pool.Exec(ctx, `UPDATE opensearch_alert_deliveries SET status='REJECTED',safe_error=$2,processed_at=NOW() WHERE id=$1`, deliveryID, message)
}

func (s *Service) Reconcile(ctx context.Context, receiverID string) (map[string]any, error) {
	if s.fetcher == nil {
		return nil, errors.New("OpenSearch alert reconciliation is unavailable")
	}
	receiver, err := s.GetReceiver(ctx, receiverID)
	if err != nil {
		return nil, err
	}
	runID, _ := id.NewUUID()
	_, _ = s.pool.Exec(ctx, `INSERT INTO opensearch_alert_reconciliation_runs(id,receiver_id,status)VALUES($1,$2,'RUNNING')`, runID, receiverID)
	raw, err := s.fetcher.FetchAlertingAlerts(ctx)
	if err != nil {
		safe := safeError(err)
		_, _ = s.pool.Exec(ctx, `UPDATE opensearch_alert_reconciliation_runs SET status='FAILED',safe_error=$2,completed_at=NOW() WHERE id=$1`, runID, safe)
		_, _ = s.pool.Exec(ctx, `UPDATE opensearch_alert_receivers SET last_reconciliation_status='FAILED',last_reconciliation_error=$2,last_reconciled_at=NOW() WHERE id=$1`, receiverID, safe)
		return nil, err
	}
	var payload struct {
		Alerts []map[string]any `json:"alerts"`
	}
	if err = json.Unmarshal(raw, &payload); err != nil {
		return nil, errors.New("OpenSearch Alerting API returned invalid JSON")
	}
	var masksJSON []byte
	_ = s.pool.QueryRow(ctx, `SELECT masking_rules FROM applications WHERE id=$1`, receiver.ApplicationID).Scan(&masksJSON)
	var masks []string
	_ = json.Unmarshal(masksJSON, &masks)
	changed := 0
	for _, item := range payload.Alerts {
		event := eventFromAPI(item)
		if event.MonitorID == "" {
			continue
		}
		normalizeEvent(&event)
		if validateEvent(event, receiver.ExpectedMonitorTypes) != nil {
			continue
		}
		if s.applyEvent(ctx, receiver, event, masks, true) == nil {
			changed++
		}
	}
	now := time.Now().UTC()
	_, _ = s.pool.Exec(ctx, `UPDATE opensearch_alert_reconciliation_runs SET status='SUCCESS',alerts_seen=$2,alerts_changed=$3,completed_at=$4 WHERE id=$1`, runID, len(payload.Alerts), changed, now)
	_, _ = s.pool.Exec(ctx, `UPDATE opensearch_alert_receivers SET last_reconciliation_status='SUCCESS',last_reconciliation_error='',last_reconciled_at=$2 WHERE id=$1`, receiverID, now)
	return map[string]any{"status": "SUCCESS", "alertsSeen": len(payload.Alerts), "alertsChanged": changed, "completedAt": now}, nil
}

func eventFromAPI(item map[string]any) ExternalEvent {
	e := ExternalEvent{MonitorID: text(item["monitor_id"]), MonitorName: text(item["monitor_name"]), MonitorType: normalizeAPIMonitorType(text(item["monitor_type"])), TriggerID: text(item["trigger_id"]), TriggerName: text(item["trigger_name"]), Severity: text(item["severity"]), AlertID: text(item["id"]), State: text(item["state"]), Error: text(item["error_message"])}
	if value, ok := item["start_time"].(string); ok {
		e.PeriodStart = value
	}
	if value, ok := item["end_time"].(string); ok {
		e.PeriodEnd = value
	}
	return e
}
func normalizeAPIMonitorType(value string) string {
	value = strings.ToUpper(value)
	switch {
	case strings.Contains(value, "BUCKET"):
		return "BUCKET_LEVEL"
	case strings.Contains(value, "DOC"):
		return "DOCUMENT_LEVEL"
	default:
		return "QUERY_LEVEL"
	}
}
func text(value any) string {
	if value == nil {
		return ""
	}
	return fmt.Sprint(value)
}
func safeError(err error) string {
	message := strings.ReplaceAll(err.Error(), "\n", " ")
	if len(message) > 500 {
		message = message[:500]
	}
	return message
}

func (s *Service) Start(ctx context.Context) {
	go func() {
		ticker := time.NewTicker(time.Minute)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				// Samples are deliberately short-lived even when alert summaries are
				// retained. Keep only an explicit capture-state marker after expiry.
				_, _ = s.pool.Exec(ctx, `UPDATE alerts
					SET evidence = '{"captureState":"EXPIRED"}'::jsonb,
						sample_expires_at = NULL
					WHERE source_type = 'OPENSEARCH_ALERTING'
						AND sample_expires_at IS NOT NULL
						AND sample_expires_at <= NOW()`)
				if s.fetcher == nil {
					continue
				}
				receivers, err := s.ListReceivers(ctx, "")
				if err != nil {
					continue
				}
				now := time.Now()
				for _, r := range receivers {
					if !r.Enabled {
						continue
					}
					if r.LastReconciledAt != nil && now.Sub(*r.LastReconciledAt) < time.Duration(r.ReconciliationIntervalSeconds)*time.Second {
						continue
					}
					reconcileCtx, cancel := context.WithTimeout(ctx, 35*time.Second)
					_, _ = s.Reconcile(reconcileCtx, r.ID)
					cancel()
				}
			}
		}
	}()
}
