//go:build testlab_integration

package runs

import (
	"context"
	"net/http/cookiejar"
	"os"
	"strings"
	"testing"

	"github.com/rhythm-monitoring/rhythm/internal/scripts"
)

func testLabURL(t *testing.T) string {
	t.Helper()
	baseURL := strings.TrimRight(os.Getenv("TEST_LAB_URL"), "/")
	if baseURL == "" {
		t.Skip("TEST_LAB_URL is not set")
	}
	return baseURL
}

func testLabStep(id, method, target string) StepDefinition {
	return StepDefinition{ID: id, Name: id, Type: "HTTP_REQUEST", Enabled: true, TimeoutMS: 5000, Request: RequestConfig{
		Method: method, URL: target,
		Settings: SettingsConfig{TimeoutMS: 5000, FollowRedirects: true, MaxRedirects: 5, Compression: true, CaptureBody: true, MaxBodyBytes: 64 << 10},
	}}
}

func requireTestLabSuccess(t *testing.T, result StepRun) {
	t.Helper()
	if result.Status != StatusSuccess {
		t.Fatalf("expected Test Lab step success, got %s (%s): %s", result.Status, result.FailureCategory, result.ErrorMessage)
	}
}

func TestLabExecutorRequestMutationExtractionAndRetry(t *testing.T) {
	baseURL := testLabURL(t)
	executor := NewHTTPExecutor(true)
	executor.SetScriptExecutor(scripts.NewRuntime())

	step := testLabStep("script-and-extract", "GET", baseURL+"/extract/json")
	step.Request.PreRequestScript = scripts.Script{Enabled: true, RuntimeVersion: scripts.RuntimeVersion, Code: `
pm.variables.set("traceId", "integration-trace");
pm.request.headers.upsert({key:"X-Correlation-ID", value:pm.variables.get("traceId")});
pm.test("variable prepared", () => pm.expect(pm.variables.get("traceId")).to.equal("integration-trace"));`}
	step.Request.Extractors = []ExtractorConfig{{Enabled: true, Source: "jsonpath", Variable: "userId", Expression: "$.data.user.id"}}
	step.Request.Assertions = []AssertionConfig{{Enabled: true, Type: "status", Expected: "200"}, {Enabled: true, Type: "jsonpath", Expression: "$.data.user.id", Expected: "78291"}}
	result := executor.Execute(context.Background(), step)
	requireTestLabSuccess(t, result)
	if len(result.Extractors) != 1 || !result.Extractors[0].Success || result.Extractors[0].Value == "" {
		t.Fatalf("expected JSON extractor evidence, got %#v", result.Extractors)
	}

	retry := testLabStep("retry", "GET", baseURL+"/unstable/3?key=rhythm-executor-integration")
	retry.Request.Settings.Retries = 2
	retry.Request.Settings.RetryBackoff = "10ms"
	retryResult := executor.Execute(context.Background(), retry)
	requireTestLabSuccess(t, retryResult)
	if retryResult.AttemptCount != 3 {
		t.Fatalf("expected three independent attempts, got %d", retryResult.AttemptCount)
	}
}

func TestLabExecutorHMACAndMACScripts(t *testing.T) {
	baseURL := testLabURL(t)
	executor := NewHTTPExecutor(true)
	executor.SetScriptExecutor(scripts.NewRuntime())

	hmacStep := testLabStep("hmac", "POST", baseURL+"/auth/hmac")
	hmacStep.Request.Body = BodyConfig{Type: "raw", Content: `{"purpose":"executor-integration"}`}
	hmacStep.Request.Headers = []KeyValue{{Enabled: true, Key: "Content-Type", Value: "application/json"}}
	hmacStep.Request.PreRequestScript = scripts.Script{Enabled: true, RuntimeVersion: scripts.RuntimeVersion, Code: `
const clientId = "rhythm-client";
const secret = "rhythm-hmac-secret";
const timestamp = Date.now().toString();
const signature = CryptoJS.enc.Base64.stringify(CryptoJS.HmacSHA256(clientId + "-" + timestamp, secret));
pm.request.headers.upsert({key:"X-Client-ID", value:clientId});
pm.request.headers.upsert({key:"X-Timestamp", value:timestamp});
pm.request.headers.upsert({key:"X-Signature", value:signature});`}
	requireTestLabSuccess(t, executor.Execute(context.Background(), hmacStep))

	macStep := testLabStep("mac", "POST", baseURL+"/auth/mac?source=rhythm")
	macStep.Request.Body = BodyConfig{Type: "raw", Content: `{"amount":10}`}
	macStep.Request.Headers = []KeyValue{{Enabled: true, Key: "Content-Type", Value: "application/json"}}
	macStep.Request.PreRequestScript = scripts.Script{Enabled: true, RuntimeVersion: scripts.RuntimeVersion, Code: `
const key = "rhythm-mac-key";
const secret = "rhythm-mac-secret";
const ts = Date.now().toString();
const nonce = rhythm.random.string(36);
const url = new URL(pm.variables.replaceIn(pm.request.url.toString()));
const payload = pm.request.body.raw;
const bodyHash = CryptoJS.enc.Base64.stringify(CryptoJS.HmacSHA256(payload, secret));
const port = url.port || (url.protocol === "http:" ? "80" : "443");
const canonical = ts + "\n" + nonce + "\n" + pm.request.method + "\n" + url.pathname + url.search + "\n" + url.hostname + "\n" + port + "\n" + bodyHash + "\n";
const mac = CryptoJS.enc.Base64.stringify(CryptoJS.HmacSHA256(canonical, secret));
pm.request.headers.upsert({key:"Authorization", value:'MAC id="' + key + '",ts="' + ts + '",nonce="' + nonce + '",bodyhash="' + bodyHash + '",mac="' + mac + '"'});`}
	requireTestLabSuccess(t, executor.Execute(context.Background(), macStep))
}

func TestLabExecutorCookieJarAndAuxiliaryTokenChain(t *testing.T) {
	baseURL := testLabURL(t)
	executor := NewHTTPExecutor(true)
	executor.SetScriptExecutor(scripts.NewRuntime())
	jar, err := cookiejar.New(nil)
	if err != nil {
		t.Fatal(err)
	}

	login := testLabStep("login", "POST", baseURL+"/cookies/login")
	login.Request.PersistCookies = true
	login.Request.Headers = []KeyValue{{Enabled: true, Key: "Content-Type", Value: "application/json"}}
	login.Request.Body = BodyConfig{Type: "raw", Content: `{"username":"rhythm","password":"rhythm-test"}`}
	requireTestLabSuccess(t, executor.ExecuteWithJar(context.Background(), login, jar))

	profile := testLabStep("profile", "GET", baseURL+"/cookies/profile")
	profile.Request.PersistCookies = true
	requireTestLabSuccess(t, executor.ExecuteWithJar(context.Background(), profile, jar))

	chain := testLabStep("token-chain", "GET", baseURL+"/protected/keysets")
	chain.Request.PreRequestScript = scripts.Script{Enabled: true, RuntimeVersion: scripts.RuntimeVersion, Code: `
const clientId = "rhythm-app-client";
const version = "2";
const timestamp = Date.now().toString();
const bytes = CryptoJS.enc.Base64.parse("cmh5dGhtLWFwcC1zZWNyZXQ=");
let signature = CryptoJS.enc.Base64.stringify(CryptoJS.HmacSHA256(clientId + "-" + version + "-" + timestamp, bytes));
signature = signature.replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
const response = await rhythm.sendRequest({
  url: pm.variables.get("test_lab_url") + "/auth/application-token",
  method: "POST",
  headers: {"Content-Type":"application/json", "X-Auth-AppID":clientId, "X-Auth-Version":version, "X-Auth-Timestamp":timestamp, "X-Auth-Signature":signature},
  body: {scope:["*"]}
});
pm.test("dependency succeeded", () => pm.expect(response.statusCode).to.equal(200));
pm.request.headers.upsert({key:"Authorization", value:"Bearer " + response.json().authorization_token});`}
	result := executor.ExecuteWithState(context.Background(), chain, jar, map[string]string{"test_lab_url": baseURL})
	requireTestLabSuccess(t, result)
	if result.PreRequestScript == nil || len(result.PreRequestScript.AuxiliaryRequests) != 1 {
		t.Fatalf("expected one governed auxiliary request, got %#v", result.PreRequestScript)
	}
}
