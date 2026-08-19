package lab

import (
	"net/http"
)

type Scenario struct {
	ID       string `json:"id"`
	Method   string `json:"method"`
	Path     string `json:"path"`
	Category string `json:"category"`
	Purpose  string `json:"purpose"`
}

var scenarioCatalog = []Scenario{
	{"echo", "POST", "/api/echo", "HTTP Basics", "Inspect request method, headers, query, cookies and body"},
	{"methods", "GET", "/api/method", "HTTP Basics", "Confirm the received HTTP method"},
	{"query", "GET", "/api/query", "HTTP Basics", "Preserve duplicate, empty and encoded query values"},
	{"request-headers", "GET", "/api/headers", "HTTP Basics", "Inspect masked request headers"},
	{"basic-auth", "GET", "/auth/basic", "Authentication", "Validate Basic authentication"},
	{"bearer-auth", "GET", "/auth/bearer", "Authentication", "Validate Bearer authentication"},
	{"api-key", "GET", "/auth/api-key", "Authentication", "Validate header API key authentication"},
	{"api-key-query", "GET", "/auth/api-key-query", "Authentication", "Validate query API key authentication"},
	{"hmac-auth", "POST", "/auth/hmac", "Authentication", "Validate HMAC-SHA256 signing and timestamp freshness"},
	{"mac-auth", "POST", "/auth/mac", "Authentication", "Validate MAC canonical request signing and nonce replay"},
	{"application-token", "POST", "/auth/application-token", "Request Chaining", "Issue a short-lived dependency token"},
	{"protected-keysets", "GET", "/protected/keysets", "Request Chaining", "Consume the dependency token"},
	{"jwt-token", "POST", "/auth/jwt/token", "Authentication", "Issue an HS256 or RS256 JWT"},
	{"jwt-protected", "GET", "/auth/jwt/protected", "Authentication", "Validate JWT signature and claims"},
	{"cookie-set", "GET", "/cookies/set", "Cookies", "Set a named cookie"},
	{"cookie-read", "GET", "/cookies/read", "Cookies", "Read masked cookie evidence"},
	{"cookie-delete", "GET", "/cookies/delete", "Cookies", "Expire a named cookie"},
	{"cookie-attributes", "GET", "/cookies/attributes", "Cookies", "Set secure cookie-attribute variants"},
	{"cookie-login", "POST", "/cookies/login", "Cookies", "Create a cookie-backed authenticated session"},
	{"cookie-profile", "GET", "/cookies/profile", "Cookies", "Require the authenticated session cookie"},
	{"status", "GET", "/status/{code}", "Failures", "Return a selected HTTP status"},
	{"delay", "GET", "/delay-ms/{milliseconds}", "Latency", "Simulate bounded cancellable latency"},
	{"random-latency", "GET", "/latency/random", "Latency", "Select latency inside a bounded range"},
	{"redirect", "GET", "/redirect/{count}", "Redirects", "Create a finite redirect chain"},
	{"redirect-loop", "GET", "/redirect/loop", "Redirects", "Create an intentional redirect loop"},
	{"json", "GET", "/response/json", "Responses", "Return stable nested JSON"},
	{"deep-json", "GET", "/response/json/deep", "Responses", "Return arrays, nulls and nested JSON"},
	{"dynamic-json", "GET", "/response/json/dynamic", "Responses", "Return dynamic time, ID and numeric values"},
	{"malformed-json", "GET", "/response/malformed-json", "Responses", "Return intentionally malformed JSON"},
	{"plain-text", "GET", "/response/text", "Responses", "Return UTF-8 plain text"},
	{"xml", "GET", "/response/xml", "Responses", "Return an XML document"},
	{"response-headers", "GET", "/response/headers", "Responses", "Return extractor-friendly response headers"},
	{"regex", "GET", "/response/regex", "Responses", "Return regex-friendly transaction text"},
	{"large-response", "GET", "/response/large/{size}", "Responses", "Return a selected bounded response size"},
	{"binary", "GET", "/response/binary", "Responses", "Return binary octets"},
	{"unicode", "GET", "/response/unicode", "Responses", "Return multilingual and special-character values"},
	{"upload", "POST", "/upload", "Files", "Inspect multipart upload metadata"},
	{"form", "POST", "/form", "Files", "Inspect URL-encoded form fields"},
	{"gzip", "GET", "/compression/gzip", "Compression", "Return a gzip-encoded JSON payload"},
	{"accepted-encoding", "GET", "/compression/accepted", "Compression", "Report the received Accept-Encoding"},
	{"stream", "GET", "/stream", "HTTP Basics", "Stream bounded chunks with configurable pacing"},
	{"validate-json", "POST", "/validate/json", "Validation", "Validate a fixed request-body contract"},
	{"validate-dynamic-body", "POST", "/validate/dynamic-body", "Validation", "Validate UUID, timestamp and environment fields"},
	{"schema", "GET", "/validation/schema", "Validation", "Return JSON Schema assertion fixture data"},
	{"correlation", "GET", "/trace/correlation", "Variables", "Require and echo a correlation ID"},
	{"nonce", "GET", "/trace/nonce", "Variables", "Validate a generated request nonce"},
	{"workflow-start", "POST", "/workflow/start", "Workflows", "Start a stateful multi-step workflow"},
	{"workflow-step", "POST", "/workflow/{workflowId}/step", "Workflows", "Advance an authenticated workflow"},
	{"workflow-result", "GET", "/workflow/{workflowId}/result", "Workflows", "Inspect workflow completion"},
	{"chain-start", "POST", "/chain/start", "Request Chaining", "Start a dependency chain"},
	{"chain-token", "GET", "/chain/token", "Request Chaining", "Issue a chain token"},
	{"chain-session", "GET", "/chain/session", "Request Chaining", "Exchange a token for a chain session"},
	{"chain-protected", "GET", "/chain/protected", "Request Chaining", "Validate all chained values"},
	{"rate-limit", "GET", "/rate-limit", "Failures", "Return 429 after a bounded quota"},
	{"retry", "GET", "/unstable/{successAfter}", "Failures", "Fail until a selected attempt"},
	{"chaos", "GET", "/chaos/random-error", "Failures", "Return deterministic or random failures"},
	{"variables", "GET", "/variables/{environment}/{userId}", "Variables", "Echo templated path and query values"},
	{"json-extractor", "GET", "/extract/json", "Extractors", "Return JSONPath extraction data"},
	{"header-extractor", "GET", "/extract/header", "Extractors", "Return header extraction data"},
	{"cookie-extractor", "GET", "/extract/cookie", "Extractors", "Return cookie extraction data"},
	{"regex-extractor", "GET", "/extract/regex", "Extractors", "Return regex extraction data"},
	{"xml-extractor", "GET", "/extract/xml", "Extractors", "Return XPath extraction data"},
	{"protected-extractor", "GET", "/extract/protected", "Extractors", "Require a previously extracted token"},
	{"cors-open", "GET", "/cors/open", "CORS", "Return permissive CORS headers"},
	{"cors-restricted", "GET", "/cors/restricted", "CORS", "Return restricted CORS headers"},
	{"metrics", "GET", "/metrics/test-lab", "Operations", "Return Test Lab request metrics"},
	{"reset", "POST", "/admin/reset", "Operations", "Reset all in-memory scenario state"},
	{"certificates", "GET", "/certificates", "TLS", "Report safe generated-certificate metadata"},
	{"tls", "GET", "/tls", "TLS", "Report safe TLS connection metadata"},
	{"mtls", "GET", "/mtls", "mTLS", "Require a Test Lab client certificate"},
}

func (s *Server) scenarios(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"service": ServiceName, "scenarios": scenarioCatalog})
}
func (s *Server) openapi(w http.ResponseWriter, r *http.Request) {
	paths := map[string]any{}
	for _, scenario := range scenarioCatalog {
		operation := map[string]any{"operationId": scenario.ID, "summary": scenario.Purpose, "tags": []string{scenario.Category}, "responses": map[string]any{"200": map[string]any{"description": "Scenario response"}}}
		path, ok := paths[scenario.Path].(map[string]any)
		if !ok {
			path = map[string]any{}
			paths[scenario.Path] = path
		}
		path[lower(scenario.Method)] = operation
	}
	writeJSON(w, http.StatusOK, map[string]any{"openapi": "3.1.0", "info": map[string]any{"title": "Rhythm API Test Lab", "version": "0.1.0", "description": "TEST ONLY — NOT FOR PRODUCTION"}, "servers": []map[string]string{{"url": "http://localhost:9080"}, {"url": "https://localhost:9443"}}, "paths": paths})
}
func lower(value string) string {
	out := make([]byte, len(value))
	for i, ch := range []byte(value) {
		if ch >= 'A' && ch <= 'Z' {
			ch += 32
		}
		out[i] = ch
	}
	return string(out)
}
