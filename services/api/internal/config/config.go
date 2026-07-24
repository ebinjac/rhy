package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
)

type Config struct {
	HTTPAddr            string
	AllowedOrigin       string
	DevelopmentActorID  string
	StorageMode         string
	DatabaseURL         string
	RedisURL            string
	AllowPrivateTargets bool
	ScriptRunnerURL     string
	ScriptRunnerToken   string
	ELFBootstrapURL     string
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
