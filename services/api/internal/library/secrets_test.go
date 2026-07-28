package library

import (
	"encoding/base64"
	"encoding/json"
	"strings"
	"testing"

	"github.com/rhythm-monitoring/rhythm/internal/secretscrypto"
)

func localTestKey(t *testing.T) []byte {
	t.Helper()
	key, err := secretscrypto.ParseKey(base64.StdEncoding.EncodeToString([]byte("0123456789abcdef0123456789abcdef")))
	if err != nil {
		t.Fatalf("parse key: %v", err)
	}
	return key
}

func TestPrepareSecretConfigEncryptsLocalValue(t *testing.T) {
	service := &Service{secretsKey: localTestKey(t)}
	stored, profileType, err := service.prepareSecretConfig(map[string]any{
		"provider": "LOCAL",
		"value":    "plaintext-secret",
	})
	if err != nil {
		t.Fatalf("prepare: %v", err)
	}
	if profileType != "LOCAL" {
		t.Fatalf("profile type %q", profileType)
	}
	if stored["provider"] != "LOCAL" {
		t.Fatalf("provider %v", stored["provider"])
	}
	ciphertext, _ := stored["encryptedValue"].(string)
	if ciphertext == "" || strings.Contains(ciphertext, "plaintext-secret") {
		t.Fatalf("expected encrypted payload, got %#v", stored)
	}
	if _, exists := stored["value"]; exists {
		t.Fatal("plaintext value must not be persisted")
	}
	decoded, err := secretscrypto.Decrypt(service.secretsKey, ciphertext)
	if err != nil || decoded != "plaintext-secret" {
		t.Fatalf("round-trip failed: %v %q", err, decoded)
	}
}

func TestPrepareSecretConfigRequiresEncryptionKeyForLocal(t *testing.T) {
	service := &Service{}
	_, _, err := service.prepareSecretConfig(map[string]any{
		"provider": "LOCAL",
		"value":    "x",
	})
	if err == nil || !strings.Contains(err.Error(), "RHYTHM_SECRETS_ENCRYPTION_KEY") {
		t.Fatalf("expected encryption key error, got %v", err)
	}
}

func TestRedactSecretConfigNeverLeaksPlaintextOrCiphertext(t *testing.T) {
	redacted := redactSecretConfig(map[string]any{
		"provider":       "LOCAL",
		"cipher":         "AES-GCM",
		"encryptedValue": "v1:abc",
		"value":          "should-not-leak",
		"token":          "also-secret",
	})
	encoded, _ := json.Marshal(redacted)
	payload := string(encoded)
	for _, banned := range []string{"should-not-leak", "also-secret", "v1:abc", "encryptedValue"} {
		if strings.Contains(payload, banned) {
			t.Fatalf("list payload leaked %q: %s", banned, payload)
		}
	}
	if redacted["hasValue"] != true {
		t.Fatalf("expected hasValue marker, got %#v", redacted)
	}
	if redacted["provider"] != "LOCAL" {
		t.Fatalf("provider %v", redacted["provider"])
	}
}

func TestRedactSecretConfigKeepsEnvMetadata(t *testing.T) {
	redacted := redactSecretConfig(map[string]any{
		"provider":     "ENV",
		"externalPath": "PAYMENTS_API_TOKEN",
	})
	if redacted["externalPath"] != "PAYMENTS_API_TOKEN" {
		t.Fatalf("unexpected redaction: %#v", redacted)
	}
	if _, exists := redacted["hasValue"]; exists {
		t.Fatal("ENV secrets should not set hasValue")
	}
}

func TestResolveLocalSecretDecrypts(t *testing.T) {
	key := localTestKey(t)
	ciphertext, err := secretscrypto.Encrypt(key, "runtime-secret")
	if err != nil {
		t.Fatal(err)
	}
	service := &Service{secretsKey: key}
	value, err := service.resolveLocalSecret("api-token", map[string]any{
		"provider":       "LOCAL",
		"encryptedValue": ciphertext,
	})
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	if value != "runtime-secret" {
		t.Fatalf("got %q", value)
	}
}

func TestResolveLocalSecretLegacyPlaintextFallback(t *testing.T) {
	service := &Service{secretsKey: localTestKey(t)}
	value, err := service.resolveLocalSecret("legacy", map[string]any{
		"provider": "LOCAL",
		"value":    "legacy-plaintext",
	})
	if err != nil {
		t.Fatalf("resolve legacy: %v", err)
	}
	if value != "legacy-plaintext" {
		t.Fatalf("got %q", value)
	}
}

func TestPrepareEnvAndVaultRejectPlaintextValues(t *testing.T) {
	service := &Service{secretsKey: localTestKey(t)}
	if _, _, err := service.prepareSecretConfig(map[string]any{
		"provider":     "ENV",
		"externalPath": "FOO",
		"value":        "nope",
	}); err == nil {
		t.Fatal("ENV should reject plaintext value")
	}
	if _, _, err := service.prepareSecretConfig(map[string]any{
		"provider":     "VAULT",
		"externalPath": "secret/data/x",
		"token":        "nope",
	}); err == nil {
		t.Fatal("VAULT should reject plaintext token")
	}
}
