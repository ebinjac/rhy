package secretscrypto

import (
	"encoding/base64"
	"strings"
	"testing"
)

func testKey(t *testing.T) []byte {
	t.Helper()
	key, err := ParseKey(base64.StdEncoding.EncodeToString([]byte("0123456789abcdef0123456789abcdef")))
	if err != nil {
		t.Fatalf("parse key: %v", err)
	}
	return key
}

func TestEncryptDecryptRoundTrip(t *testing.T) {
	key := testKey(t)
	const plaintext = "super-secret-token-⚡"
	ciphertext, err := Encrypt(key, plaintext)
	if err != nil {
		t.Fatalf("encrypt: %v", err)
	}
	if !strings.HasPrefix(ciphertext, VersionPrefix) {
		t.Fatalf("missing version prefix: %q", ciphertext)
	}
	if strings.Contains(ciphertext, plaintext) {
		t.Fatal("ciphertext unexpectedly contains plaintext")
	}
	got, err := Decrypt(key, ciphertext)
	if err != nil {
		t.Fatalf("decrypt: %v", err)
	}
	if got != plaintext {
		t.Fatalf("got %q want %q", got, plaintext)
	}
}

func TestEncryptProducesUniqueCiphertext(t *testing.T) {
	key := testKey(t)
	a, err := Encrypt(key, "same")
	if err != nil {
		t.Fatal(err)
	}
	b, err := Encrypt(key, "same")
	if err != nil {
		t.Fatal(err)
	}
	if a == b {
		t.Fatal("expected unique nonces to produce different ciphertext")
	}
}

func TestDecryptRejectsTampering(t *testing.T) {
	key := testKey(t)
	ciphertext, err := Encrypt(key, "value")
	if err != nil {
		t.Fatal(err)
	}
	tampered := ciphertext[:len(ciphertext)-1] + "A"
	if _, err := Decrypt(key, tampered); err == nil {
		t.Fatal("expected tampered ciphertext to fail")
	}
}

func TestParseKeyFormats(t *testing.T) {
	raw := []byte("0123456789abcdef0123456789abcdef")
	cases := []string{
		base64.StdEncoding.EncodeToString(raw),
		base64.RawStdEncoding.EncodeToString(raw),
		"3031323334353637383961626364656630313233343536373839616263646566",
		string(raw),
	}
	for _, input := range cases {
		key, err := ParseKey(input)
		if err != nil {
			t.Fatalf("ParseKey(%q): %v", input, err)
		}
		if len(key) != 32 {
			t.Fatalf("unexpected key length %d", len(key))
		}
	}
	if _, err := ParseKey(""); err != ErrMissingKey {
		t.Fatalf("expected ErrMissingKey, got %v", err)
	}
	if _, err := ParseKey("too-short"); err != ErrInvalidKey {
		t.Fatalf("expected ErrInvalidKey, got %v", err)
	}
}
