package scripts

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestRuntimeMutatesVariablesAndRequest(t *testing.T) {
	runtime := NewRuntime()
	result, err := runtime.Execute(context.Background(), Input{Script: Script{Enabled: true, Code: `
pm.variables.set("token", "generated");
pm.request.headers.upsert({key:"X-Trace", value:"trace-1"});
pm.request.query.add({key:"debug", value:"true"});
pm.request.body.content = JSON.stringify({token: pm.variables.get("token")});
console.log("prepared", pm.request.method);
pm.test("token exists", () => pm.expect(pm.variables.get("token")).to.equal("generated"));`, RuntimeVersion: RuntimeVersion}, Variables: map[string]string{}, Collection: map[string]string{}, Environment: map[string]string{}, Globals: map[string]string{}, Request: &Request{Method: "POST", URL: "https://example.com", Headers: []Entry{}, Query: []Entry{}, Body: map[string]any{"type": "json", "content": "{}"}}, TimeoutMS: 1000})
	if err != nil {
		t.Fatal(err)
	}
	if result.Status != "SUCCESS" || result.Variables["token"] != "MASKED" || result.InternalVariables["token"] != "generated" {
		t.Fatalf("unexpected result: %#v", result)
	}
	if result.Request == nil || len(result.Request.Headers) != 1 || result.Request.Headers[0].Key != "X-Trace" {
		t.Fatalf("request mutation missing: %#v", result.Request)
	}
	if len(result.Logs) != 1 || len(result.Tests) != 1 || !result.Tests[0].Passed {
		t.Fatalf("evidence missing: %#v", result)
	}
}

func TestRuntimeMasksVaultValues(t *testing.T) {
	result, err := NewRuntime().Execute(context.Background(), Input{Script: Script{Enabled: true, Code: `const secret = await pm.vault.get("api-key"); console.log(secret); pm.variables.set("copy", secret); pm.request.headers.upsert({key:"Authorization",value:"Bearer "+secret});`, RuntimeVersion: RuntimeVersion}, Variables: map[string]string{}, Collection: map[string]string{}, Environment: map[string]string{}, Globals: map[string]string{}, Secrets: map[string]string{"api-key": "exact-secret-value"}, Request: &Request{Method: "GET", URL: "https://example.com", Headers: []Entry{}, Query: []Entry{}}, TimeoutMS: 1000})
	if err != nil {
		t.Fatal(err)
	}
	encoded := printable(map[string]any{"logs": result.Logs, "variables": result.Variables, "changes": result.VariableChanges})
	if strings.Contains(encoded, "exact-secret-value") || result.Variables["copy"] != "MASKED" {
		t.Fatalf("secret leaked in safe evidence: %s", encoded)
	}
	fullEvidence, _ := json.Marshal(struct {
		Logs           []Log             `json:"logs"`
		Variables      map[string]string `json:"variables"`
		Changes        []Change          `json:"changes"`
		Request        *Request          `json:"request"`
		RequestChanges []Change          `json:"requestChanges"`
	}{result.Logs, result.Variables, result.VariableChanges, result.Request, result.RequestChanges})
	if strings.Contains(string(fullEvidence), "exact-secret-value") || result.Request.Headers[0].Value != "MASKED" || !strings.Contains(result.InternalRequest.Headers[0].Value, "exact-secret-value") {
		t.Fatalf("request mutation secret handling failed: %s %#v", fullEvidence, result.InternalRequest)
	}
}

func TestRuntimeStopsInfiniteLoop(t *testing.T) {
	result, err := NewRuntime().Execute(context.Background(), Input{Script: Script{Enabled: true, Code: `while(true){}`, RuntimeVersion: RuntimeVersion}, Variables: map[string]string{}, Collection: map[string]string{}, Environment: map[string]string{}, Globals: map[string]string{}, TimeoutMS: 1000})
	if err != nil {
		t.Fatal(err)
	}
	if result.ErrorCategory != "SCRIPT_TIMEOUT" {
		t.Fatalf("expected timeout, got %#v", result)
	}
}

func TestPreviewAllowsAuxiliaryRequests(t *testing.T) {
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"token":"preview-token"}`))
	}))
	defer target.Close()

	code := fmt.Sprintf(`
const response = await pm.sendRequest(%q);
pm.variables.set("token", response.json().token);
`, target.URL)
	result, err := NewRuntime().Execute(context.Background(), Input{Script: Script{Enabled: true, Code: code, RuntimeVersion: RuntimeVersion}, Preview: true, AllowPrivateTargets: true, Variables: map[string]string{}, Collection: map[string]string{}, Environment: map[string]string{}, Globals: map[string]string{}, TimeoutMS: 2000})
	if err != nil {
		t.Fatal(err)
	}
	if result.Status != "SUCCESS" || result.InternalVariables["token"] != "preview-token" || len(result.AuxiliaryRequests) != 1 {
		t.Fatalf("expected preview sendRequest to succeed, got %#v", result)
	}
	aux := result.AuxiliaryRequests[0]
	if aux.Source != "pm.sendRequest" || aux.Method != http.MethodGet || !aux.Success || aux.Status != http.StatusOK || aux.DurationMS < 0 || aux.Error != "" {
		t.Fatalf("expected timed successful auxiliary request evidence, got %#v", aux)
	}
	if !strings.Contains(aux.URL, target.URL) && aux.URL != target.URL {
		// httptest URL may differ only by trailing slash / host form after safeURL
		if !strings.HasPrefix(aux.URL, "http://127.0.0.1") && !strings.HasPrefix(aux.URL, "http://localhost") {
			t.Fatalf("unexpected auxiliary request URL: %q", aux.URL)
		}
	}
}

func TestRuntimeRecordsMultipleAuxiliaryRequestsInOrder(t *testing.T) {
	var hits []string
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits = append(hits, r.URL.Path)
		time.Sleep(5 * time.Millisecond)
		w.WriteHeader(http.StatusCreated)
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer target.Close()

	code := fmt.Sprintf(`
await pm.sendRequest({ method: "GET", url: %q });
await pm.sendRequest({ method: "POST", url: %q });
`, target.URL+"/one", target.URL+"/two")
	result, err := NewRuntime().Execute(context.Background(), Input{Script: Script{Enabled: true, Code: code, RuntimeVersion: RuntimeVersion}, AllowPrivateTargets: true, Variables: map[string]string{}, Collection: map[string]string{}, Environment: map[string]string{}, Globals: map[string]string{}, TimeoutMS: 2000})
	if err != nil {
		t.Fatal(err)
	}
	if result.Status != "SUCCESS" || len(result.AuxiliaryRequests) != 2 {
		t.Fatalf("expected two auxiliary requests, got %#v", result)
	}
	if len(hits) != 2 || hits[0] != "/one" || hits[1] != "/two" {
		t.Fatalf("unexpected hit order: %#v", hits)
	}
	first, second := result.AuxiliaryRequests[0], result.AuxiliaryRequests[1]
	if first.Method != http.MethodGet || second.Method != http.MethodPost {
		t.Fatalf("methods out of order: %#v", result.AuxiliaryRequests)
	}
	if !strings.HasSuffix(first.URL, "/one") || !strings.HasSuffix(second.URL, "/two") {
		t.Fatalf("URLs out of order: %#v", result.AuxiliaryRequests)
	}
	if !first.Success || !second.Success || first.Status != http.StatusCreated || second.Status != http.StatusCreated {
		t.Fatalf("expected successful evidence: %#v", result.AuxiliaryRequests)
	}
	if first.DurationMS < 1 || second.DurationMS < 1 {
		t.Fatalf("expected positive durations, got %#v", result.AuxiliaryRequests)
	}
	if AuxiliaryRequestDurationMS(result) != first.DurationMS+second.DurationMS {
		t.Fatalf("duration sum mismatch: %#v", result.AuxiliaryRequests)
	}
}

func TestRuntimeRecordsFailedAuxiliaryRequestDuration(t *testing.T) {
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		hj, ok := w.(http.Hijacker)
		if !ok {
			t.Fatal("hijacking unsupported")
		}
		conn, _, err := hj.Hijack()
		if err != nil {
			t.Fatal(err)
		}
		_ = conn.Close()
	}))
	defer target.Close()

	code := fmt.Sprintf(`
try {
  await pm.sendRequest(%q);
} catch (error) {
  pm.variables.set("caught", "yes");
}
`, target.URL)
	result, err := NewRuntime().Execute(context.Background(), Input{Script: Script{Enabled: true, Code: code, RuntimeVersion: RuntimeVersion}, AllowPrivateTargets: true, Variables: map[string]string{}, Collection: map[string]string{}, Environment: map[string]string{}, Globals: map[string]string{}, TimeoutMS: 2000})
	if err != nil {
		t.Fatal(err)
	}
	if result.Status != "SUCCESS" || result.InternalVariables["caught"] != "yes" || len(result.AuxiliaryRequests) != 1 {
		t.Fatalf("expected caught sendRequest failure evidence, got %#v", result)
	}
	aux := result.AuxiliaryRequests[0]
	if aux.Success || aux.Error == "" || aux.DurationMS < 0 || aux.Source != "pm.sendRequest" {
		t.Fatalf("expected failed timed evidence, got %#v", aux)
	}
}

func TestRuntimeRecordsInvalidAuxiliaryRequestEvidence(t *testing.T) {
	result, err := NewRuntime().Execute(context.Background(), Input{Script: Script{Enabled: true, Code: `
try {
  await pm.sendRequest({ method: "GET", url: "not-a-url" });
} catch (error) {
  pm.variables.set("caught", "yes");
}
`, RuntimeVersion: RuntimeVersion}, AllowPrivateTargets: true, Variables: map[string]string{}, Collection: map[string]string{}, Environment: map[string]string{}, Globals: map[string]string{}, TimeoutMS: 1000})
	if err != nil {
		t.Fatal(err)
	}
	if result.Status != "SUCCESS" || result.InternalVariables["caught"] != "yes" || len(result.AuxiliaryRequests) != 1 {
		t.Fatalf("expected invalid URL evidence, got %#v", result)
	}
	aux := result.AuxiliaryRequests[0]
	if aux.Success || aux.Error != "invalid URL" || aux.Method != http.MethodGet {
		t.Fatalf("unexpected invalid URL evidence: %#v", aux)
	}
}

func TestPreviewMasksVaultSecrets(t *testing.T) {
	result, err := NewRuntime().Execute(context.Background(), Input{Script: Script{Enabled: true, Code: `const secret = await pm.vault.get("api-key"); pm.variables.set("copy", secret);`, RuntimeVersion: RuntimeVersion}, Preview: true, Secrets: map[string]string{"api-key": "exact-secret-value"}, Variables: map[string]string{}, Collection: map[string]string{}, Environment: map[string]string{}, Globals: map[string]string{}, TimeoutMS: 1000})
	if err != nil {
		t.Fatal(err)
	}
	if result.Status != "SUCCESS" || result.InternalVariables["copy"] != "MASKED" {
		t.Fatalf("expected preview vault to return MASKED, got %#v", result)
	}
}

func TestRuntimeCookiesAndWebURLAPIs(t *testing.T) {
	result, err := NewRuntime().Execute(context.Background(), Input{Script: Script{Enabled: true, Code: `
pm.cookies.set("session", "rotated");
await pm.cookies.jar().set("https://example.com", {name:"locale", value:"en-IN"});
const target = new URL("/health?ready=false", "https://example.com/base");
target.searchParams.set("ready", "true");
pm.request.url = target.toString();
pm.test("cookie visible", () => pm.expect(pm.cookies.get("session")).to.equal("rotated"));`, RuntimeVersion: RuntimeVersion}, Cookies: map[string]string{"session": "initial"}, Variables: map[string]string{}, Collection: map[string]string{}, Environment: map[string]string{}, Globals: map[string]string{}, Request: &Request{Method: "GET", URL: "https://example.com", Headers: []Entry{}, Query: []Entry{}}, TimeoutMS: 1000})
	if err != nil {
		t.Fatal(err)
	}
	if result.Status != "SUCCESS" || result.InternalCookies["session"] != "rotated" || result.InternalCookies["locale"] != "en-IN" {
		t.Fatalf("cookie mutations missing: %#v", result)
	}
	if result.Request == nil || result.Request.URL != "https://example.com/health?ready=true" {
		t.Fatalf("URL mutation missing: %#v", result.Request)
	}
}

func TestRuntimeTimestampUUIDHeaderAndEnvironment(t *testing.T) {
	result, err := NewRuntime().Execute(context.Background(), Input{Script: Script{Enabled: true, Code: `
const timestamp = String(Date.now());
const id = crypto.randomUUID();
pm.environment.set("preparedAt", timestamp);
pm.variables.set("requestId", id);
pm.request.headers.upsert({key:"X-Request-ID", value:id});
pm.request.headers.upsert({key:"X-Prepared-At", value:timestamp});
pm.request.headers.remove("X-Remove-Me");
const rendered = pm.variables.replaceIn("id={{requestId}} guid={{$guid}} ts={{$timestamp}}");
console.log(rendered);
pm.test("env set", () => pm.expect(pm.environment.get("preparedAt")).to.equal(timestamp));
pm.test("header upsert", () => pm.expect(pm.request.headers.get("X-Request-ID")).to.equal(id));
pm.test("header removed", () => pm.expect(pm.request.headers.has("X-Remove-Me")).to.equal(false));
pm.test("replaceIn helpers", () => {
  pm.expect(rendered.includes("id="+id)).to.equal(true);
  pm.expect(rendered.includes("guid=")).to.equal(true);
  pm.expect(rendered.includes("ts=")).to.equal(true);
});
`, RuntimeVersion: RuntimeVersion}, Variables: map[string]string{}, Collection: map[string]string{}, Environment: map[string]string{}, Globals: map[string]string{}, Request: &Request{Method: "GET", URL: "https://example.com", Headers: []Entry{{Key: "X-Remove-Me", Value: "gone"}}, Query: []Entry{}}, TimeoutMS: 1000})
	if err != nil {
		t.Fatal(err)
	}
	if result.Status != "SUCCESS" {
		t.Fatalf("unexpected status: %#v", result)
	}
	if result.InternalEnvironment["preparedAt"] == "" || result.InternalVariables["requestId"] == "" {
		t.Fatalf("env/variable missing: %#v %#v", result.InternalEnvironment, result.InternalVariables)
	}
	if result.Request == nil || len(result.Request.Headers) != 2 {
		t.Fatalf("expected two headers after upsert/remove, got %#v", result.Request)
	}
	if len(result.Logs) == 0 || len(result.Tests) != 4 {
		t.Fatalf("evidence incomplete: %#v", result)
	}
}

func TestRuntimeMissingSecretFailsScript(t *testing.T) {
	result, err := NewRuntime().Execute(context.Background(), Input{Script: Script{Enabled: true, Code: `await pm.vault.get("missing-secret");`, RuntimeVersion: RuntimeVersion}, Variables: map[string]string{}, Collection: map[string]string{}, Environment: map[string]string{}, Globals: map[string]string{}, Secrets: map[string]string{}, Request: &Request{Method: "GET", URL: "https://example.com", Headers: []Entry{}, Query: []Entry{}}, TimeoutMS: 1000})
	if err != nil {
		t.Fatal(err)
	}
	if result.Status != "FAILED" || !strings.Contains(result.ErrorMessage, "not available") {
		t.Fatalf("expected missing secret failure, got %#v", result)
	}
}

func TestRuntimeSHA256Digest(t *testing.T) {
	result, err := NewRuntime().Execute(context.Background(), Input{Script: Script{Enabled: true, Code: `
const bytes = new TextEncoder().encode("hello");
const digest = await crypto.subtle.digest("SHA-256", bytes);
const hex = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
pm.variables.set("digest", hex);
pm.test("sha256", () => pm.expect(hex).to.equal("2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"));
`, RuntimeVersion: RuntimeVersion}, Variables: map[string]string{}, Collection: map[string]string{}, Environment: map[string]string{}, Globals: map[string]string{}, Request: &Request{Method: "GET", URL: "https://example.com", Headers: []Entry{}, Query: []Entry{}}, TimeoutMS: 1000})
	if err != nil {
		t.Fatal(err)
	}
	if result.Status != "SUCCESS" || result.InternalVariables["digest"] != "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824" {
		t.Fatalf("SHA-256 digest failed: %#v", result)
	}
}

func TestRuntimeSendRequestAcceptsHeadersAlias(t *testing.T) {
	var sawAccept string
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		sawAccept = r.Header.Get("Accept")
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer target.Close()

	code := fmt.Sprintf(`
const response = await pm.sendRequest({
  method: "GET",
  url: %q,
  headers: { Accept: "application/json" },
});
pm.variables.set("ok", String(response.json().ok));
`, target.URL)
	result, err := NewRuntime().Execute(context.Background(), Input{Script: Script{Enabled: true, Code: code, RuntimeVersion: RuntimeVersion}, AllowPrivateTargets: true, Variables: map[string]string{}, Collection: map[string]string{}, Environment: map[string]string{}, Globals: map[string]string{}, TimeoutMS: 2000})
	if err != nil {
		t.Fatal(err)
	}
	if result.Status != "SUCCESS" || result.InternalVariables["ok"] != "true" || sawAccept != "application/json" {
		t.Fatalf("headers alias sendRequest failed: %#v accept=%q", result, sawAccept)
	}
}

func TestRuntimeHMACAndAuxiliaryRequest(t *testing.T) {
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"token":"issued"}`))
	}))
	defer target.Close()

	mac := hmac.New(sha256.New, []byte("signing-secret"))
	_, _ = mac.Write([]byte("payload"))
	expected := fmt.Sprintf("%x", mac.Sum(nil))
	code := fmt.Sprintf(`
const encoder = new TextEncoder();
const key = await crypto.subtle.importKey("raw", encoder.encode(await pm.vault.get("hmac-secret")), {name:"HMAC",hash:"SHA-256"}, false, ["sign"]);
const bytes = new Uint8Array(await crypto.subtle.sign({name:"HMAC",hash:"SHA-256"}, key, encoder.encode("payload")));
const signature = Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
pm.request.headers.upsert({key:"X-Signature",value:signature,sensitive:true});
const response = await pm.sendRequest(%q);
pm.variables.set("token", response.json().token);
pm.test("HMAC generated", () => pm.expect(signature).to.equal(%q));`, target.URL, expected)
	result, err := NewRuntime().Execute(context.Background(), Input{Script: Script{Enabled: true, Code: code, RuntimeVersion: RuntimeVersion}, AllowPrivateTargets: true, Secrets: map[string]string{"hmac-secret": "signing-secret"}, Variables: map[string]string{}, Request: &Request{Method: "POST", URL: "https://example.com", Headers: []Entry{}, Query: []Entry{}, Body: map[string]any{"type": "raw", "content": "payload"}}, TimeoutMS: 2000})
	if err != nil {
		t.Fatal(err)
	}
	if result.Status != "SUCCESS" || result.InternalVariables["token"] != "issued" || len(result.AuxiliaryRequests) != 1 || !result.Tests[0].Passed {
		t.Fatalf("HMAC or auxiliary request support failed: %#v", result)
	}
	if result.Request.Headers[0].Value != "MASKED" || result.InternalRequest.Headers[0].Value != expected {
		t.Fatalf("HMAC evidence masking failed: %#v", result)
	}
}

func TestRuntimeResponseTestsPackagesStateAndVisualizer(t *testing.T) {
	result, err := NewRuntime().Execute(context.Background(), Input{
		Script: Script{Enabled: true, RuntimeVersion: RuntimeVersion, Code: `
const _ = pm.require("lodash");
const Ajv = require("ajv");
const uuid = pm.require("uuid");
const payload = pm.response.json();
const validate = new Ajv().compile({
  type: "object",
  required: ["data"],
  properties: { data: { type: "object", required: ["id"] } },
});
await pm.state.set("responseId", _.get(payload, "data.id"));
const count = await pm.state.increment("checks");
pm.visualizer.set("<h1>{{id}}</h1>", { id: _.get(payload, "data.id") });
pm.test("status", () => pm.response.to.have.status(200));
pm.test("header", () => pm.response.to.have.header("Content-Type", "application/json"));
pm.test("schema", () => pm.expect(validate(payload)).to.equal(true));
pm.test("uuid package", () => pm.expect(uuid.validate(_.get(payload, "data.id"))).to.equal(true));
pm.test("state increment", () => pm.expect(count).to.equal(1));
`},
		Scope:       "test",
		Variables:   map[string]string{},
		Environment: map[string]string{},
		Collection:  map[string]string{},
		Globals:     map[string]string{},
		Response: &Response{
			Code:           http.StatusOK,
			Status:         "200 OK",
			Headers:        map[string]string{"Content-Type": "application/json"},
			Body:           `{"data":{"id":"4d025591-54d9-4c59-85a8-f6456827b250"}}`,
			ResponseTimeMS: 42,
			ResponseSize:   58,
		},
		TimeoutMS: 1000,
		Info:      Info{EventName: "test", RuntimeVersion: RuntimeVersion},
	})
	if err != nil {
		t.Fatal(err)
	}
	if result.Status != "SUCCESS" || len(result.Tests) != 5 {
		t.Fatalf("response Tests APIs failed: %#v", result)
	}
	if result.Visualizer == nil || result.Visualizer.Data["id"] != "4d025591-54d9-4c59-85a8-f6456827b250" {
		t.Fatalf("visualizer evidence missing: %#v", result.Visualizer)
	}
	if result.InternalState["responseId"] != "4d025591-54d9-4c59-85a8-f6456827b250" {
		t.Fatalf("run-local state missing: %#v", result.InternalState)
	}
}

func TestConvertESModuleBundle(t *testing.T) {
	source, err := convertESModuleBundle(`var value={ok:true};var other=42;export{value as default,other as answer};`)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(source, `return {"default":value,"answer":other};`) {
		t.Fatalf("unexpected converted bundle: %s", source)
	}
}

func TestExternalPackageSpecifierRequiresExactVersion(t *testing.T) {
	_, _, err := NewRuntime().resolveExternalPackage(context.Background(), "npm:lodash@latest")
	if err == nil || !strings.Contains(err.Error(), "exact") {
		t.Fatalf("expected unversioned package to be rejected, got %v", err)
	}
}

func TestRuntimeContextSpecificAPIsFailClearly(t *testing.T) {
	result, err := NewRuntime().Execute(context.Background(), Input{
		Script: Script{Enabled: true, RuntimeVersion: RuntimeVersion, Code: `
pm.test("response absent", () => pm.expect(pm.response).to.equal(undefined));
try {
  pm.visualizer.set("<p>not available</p>", {});
} catch (error) {
  pm.variables.set("visualizerError", error.code);
}
try {
  void pm.message;
} catch (error) {
  pm.variables.set("messageError", error.code);
}
`},
		Scope:       "request",
		Variables:   map[string]string{},
		Environment: map[string]string{},
		Collection:  map[string]string{},
		Globals:     map[string]string{},
		TimeoutMS:   1000,
		Info:        Info{EventName: "prerequest", RuntimeVersion: RuntimeVersion},
	})
	if err != nil {
		t.Fatal(err)
	}
	if result.Status != "SUCCESS" || result.InternalVariables["visualizerError"] != "SCRIPT_CONTEXT_UNAVAILABLE" || result.InternalVariables["messageError"] != "SCRIPT_CONTEXT_UNAVAILABLE" {
		t.Fatalf("expected stable context errors, got %#v", result)
	}
}

func TestRuntimePostmanGlobalsAndCoreModules(t *testing.T) {
	result, err := NewRuntime().Execute(context.Background(), Input{
		Script: Script{Enabled: true, RuntimeVersion: RuntimeVersion, Code: `
const path = require("path");
const { Buffer, isAscii, isUtf8, transcode, resolveObjectURL } = require("buffer");
const querystring = require("querystring");
const cloned = structuredClone({ok:true});
const controller = new AbortController();
const file = new File(["hello"], "hello.txt", {type:"text/plain"});
const copied = Buffer.copyBytesFrom(new Uint16Array([0x1234, 0x5678]), 1, 1);
const latin = transcode(Buffer.from("Rhythm"), "utf8", "latin1");
const objectURL = URL.createObjectURL(file);
const encoded = Buffer.from("hello").toString("base64");
const parsed = querystring.parse("ready=true&id=42");
pm.test("core modules", () => {
  pm.expect(path.join("api", "v1", "health")).to.equal("api/v1/health");
  pm.expect(encoded).to.equal("aGVsbG8=");
  pm.expect(parsed.id).to.equal("42");
  pm.expect(cloned.ok).to.equal(true);
  pm.expect(file.name).to.equal("hello.txt");
  pm.expect(controller.signal.aborted).to.equal(false);
  pm.expect(copied.length).to.equal(2);
  pm.expect(isAscii(Buffer.from("Rhythm"))).to.equal(true);
  pm.expect(isUtf8(Buffer.from("✓"))).to.equal(true);
  pm.expect(isUtf8(Uint8Array.from([0xc3, 0x28]))).to.equal(false);
  pm.expect(latin.toString("latin1")).to.equal("Rhythm");
  pm.expect(resolveObjectURL(objectURL)).to.equal(file);
  URL.revokeObjectURL(objectURL);
});
`},
		Variables:   map[string]string{},
		Environment: map[string]string{},
		Collection:  map[string]string{},
		Globals:     map[string]string{},
		TimeoutMS:   1000,
	})
	if err != nil {
		t.Fatal(err)
	}
	if result.Status != "SUCCESS" || len(result.Tests) != 1 || !result.Tests[0].Passed {
		t.Fatalf("global and core compatibility failed: %#v", result)
	}
}

func TestRuntimeAcceptsLegacyRuntimeVersion(t *testing.T) {
	result, err := NewRuntime().Execute(context.Background(), Input{
		Script:      Script{Enabled: true, RuntimeVersion: LegacyRuntimeVersion, Code: `pm.variables.set("legacy","ok");`},
		Variables:   map[string]string{},
		Environment: map[string]string{},
		Collection:  map[string]string{},
		Globals:     map[string]string{},
		TimeoutMS:   1000,
	})
	if err != nil {
		t.Fatal(err)
	}
	if result.Status != "SUCCESS" || result.InternalVariables["legacy"] != "ok" || result.RuntimeVersion != RuntimeVersion {
		t.Fatalf("legacy scripts should execute on the compatible current runtime: %#v", result)
	}
}

func TestRuntimeLoadsRevisionScopedTeamPackage(t *testing.T) {
	result, err := NewRuntime().Execute(context.Background(), Input{
		Script: Script{
			Enabled:        true,
			RuntimeVersion: RuntimeVersion,
			Packages: []TeamPackage{{
				Name: "@rhythm/signing",
				Code: `module.exports = { sign(value) { return "signed:" + value; } };`,
			}},
			Code: `const signing = pm.require("@rhythm/signing"); pm.variables.set("signature", signing.sign("payload"));`,
		},
		Variables:   map[string]string{},
		Environment: map[string]string{},
		Collection:  map[string]string{},
		Globals:     map[string]string{},
		TimeoutMS:   1000,
	})
	if err != nil {
		t.Fatal(err)
	}
	if result.Status != "SUCCESS" || result.InternalVariables["signature"] != "signed:payload" || len(result.PackageImports) != 1 || result.PackageImports[0].Registry != "team" {
		t.Fatalf("team package did not execute: %#v", result)
	}
}

func TestRuntimeExecutionControls(t *testing.T) {
	result, err := NewRuntime().Execute(context.Background(), Input{
		Script: Script{
			Enabled:        true,
			RuntimeVersion: RuntimeVersion,
			Code: `
pm.execution.skipRequest();
pm.execution.setNextRequest("step-3");
pm.test("execution location", () => {
  pm.expect(pm.execution.location.current).to.equal("Login");
  pm.expect(pm.execution.location[0]).to.equal("monitor-1");
});
try {
  await pm.execution.runRequest("postman-request-id");
} catch (error) {
  pm.variables.set("runRequestError", error.code);
}
`,
		},
		Scope:       "request",
		Variables:   map[string]string{},
		Environment: map[string]string{},
		Collection:  map[string]string{},
		Globals:     map[string]string{},
		TimeoutMS:   1000,
		Info:        Info{MonitorID: "monitor-1", RequestName: "Login"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if result.Status != "SUCCESS" || !result.Execution.RequestSkipped || !result.Execution.NextRequestSet || result.Execution.NextRequest != "step-3" || result.InternalVariables["runRequestError"] != "SCRIPT_CONTEXT_UNAVAILABLE" {
		t.Fatalf("execution controls missing: %#v", result.Execution)
	}
}

func TestRuntimeStateAndCurrentIterationDataset(t *testing.T) {
	result, err := NewRuntime().Execute(context.Background(), Input{
		Script: Script{
			Enabled:        true,
			RuntimeVersion: RuntimeVersion,
			Code: `
await pm.state.set("counter", 1);
await pm.state.increment("counter", 2);
await pm.state.push("events", {type:"created"});
await pm.state.push("events", [{type:"updated"}]);
const firstRole = await pm.state.addToSet("roles", "admin");
const duplicateRole = await pm.state.addToSet("roles", "admin");
const removed = await pm.state.delete("counter");
const dataset = pm.datasets("current-iteration");
const all = await dataset.executeView("all");
const selected = await dataset.executeQuery(
  "SELECT * FROM current_iteration WHERE region = ?",
  ["eu"],
);
pm.test("state methods", async () => {
  pm.expect(firstRole).to.equal(true);
  pm.expect(duplicateRole).to.equal(false);
  pm.expect(removed).to.equal(true);
  pm.expect(await pm.state.has("counter")).to.equal(false);
  pm.expect((await pm.state.get("events")).length).to.equal(2);
});
pm.test("dataset handle", () => {
  pm.expect(all.rows.length).to.equal(1);
  pm.expect(selected.rows.length).to.equal(1);
  pm.expect(selected.rows[0].region).to.equal("eu");
});
`,
		},
		Scope:         "test",
		Variables:     map[string]string{},
		Environment:   map[string]string{},
		Collection:    map[string]string{},
		Globals:       map[string]string{},
		IterationData: map[string]string{"region": "eu", "build": "42"},
		TimeoutMS:     1000,
		Info:          Info{EventName: "test", RuntimeVersion: RuntimeVersion},
	})
	if err != nil {
		t.Fatal(err)
	}
	if result.Status != "SUCCESS" || len(result.Tests) != 2 || len(result.InternalState["events"].([]any)) != 2 {
		t.Fatalf("state and dataset APIs failed: %#v", result)
	}
}
