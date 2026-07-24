package library

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestResolveVaultKVV2Secret(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/secret/data/payments" {
			t.Fatalf("unexpected Vault path %q", r.URL.Path)
		}
		if r.Header.Get("X-Vault-Token") != "test-token" || r.Header.Get("X-Vault-Namespace") != "payments" {
			t.Fatal("Vault authentication headers were not supplied")
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":{"data":{"apiKey":"super-secret"},"metadata":{"version":1}}}`))
	}))
	defer server.Close()

	service := &Service{httpClient: server.Client(), vaultAddr: server.URL, vaultToken: "test-token"}
	value, err := service.resolveVaultSecret(context.Background(), "payments-api-key", "secret/data/payments", map[string]any{"field": "apiKey", "namespace": "payments"})
	if err != nil {
		t.Fatalf("resolve Vault secret: %v", err)
	}
	if value != "super-secret" {
		t.Fatalf("unexpected Vault value %q", value)
	}
}

func TestResolveVaultSecretNeverReturnsResponseBodyInError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusForbidden)
		_, _ = w.Write([]byte(`{"errors":["sensitive policy detail"]}`))
	}))
	defer server.Close()

	service := &Service{httpClient: server.Client(), vaultAddr: server.URL, vaultToken: "test-token"}
	_, err := service.resolveVaultSecret(context.Background(), "blocked", "secret/data/blocked", map[string]any{})
	if err == nil || err.Error() != `Vault secret "blocked" returned HTTP 403` {
		t.Fatalf("unexpected safe error: %v", err)
	}
}
