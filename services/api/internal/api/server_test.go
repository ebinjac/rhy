package api

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/rhythm-monitoring/rhythm/internal/agents"
	"github.com/rhythm-monitoring/rhythm/internal/authz"
	"github.com/rhythm-monitoring/rhythm/internal/monitors"
	"github.com/rhythm-monitoring/rhythm/internal/runs"
	"github.com/rhythm-monitoring/rhythm/internal/scripts"
	"github.com/rhythm-monitoring/rhythm/internal/suites"
)

func TestListMonitorsReturnsEnvelopeAndRequestID(t *testing.T) {
	handler := testServer()
	request := httptest.NewRequest(http.MethodGet, "/api/v1/monitors", nil)
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", response.Code)
	}
	if response.Header().Get("X-Request-ID") == "" {
		t.Fatal("expected X-Request-ID response header")
	}
	var body struct {
		Data []monitors.Monitor `json:"data"`
		Meta responseMeta       `json:"meta"`
	}
	if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(body.Data) == 0 || body.Meta.RequestID == "" {
		t.Fatalf("expected seeded monitors and response metadata")
	}
}

func TestScriptValidationAndPreview(t *testing.T) {
	runner := httptest.NewServer(scripts.NewHTTPHandler(scripts.NewRuntime(), "api-test-token"))
	defer runner.Close()
	handler := testServerWithScripts(scripts.NewClient(runner.URL, "api-test-token"))

	created := performRequest(handler, http.MethodPost, "/api/v1/monitors", `{"name":"Script preview","slug":"script-preview","definition":{"schemaVersion":2,"scripts":{"preRequest":{"enabled":false,"language":"javascript","code":"","runtimeVersion":"rhythm-js-1"}},"steps":[]}}`)
	if created.Code != http.StatusCreated {
		t.Fatalf("create monitor: %d %s", created.Code, created.Body.String())
	}
	var envelope struct {
		Data monitors.Monitor `json:"data"`
	}
	if err := json.NewDecoder(created.Body).Decode(&envelope); err != nil {
		t.Fatal(err)
	}

	validated := performRequest(handler, http.MethodPost, "/api/v1/scripts/validate", `{"code":"pm.variables.set('ready', 'yes')"}`)
	if validated.Code != http.StatusOK || !bytes.Contains(validated.Body.Bytes(), []byte(`"valid":true`)) {
		t.Fatalf("validate script: %d %s", validated.Code, validated.Body.String())
	}
	path := "/api/v1/monitors/" + envelope.Data.ID + "/revisions/" + envelope.Data.CurrentDraftRevisionID + "/scripts/preview"
	previewed := performRequest(handler, http.MethodPost, path, `{"scope":"request","stepId":"step-1","code":"pm.variables.set('ready','yes'); pm.request.headers.upsert({key:'X-Test',value:'ok'})","variables":{},"request":{"method":"GET","url":"https://example.com","headers":[],"query":[],"body":{},"auth":{}}}`)
	if previewed.Code != http.StatusOK || !bytes.Contains(previewed.Body.Bytes(), []byte(`"status":"SUCCESS"`)) || !bytes.Contains(previewed.Body.Bytes(), []byte(`"X-Test"`)) {
		t.Fatalf("preview script %s: %d %s", path, previewed.Code, previewed.Body.String())
	}
	if bytes.Contains(previewed.Body.Bytes(), []byte("internalVariables")) || bytes.Contains(previewed.Body.Bytes(), []byte("internalCookies")) || bytes.Contains(previewed.Body.Bytes(), []byte("internalRequest")) {
		t.Fatalf("preview exposed internal runner state: %s", previewed.Body.String())
	}

	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"token":"issued"}`))
	}))
	defer target.Close()
	networkBody, err := json.Marshal(map[string]any{
		"scope":     "monitor",
		"code":      fmt.Sprintf(`const response = await pm.sendRequest(%q); pm.variables.set('token', response.json().token);`, target.URL),
		"variables": map[string]string{},
	})
	if err != nil {
		t.Fatal(err)
	}
	network := performRequest(handler, http.MethodPost, path, string(networkBody))
	if network.Code != http.StatusOK || !bytes.Contains(network.Body.Bytes(), []byte(`"status":"SUCCESS"`)) || !bytes.Contains(network.Body.Bytes(), []byte(`"token"`)) {
		t.Fatalf("preview sendRequest: %d %s", network.Code, network.Body.String())
	}
}

func TestListRecentRunsValidatesLimit(t *testing.T) {
	handler := testServer()
	request := httptest.NewRequest(http.MethodGet, "/api/v1/runs?limit=201", nil)
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if response.Code != http.StatusBadRequest || !bytes.Contains(response.Body.Bytes(), []byte("INVALID_LIMIT")) {
		t.Fatalf("expected a structured invalid-limit response, got %d: %s", response.Code, response.Body.String())
	}
}

func TestCreateMonitorRejectsInvalidFields(t *testing.T) {
	handler := testServer()
	request := httptest.NewRequest(http.MethodPost, "/api/v1/monitors", bytes.NewBufferString(`{"name":"","slug":"Invalid Slug"}`))
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if response.Code != http.StatusUnprocessableEntity {
		t.Fatalf("expected 422, got %d", response.Code)
	}
	if !bytes.Contains(response.Body.Bytes(), []byte("MONITOR_VALIDATION_FAILED")) {
		t.Fatalf("expected structured validation error, got %s", response.Body.String())
	}
}

func TestCreateMonitorRejectsTrailingJSON(t *testing.T) {
	handler := testServer()
	request := httptest.NewRequest(http.MethodPost, "/api/v1/monitors", bytes.NewBufferString(`{"name":"Inventory health","slug":"inventory-health"}{}`))
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if response.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", response.Code)
	}
}

func TestCreateMonitorCreatesDraftRevision(t *testing.T) {
	handler := testServer()
	request := httptest.NewRequest(http.MethodPost, "/api/v1/monitors", bytes.NewBufferString(`{"name":"Inventory health","slug":"inventory-health","definition":{"schemaVersion":1,"steps":[{"id":"request-1","type":"HTTP_REQUEST","request":{"method":"GET","url":"https://example.com/health"}}]}}`))
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if response.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", response.Code, response.Body.String())
	}
	if response.Header().Get("Location") == "" {
		t.Fatal("expected Location header")
	}

	revisionsRequest := httptest.NewRequest(http.MethodGet, response.Header().Get("Location")+"/revisions", nil)
	revisionsResponse := httptest.NewRecorder()
	handler.ServeHTTP(revisionsResponse, revisionsRequest)
	if revisionsResponse.Code != http.StatusOK {
		t.Fatalf("expected revisions to load, got %d", revisionsResponse.Code)
	}
	if !bytes.Contains(revisionsResponse.Body.Bytes(), []byte(`"https://example.com/health"`)) {
		t.Fatalf("expected request definition in revision, got %s", revisionsResponse.Body.String())
	}
}

func TestUpdateMonitorRequiresETag(t *testing.T) {
	handler := testServer()
	request := httptest.NewRequest(http.MethodPatch, "/api/v1/monitors/payments-prod", bytes.NewBufferString(`{"name":"Updated name"}`))
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if response.Code != http.StatusPreconditionRequired {
		t.Fatalf("expected 428, got %d: %s", response.Code, response.Body.String())
	}
}

func TestUpdateMonitorUsesOptimisticConcurrency(t *testing.T) {
	handler := testServer()
	getRequest := httptest.NewRequest(http.MethodGet, "/api/v1/monitors/payments-prod", nil)
	getResponse := httptest.NewRecorder()
	handler.ServeHTTP(getResponse, getRequest)
	etag := getResponse.Header().Get("ETag")
	if etag == "" {
		t.Fatal("expected monitor ETag")
	}

	updateRequest := httptest.NewRequest(http.MethodPatch, "/api/v1/monitors/payments-prod", bytes.NewBufferString(`{"name":"Updated payment journey","tags":["payments","critical"]}`))
	updateRequest.Header.Set("Content-Type", "application/json")
	updateRequest.Header.Set("If-Match", etag)
	updateResponse := httptest.NewRecorder()
	handler.ServeHTTP(updateResponse, updateRequest)
	if updateResponse.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", updateResponse.Code, updateResponse.Body.String())
	}
	if updateResponse.Header().Get("ETag") == etag {
		t.Fatal("expected a new ETag after update")
	}

	staleRequest := httptest.NewRequest(http.MethodPatch, "/api/v1/monitors/payments-prod", bytes.NewBufferString(`{"name":"Stale update"}`))
	staleRequest.Header.Set("Content-Type", "application/json")
	staleRequest.Header.Set("If-Match", etag)
	staleResponse := httptest.NewRecorder()
	handler.ServeHTTP(staleResponse, staleRequest)
	if staleResponse.Code != http.StatusPreconditionFailed {
		t.Fatalf("expected 412, got %d: %s", staleResponse.Code, staleResponse.Body.String())
	}
}

func TestDeleteMonitorSoftDeletesFromAPI(t *testing.T) {
	handler := testServer()
	deleteRequest := httptest.NewRequest(http.MethodDelete, "/api/v1/monitors/payments-prod", nil)
	deleteResponse := httptest.NewRecorder()
	handler.ServeHTTP(deleteResponse, deleteRequest)
	if deleteResponse.Code != http.StatusNoContent {
		t.Fatalf("expected 204, got %d: %s", deleteResponse.Code, deleteResponse.Body.String())
	}

	getRequest := httptest.NewRequest(http.MethodGet, "/api/v1/monitors/payments-prod", nil)
	getResponse := httptest.NewRecorder()
	handler.ServeHTTP(getResponse, getRequest)
	if getResponse.Code != http.StatusNotFound {
		t.Fatalf("expected 404 after deletion, got %d", getResponse.Code)
	}
}

func TestBulkDeleteMonitorsPermanently(t *testing.T) {
	handler := testServer()
	deleteRequest := httptest.NewRequest(http.MethodPost, "/api/v1/monitors/bulk-delete", bytes.NewBufferString(`{"monitorIds":["payments-prod","orders-staging"]}`))
	deleteRequest.Header.Set("Content-Type", "application/json")
	deleteResponse := httptest.NewRecorder()
	handler.ServeHTTP(deleteResponse, deleteRequest)
	if deleteResponse.Code != http.StatusOK || !bytes.Contains(deleteResponse.Body.Bytes(), []byte(`"deletedCount":2`)) {
		t.Fatalf("expected two permanently deleted monitors, got %d: %s", deleteResponse.Code, deleteResponse.Body.String())
	}
	for _, monitorID := range []string{"payments-prod", "orders-staging"} {
		getRequest := httptest.NewRequest(http.MethodGet, "/api/v1/monitors/"+monitorID, nil)
		getResponse := httptest.NewRecorder()
		handler.ServeHTTP(getResponse, getRequest)
		if getResponse.Code != http.StatusNotFound {
			t.Fatalf("expected %s to be permanently deleted, got %d", monitorID, getResponse.Code)
		}
	}
}

func TestManualRunExecutesDraftAndReturnsEvidence(t *testing.T) {
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"status":"ready"}`))
	}))
	defer target.Close()
	handler := testServer()
	createBody := fmt.Sprintf(`{"name":"Executable monitor","slug":"executable-monitor","definition":{"steps":[{"id":"step-1","name":"Health","type":"HTTP_REQUEST","enabled":true,"timeoutMs":1000,"request":{"method":"GET","url":%q,"assertions":[{"enabled":true,"type":"jsonpath","expression":"$.status","expected":"ready"}],"settings":{"timeoutMs":1000}}}]}}`, target.URL)
	createRequest := httptest.NewRequest(http.MethodPost, "/api/v1/monitors", bytes.NewBufferString(createBody))
	createRequest.Header.Set("Content-Type", "application/json")
	createResponse := httptest.NewRecorder()
	handler.ServeHTTP(createResponse, createRequest)
	if createResponse.Code != http.StatusCreated {
		t.Fatalf("expected monitor creation, got %d: %s", createResponse.Code, createResponse.Body.String())
	}
	var created struct {
		Data monitors.Monitor `json:"data"`
	}
	if err := json.NewDecoder(createResponse.Body).Decode(&created); err != nil {
		t.Fatalf("decode monitor: %v", err)
	}

	runRequest := httptest.NewRequest(http.MethodPost, "/api/v1/monitors/"+created.Data.ID+"/runs?wait=true", nil)
	runResponse := httptest.NewRecorder()
	handler.ServeHTTP(runResponse, runRequest)
	if runResponse.Code != http.StatusCreated {
		t.Fatalf("expected run creation, got %d: %s", runResponse.Code, runResponse.Body.String())
	}
	if !bytes.Contains(runResponse.Body.Bytes(), []byte(`"status":"SUCCESS"`)) || !bytes.Contains(runResponse.Body.Bytes(), []byte(`"passed":true`)) {
		t.Fatalf("expected successful evidence, got %s", runResponse.Body.String())
	}
	var executed struct {
		Data struct {
			Run runs.Run `json:"run"`
		} `json:"data"`
	}
	if err := json.Unmarshal(runResponse.Body.Bytes(), &executed); err != nil {
		t.Fatalf("decode run response: %v", err)
	}
	diagnosticsResponse := performRequest(handler, http.MethodGet, "/api/v1/runs/"+executed.Data.Run.ID+"/diagnostics", "")
	if diagnosticsResponse.Code != http.StatusOK {
		t.Fatalf("expected diagnostics, got %d: %s", diagnosticsResponse.Code, diagnosticsResponse.Body.String())
	}
	for _, evidence := range []string{`"analysis"`, `"stepTimeMs"`, `"durationShare"`, `"events"`, `"attempts"`} {
		if !bytes.Contains(diagnosticsResponse.Body.Bytes(), []byte(evidence)) {
			t.Fatalf("expected %s in diagnostics, got %s", evidence, diagnosticsResponse.Body.String())
		}
	}
}

func TestManualRunReturnsQueuedLifecycle(t *testing.T) {
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))
	defer target.Close()
	handler := testServer()
	createBody := fmt.Sprintf(`{"name":"Queued monitor","slug":"queued-monitor","definition":{"steps":[{"id":"step-1","name":"Health","type":"HTTP_REQUEST","enabled":true,"request":{"method":"GET","url":%q,"settings":{"timeoutMs":1000}}}]}}`, target.URL)
	createResponse := performRequest(handler, http.MethodPost, "/api/v1/monitors", createBody)
	var created struct {
		Data monitors.Monitor `json:"data"`
	}
	if err := json.NewDecoder(createResponse.Body).Decode(&created); err != nil {
		t.Fatal(err)
	}
	runResponse := performRequest(handler, http.MethodPost, "/api/v1/monitors/"+created.Data.ID+"/runs", "")
	if runResponse.Code != http.StatusAccepted || !bytes.Contains(runResponse.Body.Bytes(), []byte(`"status":"QUEUED"`)) {
		t.Fatalf("expected a queued 202 response, got %d: %s", runResponse.Code, runResponse.Body.String())
	}
	if location := runResponse.Header().Get("Location"); !strings.HasSuffix(location, "/diagnostics") {
		t.Fatalf("expected diagnostics Location, got %q", location)
	}
}

func TestActiveRunCanBeCancelled(t *testing.T) {
	target := httptest.NewServer(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		<-r.Context().Done()
	}))
	defer target.Close()
	handler := testServer()
	createBody := fmt.Sprintf(`{"name":"Cancellation monitor","slug":"cancellation-monitor","definition":{"steps":[{"id":"slow-step","name":"Slow request","type":"HTTP_REQUEST","enabled":true,"request":{"method":"GET","url":%q,"settings":{"timeoutMs":10000}}}]}}`, target.URL)
	createResponse := performRequest(handler, http.MethodPost, "/api/v1/monitors", createBody)
	var created struct {
		Data monitors.Monitor `json:"data"`
	}
	if err := json.NewDecoder(createResponse.Body).Decode(&created); err != nil {
		t.Fatal(err)
	}
	runResponse := performRequest(handler, http.MethodPost, "/api/v1/monitors/"+created.Data.ID+"/runs", "")
	var queued struct {
		Data struct {
			RunID string `json:"runId"`
		} `json:"data"`
	}
	if err := json.NewDecoder(runResponse.Body).Decode(&queued); err != nil {
		t.Fatal(err)
	}
	cancelResponse := performRequest(handler, http.MethodPost, "/api/v1/runs/"+queued.Data.RunID+"/cancel", "")
	if cancelResponse.Code != http.StatusAccepted {
		t.Fatalf("expected cancellation acceptance, got %d: %s", cancelResponse.Code, cancelResponse.Body.String())
	}
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		diagnosticsResponse := performRequest(handler, http.MethodGet, "/api/v1/runs/"+queued.Data.RunID+"/diagnostics", "")
		if bytes.Contains(diagnosticsResponse.Body.Bytes(), []byte(`"status":"CANCELLED"`)) {
			if !bytes.Contains(diagnosticsResponse.Body.Bytes(), []byte(`"phase":"CANCELLATION"`)) {
				t.Fatalf("expected structured cancellation failure, got %s", diagnosticsResponse.Body.String())
			}
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("run did not reach CANCELLED status")
}

func TestMonitorLifecyclePublishesImmutableRevisionAndChangesState(t *testing.T) {
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusNoContent) }))
	defer target.Close()
	handler := testServer()
	createBody := fmt.Sprintf(`{"name":"Lifecycle monitor","slug":"lifecycle-monitor","definition":{"steps":[{"id":"step-1","name":"Health","type":"HTTP_REQUEST","enabled":true,"request":{"method":"GET","url":%q,"settings":{"timeoutMs":1000}}}]}}`, target.URL)
	createResponse := performRequest(handler, http.MethodPost, "/api/v1/monitors", createBody)
	if createResponse.Code != http.StatusCreated {
		t.Fatalf("create monitor: %d %s", createResponse.Code, createResponse.Body.String())
	}
	var created struct {
		Data monitors.Monitor `json:"data"`
	}
	if err := json.NewDecoder(createResponse.Body).Decode(&created); err != nil {
		t.Fatal(err)
	}
	base := "/api/v1/monitors/" + created.Data.ID

	validateResponse := performRequest(handler, http.MethodPost, base+"/validate", "")
	if validateResponse.Code != http.StatusOK || !bytes.Contains(validateResponse.Body.Bytes(), []byte(`"valid":true`)) {
		t.Fatalf("validate monitor: %d %s", validateResponse.Code, validateResponse.Body.String())
	}
	publishResponse := performRequest(handler, http.MethodPost, base+"/publish", `{"changeSummary":"Initial production revision"}`)
	if publishResponse.Code != http.StatusOK || !bytes.Contains(publishResponse.Body.Bytes(), []byte(`"status":"PUBLISHED"`)) {
		t.Fatalf("publish monitor: %d %s", publishResponse.Code, publishResponse.Body.String())
	}
	revisionsResponse := performRequest(handler, http.MethodGet, base+"/revisions", "")
	var revisions struct {
		Data []monitors.Revision `json:"data"`
	}
	if err := json.NewDecoder(revisionsResponse.Body).Decode(&revisions); err != nil {
		t.Fatal(err)
	}
	if len(revisions.Data) != 2 || revisions.Data[0].Status != monitors.RevisionDraft || revisions.Data[1].Status != monitors.RevisionPublished {
		t.Fatalf("expected next draft and immutable published revision, got %#v", revisions.Data)
	}

	enableResponse := performRequest(handler, http.MethodPost, base+"/enable", "")
	if enableResponse.Code != http.StatusOK || !bytes.Contains(enableResponse.Body.Bytes(), []byte(`"state":"ENABLED"`)) {
		t.Fatalf("enable: %s", enableResponse.Body.String())
	}
	runResponse := performRequest(handler, http.MethodPost, base+"/runs?revision=published&wait=true", "")
	if runResponse.Code != http.StatusCreated || !bytes.Contains(runResponse.Body.Bytes(), []byte(`"triggerType":"MANUAL_PUBLISHED"`)) {
		t.Fatalf("published run: %s", runResponse.Body.String())
	}
	disableResponse := performRequest(handler, http.MethodPost, base+"/disable", "")
	if disableResponse.Code != http.StatusOK || !bytes.Contains(disableResponse.Body.Bytes(), []byte(`"state":"DISABLED"`)) {
		t.Fatalf("disable: %s", disableResponse.Body.String())
	}
	archiveResponse := performRequest(handler, http.MethodPost, base+"/archive", "")
	if archiveResponse.Code != http.StatusOK || !bytes.Contains(archiveResponse.Body.Bytes(), []byte(`"state":"ARCHIVED"`)) {
		t.Fatalf("archive: %s", archiveResponse.Body.String())
	}
	restoreResponse := performRequest(handler, http.MethodPost, base+"/restore", "")
	if restoreResponse.Code != http.StatusOK || !bytes.Contains(restoreResponse.Body.Bytes(), []byte(`"state":"DISABLED"`)) {
		t.Fatalf("restore: %s", restoreResponse.Body.String())
	}

	cloneResponse := performRequest(handler, http.MethodPost, base+"/clone", `{"name":"Lifecycle monitor copy","slug":"lifecycle-monitor-copy"}`)
	if cloneResponse.Code != http.StatusCreated || !bytes.Contains(cloneResponse.Body.Bytes(), []byte(`"state":"DRAFT"`)) {
		t.Fatalf("clone: %s", cloneResponse.Body.String())
	}
}

func TestMultiStepRunPassesExtractorOutputToLaterTemplate(t *testing.T) {
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path == "/create" {
			_, _ = w.Write([]byte(`{"id":"order-42"}`))
			return
		}
		if r.URL.Path != "/orders/order-42" {
			t.Fatalf("later step received unexpected path %s", r.URL.Path)
		}
		_, _ = w.Write([]byte(`{"state":"ready"}`))
	}))
	defer target.Close()
	handler := testServer()
	createBody := fmt.Sprintf(`{"name":"Multi step","slug":"multi-step","definition":{"steps":[{"id":"create","name":"Create","type":"HTTP_REQUEST","enabled":true,"request":{"method":"POST","url":%q,"extractors":[{"enabled":true,"source":"jsonpath","variable":"orderId","expression":"$.id"}],"settings":{"timeoutMs":1000}}},{"id":"lookup","name":"Lookup","type":"HTTP_REQUEST","enabled":true,"request":{"method":"GET","url":%q,"assertions":[{"enabled":true,"type":"jsonpath","expression":"$.state","expected":"ready"}],"settings":{"timeoutMs":1000}}}]}}`, target.URL+"/create", target.URL+"/orders/{{ steps.create.outputs.orderId }}")
	created := performRequest(handler, http.MethodPost, "/api/v1/monitors", createBody)
	var payload struct {
		Data monitors.Monitor `json:"data"`
	}
	if err := json.NewDecoder(created.Body).Decode(&payload); err != nil {
		t.Fatal(err)
	}
	run := performRequest(handler, http.MethodPost, "/api/v1/monitors/"+payload.Data.ID+"/runs?revision=draft&wait=true", "")
	if run.Code != http.StatusCreated || !bytes.Contains(run.Body.Bytes(), []byte(`"status":"SUCCESS"`)) || !bytes.Contains(run.Body.Bytes(), []byte(`"stepName":"Lookup"`)) {
		t.Fatalf("expected multi-step success, got %d %s", run.Code, run.Body.String())
	}
}

func TestActionStepProducesMaskedOutputsForLaterRequest(t *testing.T) {
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/orders/order-42" {
			t.Fatalf("unexpected action-rendered path %s", r.URL.Path)
		}
		if r.Header.Get("X-Signature") == "" {
			t.Fatal("expected action-produced signature")
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	defer target.Close()
	handler := testServer()
	createBody := fmt.Sprintf(`{"name":"Action chain","slug":"action-chain","definition":{"steps":[{"id":"material","name":"Build material","type":"ACTION","enabled":true,"actions":[{"enabled":true,"type":"SET_VARIABLE","output":"orderId","expression":"order-42"},{"enabled":true,"type":"GENERATE_HMAC","output":"signature","expression":"order-42","sensitive":true,"fields":{"secret":"signing-secret","algorithm":"SHA256","outputEncoding":"BASE64"}}]},{"id":"lookup","name":"Lookup","type":"HTTP_REQUEST","enabled":true,"request":{"method":"GET","url":%q,"headers":[{"enabled":true,"key":"X-Signature","value":"{{ steps.material.outputs.signature }}","sensitive":true}],"assertions":[{"enabled":true,"type":"status","expected":"204"}],"settings":{"timeoutMs":1000}}}]}}`, target.URL+"/orders/{{ steps.material.outputs.orderId }}")
	created := performRequest(handler, http.MethodPost, "/api/v1/monitors", createBody)
	if created.Code != http.StatusCreated {
		t.Fatalf("create action monitor: %d %s", created.Code, created.Body.String())
	}
	var payload struct {
		Data monitors.Monitor `json:"data"`
	}
	if err := json.NewDecoder(created.Body).Decode(&payload); err != nil {
		t.Fatal(err)
	}
	run := performRequest(handler, http.MethodPost, "/api/v1/monitors/"+payload.Data.ID+"/runs?revision=draft&wait=true", "")
	if run.Code != http.StatusCreated || !bytes.Contains(run.Body.Bytes(), []byte(`"status":"SUCCESS"`)) {
		t.Fatalf("action run failed: %d %s", run.Code, run.Body.String())
	}
	if bytes.Contains(run.Body.Bytes(), []byte("signing-secret")) {
		t.Fatal("sensitive action input leaked in run response")
	}
	if !bytes.Contains(run.Body.Bytes(), []byte(`"sensitive":true`)) {
		t.Fatalf("expected sensitive output metadata, got %s", run.Body.String())
	}
}

func TestSensitiveExtractorChainsWithoutLeakingRunEvidence(t *testing.T) {
	const token = "workflow-secret-token-7492"
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path == "/token" {
			_, _ = w.Write([]byte(`{"access_token":"` + token + `"}`))
			return
		}
		if r.URL.Path != "/protected" || r.Header.Get("Authorization") != "Bearer "+token {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer target.Close()

	handler := testServer()
	createBody := fmt.Sprintf(`{"name":"Sensitive chain","slug":"sensitive-chain","definition":{"steps":[{"id":"token","name":"Get token","type":"HTTP_REQUEST","enabled":true,"request":{"method":"POST","url":%q,"extractors":[{"enabled":true,"source":"jsonpath","variable":"accessToken","expression":"$.access_token","sensitive":true}],"settings":{"timeoutMs":1000}}},{"id":"protected","name":"Use token","type":"HTTP_REQUEST","enabled":true,"request":{"method":"GET","url":%q,"auth":{"type":"bearer","fields":{"token":"{{ steps.token.outputs.accessToken }}"}},"assertions":[{"enabled":true,"type":"status","expected":"200"}],"settings":{"timeoutMs":1000}}}]}}`, target.URL+"/token", target.URL+"/protected")
	created := performRequest(handler, http.MethodPost, "/api/v1/monitors", createBody)
	if created.Code != http.StatusCreated {
		t.Fatalf("create sensitive monitor: %d %s", created.Code, created.Body.String())
	}
	var payload struct {
		Data monitors.Monitor `json:"data"`
	}
	if err := json.NewDecoder(created.Body).Decode(&payload); err != nil {
		t.Fatal(err)
	}
	run := performRequest(handler, http.MethodPost, "/api/v1/monitors/"+payload.Data.ID+"/runs?revision=draft&wait=true", "")
	if run.Code != http.StatusCreated || !bytes.Contains(run.Body.Bytes(), []byte(`"status":"SUCCESS"`)) {
		t.Fatalf("sensitive chain failed: %d %s", run.Code, run.Body.String())
	}
	if bytes.Contains(run.Body.Bytes(), []byte(token)) {
		t.Fatalf("sensitive extractor leaked in run evidence: %s", run.Body.String())
	}
	if !bytes.Contains(run.Body.Bytes(), []byte(`"value":"••••••••"`)) {
		t.Fatalf("sensitive extractor was not masked: %s", run.Body.String())
	}
}

func TestConditionalStepUsesPriorResponseAndRecordsSkip(t *testing.T) {
	var skippedEndpointCalled bool
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/probe" {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		skippedEndpointCalled = true
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer target.Close()

	handler := testServer()
	createBody := fmt.Sprintf(`{"name":"Conditional","slug":"conditional","definition":{"steps":[{"id":"probe","name":"Probe","type":"HTTP_REQUEST","enabled":true,"request":{"method":"GET","url":%q,"settings":{"timeoutMs":1000}}},{"id":"cleanup","name":"Cleanup","type":"HTTP_REQUEST","enabled":true,"condition":"{{ steps.probe.response.statusCode != 204 }}","request":{"method":"POST","url":%q,"settings":{"timeoutMs":1000}}}]}}`, target.URL+"/probe", target.URL+"/cleanup")
	created := performRequest(handler, http.MethodPost, "/api/v1/monitors", createBody)
	var payload struct {
		Data monitors.Monitor `json:"data"`
	}
	if err := json.NewDecoder(created.Body).Decode(&payload); err != nil {
		t.Fatal(err)
	}
	run := performRequest(handler, http.MethodPost, "/api/v1/monitors/"+payload.Data.ID+"/runs?revision=draft&wait=true", "")
	if run.Code != http.StatusCreated || !bytes.Contains(run.Body.Bytes(), []byte(`"status":"SKIPPED_CONDITION"`)) || !bytes.Contains(run.Body.Bytes(), []byte(`"status":"SUCCESS"`)) {
		t.Fatalf("conditional run failed: %d %s", run.Code, run.Body.String())
	}
	if skippedEndpointCalled {
		t.Fatal("conditional step sent an HTTP request despite false condition")
	}
}

func TestValidationSuiteAPICreatesAndListsOrderedStages(t *testing.T) {
	handler := testServer()
	body := `{"name":"Production deployment gate","environment":"production","parallelism":2,"failFast":true,"timeoutSeconds":300,"stages":[{"id":"availability","name":"Availability","order":1,"checks":[{"id":"payments","monitorId":"payments-prod","name":"Payments health","required":true}]}]}`
	created := performRequest(handler, http.MethodPost, "/api/v1/suites", body)
	if created.Code != http.StatusCreated || !bytes.Contains(created.Body.Bytes(), []byte(`"name":"Production deployment gate"`)) {
		t.Fatalf("create validation suite: %d %s", created.Code, created.Body.String())
	}
	listed := performRequest(handler, http.MethodGet, "/api/v1/suites", "")
	if listed.Code != http.StatusOK || !bytes.Contains(listed.Body.Bytes(), []byte("Production deployment gate")) {
		t.Fatalf("list validation suites: %d %s", listed.Code, listed.Body.String())
	}
}

func TestValidationSuiteAPIUpdatesAndDeletes(t *testing.T) {
	handler := testServer()
	created := performRequest(handler, http.MethodPost, "/api/v1/suites", `{"name":"Staging gate","environment":"staging","parallelism":1,"failFast":true,"timeoutSeconds":300,"stages":[{"id":"smoke","name":"Smoke","order":1,"checks":[{"id":"health","kind":"MONITOR","monitorId":"payments-prod","name":"Health","required":true}]}]}`)
	if created.Code != http.StatusCreated {
		t.Fatalf("create validation suite: %d %s", created.Code, created.Body.String())
	}
	var payload struct {
		Data struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if err := json.NewDecoder(created.Body).Decode(&payload); err != nil {
		t.Fatal(err)
	}
	updated := performRequest(handler, http.MethodPatch, "/api/v1/suites/"+payload.Data.ID, `{"name":"Staging gate v2","environment":"staging","description":"Updated","parallelism":2,"failFast":false,"timeoutSeconds":600,"baselinePolicy":"NONE","notificationPolicy":"FAILURES","stages":[{"id":"smoke","name":"Smoke","order":1,"checks":[{"id":"health","kind":"MONITOR","monitorId":"payments-prod","name":"Health","required":true}]}]}`)
	if updated.Code != http.StatusOK || !bytes.Contains(updated.Body.Bytes(), []byte(`"name":"Staging gate v2"`)) || !bytes.Contains(updated.Body.Bytes(), []byte(`"parallelism":2`)) {
		t.Fatalf("update validation suite: %d %s", updated.Code, updated.Body.String())
	}
	deleted := performRequest(handler, http.MethodDelete, "/api/v1/suites/"+payload.Data.ID, "")
	if deleted.Code != http.StatusNoContent {
		t.Fatalf("delete validation suite: %d %s", deleted.Code, deleted.Body.String())
	}
	missing := performRequest(handler, http.MethodGet, "/api/v1/suites/"+payload.Data.ID, "")
	if missing.Code != http.StatusNotFound {
		t.Fatalf("deleted suite should be missing: %d %s", missing.Code, missing.Body.String())
	}
}

func TestExecutionAgentRegistrationHeartbeatAndDrainAPI(t *testing.T) {
	handler := testServer()
	registered := performRequest(handler, http.MethodPost, "/api/v1/agents/register", `{"name":"datacenter-a","groupId":"private","version":"1.2.3","tags":["internal","east"],"capabilities":{"mtls":true},"maxConcurrency":4}`)
	if registered.Code != http.StatusCreated {
		t.Fatalf("register agent: %d %s", registered.Code, registered.Body.String())
	}
	var payload struct {
		Data agents.Agent `json:"data"`
	}
	if err := json.NewDecoder(registered.Body).Decode(&payload); err != nil {
		t.Fatal(err)
	}
	heartbeat := performRequest(handler, http.MethodPost, "/api/v1/agents/"+payload.Data.ID+"/heartbeat", `{"version":"1.2.4","tags":["internal","east"],"capabilities":{"mtls":true,"socks5":true},"maxConcurrency":4,"activeRuns":1}`)
	if heartbeat.Code != http.StatusOK || !bytes.Contains(heartbeat.Body.Bytes(), []byte(`"health":"HEALTHY"`)) {
		t.Fatalf("heartbeat: %d %s", heartbeat.Code, heartbeat.Body.String())
	}
	drained := performRequest(handler, http.MethodPost, "/api/v1/agents/"+payload.Data.ID+"/drain", "")
	if drained.Code != http.StatusOK || !bytes.Contains(drained.Body.Bytes(), []byte(`"status":"DRAINING"`)) {
		t.Fatalf("drain: %d %s", drained.Code, drained.Body.String())
	}
}

func performRequest(handler http.Handler, method, path, body string) *httptest.ResponseRecorder {
	var reader io.Reader
	if body != "" {
		reader = bytes.NewBufferString(body)
	}
	request := httptest.NewRequest(method, path, reader)
	if body != "" {
		request.Header.Set("Content-Type", "application/json")
	}
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	return response
}

func testServer() http.Handler {
	return testServerWithScripts(nil)
}

func testServerWithScripts(scriptClient *scripts.Client) http.Handler {
	repository := monitors.NewMemoryRepository(monitors.DevelopmentSeed())
	monitorService := monitors.NewService(repository)
	runService := runs.NewService(monitorService, runs.NewMemoryRepository(), runs.NewHTTPExecutor(true))
	agentService := agents.New(agents.NewMemoryRepository())
	runService.SetAgentRouter(agentService)
	return NewServer(Dependencies{
		Logger: slog.New(slog.NewTextHandler(io.Discard, nil)), Monitors: monitorService,
		Runs:                runService,
		Suites:              suites.New(suites.NewMemoryRepository(), runService),
		Agents:              agentService,
		Scripts:             scriptClient,
		Authenticator:       authz.NewDevelopmentAuthenticator("test-admin"),
		AllowedOrigin:       "http://localhost:3000",
		AllowPrivateTargets: true,
	})
}
