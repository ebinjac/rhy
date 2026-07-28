package library

import "testing"

func TestPrepareEnvironmentConfigRequiresSecretsForSensitiveVariables(t *testing.T) {
	_, _, err := prepareEnvironmentConfig("PRODUCTION", map[string]any{
		"baseUrl":   "https://api.example.com",
		"variables": map[string]any{"API_TOKEN": "raw-token"},
	})
	if err == nil {
		t.Fatal("expected sensitive environment variable to require a secret reference")
	}
	config, kind, err := prepareEnvironmentConfig("PRODUCTION", map[string]any{
		"baseUrl":   "https://api.example.com/",
		"variables": map[string]any{"API_TOKEN": "secret://prod-token", "API_VERSION": "v2"},
	})
	if err != nil || kind != "PRODUCTION" || config["secretCount"] != 1 {
		t.Fatalf("unexpected environment config: %#v, %s, %v", config, kind, err)
	}
}

func TestPrepareAuthConfigNormalizesBearerSecret(t *testing.T) {
	config, kind, err := prepareAuthConfig("BEARER", map[string]any{"tokenSecretRef": "payments-token"})
	if err != nil {
		t.Fatal(err)
	}
	if kind != "BEARER" || config["tokenSecretRef"] != "secret://payments-token" || config["secretBacked"] != true {
		t.Fatalf("unexpected auth config: %#v", config)
	}
}

func TestPrepareAuthConfigRejectsInvalidAPIKeyLocation(t *testing.T) {
	_, _, err := prepareAuthConfig("API_KEY", map[string]any{
		"name": "X-API-Key", "location": "cookie", "valueSecretRef": "secret://key",
	})
	if err == nil {
		t.Fatal("expected invalid API key location to be rejected")
	}
}

func TestPrepareTelemetryConfigNormalizesURLAndToken(t *testing.T) {
	config, kind, err := prepareTelemetryConfig("DYNATRACE", map[string]any{
		"baseUrl":        "https://tenant.live.dynatrace.com/",
		"tokenSecretRef": "dynatrace-token",
	})
	if err != nil {
		t.Fatal(err)
	}
	if kind != "DYNATRACE" || config["baseUrl"] != "https://tenant.live.dynatrace.com" || config["tokenSecretRef"] != "secret://dynatrace-token" {
		t.Fatalf("unexpected telemetry config: %#v", config)
	}
}
