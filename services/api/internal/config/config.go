package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
)

type Config struct {
	HTTPAddr                string
	RuntimeRole             string
	Environment             string
	AuthMode                string
	IdentityHeader          string
	GroupsHeader            string
	AdminGroups             []string
	EditorGroups            []string
	OperatorGroups          []string
	ViewerGroups            []string
	TrustedProxyCIDRs       []string
	WorkerConcurrency       int
	ExecutorSlotsPerReplica int
	ExecutorMinReplicas     int
	ExecutorMaxReplicas     int
	ExecutorTargetPercent   int
	WorkerMemoryStopPercent int
	BrowserJobConcurrency   int
	DeploymentConcurrency   int
	SchedulerBatchSize      int
	SchedulerPollMS         int
	TargetHostConcurrency   int
	DatabaseMaxConns        int
	DatabaseMinConns        int
	DatabaseTxPooling       bool
	RequiredSchemaVersion   string
	AllowedOrigin           string
	DevelopmentActorID      string
	StorageMode             string
	DatabaseURL             string
	RedisURL                string
	RedisMode               string
	RedisAddrs              []string
	RedisUsername           string
	RedisPassword           string
	RedisDB                 int
	RedisTLS                bool
	AllowPrivateTargets     bool
	PrivateTargetHosts      []string
	PrivateTargetCIDRs      []string
	ScriptRunnerURL         string
	ScriptRunnerToken       string
	BrowserRunnerURL        string
	BrowserRunnerToken      string
	ArtifactStoreURL        string
	ArtifactProvider        string
	ArtifactRegion          string
	ArtifactPrefix          string
	ArtifactKMSKeyID        string
	ArtifactPathStyle       bool
	ArtifactAutoCreate      bool
	ArtifactAccessKey       string
	ArtifactSecretKey       string
	ArtifactBucket          string
	ELFBootstrapURL         string
	SecretsEncryptionKey    string
	SMTPHost                string
	SMTPPort                int
	SMTPFrom                string
	SMTPFromName            string
	SMTPUsername            string
	SMTPPassword            string
	SMTPTo                  []string
	DynatraceAllowedHosts   []string
}

func Load() (Config, error) {
	cfg := Config{
		HTTPAddr:              valueOrDefault("RHYTHM_HTTP_ADDR", ":8080"),
		RuntimeRole:           strings.ToLower(valueOrDefault("RHYTHM_ROLE", "all")),
		Environment:           strings.ToLower(valueOrDefault("RHYTHM_ENVIRONMENT", "development")),
		AuthMode:              strings.ToLower(valueOrDefault("RHYTHM_AUTH_MODE", "development")),
		IdentityHeader:        valueOrDefault("RHYTHM_IDENTITY_HEADER", "X-Rhythm-User"),
		GroupsHeader:          valueOrDefault("RHYTHM_GROUPS_HEADER", "X-Rhythm-Groups"),
		AdminGroups:           splitCSV(os.Getenv("RHYTHM_ADMIN_GROUPS")),
		EditorGroups:          splitCSV(os.Getenv("RHYTHM_EDITOR_GROUPS")),
		OperatorGroups:        splitCSV(os.Getenv("RHYTHM_OPERATOR_GROUPS")),
		ViewerGroups:          splitCSV(os.Getenv("RHYTHM_VIEWER_GROUPS")),
		TrustedProxyCIDRs:     splitCSV(valueOrDefault("RHYTHM_TRUSTED_PROXY_CIDRS", "127.0.0.0/8,::1/128")),
		AllowedOrigin:         valueOrDefault("RHYTHM_ALLOWED_ORIGIN", "http://localhost:3000"),
		DevelopmentActorID:    valueOrDefault("RHYTHM_DEVELOPMENT_ACTOR_ID", "local-admin"),
		StorageMode:           valueOrDefault("RHYTHM_STORAGE_MODE", "memory"),
		DatabaseURL:           strings.TrimSpace(os.Getenv("RHYTHM_DATABASE_URL")),
		RequiredSchemaVersion: strings.TrimSpace(os.Getenv("RHYTHM_REQUIRED_SCHEMA_VERSION")),
		RedisURL:              strings.TrimSpace(os.Getenv("RHYTHM_REDIS_URL")),
		RedisMode:             strings.ToLower(valueOrDefault("RHYTHM_REDIS_MODE", "single")),
		RedisAddrs:            splitCSV(os.Getenv("RHYTHM_REDIS_ADDRS")),
		RedisUsername:         strings.TrimSpace(os.Getenv("RHYTHM_REDIS_USERNAME")),
		RedisPassword:         os.Getenv("RHYTHM_REDIS_PASSWORD"),
		PrivateTargetHosts:    splitCSV(os.Getenv("RHYTHM_PRIVATE_TARGET_ALLOWED_HOSTS")),
		PrivateTargetCIDRs:    splitCSV(os.Getenv("RHYTHM_PRIVATE_TARGET_ALLOWED_CIDRS")),
		ScriptRunnerURL:       valueOrDefault("RHYTHM_SCRIPT_RUNNER_URL", "http://script-runner:8090"),
		ScriptRunnerToken:     valueOrDefault("RHYTHM_SCRIPT_RUNNER_TOKEN", "rhythm-local-script-token"),
		BrowserRunnerURL:      valueOrDefault("RHYTHM_BROWSER_RUNNER_URL", "http://browser-agent:8091"),
		BrowserRunnerToken:    valueOrDefault("RHYTHM_BROWSER_RUNNER_TOKEN", "rhythm-local-browser-token"),
		ArtifactStoreURL:      valueOrDefault("RHYTHM_ARTIFACT_STORE_URL", "http://minio:9000"),
		ArtifactProvider:      strings.ToLower(valueOrDefault("RHYTHM_ARTIFACT_STORE_PROVIDER", "minio")),
		ArtifactRegion:        valueOrDefault("RHYTHM_ARTIFACT_STORE_REGION", "us-east-1"),
		ArtifactPrefix:        strings.Trim(strings.TrimSpace(os.Getenv("RHYTHM_ARTIFACT_STORE_PREFIX")), "/"),
		ArtifactKMSKeyID:      strings.TrimSpace(os.Getenv("RHYTHM_ARTIFACT_STORE_KMS_KEY_ID")),
		ArtifactAccessKey: firstNonEmpty(
			os.Getenv("RHYTHM_ARTIFACT_STORE_ACCESS_KEY"),
			os.Getenv("RHYTHM_ARTIFACT_ACCESS_KEY"),
		),
		ArtifactSecretKey: firstNonEmpty(
			os.Getenv("RHYTHM_ARTIFACT_STORE_SECRET_KEY"),
			os.Getenv("RHYTHM_ARTIFACT_SECRET_KEY"),
		),
		ArtifactBucket: firstNonEmpty(
			os.Getenv("RHYTHM_ARTIFACT_STORE_BUCKET"),
			os.Getenv("RHYTHM_ARTIFACT_BUCKET"),
			"rhythm-browser-artifacts",
		),
		ELFBootstrapURL: strings.TrimSpace(os.Getenv("RHYTHM_ELF_BOOTSTRAP_URL")),
		SecretsEncryptionKey: firstNonEmpty(
			os.Getenv("RHYTHM_SECRETS_ENCRYPTION_KEY"),
			os.Getenv("RHYTHM_SECRETS_KEY"),
			os.Getenv("SECRETS_ENCRYPTION_KEY"),
		),
		SMTPHost: firstNonEmpty(os.Getenv("RHYTHM_SMTP_HOST"), os.Getenv("SMTP_HOST")),
		SMTPFrom: firstNonEmpty(
			os.Getenv("RHYTHM_SMTP_FROM"),
			os.Getenv("SMTP_FROM"),
			os.Getenv("SMTP_FROM_EMAIL"),
			os.Getenv("RHYTHM_SMTP_FROM_EMAIL"),
		),
		SMTPFromName: firstNonEmpty(
			os.Getenv("RHYTHM_SMTP_FROM_NAME"),
			os.Getenv("SMTP_FROM_NAME"),
		),
		SMTPUsername:          firstNonEmpty(os.Getenv("RHYTHM_SMTP_USERNAME"), os.Getenv("SMTP_USERNAME"), os.Getenv("SMTP_USER")),
		SMTPPassword:          firstNonEmpty(os.Getenv("RHYTHM_SMTP_PASSWORD"), os.Getenv("SMTP_PASSWORD")),
		SMTPTo:                splitCSV(firstNonEmpty(os.Getenv("RHYTHM_SMTP_TO"), os.Getenv("SMTP_TO"))),
		DynatraceAllowedHosts: splitCSV(valueOrDefault("RHYTHM_DYNATRACE_ALLOWED_HOSTS", "amex-prod.live.dynatrace.com,amex.live.dynatrace.com")),
	}
	// AWS must use the SDK's normal regional endpoint unless an endpoint override
	// was explicitly supplied. MinIO keeps the local Compose default.
	if cfg.ArtifactProvider == "s3" && strings.TrimSpace(os.Getenv("RHYTHM_ARTIFACT_STORE_URL")) == "" {
		cfg.ArtifactStoreURL = ""
	}
	var err error
	if cfg.RedisDB, err = integerInRange("RHYTHM_REDIS_DB", 0, 0, 15); err != nil {
		return Config{}, err
	}
	if cfg.RedisTLS, err = booleanValue("RHYTHM_REDIS_TLS", false); err != nil {
		return Config{}, err
	}
	if cfg.ArtifactPathStyle, err = booleanValue("RHYTHM_ARTIFACT_STORE_PATH_STYLE", cfg.ArtifactProvider == "minio"); err != nil {
		return Config{}, err
	}
	if cfg.ArtifactAutoCreate, err = booleanValue("RHYTHM_ARTIFACT_STORE_AUTO_CREATE", cfg.Environment == "development"); err != nil {
		return Config{}, err
	}
	if cfg.WorkerConcurrency, err = integerInRange("RHYTHM_WORKER_CONCURRENCY", 32, 1, 256); err != nil {
		return Config{}, err
	}
	if cfg.ExecutorSlotsPerReplica, err = integerInRange("RHYTHM_EXECUTOR_SLOTS_PER_REPLICA", 256, 1, 256); err != nil {
		return Config{}, err
	}
	if cfg.ExecutorMinReplicas, err = integerInRange("RHYTHM_EXECUTOR_MIN_REPLICAS", 3, 1, 64); err != nil {
		return Config{}, err
	}
	if cfg.ExecutorMaxReplicas, err = integerInRange("RHYTHM_EXECUTOR_MAX_REPLICAS", 12, cfg.ExecutorMinReplicas, 128); err != nil {
		return Config{}, err
	}
	if cfg.ExecutorTargetPercent, err = integerInRange("RHYTHM_EXECUTOR_TARGET_UTILIZATION_PERCENT", 70, 25, 95); err != nil {
		return Config{}, err
	}
	if cfg.WorkerMemoryStopPercent, err = integerInRange("RHYTHM_WORKER_MEMORY_STOP_PERCENT", 80, 50, 95); err != nil {
		return Config{}, err
	}
	if cfg.BrowserJobConcurrency, err = integerInRange("RHYTHM_BROWSER_JOB_CONCURRENCY", 8, 1, 64); err != nil {
		return Config{}, err
	}
	if cfg.DeploymentConcurrency, err = integerInRange("RHYTHM_DEPLOYMENT_JOB_CONCURRENCY", 4, 1, 32); err != nil {
		return Config{}, err
	}
	if cfg.SchedulerBatchSize, err = integerInRange("RHYTHM_SCHEDULER_BATCH_SIZE", 1000, 1, 5000); err != nil {
		return Config{}, err
	}
	if cfg.SchedulerPollMS, err = integerInRange("RHYTHM_SCHEDULER_POLL_MS", 500, 100, 10000); err != nil {
		return Config{}, err
	}
	if cfg.TargetHostConcurrency, err = integerInRange("RHYTHM_TARGET_HOST_CONCURRENCY", 16, 1, 1024); err != nil {
		return Config{}, err
	}
	if cfg.DatabaseMaxConns, err = integerInRange("RHYTHM_DATABASE_MAX_CONNS", 20, 2, 500); err != nil {
		return Config{}, err
	}
	if cfg.DatabaseMinConns, err = integerInRange("RHYTHM_DATABASE_MIN_CONNS", 2, 0, cfg.DatabaseMaxConns); err != nil {
		return Config{}, err
	}
	if value := strings.TrimSpace(os.Getenv("RHYTHM_DATABASE_TRANSACTION_POOLING")); value != "" {
		enabled, parseErr := strconv.ParseBool(value)
		if parseErr != nil {
			return Config{}, fmt.Errorf("RHYTHM_DATABASE_TRANSACTION_POOLING must be true or false")
		}
		cfg.DatabaseTxPooling = enabled
	}
	portRaw := firstNonEmpty(os.Getenv("RHYTHM_SMTP_PORT"), os.Getenv("SMTP_PORT"))
	if portRaw == "" {
		cfg.SMTPPort = 25
	} else {
		port, err := strconv.Atoi(portRaw)
		if err != nil || port <= 0 || port > 65535 {
			return Config{}, fmt.Errorf("SMTP_PORT must be an integer between 1 and 65535")
		}
		cfg.SMTPPort = port
	}
	if value := strings.TrimSpace(os.Getenv("RHYTHM_ALLOW_PRIVATE_TARGETS")); value != "" {
		allowed, err := strconv.ParseBool(value)
		if err != nil {
			return Config{}, fmt.Errorf("RHYTHM_ALLOW_PRIVATE_TARGETS must be true or false")
		}
		cfg.AllowPrivateTargets = allowed
	}

	if !strings.HasPrefix(cfg.HTTPAddr, ":") && !strings.Contains(cfg.HTTPAddr, ":") {
		return Config{}, fmt.Errorf("RHYTHM_HTTP_ADDR must be a host:port or :port value")
	}
	if cfg.StorageMode != "memory" && cfg.StorageMode != "postgres" {
		return Config{}, fmt.Errorf("RHYTHM_STORAGE_MODE must be memory or postgres")
	}
	if cfg.StorageMode == "postgres" && cfg.DatabaseURL == "" {
		return Config{}, fmt.Errorf("RHYTHM_DATABASE_URL is required when RHYTHM_STORAGE_MODE=postgres")
	}
	switch cfg.RuntimeRole {
	case "all", "api", "control", "scheduler", "worker", "background", "browser":
	default:
		return Config{}, fmt.Errorf("RHYTHM_ROLE must be all, api, control, scheduler, worker, background, or browser")
	}
	if cfg.AuthMode != "development" && cfg.AuthMode != "trusted_headers" && cfg.AuthMode != "internal" {
		return Config{}, fmt.Errorf("RHYTHM_AUTH_MODE must be development, trusted_headers, or internal")
	}
	if cfg.Environment != "development" && cfg.AuthMode == "development" {
		return Config{}, fmt.Errorf("development authentication is not allowed outside the development environment")
	}
	if cfg.Environment != "development" && cfg.AllowPrivateTargets {
		return Config{}, fmt.Errorf("unrestricted private targets are not allowed outside the development environment; configure the governed host or CIDR allowlist")
	}
	if cfg.AuthMode == "internal" && (cfg.RuntimeRole == "all" || cfg.RuntimeRole == "api") {
		return Config{}, fmt.Errorf("internal authentication mode cannot serve the public API role")
	}
	if cfg.AuthMode == "trusted_headers" && (len(cfg.AdminGroups)+len(cfg.EditorGroups)+len(cfg.OperatorGroups)+len(cfg.ViewerGroups) == 0) {
		return Config{}, fmt.Errorf("trusted-header authentication requires at least one role group mapping")
	}
	if cfg.RedisMode != "single" && cfg.RedisMode != "cluster" {
		return Config{}, fmt.Errorf("RHYTHM_REDIS_MODE must be single or cluster")
	}
	if cfg.RedisMode == "cluster" && cfg.RedisDB != 0 {
		return Config{}, fmt.Errorf("RHYTHM_REDIS_DB must be 0 in cluster mode")
	}
	if cfg.ArtifactProvider != "minio" && cfg.ArtifactProvider != "s3" {
		return Config{}, fmt.Errorf("RHYTHM_ARTIFACT_STORE_PROVIDER must be minio or s3")
	}
	if cfg.Environment != "development" && cfg.ArtifactProvider == "s3" && cfg.ArtifactAutoCreate {
		return Config{}, fmt.Errorf("production S3 buckets must be provisioned outside Rhythm")
	}
	return cfg, nil
}

func valueOrDefault(key, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(key)); value != "" {
		return value
	}
	return fallback
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if trimmed := strings.TrimSpace(value); trimmed != "" {
			return trimmed
		}
	}
	return ""
}

func splitCSV(value string) []string {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	parts := strings.Split(value, ",")
	out := make([]string, 0, len(parts))
	for _, part := range parts {
		if trimmed := strings.TrimSpace(part); trimmed != "" {
			out = append(out, trimmed)
		}
	}
	return out
}

func integerInRange(key string, fallback, minimum, maximum int) (int, error) {
	raw := strings.TrimSpace(os.Getenv(key))
	if raw == "" {
		return fallback, nil
	}
	value, err := strconv.Atoi(raw)
	if err != nil || value < minimum || value > maximum {
		return 0, fmt.Errorf("%s must be an integer between %d and %d", key, minimum, maximum)
	}
	return value, nil
}

func booleanValue(key string, fallback bool) (bool, error) {
	raw := strings.TrimSpace(os.Getenv(key))
	if raw == "" {
		return fallback, nil
	}
	value, err := strconv.ParseBool(raw)
	if err != nil {
		return false, fmt.Errorf("%s must be true or false", key)
	}
	return value, nil
}
