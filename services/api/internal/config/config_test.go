package config

import (
	"strings"
	"testing"
)

func TestProductionRejectsDevelopmentAuthentication(t *testing.T) {
	t.Setenv("RHYTHM_ENVIRONMENT", "production")
	t.Setenv("RHYTHM_AUTH_MODE", "development")
	_, err := Load()
	if err == nil || !strings.Contains(err.Error(), "development authentication") {
		t.Fatalf("expected production authentication guard, got %v", err)
	}
}

func TestS3UsesAWSDefaultEndpointAndWorkloadIdentity(t *testing.T) {
	t.Setenv("RHYTHM_ARTIFACT_STORE_PROVIDER", "s3")
	t.Setenv("RHYTHM_ARTIFACT_STORE_URL", "")
	t.Setenv("RHYTHM_ARTIFACT_STORE_ACCESS_KEY", "")
	t.Setenv("RHYTHM_ARTIFACT_STORE_SECRET_KEY", "")
	config, err := Load()
	if err != nil {
		t.Fatalf("load S3 configuration: %v", err)
	}
	if config.ArtifactStoreURL != "" {
		t.Fatalf("expected AWS SDK endpoint resolution, got %q", config.ArtifactStoreURL)
	}
	if config.ArtifactAccessKey != "" || config.ArtifactSecretKey != "" {
		t.Fatal("expected workload identity without static S3 credentials")
	}
}

func TestClusterRedisRejectsNonZeroDatabase(t *testing.T) {
	t.Setenv("RHYTHM_REDIS_MODE", "cluster")
	t.Setenv("RHYTHM_REDIS_DB", "2")
	_, err := Load()
	if err == nil || !strings.Contains(err.Error(), "must be 0") {
		t.Fatalf("expected Redis cluster database guard, got %v", err)
	}
}

func TestInternalAuthenticationCannotExposePublicAPI(t *testing.T) {
	t.Setenv("RHYTHM_AUTH_MODE", "internal")
	t.Setenv("RHYTHM_ROLE", "api")
	_, err := Load()
	if err == nil || !strings.Contains(err.Error(), "cannot serve the public API") {
		t.Fatalf("expected internal authentication role guard, got %v", err)
	}
}

func TestPostgresStorageDefaultsToPostgresQueueAndAnonymousUnrestrictedAccess(t *testing.T) {
	t.Setenv("RHYTHM_STORAGE_MODE", "postgres")
	t.Setenv("RHYTHM_DATABASE_URL", "postgres://rhythm:test@postgres/rhythm")
	t.Setenv("RHYTHM_QUEUE_BACKEND", "")
	t.Setenv("RHYTHM_REDIS_URL", "")
	t.Setenv("RHYTHM_REDIS_ADDRS", "")
	t.Setenv("RHYTHM_AUTH_MODE", "")
	t.Setenv("RHYTHM_UNRESTRICTED_OUTBOUND", "")

	config, err := Load()
	if err != nil {
		t.Fatalf("load PostgreSQL-only configuration: %v", err)
	}
	if config.QueueBackend != "postgres" {
		t.Fatalf("queue backend=%q, want postgres", config.QueueBackend)
	}
	if config.AuthMode != "anonymous" {
		t.Fatalf("auth mode=%q, want anonymous", config.AuthMode)
	}
	if !config.UnrestrictedOutbound || !config.AllowPrivateTargets {
		t.Fatal("expected unrestricted outbound execution")
	}
}

func TestRedisQueueRequiresRedisConnection(t *testing.T) {
	t.Setenv("RHYTHM_QUEUE_BACKEND", "redis")
	t.Setenv("RHYTHM_REDIS_URL", "")
	t.Setenv("RHYTHM_REDIS_ADDRS", "")
	_, err := Load()
	if err == nil || !strings.Contains(err.Error(), "requires RHYTHM_REDIS_URL") {
		t.Fatalf("expected Redis connection validation, got %v", err)
	}
}
