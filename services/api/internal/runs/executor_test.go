package runs

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/rhythm-monitoring/rhythm/internal/scripts"
)

type fakeRuntimeResolver struct {
	secret    string
	proxy     ProxyMaterial
	tls       TLSMaterial
	telemetry TelemetryMaterial
}

func (f fakeRuntimeResolver) ResolveSecret(_ context.Context, _ string) (string, error) {
	return f.secret, nil
}
func (f fakeRuntimeResolver) ResolveTLSProfile(_ context.Context, _, _ string) (TLSMaterial, error) {
	return f.tls, nil
}
func (f fakeRuntimeResolver) ResolveProxyProfile(_ context.Context, _ string) (ProxyMaterial, error) {
	return f.proxy, nil
}
func (f fakeRuntimeResolver) ResolveTelemetryProfile(_ context.Context, _ string) (TelemetryMaterial, error) {
	return f.telemetry, nil
}

func TestHTTPExecutorRunsActionsExtractorsAndAssertions(t *testing.T) {
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasPrefix(r.URL.Path, "/orders/") {
			t.Fatalf("unexpected path %s", r.URL.Path)
		}
		w.Header().Set("X-Request-ID", "request-123")
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"order-42","token":"must-not-persist","status":"ready"}`))
	}))
	defer target.Close()

	step := StepDefinition{ID: "step-1", Name: "Create order", Type: "HTTP_REQUEST", Enabled: true, TimeoutMS: 2000,
		Request: RequestConfig{Method: "GET", URL: target.URL + "/orders/{{ generated.uuid }}",
			PreRequest: []ActionConfig{{Enabled: true, Type: "uuid", Output: "generated.uuid"}},
			Extractors: []ExtractorConfig{{Enabled: true, Source: "jsonpath", Variable: "orderId", Expression: "$.id"}},
			Assertions: []AssertionConfig{{Enabled: true, Type: "status", Expression: "status", Expected: "200"}, {Enabled: true, Type: "jsonpath", Expression: "$.status", Expected: "ready"}},
			Settings:   SettingsConfig{TimeoutMS: 2000, FollowRedirects: true, CaptureBody: true, MaxBodyBytes: 4096}}}

	result := NewHTTPExecutor(true).Execute(context.Background(), step)
	if result.Status != StatusSuccess {
		t.Fatalf("expected success, got %s: %s", result.Status, result.ErrorMessage)
	}
	if result.Extractors[0].Value != "order-42" {
		t.Fatalf("expected extracted order id, got %#v", result.Extractors[0].Value)
	}
	if total, ok := result.Timing["totalMs"].(int64); !ok || total != result.DurationMS {
		t.Fatalf("expected timing total %d to include the complete step duration, got %#v", result.DurationMS, result.Timing["totalMs"])
	}
	apiResponse, apiRecorded := result.Timing["apiResponseTimeMs"].(int64)
	if !apiRecorded || len(result.Attempts) != 1 || apiResponse != result.Attempts[0].DurationMS {
		t.Fatalf("expected API response time to match the complete final attempt, got timing=%#v attempts=%#v", result.Timing, result.Attempts)
	}
	if networkTotal, ok := result.Timing["networkTotalMs"].(int64); !ok || networkTotal < apiResponse {
		t.Fatalf("expected all-attempt network time to include the final API response, got %#v", result.Timing["networkTotalMs"])
	}
	if _, ok := result.Timing["postProcessingMs"].(int64); !ok {
		t.Fatalf("expected post-processing time to be recorded, got %#v", result.Timing)
	}
	encoded, _ := json.Marshal(result.ResponseSummary)
	if strings.Contains(string(encoded), "must-not-persist") {
		t.Fatalf("expected token to be redacted, got %s", encoded)
	}
}

func TestHTTPExecutorAppliesJavaScriptRequestMutations(t *testing.T) {
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/generated" || r.Header.Get("X-From-Script") != "yes" || r.URL.Query().Get("source") != "sandbox" {
			t.Fatalf("script request mutation was not applied: %s %#v", r.URL.String(), r.Header)
		}
		cookie, err := r.Cookie("run-cookie")
		if err != nil || cookie.Value != "isolated" {
			t.Fatalf("script cookie mutation was not applied: %#v %v", cookie, err)
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	defer target.Close()

	executor := NewHTTPExecutor(true)
	executor.SetScriptExecutor(scripts.NewRuntime())
	step := StepDefinition{ID: "scripted", Name: "Scripted request", Type: "HTTP_REQUEST", Enabled: true, Request: RequestConfig{
		Method: "GET", URL: target.URL + "/{{path}}",
		PreRequestScript: scripts.Script{Enabled: true, Language: "javascript", RuntimeVersion: scripts.RuntimeVersion, Code: `
pm.variables.set("path", "generated");
pm.request.headers.upsert({key:"X-From-Script", value:"yes"});
pm.request.query.upsert({key:"source", value:"sandbox"});
pm.cookies.set("run-cookie", "isolated");
pm.test("path prepared", () => pm.expect(pm.variables.get("path")).to.equal("generated"));`},
		Settings: SettingsConfig{TimeoutMS: 1000},
	}}
	result := executor.Execute(context.Background(), step)
	if result.Status != StatusSuccess || result.PreRequestScript == nil || result.PreRequestScript.Status != "SUCCESS" {
		t.Fatalf("expected scripted request success, got %#v", result)
	}
	encoded, _ := json.Marshal(result.PreRequestScript)
	if strings.Contains(string(encoded), "internalVariables") || strings.Contains(string(encoded), "internalCookies") {
		t.Fatalf("internal script state leaked into evidence: %s", encoded)
	}
}

func TestHTTPExecutorRunsPostResponseTestsScript(t *testing.T) {
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"order-42","status":"ready"}`))
	}))
	defer target.Close()

	executor := NewHTTPExecutor(true)
	executor.SetScriptExecutor(scripts.NewRuntime())
	step := StepDefinition{ID: "tested", Name: "Tested response", Type: "HTTP_REQUEST", Enabled: true, Request: RequestConfig{
		Method: "GET", URL: target.URL,
		TestScript: scripts.Script{Enabled: true, Language: "javascript", RuntimeVersion: scripts.RuntimeVersion, Code: `
const data = pm.response.json();
pm.test("status is 200", () => pm.response.to.have.status(200));
pm.test("order is ready", () => pm.expect(data.status).to.equal("ready"));
pm.collectionVariables.set("orderId", data.id);
pm.visualizer.set("<p>{{id}}</p>", {id:data.id});`},
		Settings: SettingsConfig{TimeoutMS: 1000, CaptureBody: true},
	}}
	values := map[string]string{}
	result := executor.ExecuteWithState(context.Background(), step, nil, values)
	if result.Status != StatusSuccess || result.TestScript == nil || result.TestScript.Status != "SUCCESS" || len(result.TestScript.Tests) != 2 {
		t.Fatalf("expected response Tests success, got %#v", result)
	}
	if result.TestScript.Visualizer == nil || result.TestScript.Visualizer.Data["id"] != "order-42" {
		t.Fatalf("expected visualizer evidence, got %#v", result.TestScript.Visualizer)
	}
	if values["orderId"] != "order-42" {
		t.Fatalf("expected Tests variable changes to continue through the workflow, got %#v", values)
	}
}

func TestHTTPExecutorStopsOnFailedPostResponseTest(t *testing.T) {
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusServiceUnavailable)
	}))
	defer target.Close()

	executor := NewHTTPExecutor(true)
	executor.SetScriptExecutor(scripts.NewRuntime())
	step := StepDefinition{ID: "failed-test", Name: "Failed Tests", Type: "HTTP_REQUEST", Enabled: true, Request: RequestConfig{
		Method: "GET", URL: target.URL,
		TestScript: scripts.Script{Enabled: true, RuntimeVersion: scripts.RuntimeVersion, Code: `pm.test("status is 200", () => pm.response.to.have.status(200));`},
		Settings:   SettingsConfig{TimeoutMS: 1000},
	}}
	result := executor.Execute(context.Background(), step)
	if result.Status != StatusFailed || result.FailureCategory != "SCRIPT_ASSERTION_FAILURE" || result.TestScript == nil {
		t.Fatalf("expected failed JavaScript Test to fail the step, got %#v", result)
	}
}

func TestHTTPExecutorHonorsSkipRequest(t *testing.T) {
	var called atomic.Int32
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		called.Add(1)
		w.WriteHeader(http.StatusOK)
	}))
	defer target.Close()
	executor := NewHTTPExecutor(true)
	executor.SetScriptExecutor(scripts.NewRuntime())
	step := StepDefinition{ID: "skipped", Name: "Skipped request", Type: "HTTP_REQUEST", Enabled: true, Request: RequestConfig{
		Method:           "GET",
		URL:              target.URL,
		PreRequestScript: scripts.Script{Enabled: true, RuntimeVersion: scripts.RuntimeVersion, Code: `pm.execution.skipRequest();`},
		Settings:         SettingsConfig{TimeoutMS: 1000},
	}}
	result := executor.Execute(context.Background(), step)
	if result.Status != StatusSkipped || called.Load() != 0 || result.PreRequestScript == nil || !result.PreRequestScript.Execution.RequestSkipped {
		t.Fatalf("skipRequest should skip the primary HTTP call: %#v calls=%d", result, called.Load())
	}
}

func TestHTTPExecutorRecordsPreRequestSendRequestEvidence(t *testing.T) {
	aux := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"token":"issued"}`))
	}))
	defer aux.Close()
	main := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-Token") != "issued" {
			t.Fatalf("main request missing token from sendRequest")
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	defer main.Close()

	executor := NewHTTPExecutor(true)
	executor.SetScriptExecutor(scripts.NewRuntime())
	step := StepDefinition{ID: "aux-script", Name: "Aux script", Type: "HTTP_REQUEST", Enabled: true, Request: RequestConfig{
		Method: "GET", URL: main.URL,
		PreRequestScript: scripts.Script{Enabled: true, Language: "javascript", RuntimeVersion: scripts.RuntimeVersion, Code: fmt.Sprintf(`
const response = await pm.sendRequest(%q);
pm.request.headers.upsert({key:"X-Token", value: response.json().token});
await pm.sendRequest({method:"GET", url:%q});
`, aux.URL, aux.URL+"/second")},
		Settings: SettingsConfig{TimeoutMS: 2000},
	}}
	result := executor.Execute(context.Background(), step)
	if result.Status != StatusSuccess || result.PreRequestScript == nil {
		t.Fatalf("expected success with pre-request evidence, got %#v", result)
	}
	if len(result.PreRequestScript.AuxiliaryRequests) != 2 {
		t.Fatalf("expected two auxiliary requests, got %#v", result.PreRequestScript.AuxiliaryRequests)
	}
	first, second := result.PreRequestScript.AuxiliaryRequests[0], result.PreRequestScript.AuxiliaryRequests[1]
	if !first.Success || !second.Success || first.Status != http.StatusOK || first.DurationMS < 0 {
		t.Fatalf("unexpected auxiliary evidence: %#v", result.PreRequestScript.AuxiliaryRequests)
	}
	if !strings.HasSuffix(second.URL, "/second") {
		t.Fatalf("expected ordered URLs, got %#v", result.PreRequestScript.AuxiliaryRequests)
	}
	count, _ := result.Timing["auxiliaryRequestCount"].(int)
	if count != 2 {
		t.Fatalf("expected auxiliaryRequestCount=2 in timing, got %#v", result.Timing)
	}
	auxMS, _ := result.Timing["auxiliaryRequestMs"].(int64)
	if auxMS != first.DurationMS+second.DurationMS {
		t.Fatalf("expected auxiliaryRequestMs sum in timing, got %#v", result.Timing)
	}
}

func TestHTTPExecutorUsesVaultSecretWithoutPersistingIt(t *testing.T) {
	const secret = "vault-runtime-secret-92841"
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer "+secret {
			t.Fatalf("vault-derived header was not applied")
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	defer target.Close()
	executor := NewHTTPExecutorWithResolver(true, fakeRuntimeResolver{secret: secret})
	executor.SetScriptExecutor(scripts.NewRuntime())
	step := StepDefinition{ID: "vault-script", Name: "Vault script", Type: "HTTP_REQUEST", Enabled: true, Request: RequestConfig{Method: "GET", URL: target.URL, PreRequestScript: scripts.Script{Enabled: true, RuntimeVersion: scripts.RuntimeVersion, Code: `const value = await pm.vault.get("api-key"); pm.request.headers.upsert({key:"Authorization", value:"Bearer "+value}); console.log(value);`}, Settings: SettingsConfig{TimeoutMS: 1000}}}
	result := executor.Execute(context.Background(), step)
	encoded, _ := json.Marshal(result)
	if result.Status != StatusSuccess || strings.Contains(string(encoded), secret) || result.PreRequestScript == nil || result.PreRequestScript.Request.Headers[0].Value != "MASKED" {
		t.Fatalf("vault-derived value leaked or was not applied: %s", encoded)
	}
}

func TestSensitiveExtractorRedactsExactValueFromCapturedBody(t *testing.T) {
	const secret = "opaque-runtime-value-9182"
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"opaque":"` + secret + `","session_id":"also-sensitive"}`))
	}))
	defer target.Close()
	step := StepDefinition{ID: "redaction", Name: "Redaction", Type: "HTTP_REQUEST", Enabled: true, Request: RequestConfig{Method: "GET", URL: target.URL, Extractors: []ExtractorConfig{{Enabled: true, Source: "jsonpath", Variable: "runtimeCredential", Expression: "$.opaque", Sensitive: true}}, Settings: SettingsConfig{TimeoutMS: 1000, CaptureBody: true}}}
	result := NewHTTPExecutor(true).Execute(context.Background(), step)
	encoded, _ := json.Marshal(result)
	if result.Status != StatusSuccess || strings.Contains(string(encoded), secret) || strings.Contains(string(encoded), "also-sensitive") {
		t.Fatalf("sensitive response value leaked: %s", encoded)
	}
}

func TestHTTPExecutorBlocksPrivateTargetsByDefault(t *testing.T) {
	step := StepDefinition{ID: "step-1", Name: "Private target", Type: "HTTP_REQUEST", Enabled: true,
		Request: RequestConfig{Method: "GET", URL: "http://127.0.0.1:8080/health", Settings: SettingsConfig{TimeoutMS: 100}}}

	result := NewHTTPExecutor(false).Execute(context.Background(), step)
	if result.Status != StatusFailed || result.FailureCategory != "CONFIGURATION_ERROR" {
		t.Fatalf("expected a blocked configuration error, got %#v", result)
	}
	if !strings.Contains(result.ErrorMessage, "private or reserved") {
		t.Fatalf("expected safe network policy message, got %q", result.ErrorMessage)
	}
}

func TestHTTPExecutorAllowsGovernedPrivateCIDR(t *testing.T) {
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer target.Close()
	executor := NewHTTPExecutor(false)
	if err := executor.SetPrivateTargetAllowlist(nil, []string{"127.0.0.0/8"}); err != nil {
		t.Fatalf("configure target policy: %v", err)
	}
	step := StepDefinition{ID: "private-allowlisted", Name: "Allowlisted target", Type: "HTTP_REQUEST", Enabled: true,
		Request: RequestConfig{Method: "GET", URL: target.URL, Settings: SettingsConfig{TimeoutMS: 1000}}}
	if result := executor.Execute(context.Background(), step); result.Status != StatusSuccess {
		t.Fatalf("expected allowlisted private target to succeed, got %#v", result)
	}
}

func TestHTTPExecutorFailsAnAssertion(t *testing.T) {
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusAccepted) }))
	defer target.Close()
	step := StepDefinition{ID: "step-1", Name: "Assertion", Type: "HTTP_REQUEST", Enabled: true,
		Request: RequestConfig{Method: "GET", URL: target.URL, Assertions: []AssertionConfig{{Enabled: true, Type: "status", Expression: "status", Expected: "200"}}, Settings: SettingsConfig{TimeoutMS: 1000}}}

	result := NewHTTPExecutor(true).Execute(context.Background(), step)
	if result.Status != StatusFailed || result.FailureCategory != "ASSERTION_FAILURE" {
		t.Fatalf("expected assertion failure, got %#v", result)
	}
}

func TestHTTPExecutorOmitsNonJSONBodiesFromEvidence(t *testing.T) {
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write([]byte("private response text")) }))
	defer target.Close()
	step := StepDefinition{ID: "step-1", Name: "Text response", Type: "HTTP_REQUEST", Enabled: true,
		Request: RequestConfig{Method: "GET", URL: target.URL, Settings: SettingsConfig{TimeoutMS: 1000, CaptureBody: true}}}

	result := NewHTTPExecutor(true).Execute(context.Background(), step)
	if strings.Contains(fmt.Sprint(result.ResponseSummary["body"]), "private response text") {
		t.Fatal("expected non-JSON response content to be omitted")
	}
}

func TestHTTPExecutorOAuthClientCredentials(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("/oauth/token", func(w http.ResponseWriter, r *http.Request) {
		username, password, ok := r.BasicAuth()
		if !ok || username != "client-id" || password != "client-secret" {
			t.Fatalf("unexpected OAuth client credentials")
		}
		if err := r.ParseForm(); err != nil || r.Form.Get("grant_type") != "client_credentials" || r.Form.Get("scope") != "read:health" {
			t.Fatalf("unexpected token request: %#v", r.Form)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"access_token":"issued-token","token_type":"Bearer"}`))
	})
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer issued-token" {
			t.Fatalf("OAuth token was not applied")
		}
		w.WriteHeader(http.StatusNoContent)
	})
	target := httptest.NewServer(mux)
	defer target.Close()

	step := StepDefinition{ID: "oauth", Name: "OAuth", Type: "HTTP_REQUEST", Enabled: true, Request: RequestConfig{
		Method: "GET", URL: target.URL + "/health",
		Auth:     AuthConfig{Type: "oauth2", Fields: map[string]string{"tokenUrl": target.URL + "/oauth/token", "clientId": "client-id", "clientSecret": "client-secret", "scope": "read:health"}},
		Settings: SettingsConfig{TimeoutMS: 1000},
	}}
	result := NewHTTPExecutor(true).Execute(context.Background(), step)
	if result.Status != StatusSuccess {
		t.Fatalf("expected OAuth request to succeed, got %#v", result)
	}
}

func TestHTTPExecutorHMACAuthentication(t *testing.T) {
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mac := hmac.New(sha256.New, []byte("signing-secret"))
		_, _ = mac.Write([]byte("GET\n/signed\n"))
		expected := fmt.Sprintf("%x", mac.Sum(nil))
		if r.Header.Get("X-Rhythm-Signature") != expected {
			t.Fatalf("unexpected HMAC signature %q", r.Header.Get("X-Rhythm-Signature"))
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	defer target.Close()

	step := StepDefinition{ID: "hmac", Name: "HMAC", Type: "HTTP_REQUEST", Enabled: true, Request: RequestConfig{
		Method: "GET", URL: target.URL + "/signed",
		Auth:     AuthConfig{Type: "hmac", Fields: map[string]string{"algorithm": "SHA256", "secretRef": "signing-secret", "canonicalTemplate": "{{ request.method }}\n{{ request.path }}\n{{ request.body }}", "outputHeader": "X-Rhythm-Signature"}},
		Settings: SettingsConfig{TimeoutMS: 1000},
	}}
	result := NewHTTPExecutor(true).Execute(context.Background(), step)
	if result.Status != StatusSuccess {
		t.Fatalf("expected signed request to succeed, got %#v", result)
	}
}

func TestHTTPExecutorJWTAuthentication(t *testing.T) {
	const secret = "jwt-signing-secret"
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		token := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
		parts := strings.Split(token, ".")
		if len(parts) != 3 {
			t.Fatalf("invalid JWT %q", token)
		}
		mac := hmac.New(sha256.New, []byte(secret))
		_, _ = mac.Write([]byte(parts[0] + "." + parts[1]))
		expected := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
		if !hmac.Equal([]byte(parts[2]), []byte(expected)) {
			t.Fatal("JWT signature does not match")
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	defer target.Close()

	step := StepDefinition{ID: "jwt", Name: "JWT", Type: "HTTP_REQUEST", Enabled: true, Request: RequestConfig{
		Method: "GET", URL: target.URL,
		Auth:     AuthConfig{Type: "jwt", Fields: map[string]string{"algorithm": "HS256", "issuer": "rhythm-test", "audience": "target-api", "keyRef": secret}},
		Settings: SettingsConfig{TimeoutMS: 1000},
	}}
	result := NewHTTPExecutor(true).Execute(context.Background(), step)
	if result.Status != StatusSuccess {
		t.Fatalf("expected JWT request to succeed, got %#v", result)
	}
}

func TestHTTPExecutorPersistsCookiesAcrossSteps(t *testing.T) {
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/login" {
			http.SetCookie(w, &http.Cookie{Name: "session", Value: "ready", Path: "/"})
			w.WriteHeader(http.StatusNoContent)
			return
		}
		cookie, err := r.Cookie("session")
		if err != nil || cookie.Value != "ready" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	defer target.Close()

	jar, err := cookiejar.New(nil)
	if err != nil {
		t.Fatal(err)
	}
	executor := NewHTTPExecutor(true)
	login := StepDefinition{ID: "login", Name: "Login", Type: "HTTP_REQUEST", Enabled: true, Request: RequestConfig{Method: "POST", URL: target.URL + "/login", PersistCookies: true, Settings: SettingsConfig{TimeoutMS: 1000}}}
	check := StepDefinition{ID: "check", Name: "Check", Type: "HTTP_REQUEST", Enabled: true, Request: RequestConfig{Method: "GET", URL: target.URL + "/check", PersistCookies: true, Settings: SettingsConfig{TimeoutMS: 1000}, Assertions: []AssertionConfig{{Enabled: true, Type: "status", Expected: "204"}}}}
	if result := executor.ExecuteWithJar(context.Background(), login, jar); result.Status != StatusSuccess {
		t.Fatalf("login step failed: %#v", result)
	}
	if result := executor.ExecuteWithJar(context.Background(), check, jar); result.Status != StatusSuccess {
		t.Fatalf("cookie was not carried to next step: %#v", result)
	}
}

func TestHTTPExecutorRetriesSafeRequests(t *testing.T) {
	var attempts atomic.Int32
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		if attempts.Add(1) < 3 {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	defer target.Close()
	step := StepDefinition{ID: "retry", Name: "Retry", Type: "HTTP_REQUEST", Enabled: true, Request: RequestConfig{Method: "GET", URL: target.URL, Settings: SettingsConfig{TimeoutMS: 2000, Retries: 2, RetryBackoff: "fixed"}, Assertions: []AssertionConfig{{Enabled: true, Type: "status", Expected: "204"}}}}
	result := NewHTTPExecutor(true).Execute(context.Background(), step)
	if result.Status != StatusSuccess || attempts.Load() != 3 || result.Timing["attempts"] != 3 {
		t.Fatalf("expected third attempt success, got attempts=%d result=%#v", attempts.Load(), result)
	}
}

func TestHTTPExecutorRejectsUnsafeRetriesWithoutIdempotencyKey(t *testing.T) {
	step := StepDefinition{ID: "retry", Name: "Retry", Type: "HTTP_REQUEST", Enabled: true, Request: RequestConfig{Method: "POST", URL: "https://example.com", Settings: SettingsConfig{TimeoutMS: 1000, Retries: 1}}}
	result := NewHTTPExecutor(true).Execute(context.Background(), step)
	if result.Status != StatusFailed || result.FailureCategory != "CONFIGURATION_ERROR" {
		t.Fatalf("expected retry configuration failure, got %#v", result)
	}
}

func TestHTTPExecutorResolvesSecretReferences(t *testing.T) {
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer resolved-token" {
			t.Fatalf("secret reference was not resolved")
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	defer target.Close()
	executor := NewHTTPExecutorWithResolver(true, fakeRuntimeResolver{secret: "resolved-token"})
	step := StepDefinition{ID: "secret", Name: "Secret", Type: "HTTP_REQUEST", Enabled: true, Request: RequestConfig{Method: "GET", URL: target.URL, Auth: AuthConfig{Type: "bearer", Fields: map[string]string{"token": "secret://api-token"}}, Settings: SettingsConfig{TimeoutMS: 1000}}}
	if result := executor.Execute(context.Background(), step); result.Status != StatusSuccess {
		t.Fatalf("secret-backed request failed: %#v", result)
	}
}

func TestHTTPExecutorRoutesThroughResolvedProxyProfile(t *testing.T) {
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusNoContent) }))
	defer target.Close()
	var proxyHits atomic.Int32
	proxy := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		proxyHits.Add(1)
		out := r.Clone(r.Context())
		out.RequestURI = ""
		response, err := http.DefaultTransport.RoundTrip(out)
		if err != nil {
			http.Error(w, "proxy failed", http.StatusBadGateway)
			return
		}
		defer response.Body.Close()
		for key, values := range response.Header {
			for _, value := range values {
				w.Header().Add(key, value)
			}
		}
		w.WriteHeader(response.StatusCode)
	}))
	defer proxy.Close()
	executor := NewHTTPExecutorWithResolver(true, fakeRuntimeResolver{proxy: ProxyMaterial{URL: proxy.URL}})
	step := StepDefinition{ID: "proxy", Name: "Proxy", Type: "HTTP_REQUEST", Enabled: true, Request: RequestConfig{Method: "GET", URL: target.URL, Proxy: ProxyConfig{Mode: "profile", ProfileID: "corporate"}, Settings: SettingsConfig{TimeoutMS: 1000}}}
	if result := executor.Execute(context.Background(), step); result.Status != StatusSuccess || proxyHits.Load() != 1 {
		t.Fatalf("profile proxy was not used: hits=%d result=%#v", proxyHits.Load(), result)
	}
}

func TestHTTPExecutorValidatesInlineJSONSchema(t *testing.T) {
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"order-42","quantity":2}`))
	}))
	defer target.Close()
	schema := `{"type":"object","required":["id","quantity"],"properties":{"id":{"type":"string"},"quantity":{"type":"integer","minimum":1}}}`
	step := StepDefinition{ID: "schema", Name: "Schema", Type: "HTTP_REQUEST", Enabled: true, Request: RequestConfig{Method: "GET", URL: target.URL, Settings: SettingsConfig{TimeoutMS: 1000}, Assertions: []AssertionConfig{{Enabled: true, Type: "json-schema", Expression: schema, Expected: "valid"}}}}
	if result := NewHTTPExecutor(true).Execute(context.Background(), step); result.Status != StatusSuccess {
		t.Fatalf("valid JSON schema assertion failed: %#v", result)
	}
	step.Request.Assertions[0].Expression = `{"type":"object","required":["missing"]}`
	if result := NewHTTPExecutor(true).Execute(context.Background(), step); result.Status != StatusFailed || result.FailureCategory != "ASSERTION_FAILURE" {
		t.Fatalf("invalid document passed JSON schema assertion: %#v", result)
	}
}

func TestHTTPExecutorUsesResolvedCustomCAAndCapturesTLSEvidence(t *testing.T) {
	target := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusNoContent) }))
	defer target.Close()
	caBundle := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: target.Certificate().Raw})
	executor := NewHTTPExecutorWithResolver(true, fakeRuntimeResolver{tls: TLSMaterial{CABundlePEM: string(caBundle)}})
	step := StepDefinition{ID: "tls", Name: "TLS", Type: "HTTP_REQUEST", Enabled: true, Request: RequestConfig{Method: "GET", URL: target.URL, TLS: TLSConfig{CAProfileID: "local-test-ca", MinimumVersion: "TLS 1.2"}, Settings: SettingsConfig{TimeoutMS: 1000}, Assertions: []AssertionConfig{{Enabled: true, Type: "tls-trusted", Expected: "true"}}}}
	result := executor.Execute(context.Background(), step)
	if result.Status != StatusSuccess || result.TLS["verified"] != true || result.TLS["protocol"] == "" {
		t.Fatalf("custom CA TLS request did not produce verified evidence: %#v", result)
	}
}

func TestHTTPExecutorEncodesStructuredBodyTypes(t *testing.T) {
	tests := []struct{ name, bodyType, content, contentType string }{
		{"json", "json", `{"id":"42"}`, "application/json"},
		{"xml", "xml", `<id>42</id>`, "application/xml"},
		{"form", "form", `name=Rhythm&state=ready`, "application/x-www-form-urlencoded"},
		{"graphql", "graphql", `query { health }`, "application/graphql"},
		{"multipart", "multipart", `name=Rhythm&state=ready`, "multipart/form-data;"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if !strings.HasPrefix(r.Header.Get("Content-Type"), test.contentType) {
					t.Fatalf("content type %q", r.Header.Get("Content-Type"))
				}
				body, _ := io.ReadAll(r.Body)
				if len(body) == 0 {
					t.Fatal("encoded body was empty")
				}
				w.WriteHeader(http.StatusNoContent)
			}))
			defer target.Close()
			step := StepDefinition{ID: test.name, Name: test.name, Type: "HTTP_REQUEST", Enabled: true, Request: RequestConfig{Method: "POST", URL: target.URL, Body: BodyConfig{Type: test.bodyType, Content: test.content}, Settings: SettingsConfig{TimeoutMS: 1000}}}
			if result := NewHTTPExecutor(true).Execute(context.Background(), step); result.Status != StatusSuccess {
				t.Fatalf("body request failed: %#v", result)
			}
		})
	}
}

func TestMetricValidationExecutesDynatraceQueryAndThreshold(t *testing.T) {
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v2/metrics/query" || r.Header.Get("Authorization") != "Api-Token dynatrace-token" {
			t.Fatalf("unexpected telemetry request: %s %q", r.URL.String(), r.Header.Get("Authorization"))
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"result":[{"metricId":"builtin:host.cpu.usage","data":[{"values":[42.0,58.0]}]}]}`))
	}))
	defer target.Close()
	executor := NewHTTPExecutorWithResolver(true, fakeRuntimeResolver{telemetry: TelemetryMaterial{BaseURL: target.URL, Token: "dynatrace-token"}})
	step := StepDefinition{ID: "cpu", Name: "CPU below threshold", Type: "METRIC_VALIDATION", Enabled: true, TimeoutMS: 2000, Metric: MetricValidationConfig{Provider: "DYNATRACE", ProfileID: "dynatrace-prod", MetricSelector: "builtin:host.cpu.usage", Aggregation: "AVG", Window: "10m", Operator: "LESS_THAN", Threshold: 80, MissingDataPolicy: "FAIL"}}
	result := executor.ExecuteMetric(context.Background(), step)
	if result.Status != StatusSuccess || result.Outputs["value"] != float64(50) || len(result.Assertions) != 1 || !result.Assertions[0].Passed {
		t.Fatalf("metric validation failed: %#v", result)
	}
}

func TestRenderSupportsScopedAndDynamicVariables(t *testing.T) {
	values := map[string]string{
		"name":                    "local",
		"variables.name":          "script-local",
		"environment.name":        "environment",
		"collection.name":         "collection",
		"globals.name":            "global",
		"steps.create.outputs.id": "order-42",
		"secrets.api-key":         "exact-secret",
	}
	rendered, err := render(
		`{{name}}|{{environment.name}}|{{collection.name}}|{{globals.name}}|{{steps.create.outputs.id}}|{{secrets.api-key}}|{{$uuid}}|{{$timestamp}}`,
		values,
	)
	if err != nil {
		t.Fatal(err)
	}
	parts := strings.Split(rendered, "|")
	if len(parts) != 8 || parts[0] != "script-local" || parts[1] != "environment" || parts[2] != "collection" || parts[3] != "global" || parts[4] != "order-42" || parts[5] != "exact-secret" || parts[6] == "" || parts[7] == "" {
		t.Fatalf("unexpected scoped rendering: %q", rendered)
	}
}

func TestSafeRequestURLMasksTemplatedSecretValues(t *testing.T) {
	target, err := url.Parse("https://example.com/orders/exact-secret?trace=exact-secret")
	if err != nil {
		t.Fatal(err)
	}
	safe := safeRequestURL(target, AuthConfig{}, map[string]string{"secrets.api-key": "exact-secret"})
	if strings.Contains(safe, "exact-secret") || !strings.Contains(safe, "••••••••") {
		t.Fatalf("secret leaked through request URL summary: %q", safe)
	}
}
