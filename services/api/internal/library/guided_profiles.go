package library

import (
	"errors"
	"fmt"
	"net/url"
	"regexp"
	"sort"
	"strings"
)

var environmentVariableName = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_.-]*$`)

func prepareEnvironmentConfig(profileType string, config map[string]any) (map[string]any, string, error) {
	stage := strings.ToUpper(strings.TrimSpace(profileType))
	if stage == "" {
		stage = "CUSTOM"
	}
	switch stage {
	case "PRODUCTION", "STAGING", "DEVELOPMENT", "TEST", "LOCAL", "CUSTOM":
	default:
		return nil, "", errors.New("environment type must be PRODUCTION, STAGING, DEVELOPMENT, TEST, LOCAL, or CUSTOM")
	}
	baseURL := strings.TrimRight(firstString(config, "baseUrl"), "/")
	if baseURL == "" {
		return nil, "", errors.New("environment base URL is required")
	}
	parsed, err := url.Parse(baseURL)
	if err != nil || parsed.Host == "" || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		return nil, "", errors.New("environment base URL must be a valid HTTP or HTTPS URL")
	}
	if parsed.User != nil {
		return nil, "", errors.New("environment base URL must not contain credentials")
	}
	variables := map[string]any{}
	if raw, ok := config["variables"].(map[string]any); ok {
		for rawKey, rawValue := range raw {
			key := strings.TrimSpace(rawKey)
			value := strings.TrimSpace(fmt.Sprint(rawValue))
			if !environmentVariableName.MatchString(key) {
				return nil, "", fmt.Errorf("environment variable %q has an invalid name", key)
			}
			if sensitiveKeyName(key) && value != "" && !strings.HasPrefix(value, "secret://") {
				return nil, "", fmt.Errorf("sensitive environment variable %q must use a secret:// reference", key)
			}
			variables[key] = value
		}
	}
	return map[string]any{
		"baseUrl":       baseURL,
		"host":          strings.ToLower(parsed.Hostname()),
		"region":        strings.TrimSpace(firstString(config, "region")),
		"variables":     variables,
		"variableCount": len(variables),
		"secretCount":   countSecretReferences(variables),
	}, stage, nil
}

func prepareAuthConfig(profileType string, config map[string]any) (map[string]any, string, error) {
	authType := strings.ToUpper(strings.ReplaceAll(strings.TrimSpace(profileType), "-", "_"))
	switch authType {
	case "BASIC":
		username, err := requiredSecretRef(config, "usernameSecretRef", "username")
		if err != nil {
			return nil, "", err
		}
		password, err := requiredSecretRef(config, "passwordSecretRef", "password")
		if err != nil {
			return nil, "", err
		}
		return authSummary(authType, map[string]any{"usernameSecretRef": username, "passwordSecretRef": password}), authType, nil
	case "BEARER":
		token, err := requiredSecretRef(config, "tokenSecretRef", "token")
		if err != nil {
			return nil, "", err
		}
		return authSummary(authType, map[string]any{"tokenSecretRef": token}), authType, nil
	case "API_KEY":
		name := strings.TrimSpace(firstString(config, "name"))
		if name == "" {
			return nil, "", errors.New("API key header or query name is required")
		}
		location := strings.ToLower(firstString(config, "location"))
		if location == "" {
			location = "header"
		}
		if location != "header" && location != "query" {
			return nil, "", errors.New("API key location must be header or query")
		}
		value, err := requiredSecretRef(config, "valueSecretRef", "API key value")
		if err != nil {
			return nil, "", err
		}
		return authSummary(authType, map[string]any{"name": name, "location": location, "valueSecretRef": value}), authType, nil
	case "OAUTH2":
		tokenURL := strings.TrimSpace(firstString(config, "tokenUrl"))
		parsed, err := url.Parse(tokenURL)
		if err != nil || parsed.Host == "" || (parsed.Scheme != "http" && parsed.Scheme != "https") {
			return nil, "", errors.New("OAuth token URL must be a valid HTTP or HTTPS URL")
		}
		clientID := strings.TrimSpace(firstString(config, "clientId"))
		if clientID == "" {
			return nil, "", errors.New("OAuth client ID is required")
		}
		clientSecret, err := requiredSecretRef(config, "clientSecretRef", "OAuth client secret")
		if err != nil {
			return nil, "", err
		}
		return authSummary(authType, map[string]any{"tokenUrl": tokenURL, "clientId": clientID, "clientSecretRef": clientSecret, "scope": strings.TrimSpace(firstString(config, "scope"))}), authType, nil
	case "JWT":
		issuer := strings.TrimSpace(firstString(config, "issuer"))
		audience := strings.TrimSpace(firstString(config, "audience"))
		if issuer == "" || audience == "" {
			return nil, "", errors.New("JWT issuer and audience are required")
		}
		keyRef, err := requiredSecretRef(config, "keySecretRef", "JWT signing key")
		if err != nil {
			return nil, "", err
		}
		algorithm := strings.ToUpper(firstString(config, "algorithm"))
		if algorithm == "" {
			algorithm = "RS256"
		}
		if algorithm != "RS256" && algorithm != "HS256" {
			return nil, "", errors.New("JWT algorithm must be RS256 or HS256")
		}
		return authSummary(authType, map[string]any{"issuer": issuer, "audience": audience, "keySecretRef": keyRef, "algorithm": algorithm}), authType, nil
	case "HMAC":
		secretRef, err := requiredSecretRef(config, "secretRef", "HMAC secret")
		if err != nil {
			return nil, "", err
		}
		algorithm := strings.ToUpper(firstString(config, "algorithm"))
		if algorithm == "" {
			algorithm = "SHA-256"
		}
		if algorithm != "SHA-256" && algorithm != "SHA-512" {
			return nil, "", errors.New("HMAC algorithm must be SHA-256 or SHA-512")
		}
		outputHeader := strings.TrimSpace(firstString(config, "outputHeader"))
		if outputHeader == "" {
			outputHeader = "X-Signature"
		}
		return authSummary(authType, map[string]any{"secretRef": secretRef, "algorithm": algorithm, "outputHeader": outputHeader, "canonicalTemplate": firstString(config, "canonicalTemplate")}), authType, nil
	default:
		return nil, "", errors.New("authentication type must be BASIC, BEARER, API_KEY, OAUTH2, JWT, or HMAC")
	}
}

func prepareTelemetryConfig(profileType string, config map[string]any) (map[string]any, string, error) {
	provider := strings.ToUpper(strings.TrimSpace(profileType))
	if provider != "DYNATRACE" {
		return nil, "", errors.New("telemetry profile type must be DYNATRACE")
	}
	baseURL := strings.TrimRight(firstString(config, "baseUrl"), "/")
	parsed, err := url.Parse(baseURL)
	if err != nil || parsed.Host == "" || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		return nil, "", errors.New("Dynatrace base URL must be a valid HTTP or HTTPS URL")
	}
	if parsed.User != nil {
		return nil, "", errors.New("Dynatrace base URL must not contain credentials")
	}
	tokenRef, err := requiredSecretRef(config, "tokenSecretRef", "Dynatrace API token")
	if err != nil {
		return nil, "", err
	}
	defaultSelector := strings.TrimSpace(firstString(config, "defaultMetricSelector"))
	if len(defaultSelector) > 1000 {
		return nil, "", errors.New("default metric selector is too long")
	}
	return map[string]any{
		"baseUrl":               baseURL,
		"host":                  strings.ToLower(parsed.Hostname()),
		"tokenSecretRef":        tokenRef,
		"defaultMetricSelector": defaultSelector,
		"defaultWindow":         defaultProfileValue(firstString(config, "defaultWindow"), "10m"),
		"defaultResolution":     defaultProfileValue(firstString(config, "defaultResolution"), "1m"),
	}, provider, nil
}

func requiredSecretRef(config map[string]any, key, label string) (string, error) {
	value := strings.TrimSpace(firstString(config, key))
	if value == "" {
		return "", fmt.Errorf("%s secret reference is required", label)
	}
	if !strings.HasPrefix(value, "secret://") {
		value = "secret://" + value
	}
	alias := strings.TrimSpace(strings.TrimPrefix(value, "secret://"))
	if alias == "" || strings.ContainsAny(alias, " \t\r\n") {
		return "", fmt.Errorf("%s must be a valid secret:// alias", label)
	}
	return "secret://" + alias, nil
}

func authSummary(authType string, fields map[string]any) map[string]any {
	fields["secretCount"] = countSecretReferences(fields)
	fields["authType"] = authType
	keys := make([]string, 0, len(fields))
	for key := range fields {
		if key != "authType" {
			keys = append(keys, key)
		}
	}
	sort.Strings(keys)
	fields["configuredFields"] = keys
	fields["secretBacked"] = true
	return fields
}

func sensitiveKeyName(key string) bool {
	lower := strings.ToLower(key)
	for _, fragment := range []string{"password", "secret", "token", "credential", "private_key", "apikey", "api_key"} {
		if strings.Contains(lower, fragment) {
			return true
		}
	}
	return false
}

func countSecretReferences(values map[string]any) int {
	count := 0
	for _, value := range values {
		if strings.HasPrefix(strings.TrimSpace(fmt.Sprint(value)), "secret://") {
			count++
		}
	}
	return count
}

func defaultProfileValue(value, fallback string) string {
	if strings.TrimSpace(value) == "" {
		return fallback
	}
	return strings.TrimSpace(value)
}
