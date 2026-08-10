package library

import "testing"

func TestPrepareEnvironmentConfigUsesPlainAliasesForSensitiveVariables(t *testing.T) {
	config, kind, err := prepareEnvironmentConfig("PRODUCTION", map[string]any{
		"baseUrl":   "https://api.example.com/",
		"variables": map[string]any{"API_TOKEN": "prod-token", "API_VERSION": "v2"},
	})
	if err != nil || kind != "PRODUCTION" || config["secretCount"] != 1 {
		t.Fatalf("unexpected environment config: %#v, %s, %v", config, kind, err)
	}
}

func TestPrepareEnvironmentConfigAcceptsHydraStyleKeys(t *testing.T) {
	config, kind, err := prepareEnvironmentConfig("CUSTOM", map[string]any{
		"baseUrl": "https://api.example.com",
		"variables": map[string]any{
			"_vault***":     "injected",
			"lowercaseKey":  "ok",
			"mixed.Case-1":  "ok",
		},
	})
	if err != nil {
		t.Fatalf("Hydra-style keys should be accepted: %v", err)
	}
	variables, _ := config["variables"].(map[string]any)
	if kind != "CUSTOM" || variables["_vault***"] != "injected" || variables["lowercaseKey"] != "ok" {
		t.Fatalf("unexpected environment config: %#v", config)
	}
}

func TestPrepareAuthConfigNormalizesBearerSecret(t *testing.T) {
	config, kind, err := prepareAuthConfig("BEARER", map[string]any{"tokenSecretRef": "payments-token"})
	if err != nil {
		t.Fatal(err)
	}
	if kind != "BEARER" || config["tokenSecretRef"] != "payments-token" || config["secretBacked"] != true {
		t.Fatalf("unexpected auth config: %#v", config)
	}
}

func TestPrepareAuthConfigRejectsInvalidAPIKeyLocation(t *testing.T) {
	_, _, err := prepareAuthConfig("API_KEY", map[string]any{
		"name": "X-API-Key", "location": "cookie", "valueSecretRef": "key",
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
	if kind != "DYNATRACE" || config["baseUrl"] != "https://tenant.live.dynatrace.com" || config["tokenSecretRef"] != "dynatrace-token" {
		t.Fatalf("unexpected telemetry config: %#v", config)
	}
}

func TestPrepareTelemetryConfigAcceptsSelectedSecretDisplayName(t *testing.T) {
	config, kind, err := prepareTelemetryConfig("DYNATRACE", map[string]any{
		"baseUrl":        "https://tenant.live.dynatrace.com/",
		"tokenSecretRef": "Dynatrace API Token",
	})
	if err != nil {
		t.Fatal(err)
	}
	if kind != "DYNATRACE" || config["tokenSecretRef"] != "Dynatrace API Token" {
		t.Fatalf("unexpected telemetry config: %#v", config)
	}
}

func TestRequiredSecretRefRejectsControlCharacters(t *testing.T) {
	_, err := requiredSecretRef(
		map[string]any{"tokenSecretRef": "Dynatrace\nToken"},
		"tokenSecretRef",
		"Dynatrace API token",
	)
	if err == nil {
		t.Fatal("expected a secret name containing a control character to be rejected")
	}
}
