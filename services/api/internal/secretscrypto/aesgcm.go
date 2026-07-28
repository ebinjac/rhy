package secretscrypto

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"strings"
)

const (
	// VersionPrefix tags ciphertext so future algorithms can coexist.
	VersionPrefix = "v1:"
	keySize       = 32
)

var (
	ErrMissingKey     = errors.New("secrets encryption key is not configured")
	ErrInvalidKey     = errors.New("secrets encryption key must be 32 bytes (base64 or hex)")
	ErrInvalidCipher  = errors.New("ciphertext is invalid or corrupted")
	ErrUnsupportedVer = errors.New("unsupported ciphertext version")
)

// ParseKey accepts a 32-byte AES key as standard/raw base64 or 64-char hex.
func ParseKey(raw string) ([]byte, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, ErrMissingKey
	}
	if decoded, err := base64.StdEncoding.DecodeString(raw); err == nil && len(decoded) == keySize {
		return decoded, nil
	}
	if decoded, err := base64.RawStdEncoding.DecodeString(raw); err == nil && len(decoded) == keySize {
		return decoded, nil
	}
	if decoded, err := hex.DecodeString(raw); err == nil && len(decoded) == keySize {
		return decoded, nil
	}
	if len(raw) == keySize {
		return []byte(raw), nil
	}
	return nil, ErrInvalidKey
}

// Encrypt seals plaintext with AES-256-GCM and returns VersionPrefix + base64(nonce|ciphertext).
func Encrypt(key []byte, plaintext string) (string, error) {
	if len(key) != keySize {
		return "", ErrInvalidKey
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", err
	}
	sealed := gcm.Seal(nonce, nonce, []byte(plaintext), nil)
	return VersionPrefix + base64.StdEncoding.EncodeToString(sealed), nil
}

// Decrypt opens a VersionPrefix + base64 AES-GCM payload produced by Encrypt.
func Decrypt(key []byte, ciphertext string) (string, error) {
	if len(key) != keySize {
		return "", ErrInvalidKey
	}
	ciphertext = strings.TrimSpace(ciphertext)
	if !strings.HasPrefix(ciphertext, VersionPrefix) {
		return "", ErrUnsupportedVer
	}
	raw, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(ciphertext, VersionPrefix))
	if err != nil {
		return "", ErrInvalidCipher
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	nonceSize := gcm.NonceSize()
	if len(raw) < nonceSize {
		return "", ErrInvalidCipher
	}
	nonce, sealed := raw[:nonceSize], raw[nonceSize:]
	plain, err := gcm.Open(nil, nonce, sealed, nil)
	if err != nil {
		return "", fmt.Errorf("%w: %v", ErrInvalidCipher, err)
	}
	return string(plain), nil
}
