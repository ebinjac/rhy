package library

import "testing"

func TestPrepareProxyConfigNormalizesRoutingAndSecrets(t *testing.T) {
	config, profileType, err := prepareProxyConfig(map[string]any{
		"url":               "https://Proxy.Example.com:8443/",
		"noProxy":           " localhost, *.Internal,\nlocalhost ",
		"usernameSecretRef": "proxy-user",
		"passwordSecretRef": "secret://proxy-password",
	})
	if err != nil {
		t.Fatalf("prepare proxy: %v", err)
	}
	if profileType != "HTTPS" || config["host"] != "proxy.example.com" || config["port"] != "8443" {
		t.Fatalf("unexpected proxy metadata: %#v", config)
	}
	if config["usernameSecretRef"] != "secret://proxy-user" || config["noProxyCount"] != 2 {
		t.Fatalf("proxy references or bypass rules were not normalized: %#v", config)
	}
}

func TestPrepareProxyConfigRejectsCredentialsInURL(t *testing.T) {
	_, _, err := prepareProxyConfig(map[string]any{"url": "http://user:password@proxy.example.com:8080"})
	if err == nil {
		t.Fatal("expected URL credentials to be rejected")
	}
}

func TestPrepareProxyConfigRejectsInvalidBypassRules(t *testing.T) {
	_, _, err := prepareProxyConfig(map[string]any{
		"url":     "socks5://proxy.example.com:1080",
		"noProxy": "https://internal.example.com",
	})
	if err == nil {
		t.Fatal("expected URL-shaped no-proxy rule to be rejected")
	}
}
