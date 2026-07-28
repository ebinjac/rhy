package elf

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"reflect"
	"regexp"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/rhythm-monitoring/rhythm/internal/id"
)

var ErrNotFound = errors.New("ELF resource not found")
var ErrNotConfigured = errors.New("ELF is not configured")
var ErrConflict = errors.New("ELF resource conflict")

const fieldConditionAggregation = "__rhythm_field_condition"

var fieldPathPattern = regexp.MustCompile(`^[A-Za-z0-9_@.-]+$`)

type Service struct {
	pool         *pgxpool.Pool
	secrets      SecretResolver
	client       *http.Client
	allowPrivate bool
}

func New(pool *pgxpool.Pool, secrets SecretResolver, allowPrivate bool) *Service {
	return &Service{pool: pool, secrets: secrets, allowPrivate: allowPrivate, client: &http.Client{Timeout: 32 * time.Second, CheckRedirect: func(_ *http.Request, _ []*http.Request) error { return errors.New("ELF redirects are not allowed") }}}
}

func (s *Service) EnsureDevelopmentSeed(ctx context.Context, baseURL, actor string) error {
	settings, err := s.GetSettings(ctx)
	if errors.Is(err, ErrNotConfigured) {
		settings, err = s.SaveSettings(ctx, Settings{BaseURL: baseURL, DashboardURL: "http://localhost:15601/app/discover", DefaultIndexPattern: "app-logs-demo-*", TimeoutSeconds: 10, AllowedIndexPatterns: []string{"app-logs-demo-*", "rhythm-demo-logs-*"}, AuthMode: "NONE"}, actor)
		if err != nil {
			return err
		}
	} else if err != nil {
		return err
	} else {
		changed := false
		if settings.DashboardURL == "" || settings.DashboardURL == "http://localhost:15601" {
			settings.DashboardURL = "http://localhost:15601/app/discover"
			changed = true
		}
		for _, pattern := range []string{"app-logs-demo-*", "rhythm-demo-logs-*"} {
			found := false
			for _, allowed := range settings.AllowedIndexPatterns {
				if allowed == pattern || IndexAllowed(pattern, []string{allowed}) {
					found = true
					break
				}
			}
			if !found {
				settings.AllowedIndexPatterns = append(settings.AllowedIndexPatterns, pattern)
				changed = true
			}
		}
		if changed {
			if _, err = s.SaveSettings(ctx, settings, actor); err != nil {
				return err
			}
		}
	}

	apps, err := s.ListApplications(ctx)
	if err != nil {
		return err
	}
	var app Application
	for _, candidate := range apps {
		if candidate.CARID == "CAR-DEMO-1001" {
			app = candidate
			break
		}
	}
	semanticMapping := map[string]string{"@timestamp": "time", "log.level": "level", "message": "message", "service": "service", "trace.id": "trace", "endpoint": "endpoint", "responseTimeMs": "latency"}
	if app.ID == "" {
		app, err = s.CreateApplication(ctx, ApplicationInput{CARID: "CAR-DEMO-1001", Name: "Demo Storefront", Owner: "Rhythm Demo Team", Environment: "local", DefaultIndexPattern: "app-logs-demo-commerce-*", DefaultTimeField: "@timestamp", MaskingRules: []string{"customer.email", "authorization", "token", "password", "session"}, SemanticMapping: semanticMapping}, actor)
		if err != nil {
			return err
		}
	}

	services := map[string]AppService{}
	for _, service := range app.Services {
		services[service.Name] = service
	}
	ensureService := func(name, indexPattern string) (AppService, error) {
		if service, ok := services[name]; ok {
			return service, nil
		}
		service, saveErr := s.SaveService(ctx, app.ID, "", ServiceInput{Name: name, IndexPattern: indexPattern, TimeField: "@timestamp", SemanticMapping: semanticMapping})
		if saveErr == nil {
			services[name] = service
		}
		return service, saveErr
	}
	sampleWeb, err := ensureService("sample-web-app", "")
	if err != nil {
		return err
	}
	if _, err = ensureService("orders-api", "app-logs-demo-orders-*"); err != nil {
		return err
	}
	identity, err := ensureService("identity-api", "app-logs-demo-identity-*")
	if err != nil {
		return err
	}
	if _, err = ensureService("checkout-api", ""); err != nil {
		return err
	}
	if _, err = ensureService("payments-api", ""); err != nil {
		return err
	}
	if _, err = ensureService("inventory-worker", ""); err != nil {
		return err
	}

	queries, err := s.ListQueries(ctx)
	if err != nil {
		return err
	}
	existingQueries := map[string]bool{}
	for _, query := range queries {
		if query.ApplicationID == app.ID {
			existingQueries[query.Name] = true
		}
	}
	ensureQuery := func(input QueryInput) error {
		if existingQueries[input.Name] {
			return nil
		}
		_, saveErr := s.SaveQuery(ctx, "", input, actor)
		return saveErr
	}
	queryInputs := []QueryInput{
		{Name: "Demo · 500 errors on orders", Description: "The exact sample scenario: fail when hits.total.value reports one or more HTTP 500 responses for /api/orders.", ApplicationID: app.ID, ServiceID: sampleWeb.ID, SearchBody: json.RawMessage(`{"size":1000,"query":{"bool":{"filter":[{"match_all":{}},{"match_phrase":{"service":"sample-web-app"}},{"exists":{"field":"responseTimeMs"}},{"match_phrase":{"endpoint":"/api/orders"}},{"term":{"statusCode":500}}]}},"sort":[{"@timestamp":{"order":"desc"}}]}`), DefaultWindowSeconds: 900, CheckKind: "HIT_COUNT", Criteria: map[string]any{"operator": "LTE", "value": 0}, GateMode: "BLOCKING", SemanticMapping: semanticMapping},
		{Name: "Demo · Slow API responses", Description: "Find responses taking at least one second across the storefront application.", ApplicationID: app.ID, SearchBody: json.RawMessage(`{"query":{"bool":{"filter":[{"exists":{"field":"responseTimeMs"}},{"range":{"responseTimeMs":{"gte":1000}}}]}}}`), DefaultWindowSeconds: 3600, CheckKind: "HIT_COUNT", Criteria: map[string]any{"operator": "LTE", "value": 5}, GateMode: "ADVISORY", SemanticMapping: semanticMapping},
		{Name: "Demo · Authentication failures", Description: "Count failed login attempts in the identity service index.", ApplicationID: app.ID, ServiceID: identity.ID, SearchBody: json.RawMessage(`{"query":{"bool":{"filter":[{"term":{"service":"identity-api"}},{"term":{"statusCode":401}}]}}}`), DefaultWindowSeconds: 900, CheckKind: "HIT_COUNT", Criteria: map[string]any{"operator": "LTE", "value": 3}, GateMode: "ADVISORY", SemanticMapping: semanticMapping},
		{Name: "Demo · Dependency timeouts", Description: "Detect payment, order, or database dependency timeouts.", ApplicationID: app.ID, SearchBody: json.RawMessage(`{"query":{"bool":{"filter":[{"term":{"error.type":"DependencyTimeout"}}]}}}`), DefaultWindowSeconds: 1800, CheckKind: "HIT_COUNT", Criteria: map[string]any{"operator": "LTE", "value": 0}, GateMode: "BLOCKING", SemanticMapping: semanticMapping},
	}
	for _, input := range queryInputs {
		if err = ensureQuery(input); err != nil {
			return err
		}
	}
	return nil
}

func (s *Service) GetSettings(ctx context.Context) (Settings, error) {
	item, err := s.loadSettings(ctx)
	if err != nil {
		return Settings{}, err
	}
	return redactSettings(item), nil
}

func (s *Service) loadSettings(ctx context.Context) (Settings, error) {
	var item Settings
	var allowed []byte
	var tlsID, proxyID *string
	err := s.pool.QueryRow(ctx, `SELECT base_url,dashboard_url,default_index_pattern,timeout_seconds,allowed_index_patterns,tls_profile_id::text,proxy_profile_id::text,auth_mode,username,credential_secret_ref,COALESCE(encrypted_credential,''),updated_by,updated_at FROM elf_settings WHERE singleton=TRUE`).Scan(&item.BaseURL, &item.DashboardURL, &item.DefaultIndexPattern, &item.TimeoutSeconds, &allowed, &tlsID, &proxyID, &item.AuthMode, &item.Username, &item.CredentialSecretRef, &item.EncryptedCredential, &item.UpdatedBy, &item.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return Settings{}, ErrNotConfigured
	}
	if err != nil {
		return Settings{}, err
	}
	_ = json.Unmarshal(allowed, &item.AllowedIndexPatterns)
	if tlsID != nil {
		item.TLSProfileID = *tlsID
	}
	if proxyID != nil {
		item.ProxyProfileID = *proxyID
	}
	item.HasCredential = strings.TrimSpace(item.EncryptedCredential) != "" || strings.HasPrefix(strings.TrimSpace(item.CredentialSecretRef), "secret://")
	return item, nil
}

func redactSettings(item Settings) Settings {
	item.Credential = ""
	item.EncryptedCredential = ""
	if item.HasCredential || strings.HasPrefix(strings.TrimSpace(item.CredentialSecretRef), "secret://") {
		item.HasCredential = true
	}
	return item
}

func (s *Service) SaveSettings(ctx context.Context, input Settings, actor string) (Settings, error) {
	input.BaseURL = strings.TrimRight(strings.TrimSpace(input.BaseURL), "/")
	input.DashboardURL = strings.TrimRight(strings.TrimSpace(input.DashboardURL), "/")
	input.DefaultIndexPattern = strings.TrimSpace(input.DefaultIndexPattern)
	input.AuthMode = strings.ToUpper(strings.TrimSpace(input.AuthMode))
	input.Username = strings.TrimSpace(input.Username)
	input.Credential = strings.TrimSpace(input.Credential)
	input.CredentialSecretRef = strings.TrimSpace(input.CredentialSecretRef)
	if input.AuthMode == "" {
		input.AuthMode = "NONE"
	}
	if input.TimeoutSeconds == 0 {
		input.TimeoutSeconds = 10
	}
	if input.BaseURL == "" || input.DefaultIndexPattern == "" {
		return Settings{}, errors.New("baseUrl and defaultIndexPattern are required")
	}
	parsed, err := url.Parse(input.BaseURL)
	if err != nil || parsed.Host == "" || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		return Settings{}, errors.New("baseUrl must be an absolute HTTP or HTTPS URL")
	}
	if parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" {
		return Settings{}, errors.New("baseUrl may not contain credentials, query parameters, or fragments")
	}
	if input.TimeoutSeconds < 1 || input.TimeoutSeconds > 30 {
		return Settings{}, errors.New("timeoutSeconds must be between 1 and 30")
	}
	if len(input.AllowedIndexPatterns) == 0 {
		input.AllowedIndexPatterns = []string{input.DefaultIndexPattern}
	}
	if !IndexAllowed(input.DefaultIndexPattern, input.AllowedIndexPatterns) {
		return Settings{}, errors.New("defaultIndexPattern must be permitted by allowedIndexPatterns")
	}
	if input.AuthMode != "NONE" && input.AuthMode != "BASIC" && input.AuthMode != "BEARER" {
		return Settings{}, errors.New("authMode must be NONE, BASIC, or BEARER")
	}

	existing, existingErr := s.loadSettings(ctx)
	if existingErr != nil && !errors.Is(existingErr, ErrNotConfigured) {
		return Settings{}, existingErr
	}

	secretRef := ""
	encrypted := ""
	if input.AuthMode == "NONE" {
		input.Username = ""
	} else {
		if input.Credential != "" && input.CredentialSecretRef != "" {
			return Settings{}, errors.New("provide either credential or credentialSecretRef, not both")
		}
		switch {
		case input.Credential != "":
			crypto, ok := s.secrets.(CredentialCrypto)
			if !ok || crypto == nil {
				return Settings{}, errors.New("inline ELF credentials require secrets encryption support")
			}
			ciphertext, encryptErr := crypto.EncryptStored(input.Credential)
			if encryptErr != nil {
				return Settings{}, encryptErr
			}
			encrypted = ciphertext
		case input.CredentialSecretRef != "":
			secretRef = input.CredentialSecretRef
			if !strings.HasPrefix(secretRef, "secret://") {
				secretRef = "secret://" + secretRef
			}
		case existingErr == nil:
			encrypted = existing.EncryptedCredential
			secretRef = existing.CredentialSecretRef
		}
		if encrypted == "" && !strings.HasPrefix(secretRef, "secret://") {
			return Settings{}, errors.New("authenticated ELF settings require a credential or secret alias")
		}
		if input.AuthMode == "BASIC" && input.Username == "" {
			return Settings{}, errors.New("BASIC authentication requires a username")
		}
	}

	allowed, _ := json.Marshal(input.AllowedIndexPatterns)
	_, err = s.pool.Exec(ctx, `INSERT INTO elf_settings(singleton,base_url,dashboard_url,default_index_pattern,timeout_seconds,allowed_index_patterns,tls_profile_id,proxy_profile_id,auth_mode,username,credential_secret_ref,encrypted_credential,updated_by,updated_at) VALUES(TRUE,$1,$2,$3,$4,$5,NULLIF($6,'')::uuid,NULLIF($7,'')::uuid,$8,$9,$10,$11,$12,NOW()) ON CONFLICT(singleton) DO UPDATE SET base_url=EXCLUDED.base_url,dashboard_url=EXCLUDED.dashboard_url,default_index_pattern=EXCLUDED.default_index_pattern,timeout_seconds=EXCLUDED.timeout_seconds,allowed_index_patterns=EXCLUDED.allowed_index_patterns,tls_profile_id=EXCLUDED.tls_profile_id,proxy_profile_id=EXCLUDED.proxy_profile_id,auth_mode=EXCLUDED.auth_mode,username=EXCLUDED.username,credential_secret_ref=EXCLUDED.credential_secret_ref,encrypted_credential=EXCLUDED.encrypted_credential,updated_by=EXCLUDED.updated_by,updated_at=NOW()`, input.BaseURL, input.DashboardURL, input.DefaultIndexPattern, input.TimeoutSeconds, allowed, input.TLSProfileID, input.ProxyProfileID, input.AuthMode, input.Username, secretRef, encrypted, actor)
	if err != nil {
		return Settings{}, err
	}
	return s.GetSettings(ctx)
}

func (s *Service) TestSettings(ctx context.Context, input *Settings) (map[string]any, error) {
	settings := Settings{}
	var err error
	if input != nil {
		settings = *input
		settings.BaseURL = strings.TrimRight(strings.TrimSpace(settings.BaseURL), "/")
		settings.DefaultIndexPattern = strings.TrimSpace(settings.DefaultIndexPattern)
		settings.AuthMode = strings.ToUpper(strings.TrimSpace(settings.AuthMode))
		settings.Username = strings.TrimSpace(settings.Username)
		settings.Credential = strings.TrimSpace(settings.Credential)
		settings.CredentialSecretRef = strings.TrimSpace(settings.CredentialSecretRef)
		if settings.AuthMode == "" {
			settings.AuthMode = "NONE"
		}
		// Merge stored credential material when the client leaves replacement fields empty.
		if settings.AuthMode != "NONE" && settings.Credential == "" {
			if existing, loadErr := s.loadSettings(ctx); loadErr == nil {
				if settings.CredentialSecretRef == "" {
					settings.EncryptedCredential = existing.EncryptedCredential
					settings.CredentialSecretRef = existing.CredentialSecretRef
				}
			}
		}
		if settings.CredentialSecretRef != "" && !strings.HasPrefix(settings.CredentialSecretRef, "secret://") {
			settings.CredentialSecretRef = "secret://" + settings.CredentialSecretRef
		}
	} else {
		settings, err = s.loadSettings(ctx)
		if err != nil {
			return nil, err
		}
	}
	if settings.TimeoutSeconds == 0 {
		settings.TimeoutSeconds = 10
	}
	from := time.Now().UTC().Add(-5 * time.Minute)
	to := time.Now().UTC()
	compiled := ValidateAndCompile(json.RawMessage(`{"query":{"match_all":{}}}`), "@timestamp", from, to, 0)
	if !compiled.Valid {
		return nil, errors.New("unable to compile connection test")
	}
	started := time.Now()
	raw, status, err := s.search(ctx, settings, settings.DefaultIndexPattern, compiled.CompiledBody)
	result := map[string]any{"reachable": err == nil, "status": status, "durationMs": time.Since(started).Milliseconds(), "baseUrl": settings.BaseURL, "index": settings.DefaultIndexPattern}
	if err != nil {
		result["category"] = categorize(err, status)
		result["message"] = safeMessage(err)
		return result, nil
	}
	var payload map[string]any
	_ = json.Unmarshal(raw, &payload)
	result["clusterResponse"] = "Search completed with credentials and index access."
	return result, nil
}

func (s *Service) ListApplications(ctx context.Context) ([]Application, error) {
	rows, err := s.pool.Query(ctx, `SELECT id::text,car_id,name,owner,environment,default_index_pattern,default_time_field,masking_rules,semantic_mapping,alert_emails,active,created_at,updated_at FROM applications ORDER BY name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []Application{}
	for rows.Next() {
		item, err := scanApplication(rows)
		if err != nil {
			return nil, err
		}
		if err = s.loadApplicationChildren(ctx, &item); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}
func (s *Service) GetApplication(ctx context.Context, applicationID string) (Application, error) {
	item, err := scanApplication(s.pool.QueryRow(ctx, `SELECT id::text,car_id,name,owner,environment,default_index_pattern,default_time_field,masking_rules,semantic_mapping,alert_emails,active,created_at,updated_at FROM applications WHERE id=$1`, applicationID))
	if errors.Is(err, pgx.ErrNoRows) {
		return Application{}, ErrNotFound
	}
	if err != nil {
		return Application{}, err
	}
	err = s.loadApplicationChildren(ctx, &item)
	return item, err
}
func scanApplication(row interface{ Scan(...any) error }) (Application, error) {
	var item Application
	var masks, mapping, emails []byte
	if err := row.Scan(&item.ID, &item.CARID, &item.Name, &item.Owner, &item.Environment, &item.DefaultIndexPattern, &item.DefaultTimeField, &masks, &mapping, &emails, &item.Active, &item.CreatedAt, &item.UpdatedAt); err != nil {
		return item, err
	}
	_ = json.Unmarshal(masks, &item.MaskingRules)
	_ = json.Unmarshal(mapping, &item.SemanticMapping)
	_ = json.Unmarshal(emails, &item.AlertEmails)
	if item.MaskingRules == nil {
		item.MaskingRules = []string{}
	}
	if item.SemanticMapping == nil {
		item.SemanticMapping = map[string]string{}
	}
	if item.AlertEmails == nil {
		item.AlertEmails = []string{}
	}
	return item, nil
}
func (s *Service) loadApplicationChildren(ctx context.Context, item *Application) error {
	rows, err := s.pool.Query(ctx, `SELECT id::text,application_id::text,name,index_pattern,time_field,semantic_mapping,created_at,updated_at FROM application_services WHERE application_id=$1 ORDER BY name`, item.ID)
	if err != nil {
		return err
	}
	defer rows.Close()
	item.Services = []AppService{}
	for rows.Next() {
		var service AppService
		var mapping []byte
		if err := rows.Scan(&service.ID, &service.ApplicationID, &service.Name, &service.IndexPattern, &service.TimeField, &mapping, &service.CreatedAt, &service.UpdatedAt); err != nil {
			return err
		}
		_ = json.Unmarshal(mapping, &service.SemanticMapping)
		if service.SemanticMapping == nil {
			service.SemanticMapping = map[string]string{}
		}
		item.Services = append(item.Services, service)
	}
	rows2, err := s.pool.Query(ctx, `SELECT monitor_id::text FROM application_monitor_links WHERE application_id=$1`, item.ID)
	if err != nil {
		return err
	}
	defer rows2.Close()
	item.MonitorIDs = []string{}
	for rows2.Next() {
		var v string
		if err := rows2.Scan(&v); err != nil {
			return err
		}
		item.MonitorIDs = append(item.MonitorIDs, v)
	}
	return rows2.Err()
}
func (s *Service) CreateApplication(ctx context.Context, input ApplicationInput, actor string) (Application, error) {
	input.Name = strings.TrimSpace(input.Name)
	input.CARID = strings.TrimSpace(input.CARID)
	if input.Name == "" {
		return Application{}, errors.New("name is required")
	}
	if len(input.CARID) > 64 {
		return Application{}, errors.New("CAR ID must be 64 characters or fewer")
	}
	if input.DefaultTimeField == "" {
		input.DefaultTimeField = "@timestamp"
	}
	active := true
	if input.Active != nil {
		active = *input.Active
	}
	identifier, _ := id.NewUUID()
	masks, _ := json.Marshal(input.MaskingRules)
	mapping, _ := json.Marshal(input.SemanticMapping)
	emails, err := marshalAlertEmails(input.AlertEmails)
	if err != nil {
		return Application{}, err
	}
	_, err = s.pool.Exec(ctx, `INSERT INTO applications(id,car_id,name,owner,environment,default_index_pattern,default_time_field,masking_rules,semantic_mapping,alert_emails,active,created_by,updated_by)VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12)`, identifier, input.CARID, input.Name, strings.TrimSpace(input.Owner), strings.TrimSpace(input.Environment), strings.TrimSpace(input.DefaultIndexPattern), strings.TrimSpace(input.DefaultTimeField), masks, mapping, emails, active, actor)
	if err != nil {
		return Application{}, err
	}
	return s.GetApplication(ctx, identifier)
}
func (s *Service) UpdateApplication(ctx context.Context, applicationID string, input ApplicationInput, actor string) (Application, error) {
	current, err := s.GetApplication(ctx, applicationID)
	if err != nil {
		return Application{}, err
	}
	if strings.TrimSpace(input.Name) != "" {
		current.Name = strings.TrimSpace(input.Name)
	}
	current.CARID = strings.TrimSpace(input.CARID)
	if len(current.CARID) > 64 {
		return Application{}, errors.New("CAR ID must be 64 characters or fewer")
	}
	if input.Owner != "" {
		current.Owner = strings.TrimSpace(input.Owner)
	}
	if input.Environment != "" {
		current.Environment = strings.TrimSpace(input.Environment)
	}
	if input.DefaultIndexPattern != "" {
		current.DefaultIndexPattern = strings.TrimSpace(input.DefaultIndexPattern)
	}
	if input.DefaultTimeField != "" {
		current.DefaultTimeField = strings.TrimSpace(input.DefaultTimeField)
	}
	if input.MaskingRules != nil {
		current.MaskingRules = input.MaskingRules
	}
	if input.SemanticMapping != nil {
		current.SemanticMapping = input.SemanticMapping
	}
	if input.AlertEmails != nil {
		normalized, emailErr := normalizeAlertEmails(input.AlertEmails)
		if emailErr != nil {
			return Application{}, emailErr
		}
		current.AlertEmails = normalized
	}
	if input.Active != nil {
		current.Active = *input.Active
	}
	masks, _ := json.Marshal(current.MaskingRules)
	mapping, _ := json.Marshal(current.SemanticMapping)
	emails, err := marshalAlertEmails(current.AlertEmails)
	if err != nil {
		return Application{}, err
	}
	_, err = s.pool.Exec(ctx, `UPDATE applications SET car_id=$2,name=$3,owner=$4,environment=$5,default_index_pattern=$6,default_time_field=$7,masking_rules=$8,semantic_mapping=$9,alert_emails=$10,active=$11,updated_by=$12,updated_at=NOW() WHERE id=$1`, applicationID, current.CARID, current.Name, current.Owner, current.Environment, current.DefaultIndexPattern, current.DefaultTimeField, masks, mapping, emails, current.Active, actor)
	if err != nil {
		return Application{}, err
	}
	return s.GetApplication(ctx, applicationID)
}
func (s *Service) DeleteApplication(ctx context.Context, applicationID string) error {
	var exists bool
	if err := s.pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM applications WHERE id=$1)`, applicationID).Scan(&exists); err != nil {
		return err
	}
	if !exists {
		return ErrNotFound
	}
	var queryCount int
	if err := s.pool.QueryRow(ctx, `SELECT COUNT(*) FROM elf_queries WHERE application_id=$1`, applicationID).Scan(&queryCount); err != nil {
		return err
	}
	if err := errDeleteApplicationBlockedByQueries(queryCount); err != nil {
		return err
	}
	tag, err := s.pool.Exec(ctx, `DELETE FROM applications WHERE id=$1`, applicationID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func errDeleteApplicationBlockedByQueries(queryCount int) error {
	if queryCount <= 0 {
		return nil
	}
	noun := "query"
	if queryCount != 1 {
		noun = "queries"
	}
	return fmt.Errorf("%w: delete or reassign %d ELF %s first", ErrConflict, queryCount, noun)
}

func normalizeAlertEmails(values []string) ([]string, error) {
	if values == nil {
		return []string{}, nil
	}
	seen := map[string]struct{}{}
	out := make([]string, 0, len(values))
	for _, value := range values {
		email := strings.TrimSpace(strings.ToLower(value))
		if email == "" {
			continue
		}
		if !strings.Contains(email, "@") || strings.ContainsAny(email, " \t\r\n,;") {
			return nil, errors.New("alertEmails must contain valid email addresses")
		}
		if _, exists := seen[email]; exists {
			continue
		}
		seen[email] = struct{}{}
		out = append(out, email)
	}
	return out, nil
}

func marshalAlertEmails(values []string) ([]byte, error) {
	normalized, err := normalizeAlertEmails(values)
	if err != nil {
		return nil, err
	}
	return json.Marshal(normalized)
}
func (s *Service) SaveService(ctx context.Context, applicationID, serviceID string, input ServiceInput) (AppService, error) {
	if strings.TrimSpace(input.Name) == "" {
		return AppService{}, errors.New("name is required")
	}
	if serviceID == "" {
		serviceID, _ = id.NewUUID()
	}
	mapping, _ := json.Marshal(input.SemanticMapping)
	_, err := s.pool.Exec(ctx, `INSERT INTO application_services(id,application_id,name,index_pattern,time_field,semantic_mapping)VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,index_pattern=EXCLUDED.index_pattern,time_field=EXCLUDED.time_field,semantic_mapping=EXCLUDED.semantic_mapping,updated_at=NOW()`, serviceID, applicationID, strings.TrimSpace(input.Name), strings.TrimSpace(input.IndexPattern), strings.TrimSpace(input.TimeField), mapping)
	if err != nil {
		return AppService{}, err
	}
	var item AppService
	var raw []byte
	err = s.pool.QueryRow(ctx, `SELECT id::text,application_id::text,name,index_pattern,time_field,semantic_mapping,created_at,updated_at FROM application_services WHERE id=$1`, serviceID).Scan(&item.ID, &item.ApplicationID, &item.Name, &item.IndexPattern, &item.TimeField, &raw, &item.CreatedAt, &item.UpdatedAt)
	_ = json.Unmarshal(raw, &item.SemanticMapping)
	return item, err
}
func (s *Service) DeleteService(ctx context.Context, applicationID, serviceID string) error {
	tag, err := s.pool.Exec(ctx, `DELETE FROM application_services WHERE id=$1 AND application_id=$2`, serviceID, applicationID)
	if err == nil && tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return err
}
func (s *Service) LinkMonitor(ctx context.Context, applicationID, monitorID string, link bool) error {
	if link {
		_, err := s.pool.Exec(ctx, `INSERT INTO application_monitor_links(application_id,monitor_id)VALUES($1,$2) ON CONFLICT(monitor_id) DO UPDATE SET application_id=EXCLUDED.application_id,created_at=NOW()`, applicationID, monitorID)
		return err
	}
	_, err := s.pool.Exec(ctx, `DELETE FROM application_monitor_links WHERE application_id=$1 AND monitor_id=$2`, applicationID, monitorID)
	return err
}

func (s *Service) ListQueries(ctx context.Context) ([]Query, error) {
	rows, err := s.pool.Query(ctx, querySelect+` ORDER BY q.updated_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []Query{}
	for rows.Next() {
		q, err := scanQuery(rows)
		if err != nil {
			return nil, err
		}
		q.LastRun, _ = s.lastRun(ctx, q.ID)
		items = append(items, q)
	}
	return items, rows.Err()
}
func (s *Service) GetQuery(ctx context.Context, queryID string) (Query, error) {
	q, err := scanQuery(s.pool.QueryRow(ctx, querySelect+` WHERE q.id=$1`, queryID))
	if errors.Is(err, pgx.ErrNoRows) {
		return Query{}, ErrNotFound
	}
	if err == nil {
		q.LastRun, _ = s.lastRun(ctx, q.ID)
	}
	return q, err
}

const querySelect = `SELECT q.id::text,q.name,q.description,q.application_id::text,a.name,COALESCE(q.service_id::text,''),COALESCE(s.name,''),q.index_override,q.active,q.current_revision_id::text,r.revision_number,r.search_body,r.default_window_seconds,r.check_kind,r.criteria,r.gate_mode,r.discovered_schema,r.semantic_mapping,q.created_at,q.updated_at FROM elf_queries q JOIN applications a ON a.id=q.application_id LEFT JOIN application_services s ON s.id=q.service_id JOIN elf_query_revisions r ON r.id=q.current_revision_id`

func scanQuery(row interface{ Scan(...any) error }) (Query, error) {
	var q Query
	var criteria, schema, mapping []byte
	if err := row.Scan(&q.ID, &q.Name, &q.Description, &q.ApplicationID, &q.ApplicationName, &q.ServiceID, &q.ServiceName, &q.IndexOverride, &q.Active, &q.CurrentRevisionID, &q.RevisionNumber, &q.SearchBody, &q.DefaultWindowSeconds, &q.CheckKind, &criteria, &q.GateMode, &schema, &mapping, &q.CreatedAt, &q.UpdatedAt); err != nil {
		return q, err
	}
	_ = json.Unmarshal(criteria, &q.Criteria)
	_ = json.Unmarshal(schema, &q.DiscoveredSchema)
	_ = json.Unmarshal(mapping, &q.SemanticMapping)
	if q.Criteria == nil {
		q.Criteria = map[string]any{}
	}
	if q.DiscoveredSchema == nil {
		q.DiscoveredSchema = []Field{}
	}
	if q.SemanticMapping == nil {
		q.SemanticMapping = map[string]string{}
	}
	return q, nil
}
func (s *Service) SaveQuery(ctx context.Context, queryID string, input QueryInput, actor string) (Query, error) {
	input.Name = strings.TrimSpace(input.Name)
	if input.Name == "" || input.ApplicationID == "" {
		return Query{}, errors.New("name and applicationId are required")
	}
	if input.DefaultWindowSeconds == 0 {
		input.DefaultWindowSeconds = 900
	}
	// ELF checks deliberately evaluate one authoritative value: the exact
	// OpenSearch hits.total.value. Other evidence is available for exploration,
	// but cannot change a gate decision.
	input.CheckKind = "HIT_COUNT"
	operator := strings.ToUpper(strings.TrimSpace(fmt.Sprint(input.Criteria["operator"])))
	if operator == "" {
		operator = "EQ"
	}
	if operator != "LT" && operator != "LTE" && operator != "EQ" && operator != "NE" && operator != "GTE" && operator != "GT" {
		return Query{}, errors.New("criteria.operator must be LT, LTE, EQ, NE, GTE, or GT")
	}
	threshold, ok := number(input.Criteria["value"])
	if !ok || threshold < 0 || threshold != math.Trunc(threshold) {
		return Query{}, errors.New("criteria.value must be a non-negative whole number")
	}
	input.Criteria = map[string]any{"operator": operator, "value": threshold}
	if input.GateMode == "" {
		input.GateMode = "BLOCKING"
	}
	input.GateMode = strings.ToUpper(input.GateMode)
	if input.GateMode != "BLOCKING" && input.GateMode != "ADVISORY" {
		return Query{}, errors.New("gateMode must be BLOCKING or ADVISORY")
	}
	if len(input.SearchBody) == 0 {
		input.SearchBody = json.RawMessage(`{"query":{"match_all":{}}}`)
	}
	probe := ValidateAndCompile(input.SearchBody, "@timestamp", time.Now().Add(-time.Minute), time.Now(), 10)
	if !probe.Valid {
		return Query{}, fmt.Errorf("search body violates ELF policy: %s", probe.Problems[0].Message)
	}
	active := true
	if input.Active != nil {
		active = *input.Active
	}
	if queryID == "" {
		queryID, _ = id.NewUUID()
		_, err := s.pool.Exec(ctx, `INSERT INTO elf_queries(id,name,description,application_id,service_id,index_override,active,created_by,updated_by)VALUES($1,$2,$3,$4,NULLIF($5,'')::uuid,$6,$7,$8,$8)`, queryID, input.Name, strings.TrimSpace(input.Description), input.ApplicationID, input.ServiceID, strings.TrimSpace(input.IndexOverride), active, actor)
		if err != nil {
			return Query{}, err
		}
	} else {
		current, err := s.GetQuery(ctx, queryID)
		if err != nil {
			return Query{}, err
		}
		if current.Name == input.Name && current.Description == strings.TrimSpace(input.Description) && current.ApplicationID == input.ApplicationID && current.ServiceID == input.ServiceID && current.IndexOverride == strings.TrimSpace(input.IndexOverride) && current.Active == active && current.DefaultWindowSeconds == input.DefaultWindowSeconds && current.CheckKind == input.CheckKind && current.GateMode == input.GateMode && jsonEquivalent(current.SearchBody, input.SearchBody) && reflect.DeepEqual(current.Criteria, input.Criteria) && reflect.DeepEqual(current.SemanticMapping, input.SemanticMapping) {
			return current, nil
		}
		_, err = s.pool.Exec(ctx, `UPDATE elf_queries SET name=$2,description=$3,application_id=$4,service_id=NULLIF($5,'')::uuid,index_override=$6,active=$7,updated_by=$8,updated_at=NOW() WHERE id=$1`, queryID, input.Name, strings.TrimSpace(input.Description), input.ApplicationID, input.ServiceID, strings.TrimSpace(input.IndexOverride), active, actor)
		if err != nil {
			return Query{}, err
		}
	}
	var revisionNumber int
	if err := s.pool.QueryRow(ctx, `SELECT COALESCE(MAX(revision_number),0)+1 FROM elf_query_revisions WHERE query_id=$1`, queryID).Scan(&revisionNumber); err != nil {
		return Query{}, err
	}
	revisionID, _ := id.NewUUID()
	criteria, _ := json.Marshal(input.Criteria)
	mapping, _ := json.Marshal(input.SemanticMapping)
	_, err := s.pool.Exec(ctx, `INSERT INTO elf_query_revisions(id,query_id,revision_number,search_body,default_window_seconds,check_kind,criteria,gate_mode,semantic_mapping,created_by)VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, revisionID, queryID, revisionNumber, input.SearchBody, input.DefaultWindowSeconds, input.CheckKind, criteria, input.GateMode, mapping, actor)
	if err != nil {
		return Query{}, err
	}
	_, err = s.pool.Exec(ctx, `UPDATE elf_queries SET current_revision_id=$2,updated_at=NOW() WHERE id=$1`, queryID, revisionID)
	if err != nil {
		return Query{}, err
	}
	return s.GetQuery(ctx, queryID)
}
func jsonEquivalent(left, right json.RawMessage) bool {
	var a, b any
	if json.Unmarshal(left, &a) != nil || json.Unmarshal(right, &b) != nil {
		return false
	}
	return reflect.DeepEqual(a, b)
}
func (s *Service) DeleteQuery(ctx context.Context, queryID string) error {
	tag, err := s.pool.Exec(ctx, `DELETE FROM elf_queries WHERE id=$1`, queryID)
	if err == nil && tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return err
}

func (s *Service) DeleteQueries(ctx context.Context, queryIDs []string) (int64, error) {
	if len(queryIDs) == 0 || len(queryIDs) > 100 {
		return 0, errors.New("queryIds must contain between 1 and 100 query IDs")
	}
	unique := make([]string, 0, len(queryIDs))
	seen := make(map[string]struct{}, len(queryIDs))
	for _, queryID := range queryIDs {
		queryID = strings.TrimSpace(queryID)
		if queryID == "" {
			return 0, errors.New("queryIds cannot contain an empty query ID")
		}
		if _, exists := seen[queryID]; exists {
			continue
		}
		seen[queryID] = struct{}{}
		unique = append(unique, queryID)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	var deleted int64
	for _, queryID := range unique {
		tag, deleteErr := tx.Exec(ctx, `DELETE FROM elf_queries WHERE id=$1`, queryID)
		if deleteErr != nil {
			return 0, deleteErr
		}
		if tag.RowsAffected() == 0 {
			return 0, ErrNotFound
		}
		deleted += tag.RowsAffected()
	}
	if err = tx.Commit(ctx); err != nil {
		return 0, err
	}
	return deleted, nil
}

func (s *Service) ValidateQuery(ctx context.Context, queryID string, from, to time.Time) (ValidationResult, error) {
	query, err := s.GetQuery(ctx, queryID)
	if err != nil {
		return ValidationResult{}, err
	}
	_, _, timeField, _, err := s.resolveContext(ctx, query)
	if err != nil {
		return ValidationResult{}, err
	}
	return ValidateAndCompile(query.SearchBody, timeField, from, to, 100), nil
}
func (s *Service) Run(ctx context.Context, queryID, actor string, input ProbeInput, evaluate bool) (RunSummary, error) {
	query, err := s.GetQuery(ctx, queryID)
	if err != nil {
		return RunSummary{}, err
	}
	settings, index, timeField, masks, err := s.resolveContext(ctx, query)
	if err != nil {
		return RunSummary{}, err
	}
	now := time.Now().UTC()
	to := now
	if input.To != nil {
		to = input.To.UTC()
	}
	window := query.DefaultWindowSeconds
	if input.WindowSeconds > 0 {
		window = input.WindowSeconds
	}
	from := to.Add(-time.Duration(window) * time.Second)
	if input.From != nil {
		from = input.From.UTC()
	}
	if input.DeploymentStart != nil {
		from = input.DeploymentStart.UTC()
	}
	size := input.Size
	if size == 0 {
		size = 100
	}
	compiled := ValidateAndCompile(query.SearchBody, timeField, from, to, size)
	if !compiled.Valid {
		return s.saveFailure(ctx, query, index, from, to, actor, "POLICY_ERROR", compiled.Problems[0].Message)
	}
	if !IndexAllowed(index, settings.AllowedIndexPatterns) {
		return s.saveFailure(ctx, query, index, from, to, actor, "INDEX_POLICY_ERROR", "Resolved index is not allowed by ELF settings.")
	}
	requestBody := compiled.CompiledBody
	if isFieldCriteria(query.Criteria) {
		requestBody, err = withFieldCriteria(requestBody, query.Criteria)
		if err != nil {
			return s.saveFailure(ctx, query, index, from, to, actor, "POLICY_ERROR", err.Error())
		}
	}
	started := time.Now()
	raw, status, searchErr := s.search(ctx, settings, index, requestBody)
	roundTrip := time.Since(started).Milliseconds()
	if searchErr != nil {
		return s.saveFailureWithDuration(ctx, query, index, from, to, actor, categorize(searchErr, status), safeMessage(searchErr), roundTrip)
	}
	var response struct {
		Took     int64          `json:"took"`
		TimedOut bool           `json:"timed_out"`
		Shards   map[string]any `json:"_shards"`
		Hits     struct {
			Total struct {
				Value    int64  `json:"value"`
				Relation string `json:"relation"`
			} `json:"total"`
			Hits []struct {
				ID     string         `json:"_id"`
				Index  string         `json:"_index"`
				Source map[string]any `json:"_source"`
				Sort   []any          `json:"sort"`
			} `json:"hits"`
		} `json:"hits"`
		Aggregations map[string]any `json:"aggregations"`
	}
	if err := json.Unmarshal(raw, &response); err != nil {
		return s.saveFailureWithDuration(ctx, query, index, from, to, actor, "RESPONSE_ERROR", "ELF returned a response Rhythm could not parse.", roundTrip)
	}
	var upstreamResponse map[string]any
	if err := json.Unmarshal(raw, &upstreamResponse); err != nil {
		return s.saveFailureWithDuration(ctx, query, index, from, to, actor, "RESPONSE_ERROR", "ELF returned a response Rhythm could not parse.", roundTrip)
	}
	maskedRawResponse := maskDocument(upstreamResponse, masks)
	samples := make([]map[string]any, 0, min(20, len(response.Hits.Hits)))
	for i, hit := range response.Hits.Hits {
		if i >= 20 {
			break
		}
		doc := maskDocument(hit.Source, masks)
		doc["_id"] = hashID(hit.ID)
		doc["_index"] = hit.Index
		samples = append(samples, doc)
	}
	fields := InferFields(samples, query.SemanticMapping)
	conditionEvidence := map[string]any{}
	if isFieldCriteria(query.Criteria) {
		conditionEvidence, _, _ = fieldCriteriaResult(query.Criteria, response.Hits.Total.Value, response.Aggregations)
		delete(response.Aggregations, fieldConditionAggregation)
	} else {
		conditionEvidence = map[string]any{
			"kind":      "HIT_COUNT",
			"path":      "hits.total.value",
			"actual":    response.Hits.Total.Value,
			"operator":  strings.ToUpper(strings.TrimSpace(fmt.Sprint(query.Criteria["operator"]))),
			"threshold": query.Criteria["value"],
		}
	}
	decision := "PENDING"
	if evaluate {
		decision = "PASS"
		if !evaluateCriteria(query.Criteria, response.Hits.Total.Value, response.Aggregations, conditionEvidence) {
			decision = "FAIL"
		}
	}
	run := RunSummary{QueryID: query.ID, RevisionID: query.CurrentRevisionID, Status: "SUCCESS", Decision: decision, GateMode: query.GateMode, ApplicationID: query.ApplicationID, ApplicationName: query.ApplicationName, ServiceID: query.ServiceID, ServiceName: query.ServiceName, ResolvedIndex: index, TimeFrom: from, TimeTo: to, HitCount: response.Hits.Total.Value, OpenSearchTookMS: response.Took, RoundTripMS: roundTrip, ShardSummary: response.Shards, Aggregations: maskDocument(response.Aggregations, masks), RawResponse: maskedRawResponse, Samples: samples, SampleState: "CAPTURED", Fields: fields, Truncation: map[string]any{"displayed": len(response.Hits.Hits), "persisted": len(samples), "truncated": len(response.Hits.Hits) > len(samples)}, Debug: map[string]any{"method": "POST", "url": settings.BaseURL + "/" + index + "/_search", "compiledBody": json.RawMessage(requestBody), "policyNotes": compiled.PolicyNotes, "conditionEvaluation": conditionEvidence}}
	if evaluate && decision == "FAIL" {
		run.FailureCategory = "CRITERIA_FAILED"
		if isFieldCriteria(query.Criteria) {
			run.FailureReason = fieldCriteriaFailure(conditionEvidence)
		} else {
			run.FailureReason = fmt.Sprintf("hits.total.value was %d; expected %s %v.", response.Hits.Total.Value, strings.ToUpper(strings.TrimSpace(fmt.Sprint(query.Criteria["operator"]))), query.Criteria["value"])
		}
	}
	return s.persistRun(ctx, run, actor)
}

func (s *Service) resolveContext(ctx context.Context, q Query) (Settings, string, string, []string, error) {
	settings, err := s.loadSettings(ctx)
	if err != nil {
		return settings, "", "", nil, err
	}
	app, err := s.GetApplication(ctx, q.ApplicationID)
	if err != nil {
		return settings, "", "", nil, err
	}
	index := settings.DefaultIndexPattern
	timeField := "@timestamp"
	if app.DefaultIndexPattern != "" {
		index = app.DefaultIndexPattern
	}
	if app.DefaultTimeField != "" {
		timeField = app.DefaultTimeField
	}
	if q.ServiceID != "" {
		for _, service := range app.Services {
			if service.ID == q.ServiceID {
				if service.IndexPattern != "" {
					index = service.IndexPattern
				}
				if service.TimeField != "" {
					timeField = service.TimeField
				}
				break
			}
		}
	}
	if q.IndexOverride != "" {
		index = q.IndexOverride
	}
	return settings, index, timeField, app.MaskingRules, nil
}
func (s *Service) resolveCredential(ctx context.Context, settings Settings) (string, error) {
	if plaintext := strings.TrimSpace(settings.Credential); plaintext != "" {
		return plaintext, nil
	}
	if ref := strings.TrimSpace(settings.CredentialSecretRef); ref != "" {
		if s.secrets == nil {
			return "", errors.New("secret resolver is unavailable")
		}
		if !strings.HasPrefix(ref, "secret://") {
			ref = "secret://" + ref
		}
		return s.secrets.ResolveSecret(ctx, ref)
	}
	if ciphertext := strings.TrimSpace(settings.EncryptedCredential); ciphertext != "" {
		crypto, ok := s.secrets.(CredentialCrypto)
		if !ok || crypto == nil {
			return "", errors.New("inline ELF credentials require secrets encryption support")
		}
		return crypto.DecryptStored(ciphertext)
	}
	return "", errors.New("ELF credential is not configured")
}

func (s *Service) search(ctx context.Context, settings Settings, index string, body []byte) ([]byte, int, error) {
	if err := s.validateTarget(ctx, settings.BaseURL); err != nil {
		return nil, 0, err
	}
	timeout := settings.TimeoutSeconds
	if timeout <= 0 || timeout > 30 {
		timeout = 30
	}
	requestCtx, cancel := context.WithTimeout(ctx, time.Duration(timeout)*time.Second)
	defer cancel()
	endpoint := settings.BaseURL + "/" + url.PathEscape(index) + "/_search?allow_partial_search_results=false&phase_took=true"
	req, err := http.NewRequestWithContext(requestCtx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return nil, 0, err
	}
	req.Header.Set("Content-Type", "application/json")
	if settings.AuthMode != "NONE" {
		credential, err := s.resolveCredential(requestCtx, settings)
		if err != nil {
			return nil, 0, fmt.Errorf("ELF credential resolution failed")
		}
		if settings.AuthMode == "BEARER" {
			req.Header.Set("Authorization", "Bearer "+credential)
		} else {
			req.SetBasicAuth(settings.Username, credential)
		}
	}
	response, err := s.client.Do(req)
	if err != nil {
		return nil, 0, err
	}
	defer response.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(response.Body, 2*1024*1024+1))
	if err != nil {
		return nil, response.StatusCode, err
	}
	if len(raw) > 2*1024*1024 {
		return nil, response.StatusCode, errors.New("ELF response exceeded the 2 MB safety limit")
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, response.StatusCode, fmt.Errorf("ELF returned HTTP %d", response.StatusCode)
	}
	return raw, response.StatusCode, nil
}

// FetchAlertingAlerts returns the bounded Alerting API response used by the
// external-alert reconciler. Authentication and target validation are shared
// with ELF searches so alert reconciliation cannot bypass the configured
// network and secret policies.
func (s *Service) FetchAlertingAlerts(ctx context.Context) (json.RawMessage, error) {
	settings, err := s.loadSettings(ctx)
	if err != nil {
		return nil, err
	}
	if err := s.validateTarget(ctx, settings.BaseURL); err != nil {
		return nil, err
	}
	timeout := settings.TimeoutSeconds
	if timeout <= 0 || timeout > 30 {
		timeout = 30
	}
	requestCtx, cancel := context.WithTimeout(ctx, time.Duration(timeout)*time.Second)
	defer cancel()
	endpoint := settings.BaseURL + "/_plugins/_alerting/monitors/alerts?size=1000&sortOrder=desc"
	req, err := http.NewRequestWithContext(requestCtx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/json")
	if settings.AuthMode != "NONE" {
		credential, resolveErr := s.resolveCredential(requestCtx, settings)
		if resolveErr != nil {
			return nil, errors.New("ELF credential resolution failed")
		}
		if settings.AuthMode == "BEARER" {
			req.Header.Set("Authorization", "Bearer "+credential)
		} else {
			req.SetBasicAuth(settings.Username, credential)
		}
	}
	response, err := s.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(response.Body, 2*1024*1024+1))
	if err != nil {
		return nil, err
	}
	if len(raw) > 2*1024*1024 {
		return nil, errors.New("Alerting API response exceeded the 2 MB safety limit")
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, fmt.Errorf("Alerting API returned HTTP %d", response.StatusCode)
	}
	return json.RawMessage(raw), nil
}
func (s *Service) validateTarget(ctx context.Context, raw string) error {
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Hostname() == "" {
		return errors.New("invalid ELF target")
	}
	addresses, err := net.DefaultResolver.LookupNetIP(ctx, "ip", parsed.Hostname())
	if err != nil {
		return errors.New("ELF target DNS resolution failed")
	}
	for _, address := range addresses {
		if !s.allowPrivate && isPrivate(address) {
			return errors.New("ELF target resolves to a private or reserved address")
		}
	}
	return nil
}
func isPrivate(ip netip.Addr) bool {
	return ip.IsPrivate() || ip.IsLoopback() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() || ip.IsUnspecified() || ip.IsMulticast()
}
func categorize(err error, status int) string {
	if errors.Is(err, context.DeadlineExceeded) || strings.Contains(strings.ToLower(err.Error()), "timeout") {
		return "TIMEOUT"
	}
	switch status {
	case 401:
		return "AUTHENTICATION"
	case 403:
		return "AUTHORIZATION"
	case 404:
		return "INDEX_NOT_FOUND"
	}
	if strings.Contains(err.Error(), "2 MB") {
		return "RESPONSE_LIMIT"
	}
	if strings.Contains(strings.ToLower(err.Error()), "dns") {
		return "CONNECTION"
	}
	return "CONNECTION"
}
func safeMessage(err error) string {
	if err == nil {
		return ""
	}
	message := strings.ReplaceAll(err.Error(), "\n", " ")
	if len(message) > 300 {
		message = message[:300]
	}
	return message
}
func hashID(value string) string {
	sum := sha256.Sum256([]byte(value))
	return fmt.Sprintf("doc-%x", sum[:6])
}

var sensitiveKey = regexp.MustCompile(`(?i)(authorization|cookie|password|passwd|secret|token|api[-_]?key|private[-_]?key|session)`)

func maskDocument(input map[string]any, patterns []string) map[string]any {
	return maskDocumentAt("", input, patterns)
}
func maskDocumentAt(prefix string, input map[string]any, patterns []string) map[string]any {
	out := map[string]any{}
	for key, value := range input {
		path := key
		if prefix != "" {
			path = prefix + "." + key
		}
		mask := sensitiveKey.MatchString(key) || sensitiveKey.MatchString(path)
		for _, pattern := range patterns {
			if matched, _ := filepathMatch(pattern, path); matched {
				mask = true
				break
			}
		}
		if mask {
			out[key] = "MASKED"
			continue
		}
		switch child := value.(type) {
		case map[string]any:
			out[key] = maskDocumentAt(path, child, patterns)
		case []any:
			items := make([]any, len(child))
			for i, item := range child {
				if m, ok := item.(map[string]any); ok {
					items[i] = maskDocumentAt(path, m, patterns)
				} else {
					items[i] = item
				}
			}
			out[key] = items
		default:
			out[key] = value
		}
	}
	return out
}
func filepathMatch(pattern, value string) (bool, error) {
	pattern = strings.ReplaceAll(pattern, ".", "\\.")
	pattern = strings.ReplaceAll(pattern, "*", ".*")
	return regexp.MatchString("(?i)^"+pattern+"$", value)
}
func isFieldCriteria(criteria map[string]any) bool {
	return strings.EqualFold(strings.TrimSpace(fmt.Sprint(criteria["kind"])), "FIELD")
}

func validateFieldCriteria(criteria map[string]any) error {
	field := strings.TrimSpace(fmt.Sprint(criteria["field"]))
	if field == "" || !fieldPathPattern.MatchString(field) {
		return errors.New("field condition requires a valid field path")
	}
	if sensitiveKey.MatchString(field) {
		return errors.New("field conditions cannot evaluate sensitive fields")
	}
	operator := strings.ToUpper(strings.TrimSpace(fmt.Sprint(criteria["operator"])))
	switch operator {
	case "GT", "GTE", "LT", "LTE", "EQ", "NE", "CONTAINS", "EXISTS", "NOT_EXISTS":
	default:
		return errors.New("field condition operator must be GT, GTE, LT, LTE, EQ, NE, CONTAINS, EXISTS, or NOT_EXISTS")
	}
	quantifier := strings.ToUpper(strings.TrimSpace(fmt.Sprint(criteria["quantifier"])))
	if quantifier == "" {
		quantifier = "ANY"
	}
	if quantifier != "ANY" && quantifier != "ALL" && quantifier != "NONE" {
		return errors.New("field condition match scope must be ANY, ALL, or NONE")
	}
	if operator != "EXISTS" && operator != "NOT_EXISTS" {
		value, exists := criteria["value"]
		if !exists || value == nil || strings.TrimSpace(fmt.Sprint(value)) == "" {
			return errors.New("field condition requires a comparison value")
		}
		if operator == "GT" || operator == "GTE" || operator == "LT" || operator == "LTE" {
			switch value.(type) {
			case float64, float32, int, int8, int16, int32, int64, uint, uint8, uint16, uint32, uint64, string:
			default:
				return errors.New("range field conditions require a number or date value")
			}
		}
	}
	return nil
}

func fieldConditionQuery(criteria map[string]any) (map[string]any, error) {
	if err := validateFieldCriteria(criteria); err != nil {
		return nil, err
	}
	field := strings.TrimSpace(fmt.Sprint(criteria["field"]))
	operator := strings.ToUpper(strings.TrimSpace(fmt.Sprint(criteria["operator"])))
	value := criteria["value"]
	switch operator {
	case "GT", "GTE", "LT", "LTE":
		return map[string]any{"range": map[string]any{field: map[string]any{strings.ToLower(operator): value}}}, nil
	case "EQ":
		return map[string]any{"term": map[string]any{field: value}}, nil
	case "NE":
		return map[string]any{"bool": map[string]any{"must_not": []any{map[string]any{"term": map[string]any{field: value}}}}}, nil
	case "CONTAINS":
		return map[string]any{"match_phrase": map[string]any{field: value}}, nil
	case "EXISTS":
		return map[string]any{"exists": map[string]any{"field": field}}, nil
	case "NOT_EXISTS":
		return map[string]any{"bool": map[string]any{"must_not": []any{map[string]any{"exists": map[string]any{"field": field}}}}}, nil
	default:
		return nil, errors.New("unsupported field condition operator")
	}
}

func withFieldCriteria(body []byte, criteria map[string]any) ([]byte, error) {
	condition, err := fieldConditionQuery(criteria)
	if err != nil {
		return nil, err
	}
	var payload map[string]any
	if err = json.Unmarshal(body, &payload); err != nil {
		return nil, errors.New("unable to add the field condition to the compiled search")
	}
	aggregationKey := "aggs"
	rawAggregations, ok := payload[aggregationKey]
	if !ok {
		aggregationKey = "aggregations"
		rawAggregations = payload[aggregationKey]
	}
	aggregations, _ := rawAggregations.(map[string]any)
	if aggregations == nil {
		aggregations = map[string]any{}
	}
	aggregations[fieldConditionAggregation] = map[string]any{"filter": condition}
	payload[aggregationKey] = aggregations
	return json.Marshal(payload)
}

func fieldCriteriaResult(criteria map[string]any, hits int64, aggs map[string]any) (map[string]any, bool, error) {
	if err := validateFieldCriteria(criteria); err != nil {
		return nil, false, err
	}
	aggregation, ok := aggs[fieldConditionAggregation].(map[string]any)
	if !ok {
		return nil, false, errors.New("field condition evidence was not returned")
	}
	matchedValue, ok := number(aggregation["doc_count"])
	if !ok {
		return nil, false, errors.New("field condition match count was not returned")
	}
	matched := int64(matchedValue)
	quantifier := strings.ToUpper(strings.TrimSpace(fmt.Sprint(criteria["quantifier"])))
	if quantifier == "" {
		quantifier = "ANY"
	}
	passed := false
	switch quantifier {
	case "ANY":
		passed = matched > 0
	case "ALL":
		passed = hits > 0 && matched == hits
	case "NONE":
		passed = matched == 0
	}
	evidence := map[string]any{
		"kind":               "FIELD",
		"field":              strings.TrimSpace(fmt.Sprint(criteria["field"])),
		"operator":           strings.ToUpper(strings.TrimSpace(fmt.Sprint(criteria["operator"]))),
		"quantifier":         quantifier,
		"evaluatedDocuments": hits,
		"matchingDocuments":  matched,
		"passed":             passed,
	}
	operator := strings.ToUpper(strings.TrimSpace(fmt.Sprint(criteria["operator"])))
	if operator != "EXISTS" && operator != "NOT_EXISTS" {
		evidence["expected"] = criteria["value"]
	}
	return evidence, passed, nil
}

func fieldCriteriaFailure(evidence map[string]any) string {
	return fmt.Sprintf("Field condition matched %v of %v documents; the %v match scope was not satisfied.", evidence["matchingDocuments"], evidence["evaluatedDocuments"], evidence["quantifier"])
}

func evaluateCriteria(criteria map[string]any, hits int64, aggs map[string]any, conditionEvidence map[string]any) bool {
	if len(criteria) == 0 {
		return hits == 0
	}
	if isFieldCriteria(criteria) {
		passed, _ := conditionEvidence["passed"].(bool)
		return passed
	}
	operator := strings.ToUpper(strings.TrimSpace(fmt.Sprint(criteria["operator"])))
	expected, _ := number(criteria["value"])
	actual := float64(hits)
	path, _ := criteria["aggregationPath"].(string)
	if path = strings.TrimSpace(path); path != "" {
		value := any(aggs)
		for _, part := range strings.Split(path, ".") {
			m, ok := value.(map[string]any)
			if !ok {
				return false
			}
			value = m[part]
		}
		var ok bool
		actual, ok = number(value)
		if !ok {
			if m, ok := value.(map[string]any); ok {
				actual, _ = number(m["value"])
			}
		}
	}
	switch operator {
	case "LT":
		return actual < expected
	case "LTE", "MAX":
		return actual <= expected
	case "GT":
		return actual > expected
	case "GTE", "MIN":
		return actual >= expected
	case "EQ", "EQUALS", "":
		return actual == expected
	case "NE":
		return actual != expected
	}
	return actual == expected
}

func (s *Service) persistRun(ctx context.Context, run RunSummary, actor string) (RunSummary, error) {
	run.ID, _ = id.NewUUID()
	now := time.Now().UTC()
	run.CreatedAt = now
	run.CompletedAt = &now
	if run.ShardSummary == nil {
		run.ShardSummary = map[string]any{}
	}
	if run.Aggregations == nil {
		run.Aggregations = map[string]any{}
	}
	if run.RawResponse == nil {
		run.RawResponse = map[string]any{}
	}
	if run.Samples == nil {
		run.Samples = []map[string]any{}
	}
	if run.Truncation == nil {
		run.Truncation = map[string]any{}
	}
	if run.Debug == nil {
		run.Debug = map[string]any{}
	}
	shards, _ := json.Marshal(run.ShardSummary)
	aggs, _ := json.Marshal(run.Aggregations)
	rawResponse, _ := json.Marshal(run.RawResponse)
	samples, _ := json.Marshal(run.Samples)
	trunc, _ := json.Marshal(run.Truncation)
	debug, _ := json.Marshal(run.Debug)
	_, err := s.pool.Exec(ctx, `INSERT INTO elf_runs(id,query_id,revision_id,status,decision,gate_mode,application_id,service_id,resolved_index,time_from,time_to,hit_count,open_search_took_ms,round_trip_ms,shard_summary,aggregations,raw_response,samples,sample_expires_at,truncation,failure_category,failure_reason,debug_evidence,created_by,created_at,completed_at)VALUES($1,NULLIF($2,'')::uuid,NULLIF($3,'')::uuid,$4,$5,$6,NULLIF($7,'')::uuid,NULLIF($8,'')::uuid,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26)`, run.ID, run.QueryID, run.RevisionID, run.Status, run.Decision, run.GateMode, run.ApplicationID, run.ServiceID, run.ResolvedIndex, run.TimeFrom, run.TimeTo, run.HitCount, run.OpenSearchTookMS, run.RoundTripMS, shards, aggs, rawResponse, samples, now.Add(7*24*time.Hour), trunc, run.FailureCategory, run.FailureReason, debug, actor, now, now)
	if err != nil {
		return RunSummary{}, err
	}
	_ = s.updateSchema(ctx, run)
	return run, nil
}
func (s *Service) updateSchema(ctx context.Context, run RunSummary) error {
	if run.QueryID == "" || len(run.Fields) == 0 {
		return nil
	}
	schema, _ := json.Marshal(run.Fields)
	_, err := s.pool.Exec(ctx, `UPDATE elf_query_revisions SET discovered_schema=$2 WHERE id=$1`, run.RevisionID, schema)
	return err
}
func (s *Service) saveFailure(ctx context.Context, q Query, index string, from, to time.Time, actor, category, reason string) (RunSummary, error) {
	return s.saveFailureWithDuration(ctx, q, index, from, to, actor, category, reason, 0)
}
func (s *Service) saveFailureWithDuration(ctx context.Context, q Query, index string, from, to time.Time, actor, category, reason string, duration int64) (RunSummary, error) {
	return s.persistRun(ctx, RunSummary{QueryID: q.ID, RevisionID: q.CurrentRevisionID, Status: "FAILED", Decision: "FAIL", GateMode: q.GateMode, ApplicationID: q.ApplicationID, ApplicationName: q.ApplicationName, ServiceID: q.ServiceID, ServiceName: q.ServiceName, ResolvedIndex: index, TimeFrom: from, TimeTo: to, RoundTripMS: duration, SampleState: "NOT_CAPTURED", FailureCategory: category, FailureReason: reason}, actor)
}
func (s *Service) ListRuns(ctx context.Context) ([]RunSummary, error) {
	rows, err := s.pool.Query(ctx, runSelect+` ORDER BY r.created_at DESC LIMIT 200`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []RunSummary{}
	for rows.Next() {
		item, err := scanRun(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}
func (s *Service) GetRun(ctx context.Context, runID string) (RunSummary, error) {
	item, err := scanRun(s.pool.QueryRow(ctx, runSelect+` WHERE r.id=$1`, runID))
	if errors.Is(err, pgx.ErrNoRows) {
		return RunSummary{}, ErrNotFound
	}
	return item, err
}

const runSelect = `SELECT r.id::text,COALESCE(r.query_id::text,''),COALESCE(r.revision_id::text,''),r.status,r.decision,r.gate_mode,COALESCE(r.application_id::text,''),COALESCE(a.name,''),COALESCE(r.service_id::text,''),COALESCE(s.name,''),r.resolved_index,r.time_from,r.time_to,r.hit_count,r.open_search_took_ms,r.round_trip_ms,r.shard_summary,r.aggregations,r.raw_response,r.samples,r.sample_expires_at,r.truncation,r.failure_category,r.failure_reason,r.debug_evidence,r.created_at,r.completed_at FROM elf_runs r LEFT JOIN applications a ON a.id=r.application_id LEFT JOIN application_services s ON s.id=r.service_id`

func scanRun(row interface{ Scan(...any) error }) (RunSummary, error) {
	var item RunSummary
	var shards, aggs, rawResponse, samples, trunc, debug []byte
	var expires *time.Time
	if err := row.Scan(&item.ID, &item.QueryID, &item.RevisionID, &item.Status, &item.Decision, &item.GateMode, &item.ApplicationID, &item.ApplicationName, &item.ServiceID, &item.ServiceName, &item.ResolvedIndex, &item.TimeFrom, &item.TimeTo, &item.HitCount, &item.OpenSearchTookMS, &item.RoundTripMS, &shards, &aggs, &rawResponse, &samples, &expires, &trunc, &item.FailureCategory, &item.FailureReason, &debug, &item.CreatedAt, &item.CompletedAt); err != nil {
		return item, err
	}
	_ = json.Unmarshal(shards, &item.ShardSummary)
	_ = json.Unmarshal(aggs, &item.Aggregations)
	_ = json.Unmarshal(rawResponse, &item.RawResponse)
	_ = json.Unmarshal(trunc, &item.Truncation)
	_ = json.Unmarshal(debug, &item.Debug)
	if item.ShardSummary == nil {
		item.ShardSummary = map[string]any{}
	}
	if item.Aggregations == nil {
		item.Aggregations = map[string]any{}
	}
	if item.RawResponse == nil {
		item.RawResponse = map[string]any{}
	}
	if item.Truncation == nil {
		item.Truncation = map[string]any{}
	}
	if item.Debug == nil {
		item.Debug = map[string]any{}
	}
	if expires != nil && expires.Before(time.Now()) {
		item.SampleState = "EXPIRED"
		item.Samples = []map[string]any{}
	} else {
		item.SampleState = "CAPTURED"
		_ = json.Unmarshal(samples, &item.Samples)
	}
	if item.Samples == nil {
		item.Samples = []map[string]any{}
	}
	item.Fields = InferFields(item.Samples, nil)
	if item.Fields == nil {
		item.Fields = []Field{}
	}
	return item, nil
}
func (s *Service) lastRun(ctx context.Context, queryID string) (*RunSummary, error) {
	item, err := scanRun(s.pool.QueryRow(ctx, runSelect+` WHERE r.query_id=$1 ORDER BY r.created_at DESC LIMIT 1`, queryID))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return &item, err
}
func (s *Service) PurgeExpiredEvidence(ctx context.Context) error {
	_, err := s.pool.Exec(ctx, `UPDATE elf_runs SET samples='[]'::jsonb,raw_response='{}'::jsonb,debug_evidence='{}'::jsonb,sample_expires_at=NULL WHERE sample_expires_at<NOW()`)
	return err
}
