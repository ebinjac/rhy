package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
)

type Config struct {
	HTTPAddr              string
	AllowedOrigin         string
	DevelopmentActorID    string
	StorageMode           string
	DatabaseURL           string
	RedisURL              string
	AllowPrivateTargets   bool
	ScriptRunnerURL       string
	ScriptRunnerToken     string
	ELFBootstrapURL       string
	SecretsEncryptionKey  string
	SMTPHost              string
	SMTPPort              int
	SMTPFrom              string
	SMTPUsername          string
	SMTPPassword          string
	SMTPTo                []string
	DynatraceAllowedHosts []string
}

func Load() (Config, error) {
	cfg := Config{
		HTTPAddr:           valueOrDefault("RHYTHM_HTTP_ADDR", ":8080"),
		AllowedOrigin:      valueOrDefault("RHYTHM_ALLOWED_ORIGIN", "http://localhost:3000"),
		DevelopmentActorID: valueOrDefault("RHYTHM_DEVELOPMENT_ACTOR_ID", "local-admin"),
		StorageMode:        valueOrDefault("RHYTHM_STORAGE_MODE", "memory"),
		DatabaseURL:        strings.TrimSpace(os.Getenv("RHYTHM_DATABASE_URL")),
		RedisURL:           strings.TrimSpace(os.Getenv("RHYTHM_REDIS_URL")),
		ScriptRunnerURL:    valueOrDefault("RHYTHM_SCRIPT_RUNNER_URL", "http://script-runner:8090"),
		ScriptRunnerToken:  valueOrDefault("RHYTHM_SCRIPT_RUNNER_TOKEN", "rhythm-local-script-token"),
		ELFBootstrapURL:    strings.TrimSpace(os.Getenv("RHYTHM_ELF_BOOTSTRAP_URL")),
		SecretsEncryptionKey: firstNonEmpty(
			os.Getenv("RHYTHM_SECRETS_ENCRYPTION_KEY"),
			os.Getenv("RHYTHM_SECRETS_KEY"),
			os.Getenv("SECRETS_ENCRYPTION_KEY"),
		),
		SMTPHost:              firstNonEmpty(os.Getenv("RHYTHM_SMTP_HOST"), os.Getenv("SMTP_HOST")),
		SMTPFrom:              firstNonEmpty(os.Getenv("RHYTHM_SMTP_FROM"), os.Getenv("SMTP_FROM")),
		SMTPUsername:          firstNonEmpty(os.Getenv("RHYTHM_SMTP_USERNAME"), os.Getenv("SMTP_USERNAME"), os.Getenv("SMTP_USER")),
		SMTPPassword:          firstNonEmpty(os.Getenv("RHYTHM_SMTP_PASSWORD"), os.Getenv("SMTP_PASSWORD")),
		SMTPTo:                splitCSV(firstNonEmpty(os.Getenv("RHYTHM_SMTP_TO"), os.Getenv("SMTP_TO"))),
		DynatraceAllowedHosts: splitCSV(valueOrDefault("RHYTHM_DYNATRACE_ALLOWED_HOSTS", "amex-prod.live.dynatrace.com,amex.live.dynatrace.com")),
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
