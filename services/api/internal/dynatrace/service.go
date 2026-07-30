package dynatrace

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/url"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/rhythm-monitoring/rhythm/internal/id"
	"github.com/rhythm-monitoring/rhythm/internal/library"
)

type Service struct {
	pool     *pgxpool.Pool
	library  *library.Service
	provider Provider
	now      func() time.Time
}

func New(pool *pgxpool.Pool, profiles *library.Service, provider Provider) *Service {
	return &Service{pool: pool, library: profiles, provider: provider, now: func() time.Time { return time.Now().UTC() }}
}

func (s *Service) ListEnvironmentBindings(ctx context.Context, applicationID string) ([]EnvironmentBinding, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT b.id::text,b.application_id::text,COALESCE(b.environment_profile_id::text,''),
		       COALESCE(p.name,b.environment_name),COALESCE(p.profile_type,b.environment_type),COALESCE(p.config_json->>'host',''),b.enabled,
		       EXISTS(SELECT 1 FROM dynatrace_application_configs c WHERE c.environment_binding_id=b.id),
		       b.created_at,b.updated_at
		FROM application_environment_bindings b
		LEFT JOIN configuration_profiles p ON p.id=b.environment_profile_id
		WHERE b.application_id=$1
		ORDER BY p.name`, applicationID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []EnvironmentBinding{}
	for rows.Next() {
		var item EnvironmentBinding
		if err := rows.Scan(&item.ID, &item.ApplicationID, &item.EnvironmentProfileID, &item.EnvironmentName, &item.EnvironmentType, &item.BaseURLHost, &item.Enabled, &item.DynatraceConfigured, &item.CreatedAt, &item.UpdatedAt); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s *Service) EnsureDefaultEnvironmentBinding(ctx context.Context, applicationID, actor string) (EnvironmentBinding, error) {
	items, err := s.ListEnvironmentBindings(ctx, applicationID)
	if err != nil {
		return EnvironmentBinding{}, err
	}
	if len(items) > 0 {
		return items[0], nil
	}
	var applicationName, environment string
	err = s.pool.QueryRow(ctx, `SELECT name,COALESCE(environment,'') FROM applications WHERE id=$1`, applicationID).Scan(&applicationName, &environment)
	if errors.Is(err, pgx.ErrNoRows) {
		return EnvironmentBinding{}, ErrNotFound
	}
	if err != nil {
		return EnvironmentBinding{}, err
	}
	environment = strings.TrimSpace(environment)
	if environment == "" {
		environment = "application"
	}
	bindingID, err := id.NewUUID()
	if err != nil {
		return EnvironmentBinding{}, err
	}
	_, err = s.pool.Exec(ctx, `
		INSERT INTO application_environment_bindings(
			id,application_id,environment_profile_id,environment_name,environment_type,enabled,created_by,updated_by
		) VALUES($1,$2,NULL,$3,$4,TRUE,$5,$5)
		ON CONFLICT (application_id) WHERE environment_profile_id IS NULL DO NOTHING`,
		bindingID, applicationID, applicationName, strings.ToUpper(environment), actor)
	if err != nil {
		return EnvironmentBinding{}, err
	}
	items, err = s.ListEnvironmentBindings(ctx, applicationID)
	if err != nil || len(items) == 0 {
		return EnvironmentBinding{}, err
	}
	return items[0], nil
}

func (s *Service) SaveEnvironmentBinding(ctx context.Context, applicationID, bindingID string, input EnvironmentBindingInput, actor string) (EnvironmentBinding, error) {
	if strings.TrimSpace(input.EnvironmentProfileID) == "" {
		return EnvironmentBinding{}, errors.New("environmentProfileId is required")
	}
	profile, err := s.library.Get(ctx, input.EnvironmentProfileID)
	if err != nil || profile.Kind != "ENVIRONMENT" || !profile.Active {
		return EnvironmentBinding{}, errors.New("an active Environment profile is required")
	}
	var applicationExists bool
	if err := s.pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM applications WHERE id=$1)`, applicationID).Scan(&applicationExists); err != nil {
		return EnvironmentBinding{}, err
	}
	if !applicationExists {
		return EnvironmentBinding{}, ErrNotFound
	}
	enabled := true
	if input.Enabled != nil {
		enabled = *input.Enabled
	}
	if bindingID == "" {
		bindingID, err = id.NewUUID()
		if err != nil {
			return EnvironmentBinding{}, err
		}
		_, err = s.pool.Exec(ctx, `INSERT INTO application_environment_bindings(id,application_id,environment_profile_id,enabled,created_by,updated_by)VALUES($1,$2,$3,$4,$5,$5)`, bindingID, applicationID, profile.ID, enabled, actor)
	} else {
		command, updateErr := s.pool.Exec(ctx, `UPDATE application_environment_bindings SET environment_profile_id=$3,enabled=$4,updated_by=$5,updated_at=NOW() WHERE id=$1 AND application_id=$2`, bindingID, applicationID, profile.ID, enabled, actor)
		err = updateErr
		if err == nil && command.RowsAffected() == 0 {
			return EnvironmentBinding{}, ErrNotFound
		}
	}
	if err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "unique") {
			return EnvironmentBinding{}, errors.New("this Environment profile is already linked to the application")
		}
		return EnvironmentBinding{}, err
	}
	return s.getEnvironmentBinding(ctx, applicationID, bindingID)
}

func (s *Service) getEnvironmentBinding(ctx context.Context, applicationID, bindingID string) (EnvironmentBinding, error) {
	var item EnvironmentBinding
	err := s.pool.QueryRow(ctx, `
		SELECT b.id::text,b.application_id::text,COALESCE(b.environment_profile_id::text,''),
		       COALESCE(p.name,b.environment_name),COALESCE(p.profile_type,b.environment_type),COALESCE(p.config_json->>'host',''),b.enabled,
		       EXISTS(SELECT 1 FROM dynatrace_application_configs c WHERE c.environment_binding_id=b.id),
		       b.created_at,b.updated_at
		FROM application_environment_bindings b
		LEFT JOIN configuration_profiles p ON p.id=b.environment_profile_id
		WHERE b.application_id=$1 AND b.id=$2`, applicationID, bindingID).
		Scan(&item.ID, &item.ApplicationID, &item.EnvironmentProfileID, &item.EnvironmentName, &item.EnvironmentType, &item.BaseURLHost, &item.Enabled, &item.DynatraceConfigured, &item.CreatedAt, &item.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return EnvironmentBinding{}, ErrNotFound
	}
	return item, err
}

func (s *Service) DeleteEnvironmentBinding(ctx context.Context, applicationID, bindingID string) error {
	command, err := s.pool.Exec(ctx, `DELETE FROM application_environment_bindings WHERE id=$1 AND application_id=$2`, bindingID, applicationID)
	if err != nil {
		return err
	}
	if command.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *Service) GetConfiguration(ctx context.Context, applicationID, bindingID string) (Configuration, error) {
	var item Configuration
	var platforms, zones, metrics []byte
	var lastTestAt *time.Time
	err := s.pool.QueryRow(ctx, `
		SELECT c.id::text,c.application_id::text,c.environment_binding_id::text,c.connection_profile_id::text,
		       p.name,COALESCE(p.config_json->>'baseUrl',''),c.credential_secret_ref,c.platforms,c.management_zones,
		       c.metric_mappings,c.baseline_window_seconds,c.stabilization_seconds,c.post_window_seconds,
		       c.enabled,c.revision_number,c.last_test_status,c.last_test_error,c.last_test_at,c.created_at,c.updated_at
		FROM dynatrace_application_configs c
		JOIN configuration_profiles p ON p.id=c.connection_profile_id
		WHERE c.application_id=$1 AND c.environment_binding_id=$2`, applicationID, bindingID).
		Scan(&item.ID, &item.ApplicationID, &item.EnvironmentBindingID, &item.ConnectionProfileID, &item.ConnectionName, &item.BaseURL,
			&item.CredentialSecretRef, &platforms, &zones, &metrics, &item.BaselineWindowSeconds, &item.StabilizationSeconds,
			&item.PostWindowSeconds, &item.Enabled, &item.RevisionNumber, &item.LastTestStatus, &item.LastTestError,
			&lastTestAt, &item.CreatedAt, &item.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return Configuration{}, ErrNotConfigured
	}
	if err != nil {
		return Configuration{}, err
	}
	item.LastTestAt = lastTestAt
	_ = json.Unmarshal(platforms, &item.Platforms)
	_ = json.Unmarshal(zones, &item.ManagementZones)
	_ = json.Unmarshal(metrics, &item.MetricMappings)
	item.MetricMappings = normalizedMetricMappings(item.MetricMappings)
	item.EffectiveCredential = credentialName(item.CredentialSecretRef)
	if item.EffectiveCredential == "" {
		profile, profileErr := s.library.Get(ctx, item.ConnectionProfileID)
		if profileErr == nil {
			item.EffectiveCredential = credentialName(text(profile.Config["tokenSecretRef"]))
		}
	}
	item.ResourceMappings, err = s.loadResourceMappings(ctx, item.ID)
	if err != nil {
		return Configuration{}, err
	}
	item.Rules, err = s.loadRules(ctx, item.ID)
	if err != nil {
		return Configuration{}, err
	}
	item.ServiceOverrides, err = s.loadServiceConfigs(ctx, item)
	return item, err
}

func (s *Service) SaveConfiguration(ctx context.Context, applicationID, bindingID string, input ConfigurationInput, actor string) (Configuration, error) {
	if _, err := s.getEnvironmentBinding(ctx, applicationID, bindingID); err != nil {
		return Configuration{}, err
	}
	connection, err := s.library.Get(ctx, strings.TrimSpace(input.ConnectionProfileID))
	if err != nil || connection.Kind != "TELEMETRY" || connection.ProfileType != "DYNATRACE" || !connection.Active {
		return Configuration{}, errors.New("an active Dynatrace telemetry profile is required")
	}
	if err := validateConfigurationInput(input); err != nil {
		return Configuration{}, err
	}
	input.MetricMappings = normalizedMetricMappings(input.MetricMappings)
	input.CredentialSecretRef = normalizeSecretRef(input.CredentialSecretRef)
	if input.BaselineWindowSeconds == 0 {
		input.BaselineWindowSeconds = 86400
	}
	if input.StabilizationSeconds == 0 {
		input.StabilizationSeconds = 600
	}
	if input.PostWindowSeconds == 0 {
		input.PostWindowSeconds = 900
	}
	enabled := true
	if input.Enabled != nil {
		enabled = *input.Enabled
	}
	platforms, _ := json.Marshal(uniqueUpper(input.Platforms))
	zones, _ := json.Marshal(uniqueTrimmed(input.ManagementZones))
	metrics, _ := json.Marshal(input.MetricMappings)
	transaction, err := s.pool.Begin(ctx)
	if err != nil {
		return Configuration{}, err
	}
	defer func() { _ = transaction.Rollback(ctx) }()
	var configID string
	var revision int
	err = transaction.QueryRow(ctx, `SELECT id::text,revision_number FROM dynatrace_application_configs WHERE application_id=$1 AND environment_binding_id=$2 FOR UPDATE`, applicationID, bindingID).Scan(&configID, &revision)
	if errors.Is(err, pgx.ErrNoRows) {
		configID, err = id.NewUUID()
		if err != nil {
			return Configuration{}, err
		}
		revision = 1
		_, err = transaction.Exec(ctx, `
			INSERT INTO dynatrace_application_configs(
				id,application_id,environment_binding_id,connection_profile_id,credential_secret_ref,platforms,
				management_zones,metric_mappings,baseline_window_seconds,stabilization_seconds,post_window_seconds,
				enabled,revision_number,created_by,updated_by)
			VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$14)`,
			configID, applicationID, bindingID, connection.ID, input.CredentialSecretRef, platforms, zones, metrics,
			input.BaselineWindowSeconds, input.StabilizationSeconds, input.PostWindowSeconds, enabled, revision, actor)
	} else if err == nil {
		revision++
		_, err = transaction.Exec(ctx, `
			UPDATE dynatrace_application_configs SET connection_profile_id=$2,credential_secret_ref=$3,platforms=$4,
				management_zones=$5,metric_mappings=$6,baseline_window_seconds=$7,stabilization_seconds=$8,
				post_window_seconds=$9,enabled=$10,revision_number=$11,last_test_status='NOT_TESTED',
				last_test_error='',last_test_at=NULL,updated_by=$12,updated_at=NOW() WHERE id=$1`,
			configID, connection.ID, input.CredentialSecretRef, platforms, zones, metrics, input.BaselineWindowSeconds,
			input.StabilizationSeconds, input.PostWindowSeconds, enabled, revision, actor)
	}
	if err != nil {
		return Configuration{}, err
	}
	if _, err = transaction.Exec(ctx, `DELETE FROM dynatrace_resource_mappings WHERE application_config_id=$1`, configID); err != nil {
		return Configuration{}, err
	}
	for _, mapping := range input.ResourceMappings {
		mapping.Enabled = true
		if err = validateResourceMapping(mapping); err != nil {
			return Configuration{}, err
		}
		mappingID, _ := id.NewUUID()
		if _, err = transaction.Exec(ctx, `INSERT INTO dynatrace_resource_mappings(id,application_config_id,service_id,platform,entity_type,mapping_type,value,label,enabled)VALUES($1,$2,NULLIF($3,'')::uuid,$4,$5,$6,$7,$8,$9)`,
			mappingID, configID, mapping.ServiceID, strings.ToUpper(mapping.Platform), strings.ToUpper(mapping.EntityType), strings.ToUpper(mapping.MappingType), strings.TrimSpace(mapping.Value), strings.TrimSpace(mapping.Label), mapping.Enabled); err != nil {
			return Configuration{}, err
		}
	}
	if _, err = transaction.Exec(ctx, `DELETE FROM dynatrace_rules WHERE application_config_id=$1`, configID); err != nil {
		return Configuration{}, err
	}
	for _, rule := range input.Rules {
		rule.Enabled = true
		if err = validateRule(rule); err != nil {
			return Configuration{}, err
		}
		ruleID, _ := id.NewUUID()
		if _, err = transaction.Exec(ctx, `INSERT INTO dynatrace_rules(id,application_config_id,service_id,name,metric,statistic,operator,threshold,comparison,scope,gate_mode,minimum_coverage_percent,consecutive_points,enabled)VALUES($1,$2,NULLIF($3,'')::uuid,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
			ruleID, configID, rule.ServiceID, strings.TrimSpace(rule.Name), strings.ToUpper(rule.Metric), strings.ToUpper(rule.Statistic), strings.ToUpper(rule.Operator),
			rule.Threshold, strings.ToUpper(rule.Comparison), strings.ToUpper(rule.Scope), strings.ToUpper(rule.GateMode), rule.MinimumCoveragePercent, max(1, rule.ConsecutivePoints), rule.Enabled); err != nil {
			return Configuration{}, err
		}
	}
	snapshot := map[string]any{
		"connectionProfileId": connection.ID, "connectionName": connection.Name, "baseUrl": connection.Config["baseUrl"],
		"credentialName": credentialName(input.CredentialSecretRef), "platforms": input.Platforms,
		"managementZones": input.ManagementZones, "metricMappings": input.MetricMappings,
		"baselineWindowSeconds": input.BaselineWindowSeconds, "stabilizationSeconds": input.StabilizationSeconds,
		"postWindowSeconds": input.PostWindowSeconds, "resourceMappings": input.ResourceMappings, "rules": input.Rules,
	}
	snapshotJSON, _ := json.Marshal(snapshot)
	revisionID, _ := id.NewUUID()
	if _, err = transaction.Exec(ctx, `INSERT INTO dynatrace_config_revisions(id,application_config_id,revision_number,snapshot,created_by)VALUES($1,$2,$3,$4,$5)`, revisionID, configID, revision, snapshotJSON, actor); err != nil {
		return Configuration{}, err
	}
	if err = transaction.Commit(ctx); err != nil {
		return Configuration{}, err
	}
	return s.GetConfiguration(ctx, applicationID, bindingID)
}

func validateConfigurationInput(input ConfigurationInput) error {
	if strings.TrimSpace(input.ConnectionProfileID) == "" {
		return errors.New("connectionProfileId is required")
	}
	platforms := uniqueUpper(input.Platforms)
	if len(platforms) == 0 {
		return errors.New("at least one platform is required")
	}
	for _, platform := range platforms {
		if platform != "HYDRA" && platform != "TIMS" {
			return errors.New("platforms may contain only HYDRA or TIMS")
		}
	}
	if input.BaselineWindowSeconds != 0 && (input.BaselineWindowSeconds < 300 || input.BaselineWindowSeconds > 30*86400) {
		return errors.New("baselineWindowSeconds must be between 300 and 2592000")
	}
	if input.StabilizationSeconds < 0 || input.StabilizationSeconds > 86400 {
		return errors.New("stabilizationSeconds must be between 0 and 86400")
	}
	if input.PostWindowSeconds != 0 && (input.PostWindowSeconds < 60 || input.PostWindowSeconds > 86400) {
		return errors.New("postWindowSeconds must be between 60 and 86400")
	}
	return nil
}

func validateResourceMapping(mapping ResourceMapping) error {
	platform := strings.ToUpper(strings.TrimSpace(mapping.Platform))
	if platform != "HYDRA" && platform != "TIMS" {
		return errors.New("resource mapping platform must be HYDRA or TIMS")
	}
	allowedTypes := map[string]bool{"ENTITY_ID": true, "TAG": true, "HOST_GROUP": true, "NAMESPACE": true, "WORKLOAD": true, "CONTAINER_GROUP": true, "CLUSTER": true, "HOST": true}
	if !allowedTypes[strings.ToUpper(strings.TrimSpace(mapping.MappingType))] {
		return errors.New("resource mapping type is not supported")
	}
	if strings.TrimSpace(mapping.Value) == "" || len(mapping.Value) > 500 {
		return errors.New("resource mapping value is required and must be 500 characters or fewer")
	}
	if strings.ContainsAny(mapping.Value, "\r\n") {
		return errors.New("resource mapping value contains unsupported characters")
	}
	return nil
}

func validateRule(rule Rule) error {
	if strings.TrimSpace(rule.Name) == "" {
		return errors.New("rule name is required")
	}
	if metric := strings.ToUpper(rule.Metric); metric != "CPU" && metric != "MEMORY" {
		return errors.New("rule metric must be CPU or MEMORY")
	}
	statistics := map[string]bool{"AVERAGE": true, "MAXIMUM": true, "LATEST": true, "P50": true, "P95": true}
	if !statistics[strings.ToUpper(rule.Statistic)] {
		return errors.New("rule statistic must be AVERAGE, MAXIMUM, LATEST, P50, or P95")
	}
	operators := map[string]bool{"GT": true, "GTE": true, "LT": true, "LTE": true, "EQ": true}
	if !operators[strings.ToUpper(rule.Operator)] {
		return errors.New("rule operator must be GT, GTE, LT, LTE, or EQ")
	}
	if comparison := strings.ToUpper(rule.Comparison); comparison != "ABSOLUTE" && comparison != "BASELINE_ABSOLUTE" && comparison != "BASELINE_PERCENT" {
		return errors.New("rule comparison is invalid")
	}
	if gate := strings.ToUpper(rule.GateMode); gate != "ADVISORY" && gate != "BLOCKING" {
		return errors.New("rule gateMode must be ADVISORY or BLOCKING")
	}
	if rule.MinimumCoveragePercent != nil && (*rule.MinimumCoveragePercent < 0 || *rule.MinimumCoveragePercent > 100) {
		return errors.New("minimumCoveragePercent must be between 0 and 100")
	}
	return nil
}

func (s *Service) loadResourceMappings(ctx context.Context, configID string) ([]ResourceMapping, error) {
	rows, err := s.pool.Query(ctx, `SELECT id::text,COALESCE(service_id::text,''),platform,entity_type,mapping_type,value,label,enabled FROM dynatrace_resource_mappings WHERE application_config_id=$1 ORDER BY created_at`, configID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []ResourceMapping{}
	for rows.Next() {
		var item ResourceMapping
		if err := rows.Scan(&item.ID, &item.ServiceID, &item.Platform, &item.EntityType, &item.MappingType, &item.Value, &item.Label, &item.Enabled); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s *Service) loadRules(ctx context.Context, configID string) ([]Rule, error) {
	rows, err := s.pool.Query(ctx, `SELECT id::text,COALESCE(service_id::text,''),name,metric,statistic,operator,threshold,comparison,scope,gate_mode,minimum_coverage_percent,consecutive_points,enabled FROM dynatrace_rules WHERE application_config_id=$1 ORDER BY created_at`, configID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []Rule{}
	for rows.Next() {
		var item Rule
		if err := rows.Scan(&item.ID, &item.ServiceID, &item.Name, &item.Metric, &item.Statistic, &item.Operator, &item.Threshold, &item.Comparison, &item.Scope, &item.GateMode, &item.MinimumCoveragePercent, &item.ConsecutivePoints, &item.Enabled); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s *Service) loadServiceConfigs(ctx context.Context, config Configuration) ([]ServiceConfig, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT c.id::text,c.service_id::text,svc.name,c.credential_secret_ref,c.platforms,c.management_zones,
		       c.metric_mappings,c.inherit_resources,c.enabled
		FROM dynatrace_service_configs c
		JOIN application_services svc ON svc.id=c.service_id
		WHERE c.application_config_id=$1 ORDER BY svc.name`, config.ID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []ServiceConfig{}
	for rows.Next() {
		var item ServiceConfig
		var platforms, zones, metrics []byte
		if err := rows.Scan(&item.ID, &item.ServiceID, &item.ServiceName, &item.CredentialSecretRef, &platforms, &zones, &metrics, &item.InheritResources, &item.Enabled); err != nil {
			return nil, err
		}
		_ = json.Unmarshal(platforms, &item.Platforms)
		_ = json.Unmarshal(zones, &item.ManagementZones)
		_ = json.Unmarshal(metrics, &item.MetricMappings)
		item.EffectiveCredential = credentialName(item.CredentialSecretRef)
		if item.EffectiveCredential == "" {
			item.EffectiveCredential = config.EffectiveCredential
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s *Service) SaveServiceConfiguration(ctx context.Context, applicationID, bindingID, serviceID string, input ServiceConfigInput, actor string) (ServiceConfig, error) {
	config, err := s.GetConfiguration(ctx, applicationID, bindingID)
	if err != nil {
		return ServiceConfig{}, err
	}
	var validService bool
	if err := s.pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM application_services WHERE id=$1 AND application_id=$2)`, serviceID, applicationID).Scan(&validService); err != nil {
		return ServiceConfig{}, err
	}
	if !validService {
		return ServiceConfig{}, errors.New("service does not belong to the application")
	}
	inherit := true
	if input.InheritResources != nil {
		inherit = *input.InheritResources
	}
	enabled := true
	if input.Enabled != nil {
		enabled = *input.Enabled
	}
	platforms := uniqueUpper(input.Platforms)
	if len(platforms) == 0 {
		platforms = config.Platforms
	}
	for _, platform := range platforms {
		if platform != "HYDRA" && platform != "TIMS" {
			return ServiceConfig{}, errors.New("platforms may contain only HYDRA or TIMS")
		}
	}
	zones := uniqueTrimmed(input.ManagementZones)
	platformJSON, _ := json.Marshal(platforms)
	zoneJSON, _ := json.Marshal(zones)
	metricJSON, _ := json.Marshal(input.MetricMappings)
	secretRef := normalizeSecretRef(input.CredentialSecretRef)
	configID, _ := id.NewUUID()
	_, err = s.pool.Exec(ctx, `
		INSERT INTO dynatrace_service_configs(id,application_config_id,service_id,credential_secret_ref,platforms,management_zones,metric_mappings,inherit_resources,enabled,created_by,updated_by)
		VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10)
		ON CONFLICT(application_config_id,service_id) DO UPDATE SET credential_secret_ref=EXCLUDED.credential_secret_ref,
			platforms=EXCLUDED.platforms,management_zones=EXCLUDED.management_zones,metric_mappings=EXCLUDED.metric_mappings,
			inherit_resources=EXCLUDED.inherit_resources,enabled=EXCLUDED.enabled,updated_by=EXCLUDED.updated_by,updated_at=NOW()`,
		configID, config.ID, serviceID, secretRef, platformJSON, zoneJSON, metricJSON, inherit, enabled, actor)
	if err != nil {
		return ServiceConfig{}, err
	}
	updated, err := s.GetConfiguration(ctx, applicationID, bindingID)
	if err != nil {
		return ServiceConfig{}, err
	}
	for _, item := range updated.ServiceOverrides {
		if item.ServiceID == serviceID {
			return item, nil
		}
	}
	return ServiceConfig{}, ErrNotFound
}

func (s *Service) connection(ctx context.Context, config Configuration, serviceID string) (Connection, error) {
	profile, err := s.library.Get(ctx, config.ConnectionProfileID)
	if err != nil || profile.Kind != "TELEMETRY" || profile.ProfileType != "DYNATRACE" || !profile.Active {
		return Connection{}, errors.New("Dynatrace connection profile is unavailable")
	}
	secretRef := config.CredentialSecretRef
	for _, override := range config.ServiceOverrides {
		if override.ServiceID == serviceID && override.CredentialSecretRef != "" {
			secretRef = override.CredentialSecretRef
			break
		}
	}
	if secretRef == "" {
		secretRef = text(profile.Config["tokenSecretRef"])
	}
	token, err := s.library.ResolveSecret(ctx, secretRef)
	if err != nil {
		return Connection{}, errors.New("Dynatrace credential could not be resolved")
	}
	connection := Connection{
		BaseURL: text(profile.Config["baseUrl"]),
		Token:   token,
		Timeout: time.Duration(intValue(profile.Config["timeoutSeconds"], 30)) * time.Second,
	}
	tlsProfileID := text(profile.Config["tlsProfileId"])
	caProfileID := text(profile.Config["caProfileId"])
	if tlsProfileID != "" || caProfileID != "" {
		material, tlsErr := s.library.ResolveTLSProfile(ctx, tlsProfileID, caProfileID)
		if tlsErr != nil {
			return Connection{}, errors.New("Dynatrace TLS profile could not be resolved")
		}
		connection.ClientCertificatePEM = material.ClientCertificatePEM
		connection.ClientKeyPEM = material.ClientKeyPEM
		connection.CABundlePEM = material.CABundlePEM
	}
	if proxyProfileID := text(profile.Config["proxyProfileId"]); proxyProfileID != "" {
		material, proxyErr := s.library.ResolveProxyProfile(ctx, proxyProfileID)
		if proxyErr != nil {
			return Connection{}, errors.New("Dynatrace proxy profile could not be resolved")
		}
		connection.ProxyURL = material.URL
		connection.ProxyNoProxy = material.NoProxy
		connection.ProxyUsername = material.Username
		connection.ProxyPassword = material.Password
	}
	return connection, nil
}

func (s *Service) TestConnection(ctx context.Context, applicationID, bindingID string) (ConnectionTest, error) {
	config, err := s.GetConfiguration(ctx, applicationID, bindingID)
	if err != nil {
		return ConnectionTest{}, err
	}
	connection, err := s.connection(ctx, config, "")
	if err != nil {
		return ConnectionTest{}, err
	}
	started := s.now()
	entities, queryErr := s.provider.ListEntities(ctx, connection, "type(HOST)", 1)
	if queryErr == nil {
		metricID := config.MetricMappings.CPU
		if metricID == "" {
			metricID = "builtin:host.cpu.usage"
		}
		_, queryErr = s.provider.MetricDescriptor(ctx, connection, metricID)
	}
	now := s.now()
	result := ConnectionTest{Status: "SUCCESS", BaseURL: config.BaseURL, LatencyMS: now.Sub(started).Milliseconds(), EntityCount: len(entities), RequiredScopes: []string{"metrics.read", "entities.read"}, CheckedAt: now}
	if queryErr != nil {
		result.Status = "FAILED"
		result.SafeError = safeError(queryErr)
	}
	_, _ = s.pool.Exec(ctx, `UPDATE dynatrace_application_configs SET last_test_status=$2,last_test_error=$3,last_test_at=$4,updated_at=NOW() WHERE id=$1`, config.ID, result.Status, result.SafeError, now)
	return result, queryErr
}

func (s *Service) ListManagementZones(ctx context.Context, applicationID, bindingID string) ([]string, error) {
	config, err := s.GetConfiguration(ctx, applicationID, bindingID)
	if err != nil {
		return nil, err
	}
	connection, err := s.connection(ctx, config, "")
	if err != nil {
		return nil, err
	}
	zones := map[string]bool{}
	for _, entityType := range []string{"HOST", "KUBERNETES_WORKLOAD"} {
		entities, queryErr := s.provider.ListEntities(ctx, connection, "type("+entityType+")", 500)
		if queryErr != nil {
			if entityType == "HOST" {
				return nil, queryErr
			}
			continue
		}
		for _, entity := range entities {
			for _, zone := range entity.ManagementZones {
				zones[zone] = true
			}
		}
	}
	out := make([]string, 0, len(zones))
	for zone := range zones {
		out = append(out, zone)
	}
	sort.Strings(out)
	return out, nil
}

func (s *Service) DiscoverResources(ctx context.Context, applicationID, bindingID, platform string, zones []string) ([]Entity, error) {
	config, err := s.GetConfiguration(ctx, applicationID, bindingID)
	if err != nil {
		return nil, err
	}
	connection, err := s.connection(ctx, config, "")
	if err != nil {
		return nil, err
	}
	platform = strings.ToUpper(strings.TrimSpace(platform))
	entityType := "KUBERNETES_WORKLOAD"
	if platform == "TIMS" {
		entityType = "HOST"
	} else if platform != "HYDRA" {
		return nil, errors.New("platform must be HYDRA or TIMS")
	}
	parts := []string{"type(" + entityType + ")"}
	zones = uniqueTrimmed(zones)
	if len(zones) == 1 {
		parts = append(parts, `mzName("`+selectorValue(zones[0])+`")`)
	} else if len(zones) > 1 {
		zoneParts := make([]string, 0, len(zones))
		for _, zone := range zones {
			zoneParts = append(zoneParts, `mzName("`+selectorValue(zone)+`")`)
		}
		parts = append(parts, "or("+strings.Join(zoneParts, ",")+")")
	}
	entities, err := s.provider.ListEntities(ctx, connection, strings.Join(parts, ","), 500)
	if err != nil {
		return nil, err
	}
	for index := range entities {
		entities[index].Platform = platform
	}
	sort.Slice(entities, func(left, right int) bool {
		return strings.ToLower(entities[left].Name) < strings.ToLower(entities[right].Name)
	})
	return entities, nil
}

func (s *Service) PreviewResources(ctx context.Context, applicationID, bindingID, serviceID string) (ResourcePreview, error) {
	config, err := s.GetConfiguration(ctx, applicationID, bindingID)
	if err != nil {
		return ResourcePreview{}, err
	}
	connection, err := s.connection(ctx, config, serviceID)
	if err != nil {
		return ResourcePreview{}, err
	}
	mappings := effectiveMappings(config.ResourceMappings, serviceID)
	zones := config.ManagementZones
	for _, override := range config.ServiceOverrides {
		if override.ServiceID == serviceID && len(override.ManagementZones) > 0 {
			zones = override.ManagementZones
		}
	}
	selectors, unmatched, err := compileSelectors(mappings, zones)
	if err != nil {
		return ResourcePreview{}, err
	}
	result := ResourcePreview{Included: []Entity{}, Excluded: []Entity{}, Conflicts: []string{}, UnmatchedRules: unmatched, CompiledSelectors: selectors}
	seen := map[string]string{}
	for _, selector := range selectors {
		entities, queryErr := s.provider.ListEntities(ctx, connection, selector, 500)
		if queryErr != nil {
			return ResourcePreview{}, queryErr
		}
		if len(entities) == 0 {
			result.UnmatchedRules = append(result.UnmatchedRules, selector)
		}
		for _, entity := range entities {
			if prior, exists := seen[entity.ID]; exists && prior != selector {
				result.Conflicts = append(result.Conflicts, fmt.Sprintf("%s matches multiple resource rules", entity.Name))
				continue
			}
			seen[entity.ID] = selector
			entity.ServiceID = serviceID
			entity.Platform = platformForEntity(entity.Type)
			result.Included = append(result.Included, entity)
		}
	}
	if len(result.Included) >= 500 {
		result.Truncated = true
	}
	return result, nil
}

func effectiveMappings(mappings []ResourceMapping, serviceID string) []ResourceMapping {
	out := []ResourceMapping{}
	hasService := false
	for _, mapping := range mappings {
		if mapping.Enabled && mapping.ServiceID == serviceID && serviceID != "" {
			hasService = true
			out = append(out, mapping)
		}
	}
	if hasService {
		return out
	}
	for _, mapping := range mappings {
		if mapping.Enabled && mapping.ServiceID == "" {
			out = append(out, mapping)
		}
	}
	return out
}

func compileSelectors(mappings []ResourceMapping, managementZones []string) ([]string, []string, error) {
	selectors := []string{}
	unmatched := []string{}
	for _, mapping := range mappings {
		if err := validateResourceMapping(mapping); err != nil {
			return nil, nil, err
		}
		entityType := strings.ToUpper(mapping.EntityType)
		if entityType == "" {
			if strings.ToUpper(mapping.Platform) == "TIMS" {
				entityType = "HOST"
			} else {
				entityType = "KUBERNETES_WORKLOAD"
			}
		}
		parts := []string{"type(" + selectorValue(entityType) + ")"}
		switch strings.ToUpper(mapping.MappingType) {
		case "ENTITY_ID":
			parts = append(parts, `entityId("`+selectorValue(mapping.Value)+`")`)
		case "TAG":
			parts = append(parts, `tag("`+selectorValue(mapping.Value)+`")`)
		case "HOST", "WORKLOAD", "CONTAINER_GROUP":
			parts = append(parts, `entityName.equals("`+selectorValue(mapping.Value)+`")`)
		case "HOST_GROUP":
			parts = append(parts, `tag("Host group:`+selectorValue(mapping.Value)+`")`)
		case "NAMESPACE":
			parts = append(parts, `tag("Kubernetes namespace:`+selectorValue(mapping.Value)+`")`)
		case "CLUSTER":
			parts = append(parts, `tag("Kubernetes cluster:`+selectorValue(mapping.Value)+`")`)
		default:
			unmatched = append(unmatched, mapping.Label)
			continue
		}
		if len(managementZones) == 1 {
			parts = append(parts, `mzName("`+selectorValue(managementZones[0])+`")`)
		} else if len(managementZones) > 1 {
			zoneParts := make([]string, 0, len(managementZones))
			for _, zone := range managementZones {
				zoneParts = append(zoneParts, `mzName("`+selectorValue(zone)+`")`)
			}
			parts = append(parts, "or("+strings.Join(zoneParts, ",")+")")
		}
		selector := strings.Join(parts, ",")
		if len(selector) > 2000 {
			return nil, nil, errors.New("compiled Dynatrace entity selector exceeds 2,000 characters")
		}
		selectors = append(selectors, selector)
	}
	if len(selectors) == 0 {
		return nil, unmatched, errors.New("at least one governed resource mapping is required")
	}
	return uniqueTrimmed(selectors), unmatched, nil
}

func selectorValue(value string) string {
	value = strings.TrimSpace(value)
	value = strings.ReplaceAll(value, `\`, `\\`)
	value = strings.ReplaceAll(value, `"`, `\"`)
	return value
}

func (s *Service) Query(ctx context.Context, applicationID, bindingID string, input QueryInput, actor string) (Run, error) {
	config, err := s.GetConfiguration(ctx, applicationID, bindingID)
	if err != nil {
		return Run{}, err
	}
	if input.TimeFrom.IsZero() || input.TimeTo.IsZero() || !input.TimeTo.After(input.TimeFrom) {
		return Run{}, errors.New("timeFrom and timeTo must define a valid absolute window")
	}
	if input.TimeTo.Sub(input.TimeFrom) > 30*24*time.Hour {
		return Run{}, errors.New("Dynatrace query window may not exceed 30 days")
	}
	connection, err := s.connection(ctx, config, input.ServiceID)
	if err != nil {
		return s.persistFailure(ctx, config, input, actor, "SECRET_RESOLUTION", safeError(err))
	}
	mappings := normalizedMetricMappings(config.MetricMappings)
	rules := config.Rules
	platform := strings.ToUpper(strings.TrimSpace(input.Platform))
	managementZones := config.ManagementZones
	for _, override := range config.ServiceOverrides {
		if override.ServiceID == input.ServiceID {
			if !emptyMetricMappings(override.MetricMappings) {
				mappings = mergeMetricMappings(mappings, override.MetricMappings)
			}
			if len(override.ManagementZones) > 0 {
				managementZones = override.ManagementZones
			}
		}
	}
	platforms := config.Platforms
	if platform != "" {
		if platform != "HYDRA" && platform != "TIMS" {
			return Run{}, errors.New("platform must be HYDRA or TIMS")
		}
		platforms = []string{platform}
	}
	platforms = uniqueUpper(platforms)
	if len(platforms) == 0 {
		return Run{}, errors.New("at least one Dynatrace platform is required")
	}
	mzSelector := managementZoneSelector(managementZones)
	if mzSelector == "" {
		return Run{}, errors.New("at least one Dynatrace management zone is required")
	}
	resources := []ResourceMetric{}
	correlationID := ""
	units := map[string]string{}
	compiledMetricSelectors := map[string][]string{}
	descriptorCache := map[string]MetricDescriptor{}
	expectedSeries := 0
	for _, selectedPlatform := range platforms {
		specs := metricSpecs(selectedPlatform, mappings)
		selectorValues := make([]string, 0, len(specs))
		for _, spec := range specs {
			descriptor, cached := descriptorCache[spec.BaseMetric]
			if !cached {
				var descriptorErr error
				descriptor, descriptorErr = s.provider.MetricDescriptor(ctx, connection, spec.BaseMetric)
				if descriptorErr != nil {
					return s.persistFailure(ctx, config, input, actor, "INVALID_METRIC", safeError(descriptorErr))
				}
				descriptorCache[spec.BaseMetric] = descriptor
			}
			if !supportsAggregation(descriptor, spec.Aggregation) {
				return s.persistFailure(ctx, config, input, actor, "INVALID_METRIC", fmt.Sprintf("%s does not support %s aggregation", spec.BaseMetric, strings.ToLower(spec.Aggregation)))
			}
			units[spec.BaseMetric] = descriptor.Unit
			selectorValues = append(selectorValues, spec.Selector)
		}
		compiledMetricSelectors[selectedPlatform] = selectorValues
		entitySelector := selectedHostEntitySelector(config.ResourceMappings, input.ServiceID, selectedPlatform)
		if len(entitySelector) > 2000 {
			return Run{}, errors.New("selected TIMS hosts exceed the Dynatrace entity-selector limit; narrow the service or management-zone scope")
		}
		series, requestID, queryErr := s.provider.QueryMetric(ctx, connection, MetricQuery{
			MetricSelector: strings.Join(selectorValues, ","), EntitySelector: entitySelector,
			ManagementZoneSelector: mzSelector, From: input.TimeFrom, To: input.TimeTo,
			Resolution: defaultString(input.Resolution, defaultResolution(selectedPlatform)), Units: units,
		})
		if requestID != "" {
			correlationID = requestID
		}
		if queryErr != nil {
			return s.persistFailure(ctx, config, input, actor, categorize(queryErr), safeError(queryErr))
		}
		platformResources := map[string]bool{}
		for _, metric := range series {
			platformResources[metric.ResourceID] = true
		}
		expectedSeries += len(platformResources) * len(selectorValues)
		resources = append(resources, series...)
	}
	resourceIDs := map[string]bool{}
	coveredResourceIDs := map[string]bool{}
	coveredSeries := 0
	for _, metric := range resources {
		resourceIDs[metric.ResourceID] = true
		if metric.Statistics.SampleCount > 0 {
			coveredResourceIDs[metric.ResourceID] = true
			coveredSeries++
		}
	}
	coverage := 0.0
	if expectedSeries > 0 {
		coverage = math.Min(100, float64(coveredSeries)/float64(expectedSeries)*100)
	}
	summary := summarizeResources(resources)
	ruleResults := evaluateRules(rules, input.ServiceID, summary, coverage, nil)
	status, decision := classifyRun(expectedSeries, coveredSeries, ruleResults)
	runID, _ := id.NewUUID()
	now := s.now()
	run := Run{
		ID: runID, ApplicationID: applicationID, EnvironmentBindingID: bindingID, ApplicationConfigID: config.ID,
		ServiceID: input.ServiceID, DeploymentRunID: input.DeploymentRunID, Status: status, Decision: decision,
		Platform: strings.Join(platforms, ","), TimeFrom: input.TimeFrom.UTC(), TimeTo: input.TimeTo.UTC(), ResourceCount: len(resourceIDs),
		CoveredResourceCount: len(coveredResourceIDs), CoveragePercent: coverage, Summary: summary, Resources: resources,
		RuleResults: ruleResults, CorrelationID: correlationID, CreatedAt: now, CompletedAt: &now,
		RequestEvidence: map[string]any{
			"method": "GET", "baseUrl": config.BaseURL, "api": "/api/v2/metrics/query",
			"managementZoneSelector": mzSelector, "metricSelectors": compiledMetricSelectors,
			"resolution": defaultString(input.Resolution, "platform default"),
			"timeFrom":   input.TimeFrom.UTC(), "timeTo": input.TimeTo.UTC(), "effectiveCredential": config.EffectiveCredential,
			"responsePolicy": "Normalized and bounded; raw upstream responses are not retained.", "units": units,
			"expectedSeries": expectedSeries, "coveredSeries": coveredSeries,
		},
	}
	if err := s.persistRun(ctx, run, actor); err != nil {
		return Run{}, err
	}
	return run, nil
}

// CompareRuns evaluates the configured baseline-relative and absolute rules
// against two immutable normalized query runs. It never re-queries Dynatrace.
func (s *Service) CompareRuns(ctx context.Context, applicationID, bindingID, serviceID string, baseline, post Run, ruleIDs []string) ([]RuleResult, string, error) {
	config, err := s.GetConfiguration(ctx, applicationID, bindingID)
	if err != nil {
		return nil, "", err
	}
	allowed := map[string]bool{}
	for _, ruleID := range ruleIDs {
		allowed[strings.TrimSpace(ruleID)] = true
	}
	rules := make([]Rule, 0, len(config.Rules))
	for _, rule := range config.Rules {
		if len(allowed) == 0 || allowed[rule.ID] {
			rules = append(rules, rule)
		}
	}
	results := evaluateRules(rules, serviceID, post.Summary, post.CoveragePercent, baseline.Summary)
	expected, covered := max(1, post.ResourceCount*max(1, len(post.Summary))), post.CoveredResourceCount
	_, decision := classifyRun(expected, covered, results)
	if post.Status == "ERROR" || post.Status == "NO_DATA" {
		blocking := false
		for _, rule := range rules {
			if rule.Enabled && strings.EqualFold(rule.GateMode, "BLOCKING") {
				blocking = true
				break
			}
		}
		if blocking {
			decision = "BLOCK"
		} else {
			decision = "ALLOW_WITH_WARNINGS"
		}
	}
	return results, decision, nil
}

func nonEmptyMetricIDs(values map[string]string) []string {
	out := []string{}
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			out = append(out, value)
		}
	}
	return out
}

type metricSpec struct {
	BaseMetric  string
	Aggregation string
	Selector    string
}

func normalizedMetricMappings(input MetricMapping) MetricMapping {
	if input.HydraCPU == "" {
		input.HydraCPU = HydraCPUMetric
	}
	if input.HydraMemory == "" {
		input.HydraMemory = HydraMemoryMetric
	}
	if input.TIMSCPU == "" {
		input.TIMSCPU = defaultString(input.CPU, TIMSCPUMetric)
	}
	if input.TIMSMemory == "" {
		input.TIMSMemory = defaultString(input.Memory, TIMSMemoryMetric)
	}
	if input.CPU == "" {
		input.CPU = input.TIMSCPU
	}
	if input.Memory == "" {
		input.Memory = input.TIMSMemory
	}
	return input
}

func emptyMetricMappings(input MetricMapping) bool {
	return input.CPU == "" && input.Memory == "" && input.HydraCPU == "" &&
		input.HydraMemory == "" && input.TIMSCPU == "" && input.TIMSMemory == ""
}

func mergeMetricMappings(base, override MetricMapping) MetricMapping {
	if override.CPU != "" {
		base.CPU = override.CPU
	}
	if override.Memory != "" {
		base.Memory = override.Memory
	}
	if override.HydraCPU != "" {
		base.HydraCPU = override.HydraCPU
	}
	if override.HydraMemory != "" {
		base.HydraMemory = override.HydraMemory
	}
	if override.TIMSCPU != "" {
		base.TIMSCPU = override.TIMSCPU
	}
	if override.TIMSMemory != "" {
		base.TIMSMemory = override.TIMSMemory
	}
	return normalizedMetricMappings(base)
}

func metricSpecs(platform string, mappings MetricMapping) []metricSpec {
	mappings = normalizedMetricMappings(mappings)
	dimension, cpu, memory := `"dt.entity.host"`, mappings.TIMSCPU, mappings.TIMSMemory
	if platform == "HYDRA" {
		dimension, cpu, memory = `"Container"`, mappings.HydraCPU, mappings.HydraMemory
	}
	out := make([]metricSpec, 0, 4)
	for _, item := range []struct {
		base        string
		aggregation string
	}{
		{cpu, "AVG"},
		{cpu, "MAX"},
		{memory, "AVG"},
		{memory, "MAX"},
	} {
		if strings.TrimSpace(item.base) == "" {
			continue
		}
		transform := strings.ToLower(item.aggregation)
		out = append(out, metricSpec{
			BaseMetric: item.base, Aggregation: item.aggregation,
			Selector: item.base + ":splitBy(" + dimension + "):" + transform + ":names",
		})
	}
	return out
}

func supportsAggregation(descriptor MetricDescriptor, aggregation string) bool {
	for _, candidate := range descriptor.AggregationTypes {
		if strings.EqualFold(candidate, aggregation) {
			return true
		}
	}
	return len(descriptor.AggregationTypes) == 0
}

func managementZoneSelector(zones []string) string {
	zones = uniqueTrimmed(zones)
	if len(zones) == 0 {
		return ""
	}
	values := make([]string, 0, len(zones))
	for _, zone := range zones {
		values = append(values, `"`+selectorValue(zone)+`"`)
	}
	return "mzName(" + strings.Join(values, ",") + ")"
}

func selectedHostEntitySelector(mappings []ResourceMapping, serviceID, platform string) string {
	if platform != "TIMS" {
		return ""
	}
	ids := []string{}
	for _, mapping := range effectiveMappings(mappings, serviceID) {
		if mapping.Enabled && strings.EqualFold(mapping.Platform, "TIMS") &&
			strings.EqualFold(mapping.MappingType, "ENTITY_ID") && strings.TrimSpace(mapping.Value) != "" {
			ids = append(ids, `"`+selectorValue(mapping.Value)+`"`)
		}
	}
	if len(ids) == 0 {
		return ""
	}
	return "type(HOST),entityId(" + strings.Join(ids, ",") + ")"
}

func defaultResolution(platform string) string {
	if platform == "HYDRA" {
		return "10m"
	}
	return "10m"
}

func summarizeResources(resources []ResourceMetric) map[string]Statistics {
	averageValues := map[string][]float64{}
	maximumValues := map[string][]float64{}
	latest := map[string]*float64{}
	for _, resource := range resources {
		for _, point := range resource.Series {
			if point.Value != nil {
				if resource.Aggregation == "MAX" {
					maximumValues[resource.Metric] = append(maximumValues[resource.Metric], *point.Value)
				} else {
					averageValues[resource.Metric] = append(averageValues[resource.Metric], *point.Value)
					value := *point.Value
					latest[resource.Metric] = &value
				}
			}
		}
	}
	out := map[string]Statistics{}
	for _, metric := range []string{"CPU", "MEMORY"} {
		stats := statistics(averageValues[metric], latest[metric])
		if len(maximumValues[metric]) > 0 {
			sorted := append([]float64(nil), maximumValues[metric]...)
			sort.Float64s(sorted)
			maximum := sorted[len(sorted)-1]
			stats.Maximum = &maximum
		}
		if stats.SampleCount > 0 || len(maximumValues[metric]) > 0 {
			out[metric] = stats
		}
	}
	return out
}

func statistics(values []float64, latest *float64) Statistics {
	if len(values) == 0 {
		return Statistics{}
	}
	sorted := append([]float64(nil), values...)
	sort.Float64s(sorted)
	sum := 0.0
	for _, value := range sorted {
		sum += value
	}
	minimum, maximum, average := sorted[0], sorted[len(sorted)-1], sum/float64(len(sorted))
	p50, p95 := percentile(sorted, .50), percentile(sorted, .95)
	return Statistics{SampleCount: len(sorted), Minimum: &minimum, Maximum: &maximum, Average: &average, Latest: latest, P50: &p50, P95: &p95}
}

func percentile(sorted []float64, fraction float64) float64 {
	if len(sorted) == 0 {
		return 0
	}
	index := int(math.Ceil(fraction*float64(len(sorted)))) - 1
	index = max(0, min(index, len(sorted)-1))
	return sorted[index]
}

func evaluateRules(rules []Rule, serviceID string, summary map[string]Statistics, coverage float64, baseline map[string]Statistics) []RuleResult {
	results := []RuleResult{}
	for _, rule := range rules {
		if !rule.Enabled || rule.ServiceID != "" && rule.ServiceID != serviceID {
			continue
		}
		statistic := summary[strings.ToUpper(rule.Metric)]
		observed := statisticValue(statistic, rule.Statistic)
		result := RuleResult{RuleID: rule.ID, RuleName: rule.Name, Status: "PASS", GateMode: rule.GateMode, Metric: rule.Metric, Statistic: rule.Statistic, Observed: observed, Threshold: rule.Threshold, Operator: rule.Operator, CoveragePercent: coverage}
		if rule.MinimumCoveragePercent != nil && coverage < *rule.MinimumCoveragePercent {
			result.Status = "FAIL"
			result.Reason = fmt.Sprintf("Resource coverage %.1f%% is below the required %.1f%%.", coverage, *rule.MinimumCoveragePercent)
			results = append(results, result)
			continue
		}
		if observed == nil {
			result.Status = "NO_DATA"
			result.Reason = "The selected metric did not return a measured value."
			results = append(results, result)
			continue
		}
		value := *observed
		switch strings.ToUpper(rule.Comparison) {
		case "BASELINE_ABSOLUTE", "BASELINE_PERCENT":
			if baseline == nil {
				result.Status = "SKIPPED"
				result.Reason = "A baseline is required to evaluate this rule."
				results = append(results, result)
				continue
			}
			base := statisticValue(baseline[strings.ToUpper(rule.Metric)], rule.Statistic)
			result.Baseline = base
			if base == nil {
				result.Status = "NO_DATA"
				result.Reason = "The baseline did not contain the selected metric."
				results = append(results, result)
				continue
			}
			value -= *base
			if strings.ToUpper(rule.Comparison) == "BASELINE_PERCENT" {
				if *base == 0 {
					result.Status = "NO_DATA"
					result.Reason = "Percentage change cannot be calculated from a zero baseline."
					results = append(results, result)
					continue
				}
				value = value / math.Abs(*base) * 100
			}
		}
		if compare(value, strings.ToUpper(rule.Operator), rule.Threshold) {
			result.Status = "FAIL"
			result.Reason = fmt.Sprintf("Observed %.2f matched the failure condition %s %.2f.", value, rule.Operator, rule.Threshold)
		} else {
			result.Reason = "The measured value remained within the configured guardrail."
		}
		results = append(results, result)
	}
	return results
}

func statisticValue(value Statistics, name string) *float64 {
	switch strings.ToUpper(name) {
	case "AVERAGE":
		return value.Average
	case "MAXIMUM":
		return value.Maximum
	case "LATEST":
		return value.Latest
	case "P50":
		return value.P50
	case "P95":
		return value.P95
	default:
		return nil
	}
}

func compare(value float64, operator string, threshold float64) bool {
	switch operator {
	case "GT":
		return value > threshold
	case "GTE":
		return value >= threshold
	case "LT":
		return value < threshold
	case "LTE":
		return value <= threshold
	case "EQ":
		return value == threshold
	default:
		return false
	}
}

func classifyRun(expected, covered int, rules []RuleResult) (string, string) {
	status, decision := "PASS", "ALLOW"
	if expected == 0 || covered == 0 {
		status, decision = "NO_DATA", "ALLOW_WITH_WARNINGS"
	} else if covered < expected {
		status, decision = "PARTIAL_DATA", "ALLOW_WITH_WARNINGS"
	}
	for _, result := range rules {
		if result.Status == "FAIL" || result.Status == "NO_DATA" {
			if strings.ToUpper(result.GateMode) == "BLOCKING" {
				return "FAIL", "BLOCK"
			}
			status, decision = "WARNING", "ALLOW_WITH_WARNINGS"
		}
	}
	return status, decision
}

func (s *Service) persistFailure(ctx context.Context, config Configuration, input QueryInput, actor, category, reason string) (Run, error) {
	runID, _ := id.NewUUID()
	now := s.now()
	run := Run{ID: runID, ApplicationID: config.ApplicationID, EnvironmentBindingID: config.EnvironmentBindingID, ApplicationConfigID: config.ID, ServiceID: input.ServiceID, DeploymentRunID: input.DeploymentRunID, Status: "ERROR", Decision: "ALLOW_WITH_WARNINGS", TimeFrom: input.TimeFrom.UTC(), TimeTo: input.TimeTo.UTC(), Summary: map[string]Statistics{}, Resources: []ResourceMetric{}, RuleResults: []RuleResult{}, RequestEvidence: map[string]any{"baseUrl": config.BaseURL, "effectiveCredential": config.EffectiveCredential}, FailureCategory: category, FailureReason: reason, CreatedAt: now, CompletedAt: &now}
	blocking := false
	for _, rule := range config.Rules {
		if rule.Enabled && (rule.ServiceID == "" || rule.ServiceID == input.ServiceID) && strings.ToUpper(rule.GateMode) == "BLOCKING" {
			blocking = true
			break
		}
	}
	if blocking {
		run.Decision = "BLOCK"
	}
	if err := s.persistRun(ctx, run, actor); err != nil {
		return Run{}, err
	}
	return run, errors.New(reason)
}

func (s *Service) persistRun(ctx context.Context, run Run, actor string) error {
	summary, _ := json.Marshal(run.Summary)
	resources, _ := json.Marshal(run.Resources)
	rules, _ := json.Marshal(run.RuleResults)
	evidence, _ := json.Marshal(run.RequestEvidence)
	_, err := s.pool.Exec(ctx, `
		INSERT INTO dynatrace_runs(id,application_id,environment_binding_id,application_config_id,service_id,deployment_run_id,
			status,decision,platform,time_from,time_to,resource_count,covered_resource_count,summary,resources,rule_results,
			request_evidence,failure_category,failure_reason,correlation_id,created_by,created_at,completed_at)
		VALUES($1,$2,$3,$4,NULLIF($5,'')::uuid,NULLIF($6,'')::uuid,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)`,
		run.ID, run.ApplicationID, run.EnvironmentBindingID, run.ApplicationConfigID, run.ServiceID, run.DeploymentRunID,
		run.Status, run.Decision, run.Platform, run.TimeFrom, run.TimeTo, run.ResourceCount, run.CoveredResourceCount,
		summary, resources, rules, evidence, run.FailureCategory, run.FailureReason, run.CorrelationID, actor, run.CreatedAt, run.CompletedAt)
	return err
}

func (s *Service) GetRun(ctx context.Context, runID string) (Run, error) {
	return scanRun(s.pool.QueryRow(ctx, runSelect+` WHERE r.id=$1`, runID))
}

func (s *Service) ListRuns(ctx context.Context, applicationID, bindingID string) ([]Run, error) {
	clauses := []string{"TRUE"}
	args := []any{}
	if applicationID != "" {
		args = append(args, applicationID)
		clauses = append(clauses, fmt.Sprintf("r.application_id=$%d", len(args)))
	}
	if bindingID != "" {
		args = append(args, bindingID)
		clauses = append(clauses, fmt.Sprintf("r.environment_binding_id=$%d", len(args)))
	}
	rows, err := s.pool.Query(ctx, runSelect+` WHERE `+strings.Join(clauses, " AND ")+` ORDER BY r.created_at DESC LIMIT 500`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []Run{}
	for rows.Next() {
		item, scanErr := scanRun(rows)
		if scanErr != nil {
			return nil, scanErr
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

const runSelect = `SELECT r.id::text,r.application_id::text,r.environment_binding_id::text,r.application_config_id::text,
	COALESCE(r.config_revision_id::text,''),COALESCE(r.service_id::text,''),COALESCE(r.deployment_run_id::text,''),
	r.status,r.decision,r.platform,r.time_from,r.time_to,r.resource_count,r.covered_resource_count,r.summary,r.resources,
	r.rule_results,r.request_evidence,r.failure_category,r.failure_reason,r.correlation_id,r.created_at,r.completed_at FROM dynatrace_runs r`

func scanRun(row interface{ Scan(...any) error }) (Run, error) {
	var item Run
	var summary, resources, rules, evidence []byte
	err := row.Scan(&item.ID, &item.ApplicationID, &item.EnvironmentBindingID, &item.ApplicationConfigID, &item.ConfigRevisionID,
		&item.ServiceID, &item.DeploymentRunID, &item.Status, &item.Decision, &item.Platform, &item.TimeFrom, &item.TimeTo,
		&item.ResourceCount, &item.CoveredResourceCount, &summary, &resources, &rules, &evidence, &item.FailureCategory,
		&item.FailureReason, &item.CorrelationID, &item.CreatedAt, &item.CompletedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return Run{}, ErrNotFound
	}
	if err != nil {
		return Run{}, err
	}
	_ = json.Unmarshal(summary, &item.Summary)
	_ = json.Unmarshal(resources, &item.Resources)
	_ = json.Unmarshal(rules, &item.RuleResults)
	_ = json.Unmarshal(evidence, &item.RequestEvidence)
	if item.ResourceCount > 0 {
		item.CoveragePercent = math.Min(100, float64(item.CoveredResourceCount)/float64(item.ResourceCount*max(1, len(item.Summary)))*100)
	}
	return item, nil
}

func normalizeSecretRef(value string) string {
	value = strings.TrimSpace(value)
	if value != "" && !strings.HasPrefix(value, "secret://") {
		return "secret://" + value
	}
	return value
}

func credentialName(reference string) string {
	return strings.TrimSpace(strings.TrimPrefix(reference, "secret://"))
}

func uniqueUpper(values []string) []string {
	out := make([]string, 0, len(values))
	seen := map[string]bool{}
	for _, value := range values {
		value = strings.ToUpper(strings.TrimSpace(value))
		if value != "" && !seen[value] {
			seen[value] = true
			out = append(out, value)
		}
	}
	return out
}

func uniqueTrimmed(values []string) []string {
	out := make([]string, 0, len(values))
	seen := map[string]bool{}
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value != "" && !seen[value] {
			seen[value] = true
			out = append(out, value)
		}
	}
	return out
}

func text(value any) string {
	if value == nil {
		return ""
	}
	return strings.TrimSpace(fmt.Sprint(value))
}

func intValue(value any, fallback int) int {
	switch typed := value.(type) {
	case int:
		return typed
	case int64:
		return int(typed)
	case float64:
		return int(typed)
	default:
		return fallback
	}
}

func platformForEntity(entityType string) string {
	if strings.Contains(strings.ToUpper(entityType), "HOST") {
		return "TIMS"
	}
	return "HYDRA"
}

func safeError(err error) string {
	if err == nil {
		return ""
	}
	message := strings.TrimSpace(err.Error())
	if parsed, parseErr := url.Parse(message); parseErr == nil && parsed.Host != "" {
		return "Dynatrace request failed."
	}
	if len(message) > 240 {
		message = message[:240]
	}
	return message
}

func categorize(err error) string {
	if err == nil {
		return ""
	}
	message := strings.ToLower(err.Error())
	switch {
	case strings.Contains(message, "token"), strings.Contains(message, "unauthorized"):
		return "AUTHENTICATION"
	case strings.Contains(message, "permission"), strings.Contains(message, "forbidden"):
		return "AUTHORIZATION"
	case strings.Contains(message, "rate limit"):
		return "RATE_LIMIT"
	case strings.Contains(message, "timeout"), strings.Contains(message, "deadline"):
		return "TIMEOUT"
	case strings.Contains(message, "private"), strings.Contains(message, "allowlist"):
		return "POLICY"
	case strings.Contains(message, "selector"):
		return "INVALID_SELECTOR"
	case strings.Contains(message, "metric"):
		return "INVALID_METRIC"
	case strings.Contains(message, "1 mb"), strings.Contains(message, "limit"):
		return "RESPONSE_LIMIT"
	default:
		return "CONNECTION"
	}
}
