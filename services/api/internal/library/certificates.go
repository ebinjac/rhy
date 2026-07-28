package library

import (
	"bytes"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"encoding/base64"
	"encoding/hex"
	"encoding/pem"
	"errors"
	"fmt"
	"path/filepath"
	"sort"
	"strings"
	"time"

	keystore "github.com/pavlo-v-chernykh/keystore-go/v4"
	"github.com/smallstep/pkcs7"
	"software.sslmate.com/src/go-pkcs12"

	"github.com/rhythm-monitoring/rhythm/internal/secretscrypto"
)

const maxCertificateSourceBytes = 10 << 20

type certificateMaterial struct {
	clientCertificatePEM string
	clientKeyPEM         string
	caBundlePEM          string
	certificates         []*x509.Certificate
	sourceFormat         string
	sourceNames          []string
	alias                string
}

func (s *Service) prepareCertificateConfig(config, existing map[string]any) (map[string]any, error) {
	purpose := strings.ToUpper(firstString(config, "purpose"))
	if purpose == "" {
		purpose = "CLIENT_IDENTITY"
	}
	switch purpose {
	case "CLIENT_IDENTITY", "TRUST_BUNDLE", "COMBINED":
	default:
		return nil, errors.New("certificate purpose must be CLIENT_IDENTITY, TRUST_BUNDLE, or COMBINED")
	}

	material, hasUpload, err := parseCertificateUpload(config)
	if err != nil {
		return nil, err
	}
	if !hasUpload {
		if existing == nil {
			legacy := normalizeLegacyCertificateReferences(config)
			if len(legacy) == 0 {
				return nil, errors.New("select a PEM, CRT, CER, DER, P7B, P7C, P12, PFX, or JKS file")
			}
			legacy["purpose"] = purpose
			return legacy, nil
		}
		return mergeCertificateMetadata(existing, config, purpose), nil
	}
	if len(s.secretsKey) == 0 {
		return nil, errors.New("certificate uploads require RHYTHM_SECRETS_ENCRYPTION_KEY")
	}
	if len(material.certificates) == 0 {
		return nil, errors.New("the uploaded files do not contain an X.509 certificate")
	}
	if purpose == "CLIENT_IDENTITY" && (material.clientCertificatePEM == "" || material.clientKeyPEM == "") {
		return nil, errors.New("client identity profiles require both a certificate and its private key")
	}
	if purpose == "TRUST_BUNDLE" && material.caBundlePEM == "" {
		// A certificate-only upload is a valid trust anchor.
		material.caBundlePEM = material.clientCertificatePEM
		material.clientCertificatePEM = ""
	}
	if material.clientKeyPEM != "" {
		if material.clientCertificatePEM == "" {
			return nil, errors.New("a private key was supplied without a client certificate")
		}
		if _, err := tls.X509KeyPair([]byte(material.clientCertificatePEM), []byte(material.clientKeyPEM)); err != nil {
			return nil, fmt.Errorf("private key does not match the client certificate: %w", err)
		}
	}

	prepared := certificateMetadata(material, purpose)
	for field, plaintext := range map[string]string{
		"encryptedClientCertificatePEM": material.clientCertificatePEM,
		"encryptedClientKeyPEM":         material.clientKeyPEM,
		"encryptedCABundlePEM":          material.caBundlePEM,
	} {
		if plaintext == "" {
			continue
		}
		ciphertext, err := secretscrypto.Encrypt(s.secretsKey, plaintext)
		if err != nil {
			return nil, fmt.Errorf("encrypt certificate material: %w", err)
		}
		prepared[field] = ciphertext
	}
	return prepared, nil
}

func normalizeLegacyCertificateReferences(config map[string]any) map[string]any {
	normalized := map[string]any{}
	for target, aliases := range map[string][]string{
		"clientCertSecretRef": {"clientCertSecretRef", "certificateSecretRef"},
		"clientKeySecretRef":  {"clientKeySecretRef", "privateKeySecretRef"},
		"caBundleSecretRef":   {"caBundleSecretRef", "caSecretRef"},
	} {
		if value := firstString(config, aliases...); value != "" {
			normalized[target] = value
		}
	}
	return normalized
}

func mergeCertificateMetadata(existing, input map[string]any, purpose string) map[string]any {
	merged := make(map[string]any, len(existing)+2)
	for key, value := range existing {
		merged[key] = value
	}
	merged["purpose"] = purpose
	if alias := firstString(input, "alias"); alias != "" {
		merged["alias"] = alias
	}
	return merged
}

func parseCertificateUpload(config map[string]any) (certificateMaterial, bool, error) {
	var result certificateMaterial
	password := firstString(config, "password")
	keyPassword := firstString(config, "keyPassword")
	if keyPassword == "" {
		keyPassword = password
	}
	alias := firstString(config, "alias")

	source, hasSource, err := decodeCertificateFile(config["source"])
	if err != nil {
		return result, true, err
	}
	privateKey, hasPrivateKey, err := decodeCertificateFile(config["privateKey"])
	if err != nil {
		return result, true, err
	}
	caBundle, hasCABundle, err := decodeCertificateFile(config["caBundle"])
	if err != nil {
		return result, true, err
	}
	if !hasSource && !hasPrivateKey && !hasCABundle {
		return result, false, nil
	}
	if hasSource {
		extension := strings.ToLower(filepath.Ext(source.name))
		switch extension {
		case ".p12", ".pfx":
			result, err = parsePKCS12(source.data, password)
			result.sourceFormat = "PKCS12"
		case ".p7b", ".p7c":
			result, err = parsePKCS7(source.data)
			result.sourceFormat = "PKCS7"
		case ".jks", ".keystore":
			result, err = parseJKS(source.data, password, keyPassword, alias)
			result.sourceFormat = "JKS"
		default:
			result, err = parsePEMorDER(source.data)
			result.sourceFormat = detectCertificateFormat(source.data, extension)
		}
		if err != nil {
			return certificateMaterial{}, true, fmt.Errorf("%s: %w", source.name, err)
		}
		result.sourceNames = append(result.sourceNames, source.name)
	}
	if hasPrivateKey {
		keyPEM, keyErr := normalizePrivateKey(privateKey.data)
		if keyErr != nil {
			return certificateMaterial{}, true, fmt.Errorf("%s: %w", privateKey.name, keyErr)
		}
		result.clientKeyPEM = keyPEM
		result.sourceNames = append(result.sourceNames, privateKey.name)
	}
	if hasCABundle {
		caMaterial, caErr := parsePEMorDER(caBundle.data)
		if caErr != nil {
			return certificateMaterial{}, true, fmt.Errorf("%s: %w", caBundle.name, caErr)
		}
		caPEM := caMaterial.clientCertificatePEM + caMaterial.caBundlePEM
		result.caBundlePEM += caPEM
		result.certificates = append(result.certificates, caMaterial.certificates...)
		result.sourceNames = append(result.sourceNames, caBundle.name)
	}
	result.alias = alias
	return result, true, nil
}

func parsePKCS7(data []byte) (certificateMaterial, error) {
	if block, _ := pem.Decode(data); block != nil {
		data = block.Bytes
	}
	container, err := pkcs7.Parse(data)
	if err != nil || len(container.Certificates) == 0 {
		return certificateMaterial{}, errors.New("PKCS#7 bundle does not contain a usable certificate")
	}
	result := certificateMaterial{certificates: container.Certificates}
	for index, certificate := range container.Certificates {
		encoded := string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: certificate.Raw}))
		if index == 0 {
			result.clientCertificatePEM = encoded
		} else {
			result.caBundlePEM += encoded
		}
	}
	return result, nil
}

type certificateFile struct {
	name string
	data []byte
}

func decodeCertificateFile(value any) (certificateFile, bool, error) {
	entry, ok := value.(map[string]any)
	if !ok || entry == nil {
		return certificateFile{}, false, nil
	}
	name := strings.TrimSpace(fmt.Sprint(entry["name"]))
	encoded := strings.TrimSpace(fmt.Sprint(entry["contentBase64"]))
	if name == "" || encoded == "" || encoded == "<nil>" {
		return certificateFile{}, false, errors.New("uploaded file name and content are required")
	}
	data, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		return certificateFile{}, true, errors.New("uploaded file is not valid base64")
	}
	if len(data) == 0 || len(data) > maxCertificateSourceBytes {
		return certificateFile{}, true, fmt.Errorf("uploaded file must be between 1 byte and %d MB", maxCertificateSourceBytes>>20)
	}
	return certificateFile{name: name, data: data}, true, nil
}

func parsePKCS12(data []byte, password string) (certificateMaterial, error) {
	privateKey, leaf, chain, err := pkcs12.DecodeChain(data, password)
	if err != nil {
		trusted, trustErr := pkcs12.DecodeTrustStore(data, password)
		if trustErr != nil || len(trusted) == 0 {
			return certificateMaterial{}, errors.New("unable to open PKCS#12 container; check its password")
		}
		result := certificateMaterial{certificates: trusted}
		for _, certificate := range trusted {
			result.caBundlePEM += string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: certificate.Raw}))
		}
		return result, nil
	}
	keyDER, err := x509.MarshalPKCS8PrivateKey(privateKey)
	if err != nil {
		return certificateMaterial{}, errors.New("PKCS#12 private key is unsupported")
	}
	result := certificateMaterial{
		clientCertificatePEM: string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: leaf.Raw})),
		clientKeyPEM:         string(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: keyDER})),
		certificates:         append([]*x509.Certificate{leaf}, chain...),
	}
	for _, certificate := range chain {
		result.caBundlePEM += string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: certificate.Raw}))
	}
	return result, nil
}

func parseJKS(data []byte, password, keyPassword, requestedAlias string) (certificateMaterial, error) {
	store := keystore.New()
	if err := store.Load(bytes.NewReader(data), []byte(password)); err != nil {
		return certificateMaterial{}, errors.New("unable to open JKS keystore; check its password")
	}
	aliases := store.Aliases()
	sort.Strings(aliases)
	if requestedAlias != "" {
		aliases = []string{requestedAlias}
	}
	result := certificateMaterial{alias: requestedAlias}
	for _, alias := range aliases {
		if store.IsPrivateKeyEntry(alias) && result.clientKeyPEM == "" {
			entry, err := store.GetPrivateKeyEntry(alias, []byte(keyPassword))
			if err != nil {
				return certificateMaterial{}, fmt.Errorf("unable to unlock JKS alias %q; check its key password", alias)
			}
			keyPEM, err := normalizePrivateKey(entry.PrivateKey)
			if err != nil {
				return certificateMaterial{}, fmt.Errorf("JKS alias %q: %w", alias, err)
			}
			result.clientKeyPEM = keyPEM
			for index, stored := range entry.CertificateChain {
				certificate, err := x509.ParseCertificate(stored.Content)
				if err != nil {
					return certificateMaterial{}, fmt.Errorf("JKS alias %q contains an invalid certificate", alias)
				}
				encoded := string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: certificate.Raw}))
				if index == 0 {
					result.clientCertificatePEM = encoded
				} else {
					result.caBundlePEM += encoded
				}
				result.certificates = append(result.certificates, certificate)
			}
			result.alias = alias
			continue
		}
		if store.IsTrustedCertificateEntry(alias) {
			entry, err := store.GetTrustedCertificateEntry(alias)
			if err != nil {
				return certificateMaterial{}, fmt.Errorf("unable to read JKS alias %q", alias)
			}
			certificate, err := x509.ParseCertificate(entry.Certificate.Content)
			if err != nil {
				return certificateMaterial{}, fmt.Errorf("JKS alias %q contains an invalid certificate", alias)
			}
			result.caBundlePEM += string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: certificate.Raw}))
			result.certificates = append(result.certificates, certificate)
		}
	}
	if len(result.certificates) == 0 {
		return certificateMaterial{}, errors.New("JKS keystore does not contain a usable certificate")
	}
	return result, nil
}

func parsePEMorDER(data []byte) (certificateMaterial, error) {
	var result certificateMaterial
	remaining := data
	for {
		block, rest := pem.Decode(remaining)
		if block == nil {
			break
		}
		remaining = rest
		switch block.Type {
		case "CERTIFICATE":
			certificate, err := x509.ParseCertificate(block.Bytes)
			if err != nil {
				return certificateMaterial{}, errors.New("PEM contains an invalid X.509 certificate")
			}
			encoded := string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: certificate.Raw}))
			if result.clientCertificatePEM == "" {
				result.clientCertificatePEM = encoded
			} else {
				result.caBundlePEM += encoded
			}
			result.certificates = append(result.certificates, certificate)
		default:
			if strings.Contains(block.Type, "PRIVATE KEY") {
				keyPEM, err := normalizePrivateKey(block.Bytes)
				if err != nil {
					return certificateMaterial{}, err
				}
				result.clientKeyPEM = keyPEM
			}
		}
	}
	if len(result.certificates) == 0 {
		certificate, err := x509.ParseCertificate(data)
		if err != nil {
			return certificateMaterial{}, errors.New("file is neither valid PEM nor a DER X.509 certificate")
		}
		result.clientCertificatePEM = string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: certificate.Raw}))
		result.certificates = append(result.certificates, certificate)
	}
	return result, nil
}

func normalizePrivateKey(data []byte) (string, error) {
	if block, _ := pem.Decode(data); block != nil {
		data = block.Bytes
	}
	var key any
	var err error
	if key, err = x509.ParsePKCS8PrivateKey(data); err != nil {
		if rsaKey, rsaErr := x509.ParsePKCS1PrivateKey(data); rsaErr == nil {
			key = rsaKey
		} else if ecKey, ecErr := x509.ParseECPrivateKey(data); ecErr == nil {
			key = ecKey
		} else {
			return "", errors.New("private key must be PKCS#1, PKCS#8, or EC")
		}
	}
	der, err := x509.MarshalPKCS8PrivateKey(key)
	if err != nil {
		return "", errors.New("private key type is unsupported")
	}
	return string(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der})), nil
}

func detectCertificateFormat(data []byte, extension string) string {
	if block, _ := pem.Decode(data); block != nil {
		return "PEM"
	}
	if extension == ".crt" || extension == ".cer" {
		return "X509"
	}
	return "DER"
}

func certificateMetadata(material certificateMaterial, purpose string) map[string]any {
	leaf := material.certificates[0]
	fingerprint := sha256.Sum256(leaf.Raw)
	names := append([]string(nil), material.sourceNames...)
	sort.Strings(names)
	return map[string]any{
		"purpose":           purpose,
		"sourceFormat":      material.sourceFormat,
		"sourceNames":       names,
		"alias":             material.alias,
		"certificateCount":  len(material.certificates),
		"subject":           leaf.Subject.String(),
		"issuer":            leaf.Issuer.String(),
		"serialNumber":      leaf.SerialNumber.Text(16),
		"dnsNames":          leaf.DNSNames,
		"notBefore":         leaf.NotBefore.UTC().Format(time.RFC3339),
		"notAfter":          leaf.NotAfter.UTC().Format(time.RFC3339),
		"daysUntilExpiry":   int(time.Until(leaf.NotAfter).Hours() / 24),
		"fingerprintSHA256": strings.ToUpper(hex.EncodeToString(fingerprint[:])),
		"keyAlgorithm":      leaf.PublicKeyAlgorithm.String(),
		"hasClientIdentity": material.clientCertificatePEM != "" && material.clientKeyPEM != "",
		"hasTrustBundle":    material.caBundlePEM != "",
		"encryptedAtRest":   true,
	}
}

func redactCertificateConfig(config map[string]any) map[string]any {
	redacted := make(map[string]any, len(config))
	hasMaterial := false
	for key, value := range config {
		if strings.HasPrefix(strings.ToLower(key), "encrypted") || strings.Contains(strings.ToLower(key), "password") {
			hasMaterial = true
			continue
		}
		redacted[key] = value
	}
	redacted["hasStoredMaterial"] = hasMaterial
	redacted["cipher"] = "AES-GCM"
	return redacted
}
