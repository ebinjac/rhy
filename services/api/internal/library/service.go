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
	"github.com/rhythm-monitoring/rhythm/internal/secretscrypto"
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
	secretsKey []byte
}

func New(pool *pgxpool.Pool, secretsEncryptionKey string) (*Service, error) {
	service := &Service{
		pool:       pool,
		httpClient: &http.Client{Timeout: 10 * time.Second},
		vaultAddr:  strings.TrimRight(strings.TrimSpace(os.Getenv("RHYTHM_VAULT_ADDR")), "/"),
		vaultToken: strings.TrimSpace(os.Getenv("RHYTHM_VAULT_TOKEN")),
	}
	if trimmed := strings.TrimSpace(secretsEncryptionKey); trimmed != "" {
		key, err := secretscrypto.ParseKey(trimmed)
		if err != nil {
			return nil, fmt.Errorf("RHYTHM_SECRETS_ENCRYPTION_KEY: %w", err)
		}
		service.secretsKey = key
	}
	return service, nil
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
	rows, err := s.pool.Query(ctx, `SELECT id::text,kind,name,COALESCE(description,''),profile_type,config_json,active,created_by,updated_by,created_at,updated_at FROM configuration_profiles WHERE kind=$1 AND active=TRUE ORDER BY name`, kind)
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
		switch kind {
		case "SECRET_REFERENCE":
			item.Config = redactSecretConfig(item.Config)
		case "CERTIFICATE":
			item.Config = redactCertificateConfig(item.Config)
		case "NOTIFICATION":
			item.Config = redactNotificationConfig(item.Config)
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
	if input.Name == "" {
		return Profile{}, fmt.Errorf("name is required")
	}
	if kind == "SECRET_REFERENCE" {
		prepared, profileType, err := s.prepareSecretConfig(input.Config)
		if err != nil {
			return Profile{}, err
		}
		input.Config = prepared
		if input.ProfileType == "" {
			input.ProfileType = profileType
		}
	} else if input.ProfileType == "" {
		return Profile{}, fmt.Errorf("name and profileType are required")
	}
	if kind == "NOTIFICATION" {
		prepared, err := s.prepareNotificationConfig(input.ProfileType, input.Config, nil)
		if err != nil {
			return Profile{}, err
		}
		input.Config = prepared
		if err := validateNotification(input.ProfileType, input.Config); err != nil {
			return Profile{}, err
		}
	}
	if kind == "CERTIFICATE" {
		prepared, err := s.prepareCertificateConfig(input.Config, nil)
		if err != nil {
			return Profile{}, err
		}
		input.Config = prepared
	}
	if kind == "PROXY" {
		prepared, profileType, err := prepareProxyConfig(input.Config)
		if err != nil {
			return Profile{}, err
		}
		input.Config = prepared
		input.ProfileType = profileType
	}
	if kind == "ENVIRONMENT" {
		prepared, profileType, err := prepareEnvironmentConfig(input.ProfileType, input.Config)
		if err != nil {
			return Profile{}, err
		}
		input.Config = prepared
		input.ProfileType = profileType
	}
	if kind == "AUTH" {
		prepared, profileType, err := prepareAuthConfig(input.ProfileType, input.Config)
		if err != nil {
			return Profile{}, err
		}
		input.Config = prepared
		input.ProfileType = profileType
	}
	if kind == "TELEMETRY" {
		prepared, profileType, err := prepareTelemetryConfig(input.ProfileType, input.Config)
		if err != nil {
			return Profile{}, err
		}
		input.Config = prepared
		input.ProfileType = profileType
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
	profile, err := s.Get(ctx, profileID)
	if err != nil {
		return Profile{}, err
	}
	return s.redactProfile(profile), nil
}

func (s *Service) Update(ctx context.Context, profileID string, input Input, actor string) (Profile, error) {
	existing, err := s.Get(ctx, profileID)
	if err != nil {
		return Profile{}, err
	}
	if !existing.Active {
		return Profile{}, ErrNotFound
	}
	kind := existing.Kind
	if name := strings.TrimSpace(input.Name); name != "" {
		existing.Name = name
	}
	existing.Description = strings.TrimSpace(input.Description)
	if profileType := strings.TrimSpace(input.ProfileType); profileType != "" {
		existing.ProfileType = profileType
	}
	if input.Config != nil {
		switch kind {
		case "SECRET_REFERENCE":
			prepared, profileType, prepErr := s.prepareSecretConfig(input.Config)
			if prepErr != nil {
				return Profile{}, prepErr
			}
			existing.Config = prepared
			if existing.ProfileType == "" {
				existing.ProfileType = profileType
			}
		case "NOTIFICATION":
			prepared, prepErr := s.prepareNotificationConfig(existing.ProfileType, input.Config, existing.Config)
			if prepErr != nil {
				return Profile{}, prepErr
			}
			existing.Config = prepared
			if err := validateNotification(existing.ProfileType, existing.Config); err != nil {
				return Profile{}, err
			}
		case "CERTIFICATE":
			prepared, prepErr := s.prepareCertificateConfig(input.Config, existing.Config)
			if prepErr != nil {
				return Profile{}, prepErr
			}
			existing.Config = prepared
		case "PROXY":
			prepared, profileType, prepErr := prepareProxyConfig(input.Config)
			if prepErr != nil {
				return Profile{}, prepErr
			}
			existing.Config = prepared
			existing.ProfileType = profileType
		case "ENVIRONMENT":
			prepared, profileType, prepErr := prepareEnvironmentConfig(existing.ProfileType, input.Config)
			if prepErr != nil {
				return Profile{}, prepErr
			}
			existing.Config = prepared
			existing.ProfileType = profileType
		case "AUTH":
			prepared, profileType, prepErr := prepareAuthConfig(existing.ProfileType, input.Config)
			if prepErr != nil {
				return Profile{}, prepErr
			}
			existing.Config = prepared
			existing.ProfileType = profileType
		case "TELEMETRY":
			prepared, profileType, prepErr := prepareTelemetryConfig(existing.ProfileType, input.Config)
			if prepErr != nil {
				return Profile{}, prepErr
			}
			existing.Config = prepared
			existing.ProfileType = profileType
		default:
			existing.Config = input.Config
		}
	}
	if input.Active != nil {
		existing.Active = *input.Active
	}
	encoded, _ := json.Marshal(existing.Config)
	_, err = s.pool.Exec(ctx, `UPDATE configuration_profiles SET name=$2,description=$3,profile_type=$4,config_json=$5,active=$6,updated_by=$7,updated_at=NOW() WHERE id=$1`, profileID, existing.Name, existing.Description, existing.ProfileType, encoded, existing.Active, actor)
	if err != nil {
		var pgerr *pgconn.PgError
		if errors.As(err, &pgerr) && pgerr.Code == "23505" {
			return Profile{}, fmt.Errorf("a profile with this name already exists")
		}
		return Profile{}, err
	}
	profile, err := s.Get(ctx, profileID)
	if err != nil {
		return Profile{}, err
	}
	return s.redactProfile(profile), nil
}

func (s *Service) redactProfile(profile Profile) Profile {
	switch profile.Kind {
	case "SECRET_REFERENCE":
		profile.Config = redactSecretConfig(profile.Config)
	case "CERTIFICATE":
		profile.Config = redactCertificateConfig(profile.Config)
	case "NOTIFICATION":
		profile.Config = redactNotificationConfig(profile.Config)
	}
	return profile
}

func validateNotification(profileType string, config map[string]any) error {
	kind := strings.ToUpper(strings.TrimSpace(profileType))
	switch kind {
	case "SLACK", "WEBHOOK":
		reference := strings.TrimSpace(fmt.Sprint(config["urlSecretRef"]))
		encrypted := strings.TrimSpace(fmt.Sprint(config["encryptedUrl"]))
		if reference != "" && reference != "<nil>" && !strings.HasPrefix(reference, "secret://") {
			return errors.New("urlSecretRef must be a secret:// alias")
		}
		if (reference == "" || reference == "<nil>") && (encrypted == "" || encrypted == "<nil>") {
			return errors.New("webhook channels require a URL secret or encrypted URL")
		}
		if plaintext := firstString(config, "url"); plaintext != "" {
			return errors.New("raw notification endpoint URLs must be encrypted before storage")
		}
	case "EMAIL":
		if strings.TrimSpace(fmt.Sprint(config["smtpHost"])) == "" || strings.TrimSpace(fmt.Sprint(config["from"])) == "" {
			return errors.New("email channels require smtpHost and from")
		}
		if plaintext := firstString(config, "username", "password"); plaintext != "" {
			return errors.New("raw SMTP credentials must be encrypted before storage")
		}
		if usernameRef := strings.TrimSpace(fmt.Sprint(config["usernameSecretRef"])); usernameRef != "" && usernameRef != "<nil>" && !strings.HasPrefix(usernameRef, "secret://") {
			return errors.New("usernameSecretRef must be a secret:// alias")
		}
		if passwordRef := strings.TrimSpace(fmt.Sprint(config["passwordSecretRef"])); passwordRef != "" && passwordRef != "<nil>" && !strings.HasPrefix(passwordRef, "secret://") {
			return errors.New("passwordSecretRef must be a secret:// alias")
		}
	default:
		return errors.New("notification profileType must be SLACK, WEBHOOK, or EMAIL")
	}
	return nil
}

// prepareNotificationConfig accepts plaintext credentials/URLs or secret refs, encrypts plaintext at rest, and never persists raw secrets.
// existing is the previously stored config (unredacted) used to preserve encrypted material when the client omits replacements.
func (s *Service) prepareNotificationConfig(profileType string, config map[string]any, existing map[string]any) (map[string]any, error) {
	if config == nil {
		config = map[string]any{}
	}
	kind := strings.ToUpper(strings.TrimSpace(profileType))
	switch kind {
	case "SLACK", "WEBHOOK":
		return s.prepareWebhookNotificationConfig(config, existing)
	case "EMAIL":
		return s.prepareEmailNotificationConfig(config, existing)
	default:
		return config, nil
	}
}

func (s *Service) prepareWebhookNotificationConfig(config map[string]any, existing map[string]any) (map[string]any, error) {
	stored := make(map[string]any, len(config)+2)
	for key, value := range config {
		lower := strings.ToLower(strings.TrimSpace(key))
		switch lower {
		case "url", "encryptedurl", "hasurl":
			continue
		default:
			stored[key] = value
		}
	}
	urlPlain := firstString(config, "url")
	urlRef := strings.TrimSpace(fmt.Sprint(config["urlSecretRef"]))
	if urlRef == "<nil>" {
		urlRef = ""
	}
	clearURL := truthy(config["clearUrl"])
	if urlPlain != "" && urlRef != "" {
		return nil, errors.New("provide either url or urlSecretRef, not both")
	}
	switch {
	case clearURL:
		// intentionally omit URL material
	case urlPlain != "":
		ciphertext, err := s.encryptInlineCredential(urlPlain)
		if err != nil {
			return nil, err
		}
		stored["encryptedUrl"] = ciphertext
	case urlRef != "":
		if !strings.HasPrefix(urlRef, "secret://") {
			urlRef = "secret://" + urlRef
		}
		stored["urlSecretRef"] = urlRef
	case existing != nil:
		if cipher := strings.TrimSpace(fmt.Sprint(existing["encryptedUrl"])); cipher != "" && cipher != "<nil>" {
			stored["encryptedUrl"] = cipher
		} else if ref := strings.TrimSpace(fmt.Sprint(existing["urlSecretRef"])); ref != "" && ref != "<nil>" {
			stored["urlSecretRef"] = ref
		}
	}
	return stored, nil
}

func (s *Service) prepareEmailNotificationConfig(config map[string]any, existing map[string]any) (map[string]any, error) {
	stored := make(map[string]any, len(config)+4)
	for key, value := range config {
		lower := strings.ToLower(strings.TrimSpace(key))
		switch lower {
		case "username", "password", "encryptedusername", "encryptedpassword", "hasusername", "haspassword":
			continue
		default:
			stored[key] = value
		}
	}

	usernamePlain := firstString(config, "username")
	passwordPlain := firstString(config, "password")
	usernameRef := strings.TrimSpace(fmt.Sprint(config["usernameSecretRef"]))
	if usernameRef == "<nil>" {
		usernameRef = ""
	}
	passwordRef := strings.TrimSpace(fmt.Sprint(config["passwordSecretRef"]))
	if passwordRef == "<nil>" {
		passwordRef = ""
	}
	clearUsername := truthy(config["clearUsername"])
	clearPassword := truthy(config["clearPassword"])

	if usernamePlain != "" && usernameRef != "" {
		return nil, errors.New("provide either username or usernameSecretRef, not both")
	}
	if passwordPlain != "" && passwordRef != "" {
		return nil, errors.New("provide either password or passwordSecretRef, not both")
	}

	switch {
	case clearUsername:
		// intentionally omit username material
	case usernamePlain != "":
		ciphertext, err := s.encryptInlineCredential(usernamePlain)
		if err != nil {
			return nil, err
		}
		stored["encryptedUsername"] = ciphertext
	case usernameRef != "":
		if !strings.HasPrefix(usernameRef, "secret://") {
			usernameRef = "secret://" + usernameRef
		}
		stored["usernameSecretRef"] = usernameRef
	case existing != nil:
		if cipher := strings.TrimSpace(fmt.Sprint(existing["encryptedUsername"])); cipher != "" && cipher != "<nil>" {
			stored["encryptedUsername"] = cipher
		} else if ref := strings.TrimSpace(fmt.Sprint(existing["usernameSecretRef"])); ref != "" && ref != "<nil>" {
			stored["usernameSecretRef"] = ref
		}
	}

	switch {
	case clearPassword:
		// intentionally omit password material
	case passwordPlain != "":
		ciphertext, err := s.encryptInlineCredential(passwordPlain)
		if err != nil {
			return nil, err
		}
		stored["encryptedPassword"] = ciphertext
	case passwordRef != "":
		if !strings.HasPrefix(passwordRef, "secret://") {
			passwordRef = "secret://" + passwordRef
		}
		stored["passwordSecretRef"] = passwordRef
	case existing != nil:
		if cipher := strings.TrimSpace(fmt.Sprint(existing["encryptedPassword"])); cipher != "" && cipher != "<nil>" {
			stored["encryptedPassword"] = cipher
		} else if ref := strings.TrimSpace(fmt.Sprint(existing["passwordSecretRef"])); ref != "" && ref != "<nil>" {
			stored["passwordSecretRef"] = ref
		}
	}

	return stored, nil
}

func (s *Service) encryptInlineCredential(plaintext string) (string, error) {
	if len(s.secretsKey) == 0 {
		return "", fmt.Errorf("inline credentials require RHYTHM_SECRETS_ENCRYPTION_KEY")
	}
	ciphertext, err := secretscrypto.Encrypt(s.secretsKey, plaintext)
	if err != nil {
		return "", fmt.Errorf("encrypt credential: %w", err)
	}
	return ciphertext, nil
}

// EncryptStored seals plaintext with the configured secrets encryption key.
func (s *Service) EncryptStored(plaintext string) (string, error) {
	return s.encryptInlineCredential(plaintext)
}

// DecryptStored opens an AES-GCM payload produced by Rhythm's secretscrypto package.
func (s *Service) DecryptStored(ciphertext string) (string, error) {
	if len(s.secretsKey) == 0 {
		return "", fmt.Errorf("stored credentials require RHYTHM_SECRETS_ENCRYPTION_KEY")
	}
	value, err := secretscrypto.Decrypt(s.secretsKey, ciphertext)
	if err != nil {
		return "", fmt.Errorf("stored credential could not be decrypted: %w", err)
	}
	return value, nil
}

func truthy(value any) bool {
	switch typed := value.(type) {
	case bool:
		return typed
	case string:
		lower := strings.ToLower(strings.TrimSpace(typed))
		return lower == "true" || lower == "1" || lower == "yes"
	default:
		return false
	}
}

// redactNotificationConfig strips ciphertext and plaintext credentials/URLs from API responses.
func redactNotificationConfig(config map[string]any) map[string]any {
	if config == nil {
		return map[string]any{}
	}
	redacted := make(map[string]any, len(config)+3)
	hasUsername := false
	hasPassword := false
	hasURL := false
	for key, value := range config {
		lower := strings.ToLower(strings.TrimSpace(key))
		switch lower {
		case "username", "password", "url", "encryptedusername", "encryptedpassword", "encryptedurl":
			if lower == "username" || lower == "encryptedusername" {
				hasUsername = true
			}
			if lower == "password" || lower == "encryptedpassword" {
				hasPassword = true
			}
			if lower == "url" || lower == "encryptedurl" {
				hasURL = true
			}
			continue
		case "hasusername", "haspassword", "hasurl":
			continue
		default:
			redacted[key] = value
		}
	}
	if ref := strings.TrimSpace(fmt.Sprint(config["usernameSecretRef"])); ref != "" && ref != "<nil>" {
		hasUsername = true
	}
	if ref := strings.TrimSpace(fmt.Sprint(config["passwordSecretRef"])); ref != "" && ref != "<nil>" {
		hasPassword = true
	}
	if ref := strings.TrimSpace(fmt.Sprint(config["urlSecretRef"])); ref != "" && ref != "<nil>" {
		hasURL = true
	}
	if hasUsername {
		redacted["hasUsername"] = true
	}
	if hasPassword {
		redacted["hasPassword"] = true
	}
	if hasURL {
		redacted["hasUrl"] = true
	}
	return redacted
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

// SMTPDefaults seeds a local EMAIL notification channel when SMTP_HOST is set.
type SMTPDefaults struct {
	Host     string
	Port     int
	From     string
	Username string
	Password string
	To       []string
}

// EnsureDefaultEmailChannel creates a single active EMAIL notification profile
// from env defaults when none exists. It also upgrades the exact legacy
// Compose-seeded freesmtpservers.com profile to the current local SMTP catcher.
func (s *Service) EnsureDefaultEmailChannel(ctx context.Context, defaults SMTPDefaults, actor string) (Profile, bool, error) {
	host := strings.TrimSpace(defaults.Host)
	from := strings.TrimSpace(defaults.From)
	if host == "" || from == "" {
		return Profile{}, false, nil
	}
	port := defaults.Port
	if port <= 0 {
		port = 25
	}
	var existing, existingName, existingDescription string
	var existingConfigJSON []byte
	err := s.pool.QueryRow(ctx, `SELECT id::text,name,COALESCE(description,''),config_json FROM configuration_profiles WHERE kind='NOTIFICATION' AND profile_type='EMAIL' AND active=TRUE ORDER BY created_at LIMIT 1`).Scan(&existing, &existingName, &existingDescription, &existingConfigJSON)
	if err == nil {
		const seededDescription = "Seeded from SMTP_* environment defaults for local alert email delivery."
		var existingConfig map[string]any
		if decodeErr := json.Unmarshal(existingConfigJSON, &existingConfig); decodeErr != nil {
			return Profile{}, false, decodeErr
		}
		if existingName == "Local SMTP" &&
			existingDescription == seededDescription &&
			strings.EqualFold(strings.TrimSpace(fmt.Sprint(existingConfig["smtpHost"])), "smtp.freesmtpservers.com") &&
			!strings.EqualFold(host, "smtp.freesmtpservers.com") {
			existingConfig["smtpHost"] = host
			existingConfig["smtpPort"] = port
			existingConfig["from"] = from
			encoded, encodeErr := json.Marshal(existingConfig)
			if encodeErr != nil {
				return Profile{}, false, encodeErr
			}
			if _, updateErr := s.pool.Exec(ctx, `UPDATE configuration_profiles SET config_json=$2::jsonb,updated_by=$3,updated_at=NOW() WHERE id=$1`, existing, encoded, actor); updateErr != nil {
				return Profile{}, false, updateErr
			}
		}
		profile, getErr := s.Get(ctx, existing)
		return profile, false, getErr
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return Profile{}, false, err
	}
	config := map[string]any{
		"smtpHost": host,
		"smtpPort": port,
		"from":     from,
	}
	if len(defaults.To) > 0 {
		to := make([]any, 0, len(defaults.To))
		for _, address := range defaults.To {
			if trimmed := strings.TrimSpace(address); trimmed != "" {
				to = append(to, trimmed)
			}
		}
		if len(to) > 0 {
			config["to"] = to
		}
	}
	if username := strings.TrimSpace(defaults.Username); username != "" {
		secretName := "smtp-username"
		if _, createErr := s.Create(ctx, "secrets", Input{
			Name:        secretName,
			Description: "Bootstrap SMTP username from environment",
			Config:      map[string]any{"provider": "LOCAL", "value": username},
		}, actor); createErr != nil && !strings.Contains(createErr.Error(), "already exists") {
			return Profile{}, false, createErr
		}
		config["usernameSecretRef"] = "secret://" + secretName
	}
	if password := strings.TrimSpace(defaults.Password); password != "" {
		secretName := "smtp-password"
		if _, createErr := s.Create(ctx, "secrets", Input{
			Name:        secretName,
			Description: "Bootstrap SMTP password from environment",
			Config:      map[string]any{"provider": "LOCAL", "value": password},
		}, actor); createErr != nil && !strings.Contains(createErr.Error(), "already exists") {
			return Profile{}, false, createErr
		}
		config["passwordSecretRef"] = "secret://" + secretName
	}
	profile, err := s.Create(ctx, "notifications", Input{
		Name:        "Local SMTP",
		Description: "Seeded from SMTP_* environment defaults for local alert email delivery.",
		ProfileType: "EMAIL",
		Config:      config,
	}, actor)
	if err != nil {
		return Profile{}, false, err
	}
	return profile, true, nil
}

// prepareSecretConfig validates input, encrypts LOCAL values, and returns storage-safe config plus a derived profile type.
func (s *Service) prepareSecretConfig(config map[string]any) (map[string]any, string, error) {
	if config == nil {
		return nil, "", fmt.Errorf("secret configuration is required")
	}
	provider := strings.ToUpper(strings.TrimSpace(fmt.Sprint(config["provider"])))
	switch provider {
	case "LOCAL", "STORED", "RHYTHM", "INLINE":
		plaintext := firstString(config, "value", "secret", "password", "token")
		if plaintext == "" {
			return nil, "", fmt.Errorf("stored secrets require a value")
		}
		if len(s.secretsKey) == 0 {
			return nil, "", fmt.Errorf("stored secrets require RHYTHM_SECRETS_ENCRYPTION_KEY")
		}
		ciphertext, err := secretscrypto.Encrypt(s.secretsKey, plaintext)
		if err != nil {
			return nil, "", fmt.Errorf("encrypt secret value: %w", err)
		}
		return map[string]any{
			"provider":       "LOCAL",
			"cipher":         "AES-GCM",
			"encryptedValue": ciphertext,
		}, "LOCAL", nil
	case "ENV", "ENVIRONMENT":
		path := strings.TrimSpace(fmt.Sprint(config["externalPath"]))
		if path == "" {
			return nil, "", fmt.Errorf("environment secrets require externalPath (env var name)")
		}
		if looksLikeSecretValueKey(config) {
			return nil, "", fmt.Errorf("environment secrets must not include plaintext values; set the variable on the API process")
		}
		return map[string]any{
			"provider":     "ENV",
			"externalPath": path,
		}, "ENV", nil
	case "VAULT", "HASHICORP_VAULT":
		path := strings.TrimSpace(fmt.Sprint(config["externalPath"]))
		if path == "" {
			return nil, "", fmt.Errorf("Vault secrets require externalPath")
		}
		if looksLikeSecretValueKey(config) {
			return nil, "", fmt.Errorf("Vault secrets must not include plaintext values")
		}
		stored := map[string]any{
			"provider":     "VAULT",
			"externalPath": path,
		}
		if field := strings.TrimSpace(fmt.Sprint(config["field"])); field != "" && field != "<nil>" {
			stored["field"] = field
		}
		if namespace := strings.TrimSpace(fmt.Sprint(config["namespace"])); namespace != "" && namespace != "<nil>" {
			stored["namespace"] = namespace
		}
		return stored, "VAULT", nil
	default:
		return nil, "", fmt.Errorf("secret provider must be LOCAL, ENV, or VAULT")
	}
}

func looksLikeSecretValueKey(config map[string]any) bool {
	for key := range config {
		lower := strings.ToLower(key)
		if lower == "value" || lower == "secret" || lower == "password" || lower == "token" || strings.Contains(lower, "privatekey") {
			if strings.TrimSpace(fmt.Sprint(config[key])) != "" && fmt.Sprint(config[key]) != "<nil>" {
				return true
			}
		}
	}
	return false
}

func firstString(config map[string]any, keys ...string) string {
	for _, key := range keys {
		if value, ok := config[key]; ok {
			text := strings.TrimSpace(fmt.Sprint(value))
			if text != "" && text != "<nil>" {
				return text
			}
		}
	}
	return ""
}

// redactSecretConfig strips ciphertext and any legacy plaintext fields from API responses.
func redactSecretConfig(config map[string]any) map[string]any {
	if config == nil {
		return map[string]any{}
	}
	redacted := make(map[string]any, len(config))
	provider := strings.ToUpper(strings.TrimSpace(fmt.Sprint(config["provider"])))
	hasMaterial := false
	for key, value := range config {
		lower := strings.ToLower(key)
		switch lower {
		case "value", "secret", "password", "token", "encryptedvalue", "ciphertext", "privatekey":
			hasMaterial = true
			continue
		default:
			if strings.Contains(lower, "privatekey") {
				hasMaterial = true
				continue
			}
		}
		redacted[key] = value
	}
	if provider == "LOCAL" || provider == "STORED" || provider == "RHYTHM" || provider == "INLINE" || hasMaterial {
		redacted["provider"] = "LOCAL"
		redacted["hasValue"] = true
		redacted["cipher"] = "AES-GCM"
	}
	return redacted
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
	case "LOCAL", "STORED", "RHYTHM", "INLINE":
		return s.resolveLocalSecret(identifier, config)
	case "ENV", "ENVIRONMENT":
		value, ok := os.LookupEnv(externalPath)
		if !ok {
			return "", fmt.Errorf("environment-backed secret %q is unavailable", identifier)
		}
		return value, nil
	case "VAULT", "HASHICORP_VAULT":
		return s.resolveVaultSecret(ctx, identifier, externalPath, config)
	default:
		// Legacy rows that somehow stored a plaintext value without a recognized provider.
		if plaintext := firstString(config, "value", "secret", "password", "token"); plaintext != "" {
			return plaintext, nil
		}
		return "", fmt.Errorf("secret provider %q is not available in this deployment", provider)
	}
}

func (s *Service) resolveLocalSecret(identifier string, config map[string]any) (string, error) {
	if ciphertext := strings.TrimSpace(fmt.Sprint(config["encryptedValue"])); ciphertext != "" && ciphertext != "<nil>" {
		if len(s.secretsKey) == 0 {
			return "", fmt.Errorf("stored secret %q requires RHYTHM_SECRETS_ENCRYPTION_KEY", identifier)
		}
		value, err := secretscrypto.Decrypt(s.secretsKey, ciphertext)
		if err != nil {
			return "", fmt.Errorf("stored secret %q could not be decrypted", identifier)
		}
		return value, nil
	}
	// Careful migration path: older plaintext rows (if any) remain readable once, but new writes encrypt.
	if plaintext := firstString(config, "value", "secret", "password", "token"); plaintext != "" {
		return plaintext, nil
	}
	return "", fmt.Errorf("stored secret %q has no encrypted value", identifier)
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
		for field, target := range map[string]*string{
			"encryptedClientCertificatePEM": &result.ClientCertificatePEM,
			"encryptedClientKeyPEM":         &result.ClientKeyPEM,
			"encryptedCABundlePEM":          &result.CABundlePEM,
		} {
			ciphertext := firstString(profile.Config, field)
			if ciphertext == "" {
				continue
			}
			if len(s.secretsKey) == 0 {
				return result, errors.New("certificate material cannot be decrypted because RHYTHM_SECRETS_ENCRYPTION_KEY is not configured")
			}
			value, err := secretscrypto.Decrypt(s.secretsKey, ciphertext)
			if err != nil {
				return result, fmt.Errorf("decrypt certificate profile %q: %w", profile.Name, err)
			}
			*target = value
		}
		for _, source := range []struct {
			keys   []string
			target *string
		}{
			{[]string{"clientCertSecretRef", "certificateSecretRef"}, &result.ClientCertificatePEM},
			{[]string{"clientKeySecretRef", "privateKeySecretRef"}, &result.ClientKeyPEM},
			{[]string{"caBundleSecretRef", "caSecretRef"}, &result.CABundlePEM},
		} {
			if *source.target != "" {
				continue
			}
			reference := firstString(profile.Config, source.keys...)
			if reference != "" {
				value, err := s.ResolveSecret(ctx, reference)
				if err != nil {
					return result, err
				}
				*source.target = value
			}
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

func (s *Service) ResolveEnvironmentProfile(ctx context.Context, profileID string) (runs.EnvironmentMaterial, error) {
	profile, err := s.profileByIdentifier(ctx, "ENVIRONMENT", profileID)
	if err != nil {
		return runs.EnvironmentMaterial{}, err
	}
	variables := map[string]string{}
	if configured, ok := profile.Config["variables"].(map[string]any); ok {
		for key, raw := range configured {
			value := strings.TrimSpace(fmt.Sprint(raw))
			if strings.HasPrefix(value, "secret://") {
				value, err = s.ResolveSecret(ctx, value)
				if err != nil {
					return runs.EnvironmentMaterial{}, fmt.Errorf("resolve environment variable %q: %w", key, err)
				}
			}
			variables[key] = value
		}
	}
	baseURL := strings.TrimSpace(fmt.Sprint(profile.Config["baseUrl"]))
	region := strings.TrimSpace(fmt.Sprint(profile.Config["region"]))
	if baseURL != "" {
		variables["baseUrl"] = baseURL
	}
	if region != "" {
		variables["region"] = region
	}
	return runs.EnvironmentMaterial{
		ID:          profile.ID,
		Name:        profile.Name,
		ProfileType: profile.ProfileType,
		BaseURL:     baseURL,
		Region:      region,
		UpdatedAt:   profile.UpdatedAt.UTC().Format(time.RFC3339Nano),
		Variables:   variables,
	}, nil
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
