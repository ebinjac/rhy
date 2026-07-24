package library

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/rhythm-monitoring/rhythm/internal/id"
	"github.com/rhythm-monitoring/rhythm/internal/runs"
)

var ErrNotFound = errors.New("configuration profile not found")

type Profile struct {
	ID          string         `json:"id"`
	Kind        string         `json:"kind"`
	Name        string         `json:"name"`
	Description string         `json:"description,omitempty"`
	ProfileType string         `json:"profileType"`
	Config      map[string]any `json:"config"`
	Active      bool           `json:"active"`
	CreatedBy   string         `json:"createdBy"`
	UpdatedBy   string         `json:"updatedBy"`
	CreatedAt   time.Time      `json:"createdAt"`
	UpdatedAt   time.Time      `json:"updatedAt"`
}
type Input struct {
	Name        string         `json:"name"`
	Description string         `json:"description,omitempty"`
	ProfileType string         `json:"profileType"`
	Config      map[string]any `json:"config"`
	Active      *bool          `json:"active,omitempty"`
}
type Service struct {
	pool       *pgxpool.Pool
	httpClient *http.Client
	vaultAddr  string
	vaultToken string
}

func New(pool *pgxpool.Pool) *Service {
	return &Service{
		pool:       pool,
		httpClient: &http.Client{Timeout: 10 * time.Second},
		vaultAddr:  strings.TrimRight(strings.TrimSpace(os.Getenv("RHYTHM_VAULT_ADDR")), "/"),
		vaultToken: strings.TrimSpace(os.Getenv("RHYTHM_VAULT_TOKEN")),
	}
}
func normalizeKind(kind string) (string, error) {
	kind = strings.ToUpper(strings.ReplaceAll(kind, "-", "_"))
	switch kind {
	case "ENVIRONMENTS", "ENVIRONMENT":
		return "ENVIRONMENT", nil
	case "SECRETS", "SECRET_REFERENCE", "SECRET_REFERENCES":
		return "SECRET_REFERENCE", nil
	case "CERTIFICATES", "CERTIFICATE":
		return "CERTIFICATE", nil
	case "PROXIES", "PROXY":
		return "PROXY", nil
	case "AUTH", "AUTH_PROFILES":
		return "AUTH", nil
	case "NOTIFICATIONS", "NOTIFICATION", "NOTIFICATION_CHANNELS":
		return "NOTIFICATION", nil
	case "TELEMETRY", "DYNATRACE", "TELEMETRY_PROFILES":
		return "TELEMETRY", nil
	}
	return "", fmt.Errorf("configuration profile kind is invalid")
}
func (s *Service) List(ctx context.Context, kind string) ([]Profile, error) {
	kind, err := normalizeKind(kind)
	if err != nil {
		return nil, err
	}
	rows, err := s.pool.Query(ctx, `SELECT id::text,kind,name,COALESCE(description,''),profile_type,config_json,active,created_by,updated_by,created_at,updated_at FROM configuration_profiles WHERE kind=$1 ORDER BY name`, kind)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]Profile, 0)
	for rows.Next() {
		item, err := scan(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}
func (s *Service) Create(ctx context.Context, kind string, input Input, actor string) (Profile, error) {
	kind, err := normalizeKind(kind)
	if err != nil {
		return Profile{}, err
	}
	input.Name = strings.TrimSpace(input.Name)
	input.ProfileType = strings.TrimSpace(input.ProfileType)
	if input.Name == "" || input.ProfileType == "" {
		return Profile{}, fmt.Errorf("name and profileType are required")
	}
	if kind == "SECRET_REFERENCE" {
		if err := validateSecretReference(input.Config); err != nil {
			return Profile{}, err
		}
	}
	if kind == "NOTIFICATION" {
		if err := validateNotification(input.ProfileType, input.Config); err != nil {
			return Profile{}, err
		}
	}
	if kind == "TELEMETRY" {
		if strings.ToUpper(input.ProfileType) != "DYNATRACE" {
			return Profile{}, errors.New("telemetry profileType must be DYNATRACE")
		}
		if strings.TrimSpace(fmt.Sprint(input.Config["baseUrl"])) == "" || !strings.HasPrefix(strings.TrimSpace(fmt.Sprint(input.Config["tokenSecretRef"])), "secret://") {
			return Profile{}, errors.New("Dynatrace profiles require baseUrl and tokenSecretRef")
		}
		if _, exists := input.Config["token"]; exists {
			return Profile{}, errors.New("raw Dynatrace tokens are not accepted")
		}
	}
	profileID, err := id.NewUUID()
	if err != nil {
		return Profile{}, err
	}
	active := true
	if input.Active != nil {
		active = *input.Active
	}
	encoded, _ := json.Marshal(input.Config)
	now := time.Now().UTC()
	_, err = s.pool.Exec(ctx, `INSERT INTO configuration_profiles(id,kind,name,description,profile_type,config_json,active,created_by,updated_by,created_at,updated_at)VALUES($1,$2,$3,$4,$5,$6,$7,$8,$8,$9,$9)`, profileID, kind, input.Name, strings.TrimSpace(input.Description), input.ProfileType, encoded, active, actor, now)
	if err != nil {
		var pgerr *pgconn.PgError
		if errors.As(err, &pgerr) && pgerr.Code == "23505" {
			return Profile{}, fmt.Errorf("a profile with this name already exists")
		}
		return Profile{}, err
	}
	return s.Get(ctx, profileID)
}

func validateNotification(profileType string, config map[string]any) error {
	kind := strings.ToUpper(strings.TrimSpace(profileType))
	switch kind {
	case "SLACK", "WEBHOOK":
		reference := strings.TrimSpace(fmt.Sprint(config["urlSecretRef"]))
		if !strings.HasPrefix(reference, "secret://") {
			return errors.New("webhook channels require a urlSecretRef secret alias")
		}
		if _, exists := config["url"]; exists {
			return errors.New("raw notification endpoint URLs are not accepted")
		}
	case "EMAIL":
		if strings.TrimSpace(fmt.Sprint(config["smtpHost"])) == "" || strings.TrimSpace(fmt.Sprint(config["from"])) == "" {
			return errors.New("email channels require smtpHost and from")
		}
		if _, exists := config["password"]; exists {
			return errors.New("raw SMTP passwords are not accepted; use passwordSecretRef")
		}
	default:
		return errors.New("notification profileType must be SLACK, WEBHOOK, or EMAIL")
	}
	return nil
}
func (s *Service) Get(ctx context.Context, profileID string) (Profile, error) {
	item, err := scan(s.pool.QueryRow(ctx, `SELECT id::text,kind,name,COALESCE(description,''),profile_type,config_json,active,created_by,updated_by,created_at,updated_at FROM configuration_profiles WHERE id=$1`, profileID))
	if errors.Is(err, pgx.ErrNoRows) {
		return Profile{}, ErrNotFound
	}
	return item, err
}
func (s *Service) Delete(ctx context.Context, profileID, actor string) error {
	command, err := s.pool.Exec(ctx, `UPDATE configuration_profiles SET active=FALSE,updated_by=$2,updated_at=NOW() WHERE id=$1 AND active=TRUE`, profileID, actor)
	if err != nil {
		return err
	}
	if command.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}
func validateSecretReference(config map[string]any) error {
	for key := range config {
		lower := strings.ToLower(key)
		if lower == "value" || lower == "secret" || lower == "password" || lower == "token" || strings.Contains(lower, "privatekey") {
			return fmt.Errorf("secret profiles may store references and metadata, never secret values")
		}
	}
	provider, _ := config["provider"].(string)
	path, _ := config["externalPath"].(string)
	if strings.TrimSpace(provider) == "" || strings.TrimSpace(path) == "" {
		return fmt.Errorf("secret reference provider and externalPath are required")
	}
	return nil
}

type scanner interface{ Scan(...any) error }

func scan(row scanner) (Profile, error) {
	var item Profile
	var encoded []byte
	if err := row.Scan(&item.ID, &item.Kind, &item.Name, &item.Description, &item.ProfileType, &encoded, &item.Active, &item.CreatedBy, &item.UpdatedBy, &item.CreatedAt, &item.UpdatedAt); err != nil {
		return Profile{}, err
	}
	if err := json.Unmarshal(encoded, &item.Config); err != nil {
		return Profile{}, err
	}
	return item, nil
}

func (s *Service) ResolveSecret(ctx context.Context, reference string) (string, error) {
	identifier := strings.TrimSpace(strings.TrimPrefix(reference, "secret://"))
	var configJSON []byte
	err := s.pool.QueryRow(ctx, `SELECT config_json FROM configuration_profiles WHERE kind='SECRET_REFERENCE' AND active=TRUE AND (id::text=$1 OR name=$1)`, identifier).Scan(&configJSON)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", fmt.Errorf("secret reference %q was not found", identifier)
	}
	if err != nil {
		return "", err
	}
	var config map[string]any
	if err := json.Unmarshal(configJSON, &config); err != nil {
		return "", err
	}
	provider := strings.ToUpper(fmt.Sprint(config["provider"]))
	externalPath := fmt.Sprint(config["externalPath"])
	switch provider {
	case "ENV", "ENVIRONMENT":
		value, ok := os.LookupEnv(externalPath)
		if !ok {
			return "", fmt.Errorf("environment-backed secret %q is unavailable", identifier)
		}
		return value, nil
	case "VAULT", "HASHICORP_VAULT":
		return s.resolveVaultSecret(ctx, identifier, externalPath, config)
	default:
		return "", fmt.Errorf("secret provider %q is not available in this deployment", provider)
	}
}

func (s *Service) resolveVaultSecret(ctx context.Context, identifier, externalPath string, config map[string]any) (string, error) {
	if s.vaultAddr == "" || s.vaultToken == "" {
		return "", errors.New("Vault-backed secrets require RHYTHM_VAULT_ADDR and RHYTHM_VAULT_TOKEN")
	}
	base, err := url.Parse(s.vaultAddr)
	if err != nil || (base.Scheme != "http" && base.Scheme != "https") || base.Host == "" {
		return "", errors.New("RHYTHM_VAULT_ADDR is invalid")
	}
	cleanPath := strings.TrimPrefix(strings.TrimSpace(externalPath), "/")
	cleanPath = strings.TrimPrefix(cleanPath, "v1/")
	if cleanPath == "" || strings.Contains(cleanPath, "..") {
		return "", fmt.Errorf("Vault path for secret %q is invalid", identifier)
	}
	base.Path = strings.TrimRight(base.Path, "/") + "/v1/" + cleanPath
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, base.String(), nil)
	if err != nil {
		return "", errors.New("create Vault secret request")
	}
	request.Header.Set("X-Vault-Token", s.vaultToken)
	if namespace := strings.TrimSpace(fmt.Sprint(config["namespace"])); namespace != "" && namespace != "<nil>" {
		request.Header.Set("X-Vault-Namespace", namespace)
	}
	response, err := s.httpClient.Do(request)
	if err != nil {
		return "", fmt.Errorf("Vault secret %q is unavailable", identifier)
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return "", fmt.Errorf("Vault secret %q returned HTTP %d", identifier, response.StatusCode)
	}
	var payload struct {
		Data map[string]any `json:"data"`
	}
	if err := json.NewDecoder(io.LimitReader(response.Body, 1<<20)).Decode(&payload); err != nil {
		return "", fmt.Errorf("Vault secret %q returned an invalid response", identifier)
	}
	// KV v2 wraps secret fields in data.data; KV v1 returns fields in data.
	fields := payload.Data
	if nested, ok := payload.Data["data"].(map[string]any); ok {
		fields = nested
	}
	field := strings.TrimSpace(fmt.Sprint(config["field"]))
	if field == "" || field == "<nil>" {
		field = "value"
	}
	value, ok := fields[field]
	if !ok || value == nil {
		return "", fmt.Errorf("Vault secret %q does not contain field %q", identifier, field)
	}
	return fmt.Sprint(value), nil
}

func (s *Service) ResolveTLSProfile(ctx context.Context, certificateProfileID, caProfileID string) (runs.TLSMaterial, error) {
	result := runs.TLSMaterial{}
	for _, identifier := range []string{certificateProfileID, caProfileID} {
		if identifier == "" {
			continue
		}
		profile, err := s.profileByIdentifier(ctx, "CERTIFICATE", identifier)
		if err != nil {
			return result, err
		}
		for field, target := range map[string]*string{"clientCertSecretRef": &result.ClientCertificatePEM, "clientKeySecretRef": &result.ClientKeyPEM, "caBundleSecretRef": &result.CABundlePEM} {
			reference := fmt.Sprint(profile.Config[field])
			if reference == "" || reference == "<nil>" {
				continue
			}
			value, err := s.ResolveSecret(ctx, reference)
			if err != nil {
				return result, err
			}
			*target = value
		}
	}
	return result, nil
}

func (s *Service) ResolveProxyProfile(ctx context.Context, profileID string) (runs.ProxyMaterial, error) {
	profile, err := s.profileByIdentifier(ctx, "PROXY", profileID)
	if err != nil {
		return runs.ProxyMaterial{}, err
	}
	result := runs.ProxyMaterial{URL: fmt.Sprint(profile.Config["url"]), NoProxy: fmt.Sprint(profile.Config["noProxy"])}
	if reference := fmt.Sprint(profile.Config["usernameSecretRef"]); reference != "" && reference != "<nil>" {
		result.Username, err = s.ResolveSecret(ctx, reference)
		if err != nil {
			return result, err
		}
	}
	if reference := fmt.Sprint(profile.Config["passwordSecretRef"]); reference != "" && reference != "<nil>" {
		result.Password, err = s.ResolveSecret(ctx, reference)
		if err != nil {
			return result, err
		}
	}
	if result.URL == "" || result.URL == "<nil>" {
		return result, errors.New("proxy profile URL is required")
	}
	return result, nil
}

func (s *Service) ResolveTelemetryProfile(ctx context.Context, profileID string) (runs.TelemetryMaterial, error) {
	profile, err := s.profileByIdentifier(ctx, "TELEMETRY", profileID)
	if err != nil {
		return runs.TelemetryMaterial{}, err
	}
	baseURL := strings.TrimRight(strings.TrimSpace(fmt.Sprint(profile.Config["baseUrl"])), "/")
	token, err := s.ResolveSecret(ctx, fmt.Sprint(profile.Config["tokenSecretRef"]))
	if err != nil {
		return runs.TelemetryMaterial{}, err
	}
	return runs.TelemetryMaterial{BaseURL: baseURL, Token: token}, nil
}

func (s *Service) profileByIdentifier(ctx context.Context, kind, identifier string) (Profile, error) {
	var item Profile
	var encoded []byte
	err := s.pool.QueryRow(ctx, `SELECT id::text,kind,name,COALESCE(description,''),profile_type,config_json,active,created_by,updated_by,created_at,updated_at FROM configuration_profiles WHERE kind=$1 AND active=TRUE AND (id::text=$2 OR name=$2)`, kind, identifier).Scan(&item.ID, &item.Kind, &item.Name, &item.Description, &item.ProfileType, &encoded, &item.Active, &item.CreatedBy, &item.UpdatedBy, &item.CreatedAt, &item.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return Profile{}, ErrNotFound
	}
	if err != nil {
		return Profile{}, err
	}
	if err := json.Unmarshal(encoded, &item.Config); err != nil {
		return Profile{}, err
	}
	return item, nil
}
