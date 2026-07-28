package library

import (
	"errors"
	"fmt"
	"net"
	"net/url"
	"sort"
	"strings"
)

func prepareProxyConfig(config map[string]any) (map[string]any, string, error) {
	rawURL := strings.TrimSpace(firstString(config, "url"))
	if rawURL == "" {
		return nil, "", errors.New("proxy URL is required")
	}
	parsed, err := url.Parse(rawURL)
	if err != nil || parsed.Host == "" {
		return nil, "", errors.New("proxy URL must include a scheme and host")
	}
	scheme := strings.ToLower(parsed.Scheme)
	switch scheme {
	case "http", "https", "socks5", "socks5h":
	default:
		return nil, "", errors.New("proxy URL must use http, https, socks5, or socks5h")
	}
	if parsed.User != nil {
		return nil, "", errors.New("proxy URL must not contain credentials; select secret aliases instead")
	}
	if parsed.RawQuery != "" || parsed.Fragment != "" {
		return nil, "", errors.New("proxy URL must not contain a query string or fragment")
	}
	if parsed.Path != "" && parsed.Path != "/" {
		return nil, "", errors.New("proxy URL must not contain a path")
	}
	if port := parsed.Port(); port != "" {
		if _, err := net.LookupPort("tcp", port); err != nil {
			return nil, "", errors.New("proxy URL contains an invalid port")
		}
	}
	parsed.Path = ""

	usernameRef, err := normalizeProxySecretReference(firstString(config, "usernameSecretRef"))
	if err != nil {
		return nil, "", fmt.Errorf("username secret: %w", err)
	}
	passwordRef, err := normalizeProxySecretReference(firstString(config, "passwordSecretRef"))
	if err != nil {
		return nil, "", fmt.Errorf("password secret: %w", err)
	}
	if firstString(config, "username", "password") != "" {
		return nil, "", errors.New("raw proxy credentials are not accepted; select secret aliases instead")
	}
	bypass, err := normalizeNoProxy(firstString(config, "noProxy"))
	if err != nil {
		return nil, "", err
	}

	host := strings.ToLower(parsed.Hostname())
	port := parsed.Port()
	if port == "" {
		switch scheme {
		case "https":
			port = "443"
		case "socks5", "socks5h":
			port = "1080"
		default:
			port = "80"
		}
	}
	prepared := map[string]any{
		"url":               parsed.String(),
		"scheme":            strings.ToUpper(scheme),
		"host":              host,
		"port":              port,
		"noProxy":           strings.Join(bypass, ", "),
		"noProxyRules":      bypass,
		"noProxyCount":      len(bypass),
		"authConfigured":    usernameRef != "" || passwordRef != "",
		"usernameSecretRef": usernameRef,
		"passwordSecretRef": passwordRef,
	}
	return prepared, strings.ToUpper(scheme), nil
}

func normalizeProxySecretReference(reference string) (string, error) {
	reference = strings.TrimSpace(reference)
	if reference == "" {
		return "", nil
	}
	if !strings.HasPrefix(reference, "secret://") {
		reference = "secret://" + reference
	}
	alias := strings.TrimSpace(strings.TrimPrefix(reference, "secret://"))
	if alias == "" || strings.ContainsAny(alias, " \t\r\n") {
		return "", errors.New("reference must be a secret:// alias without whitespace")
	}
	return "secret://" + alias, nil
}

func normalizeNoProxy(value string) ([]string, error) {
	seen := map[string]bool{}
	rules := make([]string, 0)
	for _, raw := range strings.FieldsFunc(value, func(character rune) bool {
		return character == ',' || character == '\n' || character == '\r'
	}) {
		rule := strings.ToLower(strings.TrimSpace(raw))
		if rule == "" || seen[rule] {
			continue
		}
		if strings.ContainsAny(rule, " /@") || strings.Contains(rule, "://") {
			return nil, fmt.Errorf("no-proxy rule %q must be a hostname, IP address, wildcard domain, or *", rule)
		}
		if strings.HasPrefix(rule, "*.") && len(rule) <= 2 {
			return nil, errors.New("wildcard no-proxy rules require a domain, for example *.internal")
		}
		seen[rule] = true
		rules = append(rules, rule)
	}
	sort.Strings(rules)
	return rules, nil
}
