package lab

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"fmt"
	"math/big"
	"net"
	"os"
	"path/filepath"
	"time"
)

type Certificates struct {
	CA, CAKey                                                                                                                                     *x509.Certificate
	CAPrivate                                                                                                                                     *rsa.PrivateKey
	ServerCert, ServerKey, ClientCert, ClientKey, InvalidClientCert, InvalidClientKey, SelfSignedCert, SelfSignedKey, WrongHostCert, WrongHostKey string
}

func EnsureCertificates(dir string) (Certificates, error) {
	if err := os.MkdirAll(dir, 0755); err != nil {
		return Certificates{}, err
	}
	paths := Certificates{ServerCert: filepath.Join(dir, "server.crt"), ServerKey: filepath.Join(dir, "server.key"), ClientCert: filepath.Join(dir, "client.crt"), ClientKey: filepath.Join(dir, "client.key"), InvalidClientCert: filepath.Join(dir, "invalid-client.crt"), InvalidClientKey: filepath.Join(dir, "invalid-client.key"), SelfSignedCert: filepath.Join(dir, "self-signed.crt"), SelfSignedKey: filepath.Join(dir, "self-signed.key"), WrongHostCert: filepath.Join(dir, "wrong-host.crt"), WrongHostKey: filepath.Join(dir, "wrong-host.key")}
	caPath, caKeyPath := filepath.Join(dir, "ca.crt"), filepath.Join(dir, "ca.key")
	if _, err := os.Stat(paths.ServerCert); err == nil {
		ca, caKey, err := loadCA(caPath, caKeyPath)
		paths.CA, paths.CAPrivate = ca, caKey
		return paths, err
	}
	now := time.Now().UTC()
	caKey, _ := rsa.GenerateKey(rand.Reader, 2048)
	caTemplate := &x509.Certificate{SerialNumber: serial(), Subject: pkix.Name{CommonName: "Rhythm Test Lab Development Root CA", Organization: []string{"TEST ONLY - NOT FOR PRODUCTION"}}, NotBefore: now.Add(-time.Hour), NotAfter: now.AddDate(5, 0, 0), IsCA: true, BasicConstraintsValid: true, KeyUsage: x509.KeyUsageCertSign | x509.KeyUsageCRLSign | x509.KeyUsageDigitalSignature}
	caDER, err := x509.CreateCertificate(rand.Reader, caTemplate, caTemplate, &caKey.PublicKey, caKey)
	if err != nil {
		return paths, err
	}
	ca, _ := x509.ParseCertificate(caDER)
	if err = writePair(caPath, caKeyPath, caDER, caKey); err != nil {
		return paths, err
	}
	if err = issue(paths.ServerCert, paths.ServerKey, "rhythm-test-lab", []string{"localhost", "rhythm-test-lab", "test-api.local"}, []net.IP{net.ParseIP("127.0.0.1"), net.ParseIP("::1")}, x509.ExtKeyUsageServerAuth, ca, caKey, now.Add(-time.Hour), now.AddDate(1, 0, 0)); err != nil {
		return paths, err
	}
	if err = issue(paths.ClientCert, paths.ClientKey, "rhythm-test-client", nil, nil, x509.ExtKeyUsageClientAuth, ca, caKey, now.Add(-time.Hour), now.AddDate(1, 0, 0)); err != nil {
		return paths, err
	}
	badKey, _ := rsa.GenerateKey(rand.Reader, 2048)
	badCA := &x509.Certificate{SerialNumber: serial(), Subject: pkix.Name{CommonName: "Untrusted Test CA"}, NotBefore: now.Add(-time.Hour), NotAfter: now.AddDate(1, 0, 0), IsCA: true, BasicConstraintsValid: true, KeyUsage: x509.KeyUsageCertSign}
	badDER, _ := x509.CreateCertificate(rand.Reader, badCA, badCA, &badKey.PublicKey, badKey)
	badCA, _ = x509.ParseCertificate(badDER)
	if err = issue(paths.InvalidClientCert, paths.InvalidClientKey, "invalid-test-client", nil, nil, x509.ExtKeyUsageClientAuth, badCA, badKey, now.Add(-time.Hour), now.AddDate(1, 0, 0)); err != nil {
		return paths, err
	}
	selfKey, _ := rsa.GenerateKey(rand.Reader, 2048)
	self := &x509.Certificate{SerialNumber: serial(), Subject: pkix.Name{CommonName: "localhost self-signed"}, DNSNames: []string{"localhost"}, IPAddresses: []net.IP{net.ParseIP("127.0.0.1")}, NotBefore: now.Add(-time.Hour), NotAfter: now.AddDate(1, 0, 0), KeyUsage: x509.KeyUsageDigitalSignature | x509.KeyUsageKeyEncipherment, ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth}}
	selfDER, _ := x509.CreateCertificate(rand.Reader, self, self, &selfKey.PublicKey, selfKey)
	if err = writePair(paths.SelfSignedCert, paths.SelfSignedKey, selfDER, selfKey); err != nil {
		return paths, err
	}
	if err = issue(paths.WrongHostCert, paths.WrongHostKey, "wrong-host.test", []string{"wrong-host.test"}, nil, x509.ExtKeyUsageServerAuth, ca, caKey, now.Add(-time.Hour), now.AddDate(1, 0, 0)); err != nil {
		return paths, err
	}
	paths.CA, paths.CAPrivate = ca, caKey
	return paths, nil
}
func issue(certPath, keyPath, cn string, dns []string, ips []net.IP, usage x509.ExtKeyUsage, ca *x509.Certificate, caKey *rsa.PrivateKey, notBefore, notAfter time.Time) error {
	key, _ := rsa.GenerateKey(rand.Reader, 2048)
	tpl := &x509.Certificate{SerialNumber: serial(), Subject: pkix.Name{CommonName: cn, Organization: []string{"TEST ONLY - NOT FOR PRODUCTION"}}, DNSNames: dns, IPAddresses: ips, NotBefore: notBefore, NotAfter: notAfter, KeyUsage: x509.KeyUsageDigitalSignature | x509.KeyUsageKeyEncipherment, ExtKeyUsage: []x509.ExtKeyUsage{usage}}
	der, err := x509.CreateCertificate(rand.Reader, tpl, ca, &key.PublicKey, caKey)
	if err != nil {
		return err
	}
	return writePair(certPath, keyPath, der, key)
}
func writePair(certPath, keyPath string, der []byte, key *rsa.PrivateKey) error {
	if err := os.WriteFile(certPath, pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der}), 0644); err != nil {
		return err
	}
	return os.WriteFile(keyPath, pem.EncodeToMemory(&pem.Block{Type: "RSA PRIVATE KEY", Bytes: x509.MarshalPKCS1PrivateKey(key)}), 0600)
}
func loadCA(certPath, keyPath string) (*x509.Certificate, *rsa.PrivateKey, error) {
	certPEM, err := os.ReadFile(certPath)
	if err != nil {
		return nil, nil, err
	}
	keyPEM, err := os.ReadFile(keyPath)
	if err != nil {
		return nil, nil, err
	}
	certBlock, _ := pem.Decode(certPEM)
	keyBlock, _ := pem.Decode(keyPEM)
	if certBlock == nil || keyBlock == nil {
		return nil, nil, fmt.Errorf("invalid generated CA")
	}
	cert, err := x509.ParseCertificate(certBlock.Bytes)
	if err != nil {
		return nil, nil, err
	}
	key, err := x509.ParsePKCS1PrivateKey(keyBlock.Bytes)
	return cert, key, err
}
func serial() *big.Int { n, _ := rand.Int(rand.Reader, new(big.Int).Lsh(big.NewInt(1), 128)); return n }
