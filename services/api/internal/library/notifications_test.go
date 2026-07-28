package library

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/rhythm-monitoring/rhythm/internal/secretscrypto"
)

func TestValidateNotificationEmailAllowsMissingTo(t *testing.T) {
	err := validateNotification("EMAIL", map[string]any{
		"smtpHost": "smtp.freesmtpservers.com",
		"smtpPort": 25,
		"from":     "alerts@rhythm.local",
	})
	if err != nil {
		t.Fatalf("expected EMAIL without to to be valid: %v", err)
	}
}

func TestValidateNotificationEmailRejectsLeftoverPlaintextPassword(t *testing.T) {
	err := validateNotification("EMAIL", map[string]any{
		"smtpHost": "smtp.example.com",
		"from":     "alerts@example.com",
		"password": "secret",
	})
	if err == nil {
		t.Fatal("expected leftover plaintext password rejection")
	}
}

func TestValidateNotificationEmailRequiresSecretAlias(t *testing.T) {
	err := validateNotification("EMAIL", map[string]any{
		"smtpHost":          "smtp.example.com",
		"from":              "alerts@example.com",
		"passwordSecretRef": "plain-password",
	})
	if err == nil {
		t.Fatal("expected passwordSecretRef alias validation")
	}
}

func TestPrepareNotificationConfigEncryptsPlaintextCredentials(t *testing.T) {
	service := &Service{secretsKey: localTestKey(t)}
	stored, err := service.prepareNotificationConfig("EMAIL", map[string]any{
		"smtpHost": "smtp.example.com",
		"smtpPort": 587,
		"from":     "alerts@example.com",
		"username": "smtp-user",
		"password": "smtp-pass",
	}, nil)
	if err != nil {
		t.Fatalf("prepare: %v", err)
	}
	if _, exists := stored["username"]; exists {
		t.Fatal("plaintext username must not be persisted")
	}
	if _, exists := stored["password"]; exists {
		t.Fatal("plaintext password must not be persisted")
	}
	userCipher, _ := stored["encryptedUsername"].(string)
	passCipher, _ := stored["encryptedPassword"].(string)
	if userCipher == "" || passCipher == "" {
		t.Fatalf("expected encrypted credentials, got %#v", stored)
	}
	if strings.Contains(userCipher, "smtp-user") || strings.Contains(passCipher, "smtp-pass") {
		t.Fatalf("ciphertext leaked plaintext: %#v", stored)
	}
	user, err := secretscrypto.Decrypt(service.secretsKey, userCipher)
	if err != nil || user != "smtp-user" {
		t.Fatalf("username round-trip failed: %v %q", err, user)
	}
	pass, err := secretscrypto.Decrypt(service.secretsKey, passCipher)
	if err != nil || pass != "smtp-pass" {
		t.Fatalf("password round-trip failed: %v %q", err, pass)
	}
	if err := validateNotification("EMAIL", stored); err != nil {
		t.Fatalf("prepared config should validate: %v", err)
	}
}

func TestPrepareNotificationConfigKeepsSecretRefs(t *testing.T) {
	service := &Service{secretsKey: localTestKey(t)}
	stored, err := service.prepareNotificationConfig("EMAIL", map[string]any{
		"smtpHost":          "smtp.example.com",
		"from":              "alerts@example.com",
		"usernameSecretRef": "smtp-username",
		"passwordSecretRef": "secret://smtp-password",
	}, nil)
	if err != nil {
		t.Fatalf("prepare: %v", err)
	}
	if stored["usernameSecretRef"] != "secret://smtp-username" {
		t.Fatalf("username ref: %#v", stored["usernameSecretRef"])
	}
	if stored["passwordSecretRef"] != "secret://smtp-password" {
		t.Fatalf("password ref: %#v", stored["passwordSecretRef"])
	}
}

func TestPrepareNotificationConfigPreservesExistingOnUpdate(t *testing.T) {
	service := &Service{secretsKey: localTestKey(t)}
	existing := map[string]any{
		"smtpHost":          "smtp.example.com",
		"from":              "alerts@example.com",
		"encryptedPassword": "v1:keep-me",
		"usernameSecretRef": "secret://existing-user",
	}
	stored, err := service.prepareNotificationConfig("EMAIL", map[string]any{
		"smtpHost": "smtp.example.com",
		"from":     "alerts@example.com",
		"smtpPort": 465,
	}, existing)
	if err != nil {
		t.Fatalf("prepare: %v", err)
	}
	if stored["encryptedPassword"] != "v1:keep-me" {
		t.Fatalf("expected preserved password cipher, got %#v", stored)
	}
	if stored["usernameSecretRef"] != "secret://existing-user" {
		t.Fatalf("expected preserved username ref, got %#v", stored)
	}
	if stored["smtpPort"] != 465 {
		t.Fatalf("expected updated port, got %#v", stored["smtpPort"])
	}
}

func TestPrepareNotificationConfigRequiresEncryptionKey(t *testing.T) {
	service := &Service{}
	_, err := service.prepareNotificationConfig("EMAIL", map[string]any{
		"smtpHost": "smtp.example.com",
		"from":     "alerts@example.com",
		"password": "x",
	}, nil)
	if err == nil || !strings.Contains(err.Error(), "RHYTHM_SECRETS_ENCRYPTION_KEY") {
		t.Fatalf("expected encryption key error, got %v", err)
	}
}

func TestRedactNotificationConfigNeverLeaksCredentials(t *testing.T) {
	redacted := redactNotificationConfig(map[string]any{
		"smtpHost":           "smtp.example.com",
		"from":               "alerts@example.com",
		"username":           "should-not-leak",
		"password":           "also-secret",
		"encryptedUsername":  "v1:user-cipher",
		"encryptedPassword":  "v1:pass-cipher",
		"usernameSecretRef":  "secret://smtp-user",
		"passwordSecretRef":  "secret://smtp-pass",
	})
	encoded, _ := json.Marshal(redacted)
	payload := string(encoded)
	for _, banned := range []string{
		"should-not-leak",
		"also-secret",
		"v1:user-cipher",
		"v1:pass-cipher",
		"encryptedUsername",
		"encryptedPassword",
	} {
		if strings.Contains(payload, banned) {
			t.Fatalf("list payload leaked %q: %s", banned, payload)
		}
	}
	if redacted["hasUsername"] != true || redacted["hasPassword"] != true {
		t.Fatalf("expected hasUsername/hasPassword markers, got %#v", redacted)
	}
	if redacted["usernameSecretRef"] != "secret://smtp-user" {
		t.Fatalf("secret refs should remain visible as aliases: %#v", redacted)
	}
	if redacted["smtpHost"] != "smtp.example.com" {
		t.Fatalf("non-secret fields should remain: %#v", redacted)
	}
}

func TestRedactNotificationConfigNoAuth(t *testing.T) {
	redacted := redactNotificationConfig(map[string]any{
		"smtpHost": "smtp.freesmtpservers.com",
		"from":     "alerts@rhythm.local",
	})
	if _, exists := redacted["hasUsername"]; exists {
		t.Fatal("unauthenticated channel should not set hasUsername")
	}
	if _, exists := redacted["hasPassword"]; exists {
		t.Fatal("unauthenticated channel should not set hasPassword")
	}
}

func TestPrepareWebhookNotificationConfigEncryptsURL(t *testing.T) {
	service := &Service{secretsKey: localTestKey(t)}
	stored, err := service.prepareNotificationConfig("WEBHOOK", map[string]any{
		"url": "https://hooks.example.com/incoming",
	}, nil)
	if err != nil {
		t.Fatalf("prepare: %v", err)
	}
	if _, exists := stored["url"]; exists {
		t.Fatal("plaintext url must not be persisted")
	}
	cipher, _ := stored["encryptedUrl"].(string)
	if cipher == "" {
		t.Fatalf("expected encryptedUrl, got %#v", stored)
	}
	plain, err := secretscrypto.Decrypt(service.secretsKey, cipher)
	if err != nil || plain != "https://hooks.example.com/incoming" {
		t.Fatalf("url round-trip failed: %v %q", err, plain)
	}
	if err := validateNotification("WEBHOOK", stored); err != nil {
		t.Fatalf("prepared webhook should validate: %v", err)
	}
}

func TestPrepareWebhookNotificationConfigKeepsSecretRef(t *testing.T) {
	service := &Service{secretsKey: localTestKey(t)}
	stored, err := service.prepareNotificationConfig("SLACK", map[string]any{
		"urlSecretRef": "slack-webhook",
	}, nil)
	if err != nil {
		t.Fatalf("prepare: %v", err)
	}
	if stored["urlSecretRef"] != "secret://slack-webhook" {
		t.Fatalf("url ref: %#v", stored["urlSecretRef"])
	}
}

func TestRedactNotificationConfigWebhook(t *testing.T) {
	redacted := redactNotificationConfig(map[string]any{
		"url":          "https://should-not-leak",
		"encryptedUrl": "v1:url-cipher",
		"urlSecretRef": "secret://slack-webhook",
	})
	encoded, _ := json.Marshal(redacted)
	payload := string(encoded)
	for _, banned := range []string{"https://should-not-leak", "v1:url-cipher", "encryptedUrl"} {
		if strings.Contains(payload, banned) {
			t.Fatalf("webhook payload leaked %q: %s", banned, payload)
		}
	}
	if redacted["hasUrl"] != true {
		t.Fatalf("expected hasUrl, got %#v", redacted)
	}
	if redacted["urlSecretRef"] != "secret://slack-webhook" {
		t.Fatalf("secret refs should remain visible: %#v", redacted)
	}
}
