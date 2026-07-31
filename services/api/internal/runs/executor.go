package runs

import (
	"bytes"
	"context"
	"crypto"
	"crypto/hmac"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/sha512"
	"crypto/tls"
	"crypto/x509"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"io"
	"math/big"
	"mime/multipart"
	"net"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptrace"
	"net/url"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/rhythm-monitoring/rhythm/internal/id"
	"github.com/rhythm-monitoring/rhythm/internal/scripts"
	jsonschema "github.com/santhosh-tekuri/jsonschema/v6"
	xproxy "golang.org/x/net/proxy"
)

const defaultMaxBodyBytes = 1 << 20

var templatePattern = regexp.MustCompile(`\{\{\s*([^{}]+?)\s*\}\}`)

var ErrTargetLimiterUnavailable = errors.New("distributed target concurrency limiter is unavailable")

type TargetConcurrencyLimiter interface {
	Acquire(context.Context, string, int) (func(), error)
}

func int64FromAny(value any) int64 {
	switch typed := value.(type) {
	case int64:
		return typed
	case int:
		return int64(typed)
	case float64:
		return int64(typed)
	case json.Number:
		parsed, _ := typed.Int64()
		return parsed
	default:
		parsed, _ := strconv.ParseInt(fmt.Sprint(value), 10, 64)
		return parsed
	}
}

type HTTPExecutor struct {
	allowPrivate  bool
	resolver      RuntimeResolver
	scripts       scripts.Executor
	hostMu        sync.Mutex
	hostLimit     int
	hostSlots     map[string]chan struct{}
	targetLimiter TargetConcurrencyLimiter
	caCache       sync.Map
}

type TLSMaterial struct {
	ClientCertificatePEM string
	ClientKeyPEM         string
	CABundlePEM          string
}
type ProxyMaterial struct {
	URL      string
	NoProxy  string
	Username string
	Password string
}
type TelemetryMaterial struct {
	BaseURL string
	Token   string
}
type EnvironmentMaterial struct {
	ID, Name, ProfileType, BaseURL, Region, UpdatedAt string
	Variables                                         map[string]string
}
type EnvironmentResolver interface {
	ResolveEnvironmentProfile(context.Context, string) (EnvironmentMaterial, error)
}
type RuntimeResolver interface {
	ResolveSecret(context.Context, string) (string, error)
	ResolveTLSProfile(context.Context, string, string) (TLSMaterial, error)
	ResolveProxyProfile(context.Context, string) (ProxyMaterial, error)
	ResolveTelemetryProfile(context.Context, string) (TelemetryMaterial, error)
}

func NewHTTPExecutor(allowPrivate bool) *HTTPExecutor {
	return &HTTPExecutor{allowPrivate: allowPrivate, hostLimit: 16, hostSlots: map[string]chan struct{}{}}
}

func NewHTTPExecutorWithResolver(allowPrivate bool, resolver RuntimeResolver) *HTTPExecutor {
	return &HTTPExecutor{allowPrivate: allowPrivate, resolver: resolver, hostLimit: 16, hostSlots: map[string]chan struct{}{}}
}

func (e *HTTPExecutor) SetScriptExecutor(executor scripts.Executor) { e.scripts = executor }

func (e *HTTPExecutor) SetTargetHostConcurrency(limit int) {
	if limit < 1 {
		limit = 16
	}
	e.hostMu.Lock()
	e.hostLimit = limit
	e.hostSlots = map[string]chan struct{}{}
	e.hostMu.Unlock()
}

func (e *HTTPExecutor) SetTargetConcurrencyLimiter(limiter TargetConcurrencyLimiter) {
	e.hostMu.Lock()
	e.targetLimiter = limiter
	e.hostMu.Unlock()
}

func (e *HTTPExecutor) LoadEnvironment(ctx context.Context, environmentID string) (EnvironmentMaterial, error) {
	if strings.TrimSpace(environmentID) == "" {
		return EnvironmentMaterial{Variables: map[string]string{}}, nil
	}
	resolver, ok := e.resolver.(EnvironmentResolver)
	if !ok {
		return EnvironmentMaterial{}, errors.New("environment profiles require the configuration library resolver")
	}
	return resolver.ResolveEnvironmentProfile(ctx, environmentID)
}

type ScriptExecutionContext struct {
	MonitorID, RunID, RevisionID, StepID, StepName string
}

func (e *HTTPExecutor) Execute(ctx context.Context, definition StepDefinition) StepRun {
	jar, _ := cookiejar.New(nil)
	return e.ExecuteWithJar(ctx, definition, jar)
}

func (e *HTTPExecutor) ExecuteWithJar(ctx context.Context, definition StepDefinition, jar http.CookieJar) StepRun {
	return e.ExecuteWithState(ctx, definition, jar, nil)
}

func (e *HTTPExecutor) ExecuteWithState(ctx context.Context, definition StepDefinition, jar http.CookieJar, workflowValues map[string]string) StepRun {
	return e.ExecuteWithScriptState(ctx, definition, jar, workflowValues, ScriptExecutionContext{})
}

func (e *HTTPExecutor) ExecuteWithScriptState(ctx context.Context, definition StepDefinition, jar http.CookieJar, workflowValues map[string]string, scriptContext ScriptExecutionContext) StepRun {
	if workflowValues == nil {
		workflowValues = make(map[string]string)
	}
	started := time.Now().UTC()
	result := StepRun{StepDefinitionID: definition.ID, StepName: definition.Name, StepType: definition.Type, Status: StatusRunning, StartedAt: &started, Extractors: []ExtractorResult{}, Assertions: []AssertionResult{}, Outputs: map[string]any{}, PrivateOutputs: map[string]string{}}
	preparedActions, err := e.prepareActions(ctx, definition.Request.PreRequest, workflowValues)
	if err != nil {
		return finishStep(result, StatusFailed, "PRE_REQUEST_ACTION_FAILURE", err.Error(), started)
	}
	outputs, err := executeActions(preparedActions, workflowValues)
	if err != nil {
		return finishStep(result, StatusFailed, "PRE_REQUEST_ACTION_FAILURE", err.Error(), started)
	}
	for _, action := range definition.Request.PreRequest {
		if !action.Enabled || strings.TrimSpace(action.Output) == "" {
			continue
		}
		if value, ok := outputs[action.Output]; ok {
			workflowValues[action.Output] = value
			workflowValues["variables."+action.Output] = value
			result.Outputs[action.Output] = safeActionOutput(definition.Request.PreRequest, action.Output, value)
			if action.Sensitive {
				result.PrivateOutputs[action.Output] = value
			}
		}
	}
	for key, value := range workflowValues {
		if _, exists := outputs[key]; !exists {
			outputs[key] = value
		}
	}
	requestConfig := definition.Request
	if strings.TrimSpace(requestConfig.PreRequestScript.Code) != "" {
		if e.scripts == nil {
			return finishStep(result, StatusFailed, "SCRIPT_RUNTIME_LOST", "JavaScript runner is unavailable.", started)
		}
		secrets, secretErr := e.resolveScriptSecrets(ctx, requestConfig.PreRequestScript.Code)
		if secretErr != nil {
			return finishStep(result, StatusFailed, "SCRIPT_POLICY_VIOLATION", secretErr.Error(), started)
		}
		scriptResult, scriptErr := e.scripts.Execute(ctx, scripts.Input{Script: normalizeScript(requestConfig.PreRequestScript), Scope: "request", Variables: scopeValues(workflowValues, "variables."), Environment: scopeValues(workflowValues, "environment."), Collection: scopeValues(workflowValues, "collection."), Globals: scopeValues(workflowValues, "globals."), Secrets: secrets, Cookies: scriptCookies(requestConfig, jar), Request: scriptRequest(requestConfig), AllowPrivateTargets: e.allowPrivate, TimeoutMS: scriptTimeoutMS(requestConfig.Settings.TimeoutMS, definition.TimeoutMS), Info: scripts.Info{MonitorID: scriptContext.MonitorID, RunID: scriptContext.RunID, RevisionID: scriptContext.RevisionID, StepID: definition.ID, RequestName: definition.Name, EventName: "prerequest", RuntimeVersion: scripts.RuntimeVersion}})
		if scriptErr != nil {
			return finishStep(result, StatusFailed, "SCRIPT_RUNTIME_LOST", "JavaScript runner could not complete the script.", started)
		}
		if scriptResult.Status != "SUCCESS" {
			scriptResult.InternalVariables, scriptResult.InternalEnvironment, scriptResult.InternalCollection, scriptResult.InternalCookies, scriptResult.InternalRequest = nil, nil, nil, nil, nil
			result.PreRequestScript = &scriptResult
			result.Timing = map[string]any{
				"preparationMs":         time.Since(started).Milliseconds(),
				"auxiliaryRequestMs":    scripts.AuxiliaryRequestDurationMS(scriptResult),
				"auxiliaryRequestCount": len(scriptResult.AuxiliaryRequests),
			}
			return finishStep(result, StatusFailed, scriptResult.ErrorCategory, scriptResult.ErrorMessage, started)
		}
		for key, value := range firstScriptValues(scriptResult.InternalVariables, scriptResult.Variables) {
			outputs[key] = value
			workflowValues[key] = value
			workflowValues["variables."+key] = value
			if scriptResult.Variables[key] == "MASKED" || sensitiveKey(key) {
				result.PrivateOutputs["script."+key] = value
				workflowValues["secrets.__tainted."+key] = value
			}
		}
		for key, value := range firstScriptValues(scriptResult.InternalEnvironment, scriptResult.Environment) {
			workflowValues[key] = value
			workflowValues["environment."+key] = value
		}
		for key, value := range firstScriptValues(scriptResult.InternalCollection, scriptResult.Collection) {
			workflowValues[key] = value
			workflowValues["collection."+key] = value
		}
		for key, value := range firstScriptValues(scriptResult.InternalGlobals, scriptResult.Globals) {
			workflowValues["globals."+key] = value
		}
		scriptResult.InternalVariables, scriptResult.InternalEnvironment, scriptResult.InternalCollection, scriptResult.InternalGlobals = nil, nil, nil, nil
		if scriptRequestResult := firstScriptRequest(scriptResult.InternalRequest, scriptResult.Request); scriptRequestResult != nil {
			requestConfig = applyScriptRequest(requestConfig, scriptRequestResult)
		}
		requestConfig = applyScriptCookies(requestConfig, firstScriptValues(scriptResult.InternalCookies, scriptResult.Cookies), jar)
		scriptResult.InternalCookies = nil
		scriptResult.InternalRequest = nil
		result.PreRequestScript = &scriptResult
		if scriptResult.Execution.RequestSkipped {
			result.Timing = map[string]any{
				"preparationMs":         time.Since(started).Milliseconds(),
				"preRequestScriptMs":    scriptResult.DurationMS,
				"auxiliaryRequestMs":    scripts.AuxiliaryRequestDurationMS(scriptResult),
				"auxiliaryRequestCount": len(scriptResult.AuxiliaryRequests),
			}
			return finishStep(result, StatusSkipped, "", "", started)
		}
	}
	for key, value := range outputs {
		if strings.HasPrefix(key, "secrets.") || sensitiveKey(key) {
			result.PrivateOutputs[key] = value
		}
	}

	timeout := time.Duration(requestConfig.Settings.TimeoutMS) * time.Millisecond
	if timeout <= 0 {
		timeout = time.Duration(definition.TimeoutMS) * time.Millisecond
	}
	if timeout <= 0 {
		timeout = 15 * time.Second
	}
	requestContext, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	transport, err := e.transport(requestContext, requestConfig)
	if err != nil {
		return finishStep(result, StatusFailed, "CONFIGURATION_ERROR", err.Error(), started)
	}
	defer transport.CloseIdleConnections()
	client := &http.Client{Transport: transport}
	if requestConfig.PersistCookies {
		client.Jar = jar
	}
	configureRedirects(client, requestConfig.Settings, e)
	request, safeRequest, err := e.buildRequest(requestContext, requestConfig, outputs, client)
	if err != nil {
		return finishStep(result, StatusFailed, "CONFIGURATION_ERROR", err.Error(), started)
	}
	result.RequestSummary = safeRequest
	if requestConfig.Settings.Retries > 0 && !retrySafe(request) {
		return finishStep(result, StatusFailed, "CONFIGURATION_ERROR", "Retries for non-idempotent requests require an Idempotency-Key header.", started)
	}
	preparationMS := time.Since(started).Milliseconds()
	releaseTarget, err := e.acquireTarget(requestContext, request.URL)
	if err != nil {
		if errors.Is(err, ErrTargetLimiterUnavailable) {
			return finishStep(result, StatusFailed, "TARGET_CONCURRENCY_UNAVAILABLE", "Distributed target concurrency control is unavailable.", started)
		}
		return finishStep(result, StatusTimedOut, "TARGET_CONCURRENCY_TIMEOUT", "The target host remained at its configured concurrency limit until this step timed out.", started)
	}
	defer releaseTarget()
	response, attempts, err := doWithRetries(requestContext, client, request, requestConfig.Settings, safeRequest, requestConfig.Proxy)
	result.Attempts, result.AttemptCount = attempts, len(attempts)
	result.Timing = map[string]any{"preparationMs": preparationMS}
	if result.PreRequestScript != nil {
		result.Timing["auxiliaryRequestMs"] = scripts.AuxiliaryRequestDurationMS(*result.PreRequestScript)
		result.Timing["auxiliaryRequestCount"] = len(result.PreRequestScript.AuxiliaryRequests)
	}
	if len(attempts) > 0 {
		for key, value := range attempts[len(attempts)-1].Timing {
			result.Timing[key] = value
		}
	}
	result.Timing["attempts"] = len(attempts)
	applyAttemptTotals(result.Timing, result.Attempts)
	if err != nil {
		category := networkFailureCategory(err)
		status := StatusFailed
		if errors.Is(err, context.DeadlineExceeded) || errors.Is(requestContext.Err(), context.DeadlineExceeded) {
			category, status = "REQUEST_TIMEOUT", StatusTimedOut
		}
		return finishStep(result, status, category, safeError(err), started)
	}
	defer response.Body.Close()
	result.TLS = safeTLSSummary(response)
	result.Proxy = safeProxySummary(requestConfig.Proxy)
	maxBytes := requestConfig.Settings.MaxBodyBytes
	if maxBytes <= 0 || maxBytes > defaultMaxBodyBytes {
		maxBytes = defaultMaxBodyBytes
	}
	downloadStarted := time.Now()
	body, readErr := io.ReadAll(io.LimitReader(response.Body, int64(maxBytes)+1))
	downloadMS := time.Since(downloadStarted).Milliseconds()
	if len(result.Attempts) > 0 {
		last := &result.Attempts[len(result.Attempts)-1]
		last.EndedAt = time.Now().UTC()
		last.DurationMS = last.EndedAt.Sub(last.StartedAt).Milliseconds()
		last.Timing["downloadMs"] = downloadMS
		last.Timing["totalMs"] = last.DurationMS
		last.Timing["apiResponseTimeMs"] = last.DurationMS
		applyAttemptTotals(result.Timing, result.Attempts)
	}
	if readErr != nil {
		return finishStep(result, StatusFailed, "HTTP_ERROR", "Unable to read the response body.", started)
	}
	truncated := len(body) > maxBytes
	if truncated {
		body = body[:maxBytes]
	}
	result.ResponseSummary = map[string]any{"status": response.StatusCode, "headers": safeHeaders(response.Header), "bodyBytes": len(body), "truncated": truncated, "contentType": response.Header.Get("Content-Type"), "bodyCapture": captureState(requestConfig.Settings.CaptureBody, len(body), truncated, false)}
	result.Timing["downloadMs"] = downloadMS

	postProcessingStarted := time.Now()
	extractorStarted := time.Now()
	result.Extractors = evaluateExtractors(requestConfig.Extractors, response, body, time.Since(started), result.Outputs, result.PrivateOutputs)
	result.Timing["extractionMs"] = time.Since(extractorStarted).Milliseconds()
	if requestConfig.Settings.CaptureBody {
		result.ResponseSummary["body"] = safeBody(body, result.PrivateOutputs)
		if len(result.PrivateOutputs) > 0 && len(body) > 0 {
			result.ResponseSummary["bodyCapture"].(map[string]any)["state"] = "MASKED"
		}
	}
	if strings.TrimSpace(requestConfig.TestScript.Code) != "" {
		if e.scripts == nil {
			return finishStep(result, StatusFailed, "SCRIPT_RUNTIME_LOST", "JavaScript runner is unavailable.", started)
		}
		secrets, secretErr := e.resolveScriptSecrets(ctx, requestConfig.TestScript.Code)
		if secretErr != nil {
			return finishStep(result, StatusFailed, "SCRIPT_POLICY_VIOLATION", secretErr.Error(), started)
		}
		for key, value := range result.PrivateOutputs {
			if value != "" {
				secrets["response."+key] = value
			}
		}
		responseHeaders := make(map[string]string, len(response.Header))
		for key, values := range response.Header {
			responseHeaders[key] = strings.Join(values, ", ")
		}
		testStarted := time.Now()
		testResult, scriptErr := e.scripts.Execute(ctx, scripts.Input{
			Script:              normalizeScript(requestConfig.TestScript),
			Scope:               "test",
			Variables:           scopeValues(workflowValues, "variables."),
			Environment:         scopeValues(workflowValues, "environment."),
			Collection:          scopeValues(workflowValues, "collection."),
			Globals:             scopeValues(workflowValues, "globals."),
			Secrets:             secrets,
			Cookies:             scriptCookies(requestConfig, jar),
			Request:             scriptRequest(requestConfig),
			Response:            &scripts.Response{Code: response.StatusCode, Status: response.Status, Headers: responseHeaders, Body: string(body), ResponseTimeMS: int64FromAny(result.Timing["apiResponseTimeMs"]), ResponseSize: len(body), ContentType: response.Header.Get("Content-Type"), Truncated: truncated},
			AllowPrivateTargets: e.allowPrivate,
			TimeoutMS:           scriptTimeoutMS(requestConfig.Settings.TimeoutMS, definition.TimeoutMS),
			Info:                scripts.Info{MonitorID: scriptContext.MonitorID, RunID: scriptContext.RunID, RevisionID: scriptContext.RevisionID, StepID: definition.ID, RequestName: definition.Name, EventName: "test", Iteration: 0, IterationCount: 1, RuntimeVersion: scripts.RuntimeVersion},
		})
		result.Timing["testScriptMs"] = time.Since(testStarted).Milliseconds()
		if scriptErr != nil {
			return finishStep(result, StatusFailed, "SCRIPT_RUNTIME_LOST", "JavaScript runner could not complete the Tests script.", started)
		}
		result.TestScript = &testResult
		if testResult.Status != "SUCCESS" {
			testResult.InternalVariables, testResult.InternalEnvironment, testResult.InternalCollection, testResult.InternalGlobals, testResult.InternalCookies, testResult.InternalRequest, testResult.InternalState = nil, nil, nil, nil, nil, nil, nil
			result.TestScript = &testResult
			return finishStep(result, StatusFailed, testResult.ErrorCategory, testResult.ErrorMessage, started)
		}
		for key, value := range firstScriptValues(testResult.InternalVariables, testResult.Variables) {
			outputs[key] = value
			workflowValues[key] = value
			workflowValues["variables."+key] = value
			if testResult.Variables[key] == "MASKED" || sensitiveKey(key) {
				result.PrivateOutputs["script."+key] = value
				workflowValues["secrets.__tainted."+key] = value
			}
		}
		for key, value := range firstScriptValues(testResult.InternalEnvironment, testResult.Environment) {
			workflowValues[key] = value
			workflowValues["environment."+key] = value
		}
		for key, value := range firstScriptValues(testResult.InternalCollection, testResult.Collection) {
			workflowValues[key] = value
			workflowValues["collection."+key] = value
		}
		for key, value := range firstScriptValues(testResult.InternalGlobals, testResult.Globals) {
			workflowValues["globals."+key] = value
		}
		testResult.InternalVariables, testResult.InternalEnvironment, testResult.InternalCollection, testResult.InternalGlobals, testResult.InternalCookies, testResult.InternalRequest, testResult.InternalState = nil, nil, nil, nil, nil, nil, nil
		result.TestScript = &testResult
	}
	assertionStarted := time.Now()
	result.Assertions = evaluateAssertions(requestConfig.Assertions, response, body, time.Since(started))
	result.Timing["assertionMs"] = time.Since(assertionStarted).Milliseconds()
	if len(result.Attempts) > 0 {
		last := &result.Attempts[len(result.Attempts)-1]
		last.ResponseSummary = result.ResponseSummary
		last.TLS = result.TLS
		last.Proxy = result.Proxy
	}
	result.Timing["postProcessingMs"] = time.Since(postProcessingStarted).Milliseconds()
	applyAttemptTotals(result.Timing, result.Attempts)
	for _, extractor := range result.Extractors {
		if !extractor.Success {
			return finishStep(result, StatusFailed, "EXTRACTOR_FAILURE", extractor.Error, started)
		}
	}
	for _, assertion := range result.Assertions {
		if !assertion.Passed {
			return finishStep(result, StatusFailed, "ASSERTION_FAILURE", assertion.Error, started)
		}
	}
	return finishStep(result, StatusSuccess, "", "", started)
}

func (e *HTTPExecutor) acquireTarget(ctx context.Context, target *url.URL) (func(), error) {
	key := strings.ToLower(target.Hostname())
	if key == "" {
		return func() {}, nil
	}
	e.hostMu.Lock()
	limiter := e.targetLimiter
	limit := e.hostLimit
	e.hostMu.Unlock()
	if limiter != nil {
		return limiter.Acquire(ctx, key, limit)
	}
	e.hostMu.Lock()
	slots := e.hostSlots[key]
	if slots == nil {
		slots = make(chan struct{}, limit)
		e.hostSlots[key] = slots
	}
	e.hostMu.Unlock()
	select {
	case slots <- struct{}{}:
		return func() { <-slots }, nil
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}

var vaultCallPattern = regexp.MustCompile(`pm\.vault\.get\(\s*["']([^"']+)["']\s*\)`)
var templateSecretPattern = regexp.MustCompile(`\{\{\s*secrets\.([A-Za-z0-9_.-]+)\s*\}\}`)

func (e *HTTPExecutor) ResolveDefinitionSecrets(ctx context.Context, definition Definition, values map[string]string) error {
	encoded, err := json.Marshal(definition)
	if err != nil {
		return errors.New("monitor definition could not be inspected for secret references")
	}
	for _, match := range templateSecretPattern.FindAllStringSubmatch(string(encoded), -1) {
		alias := strings.TrimSpace(match[1])
		key := "secrets." + alias
		if _, exists := values[key]; exists {
			continue
		}
		if e.resolver == nil {
			return fmt.Errorf("secret alias %q cannot be resolved", alias)
		}
		value, resolveErr := e.resolver.ResolveSecret(ctx, "secret://"+alias)
		if resolveErr != nil {
			return fmt.Errorf("secret alias %q could not be resolved", alias)
		}
		values[key] = value
	}
	return nil
}

func (e *HTTPExecutor) resolveScriptSecrets(ctx context.Context, code string) (map[string]string, error) {
	secrets := map[string]string{}
	for _, match := range vaultCallPattern.FindAllStringSubmatch(code, -1) {
		alias := strings.TrimPrefix(strings.TrimSpace(match[1]), "secret://")
		if _, exists := secrets[alias]; exists {
			continue
		}
		if e.resolver == nil {
			return nil, fmt.Errorf("secret alias %q cannot be resolved", alias)
		}
		value, err := e.resolver.ResolveSecret(ctx, "secret://"+alias)
		if err != nil {
			return nil, err
		}
		secrets[alias] = value
	}
	return secrets, nil
}

func (e *HTTPExecutor) ExecuteSetupScript(ctx context.Context, script scripts.Script, workflowValues map[string]string, info scripts.Info, timeoutMS int) (scripts.Result, map[string]string) {
	if e.scripts == nil {
		return scripts.Result{Status: "FAILED", RuntimeVersion: scripts.RuntimeVersion, ErrorCategory: "SCRIPT_RUNTIME_LOST", ErrorMessage: "JavaScript runner is unavailable."}, workflowValues
	}
	secrets, err := e.resolveScriptSecrets(ctx, script.Code)
	if err != nil {
		return scripts.Result{Status: "FAILED", RuntimeVersion: scripts.RuntimeVersion, ErrorCategory: "SCRIPT_POLICY_VIOLATION", ErrorMessage: err.Error()}, workflowValues
	}
	result, err := e.scripts.Execute(ctx, scripts.Input{Script: normalizeScript(script), Scope: "monitor", Variables: scopeValues(workflowValues, "variables."), Collection: scopeValues(workflowValues, "collection."), Environment: scopeValues(workflowValues, "environment."), Globals: scopeValues(workflowValues, "globals."), Secrets: secrets, AllowPrivateTargets: e.allowPrivate, TimeoutMS: timeoutMS, Info: info})
	if err != nil {
		return scripts.Result{Status: "FAILED", RuntimeVersion: scripts.RuntimeVersion, ErrorCategory: "SCRIPT_RUNTIME_LOST", ErrorMessage: "JavaScript runner could not complete the setup script."}, workflowValues
	}
	if result.Status == "SUCCESS" {
		for key, value := range firstScriptValues(result.InternalVariables, result.Variables) {
			workflowValues[key] = value
			workflowValues["variables."+key] = value
		}
		for key, value := range firstScriptValues(result.InternalCollection, result.Collection) {
			workflowValues[key] = value
			workflowValues["collection."+key] = value
		}
		for key, value := range firstScriptValues(result.InternalEnvironment, result.Environment) {
			workflowValues[key] = value
			workflowValues["environment."+key] = value
		}
		for key, value := range firstScriptValues(result.InternalGlobals, result.Globals) {
			workflowValues["globals."+key] = value
		}
	}
	result.InternalVariables, result.InternalEnvironment, result.InternalCollection, result.InternalGlobals, result.InternalCookies, result.InternalRequest = nil, nil, nil, nil, nil, nil
	return result, workflowValues
}

func scopeValues(values map[string]string, prefix string) map[string]string {
	result := make(map[string]string)
	for key, value := range values {
		if strings.HasPrefix(key, prefix) {
			result[strings.TrimPrefix(key, prefix)] = value
		}
		if prefix == "variables." && !strings.Contains(key, ".") {
			result[key] = value
		}
	}
	return result
}

func firstScriptValues(internal, safe map[string]string) map[string]string {
	if internal != nil {
		return internal
	}
	return safe
}

func firstScriptRequest(internal, safe *scripts.Request) *scripts.Request {
	if internal != nil {
		return internal
	}
	return safe
}

func scriptTimeoutMS(requestTimeout, stepTimeout int) int {
	if requestTimeout > 0 {
		return requestTimeout
	}
	if stepTimeout > 0 {
		return stepTimeout
	}
	return 10000
}

func normalizeScript(script scripts.Script) scripts.Script {
	if script.Language == "" {
		script.Language = "javascript"
	}
	if script.RuntimeVersion == "" {
		script.RuntimeVersion = scripts.RuntimeVersion
	}
	// Postman-style: non-empty source is always treated as enabled.
	script.Enabled = strings.TrimSpace(script.Code) != ""
	return script
}
func scriptRequest(config RequestConfig) *scripts.Request {
	headers := make([]scripts.Entry, 0, len(config.Headers))
	for _, item := range config.Headers {
		if item.Enabled {
			headers = append(headers, scripts.Entry{Key: item.Key, Value: item.Value, Sensitive: item.Sensitive})
		}
	}
	query := make([]scripts.Entry, 0, len(config.Params))
	for _, item := range config.Params {
		if item.Enabled {
			query = append(query, scripts.Entry{Key: item.Key, Value: item.Value, Sensitive: item.Sensitive})
		}
	}
	return &scripts.Request{Method: config.Method, URL: config.URL, Headers: headers, Query: query, Body: map[string]any{"type": config.Body.Type, "content": config.Body.Content}, Auth: map[string]any{"type": config.Auth.Type, "fields": config.Auth.Fields}}
}
func applyScriptRequest(config RequestConfig, request *scripts.Request) RequestConfig {
	config.Method, config.URL = request.Method, request.URL
	config.Headers = make([]KeyValue, 0, len(request.Headers))
	for _, item := range request.Headers {
		config.Headers = append(config.Headers, KeyValue{Enabled: true, Key: item.Key, Value: item.Value, Sensitive: item.Sensitive})
	}
	config.Params = make([]KeyValue, 0, len(request.Query))
	for _, item := range request.Query {
		config.Params = append(config.Params, KeyValue{Enabled: true, Key: item.Key, Value: item.Value, Sensitive: item.Sensitive})
	}
	if request.Body != nil {
		if value, ok := request.Body["type"]; ok {
			config.Body.Type = fmt.Sprint(value)
		}
		if value, ok := request.Body["content"]; ok {
			config.Body.Content = fmt.Sprint(value)
		}
	}
	if request.Auth != nil {
		if value, ok := request.Auth["type"]; ok {
			config.Auth.Type = fmt.Sprint(value)
		}
		if fields, ok := request.Auth["fields"].(map[string]any); ok {
			config.Auth.Fields = map[string]string{}
			for key, value := range fields {
				config.Auth.Fields[key] = fmt.Sprint(value)
			}
		}
	}
	return config
}

func scriptCookies(config RequestConfig, jar http.CookieJar) map[string]string {
	values := make(map[string]string)
	for _, cookie := range config.Cookies {
		if cookie.Enabled && strings.TrimSpace(cookie.Key) != "" {
			values[cookie.Key] = cookie.Value
		}
	}
	if jar == nil {
		return values
	}
	target, err := url.Parse(config.URL)
	if err != nil || target.Scheme == "" || target.Host == "" {
		return values
	}
	for _, cookie := range jar.Cookies(target) {
		values[cookie.Name] = cookie.Value
	}
	return values
}

func applyScriptCookies(config RequestConfig, values map[string]string, jar http.CookieJar) RequestConfig {
	existing := make(map[string]CookieConfig, len(config.Cookies))
	for _, cookie := range config.Cookies {
		existing[cookie.Key] = cookie
	}
	config.Cookies = make([]CookieConfig, 0, len(values))
	names := make([]string, 0, len(values))
	for name := range values {
		names = append(names, name)
	}
	sort.Strings(names)
	for _, name := range names {
		cookie := existing[name]
		cookie.Enabled, cookie.Key, cookie.Value = true, name, values[name]
		if cookie.Path == "" {
			cookie.Path = "/"
		}
		config.Cookies = append(config.Cookies, cookie)
	}
	if jar != nil {
		if target, err := url.Parse(config.URL); err == nil && target.Scheme != "" && target.Host != "" {
			cookies := make([]*http.Cookie, 0, len(config.Cookies))
			for _, configured := range config.Cookies {
				cookies = append(cookies, &http.Cookie{Name: configured.Key, Value: configured.Value, Domain: configured.Domain, Path: configured.Path})
			}
			jar.SetCookies(target, cookies)
		}
	}
	return config
}

func (e *HTTPExecutor) ExecuteActions(ctx context.Context, definition StepDefinition, workflowValues map[string]string) (StepRun, map[string]string) {
	started := time.Now().UTC()
	result := StepRun{StepDefinitionID: definition.ID, StepName: definition.Name, StepType: definition.Type, Status: StatusRunning, StartedAt: &started, Outputs: map[string]any{}, PrivateOutputs: map[string]string{}, Extractors: []ExtractorResult{}, Assertions: []AssertionResult{}}
	select {
	case <-ctx.Done():
		return finishStep(result, StatusTimedOut, "ACTION_TIMEOUT", "Action step timed out.", started), nil
	default:
	}
	values, err := e.executeStepActions(ctx, definition.Actions, workflowValues)
	if err != nil {
		return finishStep(result, StatusFailed, "ACTION_FAILURE", err.Error(), started), nil
	}
	produced := make(map[string]string)
	for _, action := range definition.Actions {
		if !action.Enabled || action.Output == "" {
			continue
		}
		value, ok := values[action.Output]
		if !ok {
			continue
		}
		produced[action.Output] = value
		if action.Sensitive {
			result.Outputs[action.Output] = map[string]any{"sensitive": true, "value": "••••••••"}
			result.PrivateOutputs[action.Output] = value
		} else {
			result.Outputs[action.Output] = value
		}
	}
	return finishStep(result, StatusSuccess, "", "", started), produced
}

func (e *HTTPExecutor) ExecuteMetric(ctx context.Context, definition StepDefinition) StepRun {
	started := time.Now().UTC()
	result := StepRun{StepDefinitionID: definition.ID, StepName: definition.Name, StepType: definition.Type, Status: StatusRunning, StartedAt: &started, Outputs: map[string]any{}, Extractors: []ExtractorResult{}, Assertions: []AssertionResult{}}
	config := definition.Metric
	if e.resolver == nil {
		return finishStep(result, StatusFailed, "CONFIGURATION_ERROR", "Telemetry profiles require a runtime resolver.", started)
	}
	if strings.ToUpper(config.Provider) != "DYNATRACE" || strings.TrimSpace(config.ProfileID) == "" || strings.TrimSpace(config.MetricSelector) == "" {
		return finishStep(result, StatusFailed, "CONFIGURATION_ERROR", "Dynatrace profile and metric selector are required.", started)
	}
	material, err := e.resolver.ResolveTelemetryProfile(ctx, config.ProfileID)
	if err != nil {
		return finishStep(result, StatusFailed, "SECRET_FETCH_FAILURE", "Unable to resolve the telemetry provider profile.", started)
	}
	target, err := url.Parse(strings.TrimRight(material.BaseURL, "/") + "/api/v2/metrics/query")
	if err != nil || target.Host == "" {
		return finishStep(result, StatusFailed, "CONFIGURATION_ERROR", "Telemetry provider URL is invalid.", started)
	}
	if err := e.validateTarget(target); err != nil {
		return finishStep(result, StatusFailed, "CONFIGURATION_ERROR", err.Error(), started)
	}
	query := target.Query()
	query.Set("metricSelector", config.MetricSelector)
	query.Set("from", "now-"+defaultString(config.Window, "10m"))
	if config.EntitySelector != "" {
		query.Set("entitySelector", config.EntitySelector)
	}
	if config.Resolution != "" {
		query.Set("resolution", config.Resolution)
	}
	target.RawQuery = query.Encode()
	timeout := time.Duration(definition.TimeoutMS) * time.Millisecond
	if timeout <= 0 {
		timeout = 30 * time.Second
	}
	requestContext, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	request, _ := http.NewRequestWithContext(requestContext, http.MethodGet, target.String(), nil)
	request.Header.Set("Authorization", "Api-Token "+material.Token)
	request.Header.Set("Accept", "application/json")
	transport, err := e.transport(requestContext, RequestConfig{Settings: SettingsConfig{Compression: true}})
	if err != nil {
		return finishStep(result, StatusFailed, "CONFIGURATION_ERROR", err.Error(), started)
	}
	defer transport.CloseIdleConnections()
	releaseTarget, err := e.acquireTarget(requestContext, target)
	if err != nil {
		if errors.Is(err, ErrTargetLimiterUnavailable) {
			return finishStep(result, StatusFailed, "TARGET_CONCURRENCY_UNAVAILABLE", "Distributed target concurrency control is unavailable.", started)
		}
		return finishStep(result, StatusTimedOut, "TARGET_CONCURRENCY_TIMEOUT", "The telemetry host remained at its configured concurrency limit.", started)
	}
	defer releaseTarget()
	response, err := (&http.Client{Transport: transport}).Do(request)
	if err != nil {
		return finishStep(result, StatusFailed, networkFailureCategory(err), safeError(err), started)
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return finishStep(result, StatusFailed, "TELEMETRY_PROVIDER_FAILURE", fmt.Sprintf("Telemetry provider returned HTTP %d.", response.StatusCode), started)
	}
	var payload struct {
		Result []struct {
			Data []struct {
				Values []*float64 `json:"values"`
			} `json:"data"`
		} `json:"result"`
	}
	if err := json.NewDecoder(io.LimitReader(response.Body, 5<<20)).Decode(&payload); err != nil {
		return finishStep(result, StatusFailed, "TELEMETRY_PROVIDER_FAILURE", "Telemetry provider returned an invalid response.", started)
	}
	values := []float64{}
	for _, series := range payload.Result {
		for _, data := range series.Data {
			for _, value := range data.Values {
				if value != nil {
					values = append(values, *value)
				}
			}
		}
	}
	if len(values) == 0 {
		if strings.EqualFold(config.MissingDataPolicy, "PASS") {
			result.Assertions = append(result.Assertions, AssertionResult{Type: "metric", Expression: config.MetricSelector, Expected: "missing data allowed", Observed: "no data", Passed: true})
			return finishStep(result, StatusSuccess, "", "", started)
		}
		return finishStep(result, StatusFailed, "TELEMETRY_MISSING_DATA", "Telemetry query returned no numeric data.", started)
	}
	observed := aggregateMetric(values, config.Aggregation)
	passed := compareMetric(observed, config.Operator, config.Threshold)
	result.RequestSummary = map[string]any{"provider": "DYNATRACE", "profileId": config.ProfileID, "metricSelector": config.MetricSelector, "entitySelector": config.EntitySelector, "window": defaultString(config.Window, "10m")}
	result.ResponseSummary = map[string]any{"seriesCount": len(payload.Result), "sampleCount": len(values), "aggregation": strings.ToUpper(defaultString(config.Aggregation, "AVG")), "value": observed}
	result.Outputs["value"] = observed
	result.Assertions = append(result.Assertions, AssertionResult{Type: "metric", Expression: config.MetricSelector, Expected: fmt.Sprintf("%s %g", config.Operator, config.Threshold), Observed: observed, Passed: passed})
	result.Timing = map[string]any{"totalMs": time.Since(started).Milliseconds()}
	if !passed {
		result.Assertions[0].Error = "metric threshold was not satisfied"
		return finishStep(result, StatusFailed, "ASSERTION_FAILURE", "Metric threshold was not satisfied.", started)
	}
	return finishStep(result, StatusSuccess, "", "", started)
}

func aggregateMetric(values []float64, aggregation string) float64 {
	aggregation = strings.ToUpper(defaultString(aggregation, "AVG"))
	result := values[0]
	switch aggregation {
	case "LAST":
		return values[len(values)-1]
	case "MAX":
		for _, value := range values[1:] {
			if value > result {
				result = value
			}
		}
		return result
	case "MIN":
		for _, value := range values[1:] {
			if value < result {
				result = value
			}
		}
		return result
	case "SUM":
		result = 0
		for _, value := range values {
			result += value
		}
		return result
	default:
		result = 0
		for _, value := range values {
			result += value
		}
		return result / float64(len(values))
	}
}
func compareMetric(observed float64, operator string, threshold float64) bool {
	switch strings.ToUpper(strings.ReplaceAll(operator, "-", "_")) {
	case "LESS_THAN", "LT":
		return observed < threshold
	case "LESS_THAN_OR_EQUAL", "LTE":
		return observed <= threshold
	case "GREATER_THAN", "GT":
		return observed > threshold
	case "GREATER_THAN_OR_EQUAL", "GTE":
		return observed >= threshold
	case "NOT_EQUAL", "NE":
		return observed != threshold
	default:
		return observed == threshold
	}
}
func defaultString(value, fallback string) string {
	if strings.TrimSpace(value) == "" {
		return fallback
	}
	return strings.TrimSpace(value)
}

func (e *HTTPExecutor) executeStepActions(ctx context.Context, actions []ActionConfig, seed map[string]string) (map[string]string, error) {
	values := make(map[string]string, len(seed))
	for key, value := range seed {
		values[key] = value
	}
	for _, action := range actions {
		if !action.Enabled {
			continue
		}
		if normalizeActionType(action.Type) == "oauth-token" {
			transport, err := e.transport(ctx, RequestConfig{Settings: SettingsConfig{Compression: true}, TLS: TLSConfig{}})
			if err != nil {
				return nil, err
			}
			defer transport.CloseIdleConnections()
			client := &http.Client{Transport: transport}
			configureRedirects(client, SettingsConfig{FollowRedirects: true, MaxRedirects: 3}, e)
			token, err := e.acquireOAuthToken(ctx, client, AuthConfig{Type: "oauth2", Fields: action.Fields}, values)
			if err != nil {
				return nil, err
			}
			if strings.TrimSpace(action.Output) == "" {
				return nil, errors.New("OAuth token action output is required")
			}
			values[action.Output] = token
			continue
		}
		prepared, err := e.prepareActions(ctx, []ActionConfig{action}, values)
		if err != nil {
			return nil, err
		}
		values, err = executeActions(prepared, values)
		if err != nil {
			return nil, err
		}
	}
	return values, nil
}

func safeActionOutput(actions []ActionConfig, key, value string) any {
	for _, action := range actions {
		if action.Output == key && action.Sensitive {
			return map[string]any{"sensitive": true, "value": "••••••••"}
		}
	}
	return value
}

func doWithRetries(ctx context.Context, client *http.Client, request *http.Request, settings SettingsConfig, safeRequest map[string]any, proxy ProxyConfig) (*http.Response, []AttemptRun, error) {
	retries := settings.Retries
	if retries < 0 {
		retries = 0
	}
	if retries > 5 {
		retries = 5
	}
	if retries > 0 && !retrySafe(request) {
		return nil, nil, errors.New("retries for non-idempotent requests require an Idempotency-Key header")
	}
	attempts := make([]AttemptRun, 0, retries+1)
	for attempt := 0; attempt <= retries; attempt++ {
		backoffMS := int64(0)
		attemptRequest := request
		if attempt > 0 {
			if request.GetBody != nil {
				body, err := request.GetBody()
				if err != nil {
					return nil, attempts, errors.New("unable to replay request body")
				}
				attemptRequest = request.Clone(ctx)
				attemptRequest.Body = body
			}
			backoffStarted := time.Now()
			if err := waitRetry(ctx, settings.RetryBackoff, attempt); err != nil {
				return nil, attempts, err
			}
			backoffMS = time.Since(backoffStarted).Milliseconds()
		}
		attemptStarted := time.Now().UTC()
		trace := newRequestTrace(attemptStarted)
		attemptRequest = attemptRequest.WithContext(httptrace.WithClientTrace(attemptRequest.Context(), trace.clientTrace()))
		response, err := client.Do(attemptRequest)
		attemptEnded := time.Now().UTC()
		attemptID, _ := id.NewUUID()
		recorded := AttemptRun{ID: attemptID, AttemptNumber: attempt + 1, Status: StatusSuccess, StartedAt: attemptStarted, EndedAt: attemptEnded, DurationMS: attemptEnded.Sub(attemptStarted).Milliseconds(), RetryBackoffMS: backoffMS, Timing: trace.summary(), RequestSummary: cloneSummary(safeRequest), Proxy: safeProxySummary(proxy)}
		recorded.Timing["totalMs"] = recorded.DurationMS
		recorded.Timing["apiResponseTimeMs"] = recorded.DurationMS
		if response != nil {
			recorded.ResponseStatus = response.StatusCode
			recorded.ResponseSummary = map[string]any{"status": response.StatusCode, "headers": safeHeaders(response.Header), "contentType": response.Header.Get("Content-Type"), "bodyCapture": map[string]any{"state": "NOT_CAPTURED"}}
			recorded.TLS = safeTLSSummary(response)
			if response.Request != nil && response.Request.URL != nil && response.Request.URL.String() != request.URL.String() {
				recorded.Redirects = []map[string]any{{"from": safeRequestURL(request.URL, AuthConfig{}), "to": safeRequestURL(response.Request.URL, AuthConfig{}), "status": response.StatusCode}}
			}
		}
		if err != nil {
			recorded.Status = StatusFailed
			recorded.FailureCategory = networkFailureCategory(err)
			recorded.ErrorMessage = safeError(err)
		} else if response.StatusCode >= 500 || response.StatusCode == http.StatusTooManyRequests {
			recorded.Status = StatusFailed
			recorded.FailureCategory = "RETRYABLE_HTTP_STATUS"
		}
		attempts = append(attempts, recorded)
		if err == nil && response.StatusCode < 500 && response.StatusCode != http.StatusTooManyRequests {
			return response, attempts, nil
		}
		if attempt == retries {
			return response, attempts, err
		}
		if response != nil {
			_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, 32<<10))
			_ = response.Body.Close()
			ended := time.Now().UTC()
			last := &attempts[len(attempts)-1]
			last.EndedAt = ended
			last.DurationMS = ended.Sub(last.StartedAt).Milliseconds()
			last.Timing["totalMs"] = last.DurationMS
			last.Timing["apiResponseTimeMs"] = last.DurationMS
		}
	}
	return nil, attempts, errors.New("request retries exhausted")
}

func applyAttemptTotals(timing map[string]any, attempts []AttemptRun) {
	var networkTotalMS, retryBackoffMS int64
	for _, attempt := range attempts {
		networkTotalMS += attempt.DurationMS
		retryBackoffMS += attempt.RetryBackoffMS
	}
	timing["networkTotalMs"] = networkTotalMS
	timing["retryBackoffMs"] = retryBackoffMS
	if len(attempts) > 0 {
		timing["apiResponseTimeMs"] = attempts[len(attempts)-1].DurationMS
	}
}

func cloneSummary(value map[string]any) map[string]any {
	encoded, _ := json.Marshal(value)
	result := map[string]any{}
	_ = json.Unmarshal(encoded, &result)
	return result
}

func captureState(enabled bool, byteLength int, truncated bool, request bool) map[string]any {
	state := "NOT_CAPTURED"
	if enabled {
		if byteLength == 0 {
			state = "EMPTY"
		} else if truncated {
			state = "TRUNCATED"
		} else {
			state = "CAPTURED"
		}
	}
	result := map[string]any{"state": state, "byteLength": byteLength}
	if request && !enabled {
		result["state"] = "EMPTY"
	}
	return result
}

type requestTrace struct {
	mu                                                                                                 sync.Mutex
	started, timeDNSStart, timeConnectStart, timeTLSStart, wroteHeadersAt, wroteRequestAt, firstByteAt time.Time
	dnsMS, connectMS, tlsMS                                                                            int64
	connectionReused                                                                                   bool
}

func newRequestTrace(started time.Time) *requestTrace { return &requestTrace{started: started} }
func (t *requestTrace) clientTrace() *httptrace.ClientTrace {
	return &httptrace.ClientTrace{DNSStart: func(httptrace.DNSStartInfo) { t.mu.Lock(); t.timeDNSStart = time.Now(); t.mu.Unlock() }, DNSDone: func(httptrace.DNSDoneInfo) {
		t.mu.Lock()
		if !t.timeDNSStart.IsZero() {
			t.dnsMS = time.Since(t.timeDNSStart).Milliseconds()
		}
		t.mu.Unlock()
	}, ConnectStart: func(_, _ string) { t.mu.Lock(); t.timeConnectStart = time.Now(); t.mu.Unlock() }, ConnectDone: func(_, _ string, _ error) {
		t.mu.Lock()
		if !t.timeConnectStart.IsZero() {
			t.connectMS = time.Since(t.timeConnectStart).Milliseconds()
		}
		t.mu.Unlock()
	}, TLSHandshakeStart: func() { t.mu.Lock(); t.timeTLSStart = time.Now(); t.mu.Unlock() }, TLSHandshakeDone: func(tls.ConnectionState, error) {
		t.mu.Lock()
		if !t.timeTLSStart.IsZero() {
			t.tlsMS = time.Since(t.timeTLSStart).Milliseconds()
		}
		t.mu.Unlock()
	}, GotConn: func(info httptrace.GotConnInfo) { t.mu.Lock(); t.connectionReused = info.Reused; t.mu.Unlock() }, WroteHeaders: func() { t.mu.Lock(); t.wroteHeadersAt = time.Now(); t.mu.Unlock() }, WroteRequest: func(httptrace.WroteRequestInfo) { t.mu.Lock(); t.wroteRequestAt = time.Now(); t.mu.Unlock() }, GotFirstResponseByte: func() { t.mu.Lock(); t.firstByteAt = time.Now(); t.mu.Unlock() }}
}
func (t *requestTrace) summary() map[string]any {
	t.mu.Lock()
	defer t.mu.Unlock()
	result := map[string]any{"connectionReused": t.connectionReused}
	if t.dnsMS > 0 {
		result["dnsMs"] = t.dnsMS
	}
	if t.connectMS > 0 {
		result["connectMs"] = t.connectMS
	}
	if t.tlsMS > 0 {
		result["tlsHandshakeMs"] = t.tlsMS
	}
	if !t.wroteHeadersAt.IsZero() && !t.wroteRequestAt.IsZero() {
		result["requestWriteMs"] = t.wroteRequestAt.Sub(t.wroteHeadersAt).Milliseconds()
	}
	if !t.wroteRequestAt.IsZero() && !t.firstByteAt.IsZero() {
		result["serverWaitMs"] = t.firstByteAt.Sub(t.wroteRequestAt).Milliseconds()
		result["timeToFirstByteMs"] = t.firstByteAt.Sub(t.started).Milliseconds()
	}
	return result
}
func safeTLSSummary(response *http.Response) map[string]any {
	if response.TLS == nil {
		return map[string]any{"used": false}
	}
	state := response.TLS
	summary := map[string]any{"used": true, "version": tlsVersionName(state.Version), "cipherSuite": tls.CipherSuiteName(state.CipherSuite), "serverName": state.ServerName, "verified": len(state.VerifiedChains) > 0}
	if len(state.PeerCertificates) > 0 {
		certificate := state.PeerCertificates[0]
		fingerprint := sha256.Sum256(certificate.Raw)
		summary["subject"] = certificate.Subject.String()
		summary["issuer"] = certificate.Issuer.String()
		summary["notAfter"] = certificate.NotAfter.UTC()
		summary["daysUntilExpiry"] = int(time.Until(certificate.NotAfter).Hours() / 24)
		summary["sha256Fingerprint"] = strings.ToUpper(hex.EncodeToString(fingerprint[:]))
	}
	return summary
}
func tlsVersionName(version uint16) string {
	switch version {
	case tls.VersionTLS13:
		return "TLS 1.3"
	case tls.VersionTLS12:
		return "TLS 1.2"
	case tls.VersionTLS11:
		return "TLS 1.1"
	default:
		return fmt.Sprintf("0x%04x", version)
	}
}
func safeProxySummary(config ProxyConfig) map[string]any {
	mode := config.Mode
	if mode == "" {
		mode = "environment"
	}
	summary := map[string]any{"mode": mode, "profileId": config.ProfileID}
	if parsed, err := url.Parse(config.URL); err == nil && parsed.Host != "" {
		summary["host"] = parsed.Host
	}
	if config.NoProxy != "" {
		summary["noProxyConfigured"] = true
	}
	return summary
}

func retrySafe(request *http.Request) bool {
	switch request.Method {
	case http.MethodGet, http.MethodHead, http.MethodOptions, http.MethodPut, http.MethodDelete:
		return true
	default:
		return strings.TrimSpace(request.Header.Get("Idempotency-Key")) != ""
	}
}

func waitRetry(ctx context.Context, strategy string, attempt int) error {
	delay := 100 * time.Millisecond
	switch strategy {
	case "linear":
		delay *= time.Duration(attempt)
	case "exponential":
		delay *= time.Duration(1 << min(attempt-1, 4))
	}
	timer := time.NewTimer(delay)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}

func (e *HTTPExecutor) buildRequest(ctx context.Context, config RequestConfig, values map[string]string, client *http.Client) (*http.Request, map[string]any, error) {
	renderedURL, err := render(config.URL, values)
	if err != nil {
		return nil, nil, err
	}
	target, err := url.Parse(renderedURL)
	if err != nil {
		return nil, nil, fmt.Errorf("invalid request URL")
	}
	if err := e.validateTarget(target); err != nil {
		return nil, nil, err
	}
	query := target.Query()
	for _, parameter := range config.Params {
		if !parameter.Enabled || strings.TrimSpace(parameter.Key) == "" {
			continue
		}
		value, err := render(parameter.Value, values)
		if err != nil {
			return nil, nil, err
		}
		query.Add(parameter.Key, value)
	}
	target.RawQuery = query.Encode()
	body, err := render(config.Body.Content, values)
	if err != nil {
		return nil, nil, err
	}
	body, automaticContentType, err := encodeRequestBody(config.Body.Type, body)
	if err != nil {
		return nil, nil, err
	}
	request, err := http.NewRequestWithContext(ctx, strings.ToUpper(config.Method), target.String(), strings.NewReader(body))
	if err != nil {
		return nil, nil, fmt.Errorf("build request: %w", err)
	}
	safeHeaderSummary := make(map[string]string)
	for _, header := range config.Headers {
		if !header.Enabled || strings.TrimSpace(header.Key) == "" {
			continue
		}
		value, err := render(header.Value, values)
		if err != nil {
			return nil, nil, err
		}
		request.Header.Add(header.Key, value)
		if header.Sensitive || sensitiveHeader(header.Key) {
			safeHeaderSummary[header.Key] = "••••••••"
		} else if maskKnownValue(value, values) != value {
			safeHeaderSummary[header.Key] = "••••••••"
		} else {
			safeHeaderSummary[header.Key] = value
		}
	}
	for _, configuredCookie := range config.Cookies {
		if !configuredCookie.Enabled || strings.TrimSpace(configuredCookie.Key) == "" {
			continue
		}
		cookieValue, err := render(configuredCookie.Value, values)
		if err != nil {
			return nil, nil, err
		}
		request.AddCookie(&http.Cookie{Name: configuredCookie.Key, Value: cookieValue, Domain: configuredCookie.Domain, Path: configuredCookie.Path})
	}
	requestValues := make(map[string]string, len(values)+4)
	for key, value := range values {
		requestValues[key] = value
	}
	requestValues["request.method"] = request.Method
	requestValues["request.path"] = request.URL.EscapedPath()
	requestValues["request.body"] = body
	requestValues["request.timestamp"] = time.Now().UTC().Format(time.RFC3339)
	if err := e.applyAuth(ctx, client, request, config.Auth, requestValues); err != nil {
		return nil, nil, err
	}
	switch config.Auth.Type {
	case "basic", "bearer", "oauth2", "jwt":
		safeHeaderSummary["Authorization"] = "••••••••"
	case "apiKey":
		if config.Auth.Fields["location"] != "query" && config.Auth.Fields["name"] != "" {
			safeHeaderSummary[config.Auth.Fields["name"]] = "••••••••"
		}
	case "hmac":
		header := strings.TrimSpace(config.Auth.Fields["outputHeader"])
		if header == "" {
			header = "X-Signature"
		}
		safeHeaderSummary[header] = "••••••••"
	}
	if automaticContentType != "" && request.Header.Get("Content-Type") == "" {
		request.Header.Set("Content-Type", automaticContentType)
	}
	summary := map[string]any{"method": request.Method, "url": safeRequestURL(request.URL, config.Auth, values), "headers": safeHeaderSummary, "bodyBytes": len(body)}
	summary["bodyCapture"] = captureState(config.Settings.CaptureBody, len(body), false, true)
	if config.Settings.CaptureBody && len(body) > 0 {
		summary["body"] = safeBody([]byte(body), values)
		if len(values) > 0 {
			summary["bodyCapture"].(map[string]any)["state"] = "MASKED"
		}
	}
	return request, summary, nil
}

func encodeRequestBody(bodyType, content string) (string, string, error) {
	switch strings.ToLower(bodyType) {
	case "", "none", "raw":
		return content, "", nil
	case "json":
		return content, "application/json", nil
	case "xml":
		return content, "application/xml", nil
	case "graphql":
		return content, "application/graphql", nil
	case "form":
		values, err := url.ParseQuery(content)
		if err != nil {
			return "", "", errors.New("form body is not valid URL-encoded data")
		}
		return values.Encode(), "application/x-www-form-urlencoded", nil
	case "multipart":
		values, err := url.ParseQuery(content)
		if err != nil {
			return "", "", errors.New("multipart body must use URL-encoded key/value fields")
		}
		var buffer bytes.Buffer
		writer := multipart.NewWriter(&buffer)
		for key, entries := range values {
			for _, value := range entries {
				if err := writer.WriteField(key, value); err != nil {
					return "", "", errors.New("multipart body could not be encoded")
				}
			}
		}
		if err := writer.Close(); err != nil {
			return "", "", errors.New("multipart body could not be finalized")
		}
		return buffer.String(), writer.FormDataContentType(), nil
	default:
		return "", "", fmt.Errorf("request body type %q is invalid", bodyType)
	}
}

func (e *HTTPExecutor) transport(ctx context.Context, config RequestConfig) (*http.Transport, error) {
	minimumVersion := uint16(tls.VersionTLS12)
	if config.TLS.MinimumVersion == "TLS 1.3" {
		minimumVersion = tls.VersionTLS13
	}
	var tlsMaterial TLSMaterial
	if config.TLS.CertificateProfileID != "" || config.TLS.CAProfileID != "" {
		if e.resolver == nil {
			return nil, errors.New("certificate and CA profiles require a runtime resolver")
		}
		material, err := e.resolver.ResolveTLSProfile(ctx, config.TLS.CertificateProfileID, config.TLS.CAProfileID)
		if err != nil {
			return nil, fmt.Errorf("resolve TLS profile: %w", err)
		}
		tlsMaterial = material
	}
	verifyHostname := true
	if config.TLS.VerifyHostname != nil {
		verifyHostname = *config.TLS.VerifyHostname
	}
	transport := &http.Transport{
		DisableCompression: !config.Settings.Compression,
		DialContext:        e.safeDialContext,
		TLSClientConfig:    &tls.Config{MinVersion: minimumVersion, InsecureSkipVerify: !verifyHostname}, //nolint:gosec -- an explicit monitor option
	}
	if tlsMaterial.CABundlePEM != "" {
		cacheKey := sha256.Sum256([]byte(tlsMaterial.CABundlePEM))
		if cached, ok := e.caCache.Load(cacheKey); ok {
			transport.TLSClientConfig.RootCAs = cached.(*x509.CertPool).Clone()
		} else {
			pool, err := x509.SystemCertPool()
			if err != nil || pool == nil {
				pool = x509.NewCertPool()
			}
			if !pool.AppendCertsFromPEM([]byte(tlsMaterial.CABundlePEM)) {
				return nil, errors.New("custom CA bundle is not valid PEM")
			}
			e.caCache.Store(cacheKey, pool.Clone())
			transport.TLSClientConfig.RootCAs = pool
		}
	}
	if tlsMaterial.ClientCertificatePEM != "" || tlsMaterial.ClientKeyPEM != "" {
		certificate, err := tls.X509KeyPair([]byte(tlsMaterial.ClientCertificatePEM), []byte(tlsMaterial.ClientKeyPEM))
		if err != nil {
			return nil, errors.New("client certificate profile is invalid")
		}
		transport.TLSClientConfig.Certificates = []tls.Certificate{certificate}
	}
	if config.Proxy.Mode == "profile" {
		if e.resolver == nil {
			return nil, errors.New("proxy profiles require a runtime resolver")
		}
		material, err := e.resolver.ResolveProxyProfile(ctx, config.Proxy.ProfileID)
		if err != nil {
			return nil, fmt.Errorf("resolve proxy profile: %w", err)
		}
		config.Proxy.URL = material.URL
		parsedProfileURL, parseErr := url.Parse(material.URL)
		if parseErr != nil {
			return nil, errors.New("proxy profile URL is invalid")
		}
		switch strings.ToLower(parsedProfileURL.Scheme) {
		case "socks5", "socks5h":
			config.Proxy.Mode = "socks5"
		case "http", "https":
			config.Proxy.Mode = strings.ToLower(parsedProfileURL.Scheme)
		default:
			return nil, errors.New("proxy profile URL must use http, https, or socks5")
		}
		config.Proxy.NoProxy = material.NoProxy
		config.Proxy.UsernameSecretRef = material.Username
		config.Proxy.PasswordSecretRef = material.Password
	}
	switch config.Proxy.Mode {
	case "", "environment":
		transport.Proxy = http.ProxyFromEnvironment
	case "none":
		transport.Proxy = nil
	case "http", "https", "socks5":
		proxyURL, err := url.Parse(config.Proxy.URL)
		if err != nil || proxyURL.Host == "" {
			return nil, errors.New("proxy URL is invalid")
		}
		username, err := e.resolveCredential(ctx, config.Proxy.UsernameSecretRef, nil)
		if err != nil {
			return nil, fmt.Errorf("resolve proxy username: %w", err)
		}
		password, err := e.resolveCredential(ctx, config.Proxy.PasswordSecretRef, nil)
		if err != nil {
			return nil, fmt.Errorf("resolve proxy password: %w", err)
		}
		if username != "" || password != "" {
			proxyURL.User = url.UserPassword(username, password)
		}
		if config.Proxy.Mode == "socks5" {
			dialer, err := xproxy.FromURL(proxyURL, &net.Dialer{Timeout: 10 * time.Second})
			if err != nil {
				return nil, errors.New("SOCKS5 proxy configuration is invalid")
			}
			transport.Proxy = nil
			transport.DialContext = func(ctx context.Context, network, address string) (net.Conn, error) {
				type contextDialer interface {
					DialContext(context.Context, string, string) (net.Conn, error)
				}
				if contextual, ok := dialer.(contextDialer); ok {
					return contextual.DialContext(ctx, network, address)
				}
				return dialer.Dial(network, address)
			}
		} else {
			transport.Proxy = proxyWithBypass(proxyURL, config.Proxy.NoProxy)
		}
	default:
		return nil, fmt.Errorf("proxy mode %q is invalid", config.Proxy.Mode)
	}
	return transport, nil
}

func proxyWithBypass(proxyURL *url.URL, noProxy string) func(*http.Request) (*url.URL, error) {
	rules := strings.Split(noProxy, ",")
	return func(request *http.Request) (*url.URL, error) {
		host := strings.ToLower(request.URL.Hostname())
		for _, raw := range rules {
			rule := strings.ToLower(strings.TrimSpace(raw))
			if rule == "" {
				continue
			}
			if rule == "*" || host == rule || strings.HasPrefix(rule, "*.") && strings.HasSuffix(host, strings.TrimPrefix(rule, "*")) {
				return nil, nil
			}
		}
		return proxyURL, nil
	}
}

func (e *HTTPExecutor) prepareActions(ctx context.Context, actions []ActionConfig, values map[string]string) ([]ActionConfig, error) {
	prepared := make([]ActionConfig, len(actions))
	for index, action := range actions {
		prepared[index] = action
		prepared[index].Fields = make(map[string]string, len(action.Fields))
		for key, value := range action.Fields {
			if strings.HasPrefix(strings.TrimSpace(value), "secret://") {
				resolved, err := e.resolveCredential(ctx, value, values)
				if err != nil {
					return nil, err
				}
				prepared[index].Fields[key] = resolved
			} else {
				prepared[index].Fields[key] = value
			}
		}
	}
	return prepared, nil
}

func (e *HTTPExecutor) resolveCredential(ctx context.Context, value string, variables map[string]string) (string, error) {
	rendered, err := render(value, variables)
	if err != nil {
		return "", err
	}
	if !strings.HasPrefix(strings.TrimSpace(rendered), "secret://") {
		return rendered, nil
	}
	if e.resolver == nil {
		return "", errors.New("secret references require the configuration library resolver")
	}
	return e.resolver.ResolveSecret(ctx, rendered)
}

func configureRedirects(client *http.Client, settings SettingsConfig, executor *HTTPExecutor) {
	if !settings.FollowRedirects {
		client.CheckRedirect = func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse }
		return
	}
	maxRedirects := settings.MaxRedirects
	if maxRedirects <= 0 {
		maxRedirects = 5
	}
	client.CheckRedirect = func(next *http.Request, via []*http.Request) error {
		if len(via) >= maxRedirects {
			return errors.New("maximum redirects exceeded")
		}
		return executor.validateTarget(next.URL)
	}
}

func (e *HTTPExecutor) validateTarget(target *url.URL) error {
	if target.Scheme != "http" && target.Scheme != "https" {
		return errors.New("only HTTP and HTTPS targets are allowed")
	}
	if target.Hostname() == "" || target.User != nil {
		return errors.New("request URL must contain a host and cannot contain embedded credentials")
	}
	if e.allowPrivate {
		return nil
	}
	lookupContext, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	addresses, err := net.DefaultResolver.LookupIPAddr(lookupContext, target.Hostname())
	if err != nil {
		return fmt.Errorf("resolve target host: %w", err)
	}
	for _, address := range addresses {
		if forbiddenIP(address.IP) {
			return errors.New("target resolves to a private or reserved network address")
		}
	}
	return nil
}

func (e *HTTPExecutor) safeDialContext(ctx context.Context, network, address string) (net.Conn, error) {
	host, port, err := net.SplitHostPort(address)
	if err != nil {
		return nil, err
	}
	addresses, err := net.DefaultResolver.LookupIPAddr(ctx, host)
	if err != nil {
		return nil, err
	}
	for _, candidate := range addresses {
		if !e.allowPrivate && forbiddenIP(candidate.IP) {
			continue
		}
		return (&net.Dialer{Timeout: 10 * time.Second}).DialContext(ctx, network, net.JoinHostPort(candidate.IP.String(), port))
	}
	return nil, errors.New("target has no allowed network address")
}

func executeActions(actions []ActionConfig, seed map[string]string) (map[string]string, error) {
	values := make(map[string]string, len(seed))
	for key, value := range seed {
		values[key] = value
	}
	for _, action := range actions {
		if !action.Enabled {
			continue
		}
		var value string
		actionType := normalizeActionType(action.Type)
		switch actionType {
		case "timestamp":
			value = time.Now().UTC().Format(time.RFC3339Nano)
		case "uuid":
			generated, err := id.NewUUID()
			if err != nil {
				return nil, err
			}
			value = generated
		case "nonce":
			buffer := make([]byte, 16)
			if _, err := rand.Read(buffer); err != nil {
				return nil, err
			}
			value = hex.EncodeToString(buffer)
		case "sha":
			rendered, err := render(action.Expression, values)
			if err != nil {
				return nil, err
			}
			digest := sha256.Sum256([]byte(rendered))
			value = hex.EncodeToString(digest[:])
		case "sha512":
			rendered, err := render(action.Expression, values)
			if err != nil {
				return nil, err
			}
			digest := sha512.Sum512([]byte(rendered))
			value = hex.EncodeToString(digest[:])
		case "hmac":
			input, err := render(firstNonEmpty(action.Fields["input"], action.Expression), values)
			if err != nil {
				return nil, err
			}
			secret, err := render(action.Fields["secret"], values)
			if err != nil {
				return nil, err
			}
			value, err = hmacSignature(action.Fields["algorithm"], secret, input)
			if err != nil {
				return nil, err
			}
			value, err = encodeActionOutput(value, action.Fields["outputEncoding"])
			if err != nil {
				return nil, err
			}
		case "base64-encode":
			rendered, err := render(action.Expression, values)
			if err != nil {
				return nil, err
			}
			value = base64.StdEncoding.EncodeToString([]byte(rendered))
		case "base64-decode":
			rendered, err := render(action.Expression, values)
			if err != nil {
				return nil, err
			}
			decoded, err := base64.StdEncoding.DecodeString(rendered)
			if err != nil {
				return nil, errors.New("base64 action input is invalid")
			}
			value = string(decoded)
		case "url-encode":
			rendered, err := render(action.Expression, values)
			if err != nil {
				return nil, err
			}
			value = url.QueryEscape(rendered)
		case "url-decode":
			rendered, err := render(action.Expression, values)
			if err != nil {
				return nil, err
			}
			value, err = url.QueryUnescape(rendered)
			if err != nil {
				return nil, errors.New("URL encoded action input is invalid")
			}
		case "random-string":
			length, _ := strconv.Atoi(action.Fields["length"])
			if length <= 0 {
				length = 24
			}
			if length > 1024 {
				return nil, errors.New("random string length exceeds 1024")
			}
			buffer := make([]byte, length)
			if _, err := rand.Read(buffer); err != nil {
				return nil, err
			}
			value = base64.RawURLEncoding.EncodeToString(buffer)[:length]
		case "json-stringify":
			rendered, err := render(action.Expression, values)
			if err != nil {
				return nil, err
			}
			var parsed any
			if err := json.Unmarshal([]byte(rendered), &parsed); err != nil {
				return nil, errors.New("JSON stringify input is invalid")
			}
			encoded, _ := json.Marshal(parsed)
			value = string(encoded)
		case "jwt":
			generated, err := generateJWT(AuthConfig{Type: "jwt", Fields: action.Fields}, values)
			if err != nil {
				return nil, err
			}
			value = generated
		case "copy-value":
			value = values[strings.TrimSpace(action.Expression)]
		case "unset-variable":
			delete(values, strings.TrimSpace(action.Expression))
			continue
		case "set-variable":
			rendered, err := render(action.Expression, values)
			if err != nil {
				return nil, err
			}
			value = rendered
		default:
			return nil, fmt.Errorf("controlled action %q is not executable yet", action.Type)
		}
		if strings.TrimSpace(action.Output) == "" {
			return nil, errors.New("pre-request action output is required")
		}
		values[action.Output] = value
	}
	return values, nil
}

func normalizeActionType(value string) string {
	value = strings.ToLower(strings.ReplaceAll(strings.TrimSpace(value), "_", "-"))
	value = strings.TrimPrefix(value, "generate-")
	switch value {
	case "timestamp":
		return "timestamp"
	case "uuid":
		return "uuid"
	case "nonce":
		return "nonce"
	case "sha256", "sha":
		return "sha"
	case "hmac-sha256", "hmac-signature":
		return "hmac"
	case "set-variable":
		return "set-variable"
	}
	return value
}
func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}
func encodeActionOutput(hexValue, encoding string) (string, error) {
	bytes, err := hex.DecodeString(hexValue)
	if err != nil {
		return "", err
	}
	switch strings.ToUpper(strings.ReplaceAll(encoding, "-", "_")) {
	case "", "HEX", "HEX_LOWER":
		return hexValue, nil
	case "HEX_UPPER":
		return strings.ToUpper(hexValue), nil
	case "BASE64":
		return base64.StdEncoding.EncodeToString(bytes), nil
	case "BASE64_URL", "BASE64_URL_SAFE":
		return base64.RawURLEncoding.EncodeToString(bytes), nil
	default:
		return "", fmt.Errorf("action output encoding %q is invalid", encoding)
	}
}

func (e *HTTPExecutor) applyAuth(ctx context.Context, client *http.Client, request *http.Request, auth AuthConfig, values map[string]string) error {
	switch auth.Type {
	case "", "none":
		return nil
	case "basic":
		username, err := e.resolveCredential(ctx, auth.Fields["username"], values)
		if err != nil {
			return err
		}
		password, err := e.resolveCredential(ctx, auth.Fields["password"], values)
		if err != nil {
			return err
		}
		request.SetBasicAuth(username, password)
	case "bearer":
		token, err := e.resolveCredential(ctx, auth.Fields["token"], values)
		if err != nil {
			return err
		}
		request.Header.Set("Authorization", "Bearer "+token)
	case "apiKey":
		name, value := auth.Fields["name"], auth.Fields["value"]
		rendered, err := e.resolveCredential(ctx, value, values)
		if err != nil {
			return err
		}
		if auth.Fields["location"] == "query" {
			query := request.URL.Query()
			query.Set(name, rendered)
			request.URL.RawQuery = query.Encode()
		} else {
			request.Header.Set(name, rendered)
		}
	case "oauth2":
		token, err := e.acquireOAuthToken(ctx, client, auth, values)
		if err != nil {
			return err
		}
		request.Header.Set("Authorization", "Bearer "+token)
	case "jwt":
		key, err := e.resolveCredential(ctx, auth.Fields["keyRef"], values)
		if err != nil {
			return err
		}
		resolvedAuth := auth
		resolvedAuth.Fields = cloneStringMap(auth.Fields)
		resolvedAuth.Fields["keyRef"] = key
		token, err := generateJWT(resolvedAuth, values)
		if err != nil {
			return err
		}
		request.Header.Set("Authorization", "Bearer "+token)
	case "hmac":
		canonical, err := render(auth.Fields["canonicalTemplate"], values)
		if err != nil {
			return err
		}
		secret, err := e.resolveCredential(ctx, auth.Fields["secretRef"], values)
		if err != nil {
			return err
		}
		signature, err := hmacSignature(auth.Fields["algorithm"], secret, canonical)
		if err != nil {
			return err
		}
		header := strings.TrimSpace(auth.Fields["outputHeader"])
		if header == "" {
			header = "X-Signature"
		}
		request.Header.Set(header, signature)
	default:
		return fmt.Errorf("authentication type %q is not executable yet", auth.Type)
	}
	return nil
}

func (e *HTTPExecutor) acquireOAuthToken(ctx context.Context, client *http.Client, auth AuthConfig, values map[string]string) (string, error) {
	tokenURL, err := render(auth.Fields["tokenUrl"], values)
	if err != nil {
		return "", err
	}
	parsed, err := url.Parse(tokenURL)
	if err != nil || e.validateTarget(parsed) != nil {
		return "", errors.New("OAuth token URL is invalid or blocked by network policy")
	}
	clientID, err := render(auth.Fields["clientId"], values)
	if err != nil {
		return "", err
	}
	clientSecret, err := e.resolveCredential(ctx, auth.Fields["clientSecret"], values)
	if err != nil {
		return "", err
	}
	form := url.Values{"grant_type": {"client_credentials"}}
	if scope := strings.TrimSpace(auth.Fields["scope"]); scope != "" {
		form.Set("scope", scope)
	}
	tokenRequest, err := http.NewRequestWithContext(ctx, http.MethodPost, parsed.String(), strings.NewReader(form.Encode()))
	if err != nil {
		return "", errors.New("unable to build OAuth token request")
	}
	tokenRequest.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	tokenRequest.SetBasicAuth(clientID, clientSecret)
	response, err := client.Do(tokenRequest)
	if err != nil {
		return "", errors.New("OAuth token request failed")
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return "", fmt.Errorf("OAuth token endpoint returned HTTP %d", response.StatusCode)
	}
	var payload struct {
		AccessToken string `json:"access_token"`
		TokenType   string `json:"token_type"`
	}
	if err := json.NewDecoder(io.LimitReader(response.Body, 1<<20)).Decode(&payload); err != nil || payload.AccessToken == "" {
		return "", errors.New("OAuth token response did not contain access_token")
	}
	return payload.AccessToken, nil
}

func generateJWT(auth AuthConfig, values map[string]string) (string, error) {
	algorithm := strings.ToUpper(strings.TrimSpace(auth.Fields["algorithm"]))
	if algorithm == "" {
		algorithm = "RS256"
	}
	issuer, err := render(auth.Fields["issuer"], values)
	if err != nil {
		return "", err
	}
	audience, err := render(auth.Fields["audience"], values)
	if err != nil {
		return "", err
	}
	key, err := render(auth.Fields["keyRef"], values)
	if err != nil {
		return "", err
	}
	now := time.Now().UTC()
	jti, err := id.NewUUID()
	if err != nil {
		return "", err
	}
	header, _ := json.Marshal(map[string]any{"alg": algorithm, "typ": "JWT"})
	claims, _ := json.Marshal(map[string]any{"iss": issuer, "sub": issuer, "aud": audience, "iat": now.Unix(), "exp": now.Add(5 * time.Minute).Unix(), "jti": jti})
	unsigned := base64.RawURLEncoding.EncodeToString(header) + "." + base64.RawURLEncoding.EncodeToString(claims)
	var signature []byte
	switch algorithm {
	case "HS256":
		mac := hmac.New(sha256.New, []byte(key))
		_, _ = mac.Write([]byte(unsigned))
		signature = mac.Sum(nil)
	case "RS256":
		privateKey, err := parseRSAPrivateKey(key)
		if err != nil {
			return "", err
		}
		digest := sha256.Sum256([]byte(unsigned))
		signature, err = rsa.SignPKCS1v15(rand.Reader, privateKey, crypto.SHA256, digest[:])
		if err != nil {
			return "", errors.New("JWT signing failed")
		}
	default:
		return "", fmt.Errorf("JWT algorithm %q is not supported", algorithm)
	}
	return unsigned + "." + base64.RawURLEncoding.EncodeToString(signature), nil
}

func parseRSAPrivateKey(value string) (*rsa.PrivateKey, error) {
	block, _ := pem.Decode([]byte(value))
	if block == nil {
		return nil, errors.New("JWT signing key is not valid PEM")
	}
	if key, err := x509.ParsePKCS1PrivateKey(block.Bytes); err == nil {
		return key, nil
	}
	parsed, err := x509.ParsePKCS8PrivateKey(block.Bytes)
	if err != nil {
		return nil, errors.New("JWT signing key is not PKCS#1 or PKCS#8")
	}
	key, ok := parsed.(*rsa.PrivateKey)
	if !ok {
		return nil, errors.New("JWT signing key is not RSA")
	}
	return key, nil
}

func cloneStringMap(source map[string]string) map[string]string {
	result := make(map[string]string, len(source))
	for key, value := range source {
		result[key] = value
	}
	return result
}

func hmacSignature(algorithm, secret, canonical string) (string, error) {
	var mac hashWriter
	switch strings.ToUpper(strings.ReplaceAll(algorithm, "-", "")) {
	case "", "SHA256", "HS256":
		mac = hmac.New(sha256.New, []byte(secret))
	case "SHA512", "HS512":
		mac = hmac.New(sha512.New, []byte(secret))
	default:
		return "", fmt.Errorf("HMAC algorithm %q is not supported", algorithm)
	}
	_, _ = mac.Write([]byte(canonical))
	return hex.EncodeToString(mac.Sum(nil)), nil
}

type hashWriter interface {
	Write([]byte) (int, error)
	Sum([]byte) []byte
}

func evaluateExtractors(configs []ExtractorConfig, response *http.Response, body []byte, duration time.Duration, outputs map[string]any, privateOutputs map[string]string) []ExtractorResult {
	results := make([]ExtractorResult, 0)
	for _, config := range configs {
		if !config.Enabled {
			continue
		}
		value, err := extractValue(config.Source, config.Expression, response, body, duration)
		result := ExtractorResult{Variable: config.Variable, Source: config.Source, Sensitive: config.Sensitive, Success: err == nil}
		if err != nil {
			result.Error = err.Error()
		} else if config.Sensitive {
			result.Value = "••••••••"
			outputs[config.Variable] = map[string]any{"sensitive": true}
			privateOutputs[config.Variable] = fmt.Sprint(value)
		} else {
			result.Value = value
			outputs[config.Variable] = value
		}
		results = append(results, result)
	}
	return results
}

func evaluateAssertions(configs []AssertionConfig, response *http.Response, body []byte, duration time.Duration) []AssertionResult {
	results := make([]AssertionResult, 0)
	for _, config := range configs {
		if !config.Enabled {
			continue
		}
		observed, err := extractValue(config.Type, config.Expression, response, body, duration)
		passed := err == nil && compareAssertion(config, observed)
		result := AssertionResult{Type: config.Type, Expression: config.Expression, Expected: config.Expected, Observed: safeObserved(config, observed), Passed: passed}
		if err != nil {
			result.Error = err.Error()
		} else if !passed {
			result.Error = "assertion did not match the expected value"
		}
		results = append(results, result)
	}
	return results
}

func extractValue(kind, expression string, response *http.Response, body []byte, duration time.Duration) (any, error) {
	switch kind {
	case "status":
		return response.StatusCode, nil
	case "header":
		value := response.Header.Get(expression)
		if value == "" {
			return nil, fmt.Errorf("response header %q was not found", expression)
		}
		return value, nil
	case "cookie":
		for _, cookie := range response.Cookies() {
			if cookie.Name == expression {
				return cookie.Value, nil
			}
		}
		return nil, fmt.Errorf("response cookie %q was not found", expression)
	case "regex":
		pattern, err := regexp.Compile(expression)
		if err != nil {
			return nil, errors.New("invalid extractor regular expression")
		}
		match := pattern.FindSubmatch(body)
		if len(match) == 0 {
			return nil, errors.New("regular expression did not match")
		}
		if len(match) > 1 {
			return string(match[1]), nil
		}
		return string(match[0]), nil
	case "jsonpath":
		return simpleJSONPath(body, expression)
	case "timing", "response-time":
		return duration.Milliseconds(), nil
	case "body-contains":
		return string(body), nil
	case "body", "body-text":
		return string(body), nil
	case "response-size":
		return len(body), nil
	case "final-url":
		return response.Request.URL.String(), nil
	case "reason":
		return response.Status, nil
	case "tls-version":
		if response.TLS == nil {
			return nil, errors.New("request did not use TLS")
		}
		return tlsVersionName(response.TLS.Version), nil
	case "tls-trusted":
		return response.TLS != nil && len(response.TLS.VerifiedChains) > 0, nil
	case "tls-days-until-expiry":
		if response.TLS == nil || len(response.TLS.PeerCertificates) == 0 {
			return nil, errors.New("peer certificate is unavailable")
		}
		return int(time.Until(response.TLS.PeerCertificates[0].NotAfter).Hours() / 24), nil
	case "tls-issuer":
		if response.TLS == nil || len(response.TLS.PeerCertificates) == 0 {
			return nil, errors.New("peer certificate is unavailable")
		}
		return response.TLS.PeerCertificates[0].Issuer.String(), nil
	case "tls-subject":
		if response.TLS == nil || len(response.TLS.PeerCertificates) == 0 {
			return nil, errors.New("peer certificate is unavailable")
		}
		return response.TLS.PeerCertificates[0].Subject.String(), nil
	case "json-schema":
		return validateJSONSchema(body, expression)
	default:
		return nil, fmt.Errorf("%s evaluation is not executable yet", kind)
	}
}

func simpleJSONPath(body []byte, expression string) (any, error) {
	var value any
	if err := json.Unmarshal(body, &value); err != nil {
		return nil, errors.New("response body is not valid JSON")
	}
	path := strings.TrimPrefix(strings.TrimSpace(expression), "$")
	path = strings.TrimPrefix(path, ".")
	current := value
	if path == "" {
		return current, nil
	}
	for _, segment := range strings.Split(path, ".") {
		object, ok := current.(map[string]any)
		if !ok {
			return nil, fmt.Errorf("JSONPath %q does not resolve to an object", expression)
		}
		current, ok = object[segment]
		if !ok {
			return nil, fmt.Errorf("JSONPath %q was not found", expression)
		}
	}
	return current, nil
}

func compareAssertion(config AssertionConfig, observed any) bool {
	kind, expected, operator := config.Type, config.Expected, strings.ToLower(config.Operator)
	if operator == "" {
		operator = "equals"
	}
	if kind == "body-contains" && config.Operator == "" {
		return strings.Contains(fmt.Sprint(observed), expected)
	}
	if kind == "response-time" && config.Operator == "" {
		limit, err := strconv.ParseInt(expected, 10, 64)
		return err == nil && observed.(int64) <= limit
	}
	if kind == "json-schema" {
		return observed == "valid"
	}
	actual := fmt.Sprint(observed)
	switch operator {
	case "equals", "equal", "eq":
		return actual == expected
	case "not-equals", "neq":
		return actual != expected
	case "exists":
		return observed != nil && actual != ""
	case "contains":
		return strings.Contains(actual, expected)
	case "matches":
		matched, err := regexp.MatchString(expected, actual)
		return err == nil && matched
	case "greater-than", "gt", "greater_than", "less-than", "lt", "less_than", "gte", "greater-than-or-equal", "lte", "less-than-or-equal":
		a, aerr := strconv.ParseFloat(actual, 64)
		b, berr := strconv.ParseFloat(expected, 64)
		if aerr != nil || berr != nil {
			return false
		}
		switch operator {
		case "greater-than", "gt", "greater_than":
			return a > b
		case "less-than", "lt", "less_than":
			return a < b
		case "gte", "greater-than-or-equal":
			return a >= b
		default:
			return a <= b
		}
	}
	return actual == expected
}

type blockedSchemaLoader struct{}

func (blockedSchemaLoader) Load(location string) (any, error) {
	return nil, fmt.Errorf("remote schema reference %q is blocked", location)
}
func validateJSONSchema(body []byte, expression string) (any, error) {
	if len(expression) > 64<<10 {
		return nil, errors.New("JSON schema exceeds 64 KiB")
	}
	var schemaDocument any
	if err := json.Unmarshal([]byte(expression), &schemaDocument); err != nil {
		return nil, errors.New("assertion schema is not valid JSON")
	}
	var document any
	if err := json.Unmarshal(body, &document); err != nil {
		return nil, errors.New("response body is not valid JSON")
	}
	compiler := jsonschema.NewCompiler()
	compiler.UseLoader(blockedSchemaLoader{})
	if err := compiler.AddResource("rhythm-inline-schema.json", schemaDocument); err != nil {
		return nil, errors.New("JSON schema could not be loaded")
	}
	schema, err := compiler.Compile("rhythm-inline-schema.json")
	if err != nil {
		return nil, errors.New("JSON schema could not be compiled")
	}
	if err := schema.Validate(document); err != nil {
		return nil, errors.New("response does not match JSON schema")
	}
	return "valid", nil
}

func render(value string, variables map[string]string) (string, error) {
	var unresolved string
	rendered := templatePattern.ReplaceAllStringFunc(value, func(match string) string {
		key := strings.TrimSpace(templatePattern.FindStringSubmatch(match)[1])
		resolved, ok := resolveTemplateValue(key, variables)
		if !ok {
			unresolved = key
			return match
		}
		return resolved
	})
	if unresolved != "" {
		return "", fmt.Errorf("template variable %q is unresolved", unresolved)
	}
	return rendered, nil
}

func resolveTemplateValue(key string, variables map[string]string) (string, bool) {
	switch key {
	case "$guid", "$uuid":
		value, err := id.NewUUID()
		return value, err == nil
	case "$timestamp":
		return strconv.FormatInt(time.Now().UTC().Unix(), 10), true
	case "$isoTimestamp":
		return time.Now().UTC().Format(time.RFC3339Nano), true
	case "$randomInt":
		value, err := rand.Int(rand.Reader, big.NewInt(1001))
		if err != nil {
			return "", false
		}
		return value.String(), true
	}
	if strings.Contains(key, ".") {
		value, ok := variables[key]
		return value, ok
	}
	if value, ok := variables["variables."+key]; ok {
		return value, true
	}
	if value, ok := variables[key]; ok {
		return value, true
	}
	for _, scope := range []string{"environment.", "collection.", "globals."} {
		if value, ok := variables[scope+key]; ok {
			return value, true
		}
	}
	return "", false
}

func finishStep(result StepRun, status Status, category, message string, started time.Time) StepRun {
	ended := time.Now().UTC()
	result.Status, result.FailureCategory, result.ErrorMessage = status, category, message
	result.EndedAt, result.DurationMS = &ended, ended.Sub(started).Milliseconds()
	if result.Timing != nil {
		result.Timing["totalMs"] = result.DurationMS
	}
	return result
}

func forbiddenIP(ip net.IP) bool {
	return ip.IsLoopback() || ip.IsPrivate() || ip.IsUnspecified() || ip.IsMulticast() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast()
}

func sensitiveHeader(name string) bool {
	return sensitiveKey(name)
}

func sensitiveKey(name string) bool {
	lower := strings.ToLower(strings.ReplaceAll(strings.ReplaceAll(name, "-", "_"), " ", "_"))
	for _, part := range []string{"password", "passwd", "secret", "client_secret", "api_key", "apikey", "token", "access_token", "refresh_token", "authorization", "proxy_authorization", "private_key", "privatekey", "assertion", "signature", "session", "cookie", "set_cookie"} {
		if strings.Contains(lower, part) {
			return true
		}
	}
	return false
}

func safeHeaders(headers http.Header) map[string][]string {
	safe := make(map[string][]string, len(headers))
	for name, values := range headers {
		if sensitiveHeader(name) {
			safe[name] = []string{"••••••••"}
		} else {
			safe[name] = values
		}
	}
	return safe
}

func networkFailureCategory(err error) string {
	message := strings.ToLower(err.Error())
	if strings.Contains(message, "proxyconnect") || strings.Contains(message, "proxy connection") {
		return "PROXY_CONNECTION_FAILURE"
	}
	var unknownAuthority x509.UnknownAuthorityError
	if errors.As(err, &unknownAuthority) {
		return "TLS_TRUST_FAILURE"
	}
	var hostnameError x509.HostnameError
	if errors.As(err, &hostnameError) {
		return "TLS_HOSTNAME_FAILURE"
	}
	var recordHeaderError tls.RecordHeaderError
	if errors.As(err, &recordHeaderError) || strings.Contains(message, "tls handshake") {
		return "TLS_HANDSHAKE_FAILURE"
	}
	var dnsError *net.DNSError
	if errors.As(err, &dnsError) {
		return "DNS_FAILURE"
	}
	var operationError *net.OpError
	if errors.As(err, &operationError) {
		if strings.Contains(strings.ToLower(operationError.Err.Error()), "refused") {
			return "CONNECTION_REFUSED"
		}
		return "NETWORK_UNREACHABLE"
	}
	return "HTTP_ERROR"
}

func safeError(err error) string {
	var urlError *url.Error
	if errors.As(err, &urlError) {
		if parsed, parseErr := url.Parse(urlError.URL); parseErr == nil {
			return fmt.Sprintf("%s %s://%s failed", urlError.Op, parsed.Scheme, parsed.Host)
		}
		return "outbound HTTP request failed"
	}
	message := err.Error()
	if len(message) > 500 {
		message = message[:500]
	}
	return message
}

func safeRequestURL(target *url.URL, auth AuthConfig, knownValues ...map[string]string) string {
	safe := *target
	query := safe.Query()
	for key := range query {
		if sensitiveKey(key) || (auth.Type == "apiKey" && auth.Fields["location"] == "query" && key == auth.Fields["name"]) {
			query.Set(key, "••••••••")
		}
	}
	safe.RawQuery = query.Encode()
	result := safe.String()
	if len(knownValues) > 0 {
		result = maskKnownValue(result, knownValues[0])
	}
	return result
}

func maskKnownValue(value string, known map[string]string) string {
	masked := value
	for key, candidate := range known {
		if candidate == "" || (!strings.HasPrefix(key, "secrets.") && !sensitiveKey(key)) {
			continue
		}
		masked = strings.ReplaceAll(masked, candidate, "••••••••")
	}
	return masked
}

func safeObserved(config AssertionConfig, observed any) any {
	lower := strings.ToLower(config.Expression)
	if config.Type == "body-contains" {
		return "body inspected"
	}
	if config.Type == "header" && sensitiveHeader(config.Expression) {
		return "••••••••"
	}
	if strings.Contains(lower, "token") || strings.Contains(lower, "secret") || strings.Contains(lower, "password") || strings.Contains(lower, "authorization") {
		return "••••••••"
	}
	return observed
}

func safeBody(body []byte, sensitiveValues map[string]string) any {
	var value any
	if json.Unmarshal(body, &value) == nil {
		return redactJSON(value, sensitiveValues)
	}
	return "Non-JSON response body omitted. Configure extractors to retain approved values."
}

func redactJSON(value any, sensitiveValues map[string]string) any {
	switch typed := value.(type) {
	case map[string]any:
		result := make(map[string]any, len(typed))
		for key, nested := range typed {
			if sensitiveKey(key) {
				result[key] = "••••••••"
			} else {
				result[key] = redactJSON(nested, sensitiveValues)
			}
		}
		return result
	case []any:
		result := make([]any, len(typed))
		for index, nested := range typed {
			result[index] = redactJSON(nested, sensitiveValues)
		}
		return result
	default:
		if text, ok := value.(string); ok {
			for _, sensitive := range sensitiveValues {
				if sensitive != "" && text == sensitive {
					return "••••••••"
				}
			}
		}
		return value
	}
}
