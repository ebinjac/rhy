package lab

import (
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	HTTPAddr, HTTPSAddr, MTLSAddr, SelfSignedAddr, WrongHostAddr, ProxyAddr              string
	CertDir, LogLevel, Environment                                                       string
	EnableHTTP, EnableHTTPS, EnableMTLS, EnableProxy, AdminEnabled                       bool
	Deterministic, EchoSensitive, MACReplayProtection, AllowProduction, ProxyRequireAuth bool
	TokenExpiry, MaxDelay, SignatureWindow, ReplayWindow                                 time.Duration
	MaxBodyBytes, MaxUploadBytes                                                         int64
}

func DefaultConfig() Config {
	return Config{
		HTTPAddr: ":9080", HTTPSAddr: ":9443", MTLSAddr: ":9444", SelfSignedAddr: ":9445", WrongHostAddr: ":9446", ProxyAddr: ":9081",
		CertDir: "certs/generated", LogLevel: "info", Environment: "development",
		EnableHTTP: true, EnableHTTPS: true, EnableMTLS: true, EnableProxy: true, AdminEnabled: true,
		MACReplayProtection: true,
		TokenExpiry:         300 * time.Second, MaxDelay: 120 * time.Second, SignatureWindow: 5 * time.Minute, ReplayWindow: 5 * time.Minute,
		MaxBodyBytes: 10 << 20, MaxUploadBytes: 20 << 20,
	}
}

func ConfigFromEnv() Config {
	c := DefaultConfig()
	c.HTTPAddr = ":" + env("TEST_LAB_HTTP_PORT", "9080")
	c.HTTPSAddr = ":" + env("TEST_LAB_HTTPS_PORT", "9443")
	c.MTLSAddr = ":" + env("TEST_LAB_MTLS_PORT", "9444")
	c.SelfSignedAddr = ":" + env("TEST_LAB_SELF_SIGNED_PORT", "9445")
	c.WrongHostAddr = ":" + env("TEST_LAB_WRONG_HOST_PORT", "9446")
	c.ProxyAddr = ":" + env("TEST_LAB_PROXY_PORT", "9081")
	c.CertDir = env("TEST_LAB_CERT_DIR", "certs/generated")
	c.LogLevel = env("TEST_LAB_LOG_LEVEL", "info")
	c.Environment = strings.ToLower(env("TEST_LAB_ENVIRONMENT", env("RHYTHM_ENVIRONMENT", env("RHYTHM_ENV", "development"))))
	c.EnableHTTP = envBool("TEST_LAB_ENABLE_HTTP", true)
	c.EnableHTTPS = envBool("TEST_LAB_ENABLE_HTTPS", true)
	c.EnableMTLS = envBool("TEST_LAB_ENABLE_MTLS", true)
	c.EnableProxy = envBool("TEST_LAB_ENABLE_PROXY", true)
	c.AdminEnabled = envBool("TEST_LAB_ADMIN_ENABLED", true)
	c.Deterministic = envBool("TEST_LAB_DETERMINISTIC", false)
	c.EchoSensitive = envBool("TEST_LAB_ECHO_SENSITIVE", false)
	c.MACReplayProtection = envBool("TEST_LAB_MAC_REPLAY_PROTECTION", true)
	c.ProxyRequireAuth = envBool("TEST_LAB_PROXY_REQUIRE_AUTH", false)
	c.AllowProduction = envBool("TEST_LAB_ALLOW_PRODUCTION", false)
	c.TokenExpiry = time.Duration(envInt("TEST_LAB_TOKEN_EXPIRY_SECONDS", 300)) * time.Second
	c.MaxDelay = time.Duration(envInt("TEST_LAB_MAX_DELAY_SECONDS", 120)) * time.Second
	c.SignatureWindow = time.Duration(envInt("TEST_LAB_SIGNATURE_WINDOW_SECONDS", 300)) * time.Second
	c.ReplayWindow = time.Duration(envInt("TEST_LAB_REPLAY_WINDOW_SECONDS", 300)) * time.Second
	c.MaxBodyBytes = int64(envInt("TEST_LAB_MAX_BODY_BYTES", 10<<20))
	c.MaxUploadBytes = int64(envInt("TEST_LAB_MAX_UPLOAD_BYTES", 20<<20))
	return c
}

func (c Config) Validate() error {
	if (c.Environment == "production" || c.Environment == "prod" || c.Environment == "e3") && !c.AllowProduction {
		return fmt.Errorf("Rhythm API Test Lab is disabled in production environments")
	}
	if !c.EnableHTTP && !c.EnableHTTPS && !c.EnableMTLS {
		return fmt.Errorf("at least one Test Lab listener must be enabled")
	}
	return nil
}

func env(name, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(name)); value != "" {
		return value
	}
	return fallback
}
func envBool(name string, fallback bool) bool {
	value := strings.TrimSpace(os.Getenv(name))
	if value == "" {
		return fallback
	}
	parsed, err := strconv.ParseBool(value)
	if err != nil {
		return fallback
	}
	return parsed
}
func envInt(name string, fallback int) int {
	value, err := strconv.Atoi(strings.TrimSpace(os.Getenv(name)))
	if err != nil {
		return fallback
	}
	return value
}
