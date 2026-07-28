package library

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/base64"
	"encoding/pem"
	"math/big"
	"testing"
	"time"

	"github.com/smallstep/pkcs7"
	"software.sslmate.com/src/go-pkcs12"

	"github.com/rhythm-monitoring/rhythm/internal/secretscrypto"
)

func TestPrepareCertificateConfigPEMEncryptsAndRedactsMaterial(t *testing.T) {
	certificate, privateKey := testCertificate(t, "api.internal")
	service := &Service{secretsKey: localTestKey(t)}

	config, err := service.prepareCertificateConfig(map[string]any{
		"purpose": "CLIENT_IDENTITY",
		"source": encodedCertificateTestFile("client.crt", pem.EncodeToMemory(&pem.Block{
			Type: "CERTIFICATE", Bytes: certificate.Raw,
		})),
		"privateKey": encodedCertificateTestFile("client.key", pem.EncodeToMemory(&pem.Block{
			Type: "RSA PRIVATE KEY", Bytes: x509.MarshalPKCS1PrivateKey(privateKey),
		})),
	}, nil)
	if err != nil {
		t.Fatalf("prepare certificate: %v", err)
	}
	if config["sourceFormat"] != "PEM" || config["hasClientIdentity"] != true {
		t.Fatalf("unexpected metadata: %#v", config)
	}
	ciphertext := firstString(config, "encryptedClientCertificatePEM")
	plaintext, err := secretscrypto.Decrypt(service.secretsKey, ciphertext)
	if err != nil {
		t.Fatalf("decrypt certificate: %v", err)
	}
	if block, _ := pem.Decode([]byte(plaintext)); block == nil || block.Type != "CERTIFICATE" {
		t.Fatal("decrypted material is not a certificate PEM")
	}
	redacted := redactCertificateConfig(config)
	if firstString(redacted, "encryptedClientCertificatePEM", "encryptedClientKeyPEM") != "" {
		t.Fatal("redacted certificate config exposed encrypted material")
	}
	if redacted["hasStoredMaterial"] != true {
		t.Fatal("redacted profile should report stored material")
	}
}

func TestPrepareCertificateConfigSupportsDERTrustBundle(t *testing.T) {
	certificate, _ := testCertificate(t, "ca.internal")
	service := &Service{secretsKey: localTestKey(t)}
	config, err := service.prepareCertificateConfig(map[string]any{
		"purpose": "TRUST_BUNDLE",
		"source":  encodedCertificateTestFile("internal-ca.der", certificate.Raw),
	}, nil)
	if err != nil {
		t.Fatalf("prepare DER trust bundle: %v", err)
	}
	if config["sourceFormat"] != "DER" || config["hasTrustBundle"] != true {
		t.Fatalf("unexpected metadata: %#v", config)
	}
	if firstString(config, "encryptedCABundlePEM") == "" {
		t.Fatal("trust bundle was not encrypted")
	}
}

func TestPrepareCertificateConfigSupportsPKCS12(t *testing.T) {
	certificate, privateKey := testCertificate(t, "payments.internal")
	container, err := pkcs12.Modern.Encode(privateKey, certificate, nil, "changeit")
	if err != nil {
		t.Fatalf("encode PKCS#12: %v", err)
	}
	service := &Service{secretsKey: localTestKey(t)}
	config, err := service.prepareCertificateConfig(map[string]any{
		"purpose":  "CLIENT_IDENTITY",
		"password": "changeit",
		"source":   encodedCertificateTestFile("payments.p12", container),
	}, nil)
	if err != nil {
		t.Fatalf("prepare PKCS#12: %v", err)
	}
	if config["sourceFormat"] != "PKCS12" || config["hasClientIdentity"] != true {
		t.Fatalf("unexpected metadata: %#v", config)
	}
	if _, exists := config["password"]; exists {
		t.Fatal("keystore password must not be persisted")
	}
}

func TestPrepareCertificateConfigSupportsPKCS12TrustStore(t *testing.T) {
	certificate, _ := testCertificate(t, "corporate-root.internal")
	container, err := pkcs12.Modern.EncodeTrustStore([]*x509.Certificate{certificate}, "changeit")
	if err != nil {
		t.Fatalf("encode PKCS#12 trust store: %v", err)
	}
	service := &Service{secretsKey: localTestKey(t)}
	config, err := service.prepareCertificateConfig(map[string]any{
		"purpose":  "TRUST_BUNDLE",
		"password": "changeit",
		"source":   encodedCertificateTestFile("corporate-roots.p12", container),
	}, nil)
	if err != nil {
		t.Fatalf("prepare PKCS#12 trust store: %v", err)
	}
	if config["hasTrustBundle"] != true || firstString(config, "encryptedCABundlePEM") == "" {
		t.Fatalf("unexpected trust store metadata: %#v", config)
	}
}

func TestPrepareCertificateConfigSupportsPKCS7Bundle(t *testing.T) {
	certificate, _ := testCertificate(t, "pkcs7-root.internal")
	container, err := pkcs7.DegenerateCertificate(certificate.Raw)
	if err != nil {
		t.Fatalf("encode PKCS#7: %v", err)
	}
	service := &Service{secretsKey: localTestKey(t)}
	config, err := service.prepareCertificateConfig(map[string]any{
		"purpose": "TRUST_BUNDLE",
		"source":  encodedCertificateTestFile("corporate-roots.p7b", container),
	}, nil)
	if err != nil {
		t.Fatalf("prepare PKCS#7 bundle: %v", err)
	}
	if config["sourceFormat"] != "PKCS7" || config["hasTrustBundle"] != true {
		t.Fatalf("unexpected PKCS#7 metadata: %#v", config)
	}
}

func TestPrepareCertificateConfigRejectsMismatchedPrivateKey(t *testing.T) {
	certificate, _ := testCertificate(t, "api.internal")
	_, otherKey := testCertificate(t, "other.internal")
	service := &Service{secretsKey: localTestKey(t)}
	_, err := service.prepareCertificateConfig(map[string]any{
		"purpose": "CLIENT_IDENTITY",
		"source": encodedCertificateTestFile("client.crt", pem.EncodeToMemory(&pem.Block{
			Type: "CERTIFICATE", Bytes: certificate.Raw,
		})),
		"privateKey": encodedCertificateTestFile("client.key", pem.EncodeToMemory(&pem.Block{
			Type: "RSA PRIVATE KEY", Bytes: x509.MarshalPKCS1PrivateKey(otherKey),
		})),
	}, nil)
	if err == nil {
		t.Fatal("expected mismatched private key to be rejected")
	}
}

func testCertificate(t *testing.T, commonName string) (*x509.Certificate, *rsa.PrivateKey) {
	t.Helper()
	privateKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	template := &x509.Certificate{
		SerialNumber: big.NewInt(now.UnixNano()),
		Subject:      pkix.Name{CommonName: commonName},
		DNSNames:     []string{commonName},
		NotBefore:    now.Add(-time.Hour),
		NotAfter:     now.Add(90 * 24 * time.Hour),
		KeyUsage:     x509.KeyUsageDigitalSignature | x509.KeyUsageKeyEncipherment,
		ExtKeyUsage:  []x509.ExtKeyUsage{x509.ExtKeyUsageClientAuth},
	}
	der, err := x509.CreateCertificate(rand.Reader, template, template, &privateKey.PublicKey, privateKey)
	if err != nil {
		t.Fatal(err)
	}
	certificate, err := x509.ParseCertificate(der)
	if err != nil {
		t.Fatal(err)
	}
	return certificate, privateKey
}

func encodedCertificateTestFile(name string, data []byte) map[string]any {
	return map[string]any{
		"name":          name,
		"contentBase64": base64.StdEncoding.EncodeToString(data),
	}
}
