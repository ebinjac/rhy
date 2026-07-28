package elf

import (
	"context"
	"strings"
	"testing"

	"github.com/rhythm-monitoring/rhythm/internal/secretscrypto"
)

type memorySecrets struct {
	values map[string]string
	key    []byte
}

func (m memorySecrets) ResolveSecret(_ context.Context, reference string) (string, error) {
	alias := strings.TrimPrefix(strings.TrimSpace(reference), "secret://")
	value, ok := m.values[alias]
	if !ok {
		return "", errSecretMissing(alias)
	}
	return value, nil
}

func (m memorySecrets) EncryptStored(plaintext string) (string, error) {
	return secretscrypto.Encrypt(m.key, plaintext)
}

func (m memorySecrets) DecryptStored(ciphertext string) (string, error) {
	return secretscrypto.Decrypt(m.key, ciphertext)
}

type missingSecretError string

func (e missingSecretError) Error() string { return "secret not found: " + string(e) }

func errSecretMissing(alias string) error { return missingSecretError(alias) }

func testKey(t *testing.T) []byte {
	t.Helper()
	key, err := secretscrypto.ParseKey("0123456789abcdef0123456789abcdef")
	if err != nil {
		t.Fatal(err)
	}
	return key
}

func TestRedactSettingsNeverLeaksCredentialMaterial(t *testing.T) {
	item := Settings{
		AuthMode:            "BEARER",
		Credential:          "plaintext-token",
		EncryptedCredential: "v1:cipher-blob",
		CredentialSecretRef: "secret://elf-token",
		HasCredential:       true,
	}
	redacted := redactSettings(item)
	if redacted.Credential != "" {
		t.Fatalf("plaintext credential leaked: %#v", redacted)
	}
	if redacted.EncryptedCredential != "" {
		t.Fatalf("ciphertext leaked: %#v", redacted)
	}
	if !redacted.HasCredential {
		t.Fatal("expected hasCredential")
	}
	if redacted.CredentialSecretRef != "secret://elf-token" {
		t.Fatalf("secret alias should remain visible: %#v", redacted)
	}
}

func TestResolveCredentialPrefersPlaintextThenSecretThenEncrypted(t *testing.T) {
	key := testKey(t)
	cipher, err := secretscrypto.Encrypt(key, "encrypted-value")
	if err != nil {
		t.Fatal(err)
	}
	service := &Service{secrets: memorySecrets{
		values: map[string]string{"elf-token": "secret-value"},
		key:    key,
	}}

	got, err := service.resolveCredential(context.Background(), Settings{Credential: "plain"})
	if err != nil || got != "plain" {
		t.Fatalf("plaintext: %v %q", err, got)
	}
	got, err = service.resolveCredential(context.Background(), Settings{CredentialSecretRef: "elf-token"})
	if err != nil || got != "secret-value" {
		t.Fatalf("secret ref: %v %q", err, got)
	}
	got, err = service.resolveCredential(context.Background(), Settings{EncryptedCredential: cipher})
	if err != nil || got != "encrypted-value" {
		t.Fatalf("encrypted: %v %q", err, got)
	}
}

func TestResolveCredentialRequiresMaterial(t *testing.T) {
	service := &Service{secrets: memorySecrets{key: testKey(t)}}
	_, err := service.resolveCredential(context.Background(), Settings{AuthMode: "BEARER"})
	if err == nil {
		t.Fatal("expected missing credential error")
	}
}
