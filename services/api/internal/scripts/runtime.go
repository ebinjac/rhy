package scripts

import (
	"context"
	"crypto/hmac"
	"crypto/md5" //nolint:gosec -- required only for explicit legacy CryptoJS compatibility
	"crypto/rand"
	"crypto/sha1" //nolint:gosec -- required only for explicit legacy CryptoJS compatibility
	"crypto/sha256"
	"crypto/sha512"
	"crypto/tls"
	"crypto/x509"
	_ "embed"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"hash"
	"io"
	"net"
	"net/http"
	"net/url"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/dop251/goja"
)

//go:embed runtime_bootstrap_v2.js
var runtimeBootstrapV2 string

const (
	maxSourceBytes = 64 << 10
	maxInputBytes  = 1 << 20
	maxOutputBytes = 256 << 10
	maxLogBytes    = 64 << 10
	maxLogs        = 200
	maxAuxRequests = 5
	maxAuxBody     = 2 << 20
	defaultCPUTime = 250 * time.Millisecond
)

type Runtime struct {
	client       *http.Client
	packageMu    sync.RWMutex
	packageCache map[string]string
	programMu    sync.RWMutex
	programCache map[string]*goja.Program
}

func NewRuntime() *Runtime {
	return &Runtime{
		client:       &http.Client{Timeout: 10 * time.Second},
		packageCache: make(map[string]string),
		programCache: make(map[string]*goja.Program),
	}
}

func (r *Runtime) Validate(code string) Validation {
	problems := make([]Problem, 0)
	if len(code) > maxSourceBytes {
		problems = append(problems, Problem{Severity: "error", Message: "Script exceeds the 64 KB source limit.", Line: 1, Column: 1, Code: "SCRIPT_SOURCE_LIMIT"})
		return Validation{Valid: false, Problems: problems}
	}
	_, err := r.compiledProgram(code)
	if err != nil {
		line, column := errorPosition(err.Error())
		problems = append(problems, Problem{Severity: "error", Message: safeError(err.Error(), nil), Line: line, Column: column, Code: "SCRIPT_SYNTAX_ERROR"})
	}
	for _, match := range potentialSecretLiteralPattern.FindAllStringSubmatchIndex(code, -1) {
		if len(match) < 6 {
			continue
		}
		line, column := sourcePosition(code, match[4])
		problems = append(problems, Problem{
			Severity: "warning",
			Message:  "Potential credential literal detected. Store sensitive material in Rhythm Secrets and read it with rhythm.secrets.get() or pm.vault.get().",
			Line:     line,
			Column:   column,
			Code:     "POTENTIAL_SECRET_LITERAL",
		})
	}
	valid := true
	for _, problem := range problems {
		if problem.Severity == "error" {
			valid = false
			break
		}
	}
	return Validation{Valid: valid, Problems: problems}
}

func sourcePosition(source string, offset int) (line, column int) {
	line, column = 1, 1
	if offset > len(source) {
		offset = len(source)
	}
	for _, character := range source[:offset] {
		if character == '\n' {
			line, column = line+1, 1
		} else {
			column++
		}
	}
	return line, column
}

func (r *Runtime) Execute(ctx context.Context, input Input) (result Result, returnErr error) {
	started := time.Now()
	result = Result{Status: "SUCCESS", RuntimeVersion: RuntimeVersion, Logs: []Log{}, Tests: []Test{}, VariableChanges: []Change{}, RequestChanges: []Change{}, AuxiliaryRequests: []AuxiliaryRequest{}, PackageImports: []PackageImport{}, Problems: []Problem{}}
	if input.Script.RuntimeVersion != "" && input.Script.RuntimeVersion != RuntimeVersion && input.Script.RuntimeVersion != LegacyRuntimeVersion {
		return failed(result, started, "SCRIPT_POLICY_VIOLATION", "Unsupported JavaScript runtime version."), nil
	}
	validation := r.Validate(input.Script.Code)
	result.Problems = validation.Problems
	if !validation.Valid {
		result.ErrorLine, result.ErrorColumn = validation.Problems[0].Line, validation.Problems[0].Column
		return failed(result, started, "SCRIPT_SYNTAX_ERROR", validation.Problems[0].Message), nil
	}
	encodedInput, _ := json.Marshal(input)
	if len(encodedInput) > maxInputBytes {
		return failed(result, started, "SCRIPT_OUTPUT_LIMIT", "Script input exceeds the 1 MB limit."), nil
	}
	if input.TimeoutMS <= 0 || input.TimeoutMS > 10000 {
		input.TimeoutMS = 10000
	}
	wallContext, cancel := context.WithTimeout(ctx, time.Duration(input.TimeoutMS)*time.Millisecond)
	defer cancel()
	resolvedExternalPackages := make(map[string]string)
	for _, match := range externalPackageCallPattern.FindAllStringSubmatch(input.Script.Code, -1) {
		specifier := match[1]
		if _, exists := resolvedExternalPackages[specifier]; exists {
			continue
		}
		source, evidence, err := r.resolveExternalPackage(wallContext, specifier)
		result.PackageImports = append(result.PackageImports, evidence)
		if err != nil {
			return failed(result, started, "SCRIPT_PACKAGE_ERROR", safeError(err.Error(), nil)), nil
		}
		resolvedExternalPackages[specifier] = source
	}

	vm := goja.New()
	secretValues := make([]string, 0, len(input.Secrets))
	for _, value := range input.Secrets {
		if value != "" {
			secretValues = append(secretValues, value)
		}
	}
	var mu sync.Mutex
	logBytes := 0
	auxCount := 0
	hostLog := func(level string, args ...any) {
		mu.Lock()
		defer mu.Unlock()
		if len(result.Logs) >= maxLogs || logBytes >= maxLogBytes {
			return
		}
		parts := make([]string, len(args))
		for index, arg := range args {
			parts[index] = printable(arg)
		}
		message := mask(strings.Join(parts, " "), secretValues)
		remaining := maxLogBytes - logBytes
		if len(message) > remaining {
			message = message[:remaining]
		}
		logBytes += len(message)
		result.Logs = append(result.Logs, Log{Level: level, Message: message, Timestamp: time.Now().UTC()})
	}
	hostSendRequest := func(raw any) (map[string]any, error) {
		mu.Lock()
		auxCount++
		count := auxCount
		mu.Unlock()
		if count > maxAuxRequests {
			return nil, errors.New("pm.sendRequest exceeded the five-call limit")
		}
		response, evidence, err := r.sendRequest(wallContext, raw, input.AllowPrivateTargets, input.AllowedPrivateHosts, input.AllowedPrivateCIDRs, input.Transport)
		evidence.URL = mask(evidence.URL, secretValues)
		mu.Lock()
		result.AuxiliaryRequests = append(result.AuxiliaryRequests, evidence)
		mu.Unlock()
		return response, err
	}
	hostRequirePackage := func(specifier string) (string, error) {
		if source, exists := resolvedExternalPackages[strings.TrimSpace(specifier)]; exists {
			return source, nil
		}
		if strings.HasPrefix(strings.TrimSpace(specifier), "npm:") || strings.HasPrefix(strings.TrimSpace(specifier), "jsr:") {
			return "", errors.New("external package imports must use a literal exact-version specifier")
		}
		source, evidence, err := r.resolvePackage(wallContext, specifier, input.Script.Packages)
		mu.Lock()
		result.PackageImports = append(result.PackageImports, evidence)
		mu.Unlock()
		return source, err
	}
	host := map[string]any{
		"log": hostLog,
		"sleep": func(milliseconds int64) error {
			if milliseconds < 0 || milliseconds > 1000 {
				return errors.New("timer delay must be between 0 and 1000 milliseconds")
			}
			select {
			case <-time.After(time.Duration(milliseconds) * time.Millisecond):
				return nil
			case <-wallContext.Done():
				return wallContext.Err()
			}
		},
		"vaultGet": func(alias string) (string, error) {
			if input.Preview {
				return "MASKED", nil
			}
			value, exists := input.Secrets[strings.TrimSpace(alias)]
			if !exists {
				return "", fmt.Errorf("secret alias %q is not available to this script", alias)
			}
			return value, nil
		},
		"sendRequest":    hostSendRequest,
		"requirePackage": hostRequirePackage,
		"randomUUID":     randomUUID,
		"randomBytes": func(length int) ([]int, error) {
			if length < 0 || length > 65536 {
				return nil, errors.New("random byte request exceeds 65536 bytes")
			}
			value := make([]byte, length)
			if _, err := rand.Read(value); err != nil {
				return nil, err
			}
			out := make([]int, len(value))
			for index := range value {
				out[index] = int(value[index])
			}
			return out, nil
		},
		"digest":      digest,
		"hmac":        digestHMAC,
		"digestBytes": digestBytes,
		"hmacBytes":   digestHMACBytes,
		"parseURL": func(raw, base string) (map[string]string, error) {
			var parsed *url.URL
			var err error
			if strings.TrimSpace(base) != "" {
				baseURL, baseErr := url.Parse(base)
				if baseErr != nil {
					return nil, errors.New("invalid base URL")
				}
				ref, refErr := url.Parse(raw)
				if refErr != nil {
					return nil, errors.New("invalid URL")
				}
				parsed = baseURL.ResolveReference(ref)
			} else {
				parsed, err = url.Parse(raw)
				if err != nil || parsed.Scheme == "" {
					return nil, errors.New("invalid URL")
				}
			}
			return map[string]string{"href": parsed.String(), "protocol": parsed.Scheme + ":", "host": parsed.Host, "hostname": parsed.Hostname(), "port": parsed.Port(), "pathname": parsed.EscapedPath(), "search": queryPrefix(parsed.RawQuery), "hash": fragmentPrefix(parsed.Fragment), "origin": parsed.Scheme + "://" + parsed.Host}, nil
		},
		"base64Encode":      func(value string) string { return base64.StdEncoding.EncodeToString([]byte(value)) },
		"base64EncodeBytes": func(value []int) string { return base64.StdEncoding.EncodeToString(intsToBytes(value)) },
		"base64Decode": func(value string) (string, error) {
			decoded, err := base64.StdEncoding.DecodeString(value)
			return string(decoded), err
		},
		"base64DecodeBytes": func(value string) ([]int, error) {
			decoded, err := base64.StdEncoding.DecodeString(value)
			return bytesToInts(decoded), err
		},
	}
	if err := vm.Set("__host", host); err != nil {
		return Result{}, err
	}
	initial := map[string]any{
		"variables": cloneMap(input.Variables), "service": cloneMap(input.Service),
		"application": cloneMap(input.Application), "environment": cloneMap(input.Environment),
		"collection": cloneMap(input.Collection), "globals": cloneMap(input.Globals),
		"cookies": cloneMap(input.Cookies), "request": genericJSON(input.Request), "response": genericJSON(input.Response),
		"iterationData": cloneMap(input.IterationData), "state": input.State, "info": genericJSON(input.Info),
		"preview": input.Preview, "scope": input.Scope,
	}
	if err := vm.Set("__initial", initial); err != nil {
		return Result{}, err
	}
	if _, err := vm.RunString(runtimeBootstrapV2); err != nil {
		return Result{}, err
	}

	cpuTimer := time.AfterFunc(defaultCPUTime, func() { vm.Interrupt("JavaScript CPU time limit exceeded") })
	defer cpuTimer.Stop()
	program, err := r.compiledProgram(input.Script.Code)
	if err != nil {
		return failed(result, started, "SCRIPT_SYNTAX_ERROR", safeError(err.Error(), secretValues)), nil
	}
	value, err := vm.RunProgram(program)
	if err == nil {
		if promise, ok := value.Export().(*goja.Promise); ok {
			switch promise.State() {
			case goja.PromiseStateRejected:
				err = fmt.Errorf("%v", promise.Result())
			case goja.PromiseStatePending:
				return failed(result, started, "SCRIPT_TIMEOUT", "JavaScript did not settle before the deterministic event queue completed."), nil
			}
		}
	}
	if err != nil {
		category := "SCRIPT_RUNTIME_ERROR"
		if _, ok := err.(*goja.InterruptedError); ok || errors.Is(wallContext.Err(), context.DeadlineExceeded) {
			category = "SCRIPT_TIMEOUT"
		}
		message := safeError(err.Error(), secretValues)
		if category == "SCRIPT_TIMEOUT" {
			message = "Pre-request script exceeded execution timeout."
		}
		line, column := errorPosition(message)
		result.ErrorLine, result.ErrorColumn = line, column
		result.SafeStack = safeStack(message)
		return failed(result, started, category, message), nil
	}
	if len(result.Tests) == 0 {
		var testsJSON string
		if exported := vm.Get("__tests"); exported != nil && !goja.IsUndefined(exported) {
			testsJSON = exported.String()
			_ = json.Unmarshal([]byte(testsJSON), &result.Tests)
		}
	}
	stateValue, err := vm.RunString("JSON.stringify({variables:__stores.variables,service:__stores.service,application:__stores.application,environment:__stores.environment,collection:__stores.collection,globals:__stores.globals,cookies:__stores.cookies,state:__stores.state,request:__serializeRequest(),visualizer:globalThis.__visualizer||null,execution:globalThis.__execution||{}})")
	if err != nil {
		return failed(result, started, "SCRIPT_RUNTIME_ERROR", safeError(err.Error(), secretValues)), nil
	}
	var state struct {
		Variables   map[string]string `json:"variables"`
		Service     map[string]string `json:"service"`
		Application map[string]string `json:"application"`
		Environment map[string]string `json:"environment"`
		Collection  map[string]string `json:"collection"`
		Globals     map[string]string `json:"globals"`
		Cookies     map[string]string `json:"cookies"`
		State       map[string]any    `json:"state"`
		Request     *Request          `json:"request"`
		Visualizer  *Visualizer       `json:"visualizer"`
		Execution   Execution         `json:"execution"`
	}
	if err := json.Unmarshal([]byte(stateValue.String()), &state); err != nil {
		return failed(result, started, "SCRIPT_OUTPUT_LIMIT", "Script produced values that cannot be serialized."), nil
	}
	result.InternalVariables, result.InternalService, result.InternalApplication, result.InternalEnvironment, result.InternalCollection, result.InternalGlobals, result.InternalCookies = state.Variables, state.Service, state.Application, state.Environment, state.Collection, state.Globals, state.Cookies
	result.InternalState = state.State
	result.InternalRequest = state.Request
	result.State = maskedObject(state.State, secretValues, false)
	result.Visualizer = maskedVisualizer(state.Visualizer, secretValues)
	result.Execution = state.Execution
	result.Variables, result.Service, result.Application, result.Environment, result.Collection, result.Globals, result.Cookies, result.Request = maskedMap(state.Variables, secretValues), maskedMap(state.Service, secretValues), maskedMap(state.Application, secretValues), maskedMap(state.Environment, secretValues), maskedMap(state.Collection, secretValues), maskedMap(state.Globals, secretValues), maskedMap(state.Cookies, secretValues), maskedRequest(state.Request, secretValues)
	result.VariableChanges = append(result.VariableChanges, diffMap("variables", input.Variables, state.Variables, secretValues)...)
	result.VariableChanges = append(result.VariableChanges, diffMap("service", input.Service, state.Service, secretValues)...)
	result.VariableChanges = append(result.VariableChanges, diffMap("application", input.Application, state.Application, secretValues)...)
	result.VariableChanges = append(result.VariableChanges, diffMap("environment", input.Environment, state.Environment, secretValues)...)
	result.VariableChanges = append(result.VariableChanges, diffMap("collection", input.Collection, state.Collection, secretValues)...)
	result.VariableChanges = append(result.VariableChanges, diffMap("globals", input.Globals, state.Globals, secretValues)...)
	result.VariableChanges = append(result.VariableChanges, diffMap("cookies", input.Cookies, state.Cookies, secretValues)...)
	result.RequestChanges = diffRequest(input.Request, state.Request, secretValues)
	for _, test := range result.Tests {
		if !test.Passed && !test.Skipped {
			return failed(result, started, "SCRIPT_ASSERTION_FAILURE", "A JavaScript test failed."), nil
		}
	}
	encodedOutput, _ := json.Marshal(result)
	if len(encodedOutput) > maxOutputBytes {
		return failed(result, started, "SCRIPT_OUTPUT_LIMIT", "Script evidence exceeds the 256 KB output limit."), nil
	}
	result.DurationMS = time.Since(started).Milliseconds()
	return result, nil
}

func (r *Runtime) compiledProgram(code string) (*goja.Program, error) {
	source := "(async function(){\n" + code + "\n;await Promise.all(globalThis.__pendingTests || []);\n})()"
	hash := sha256.Sum256([]byte(RuntimeVersion + "\x00" + source))
	key := hex.EncodeToString(hash[:])
	r.programMu.RLock()
	program := r.programCache[key]
	r.programMu.RUnlock()
	if program != nil {
		return program, nil
	}
	compiled, err := goja.Compile("pre-request.js", source, false)
	if err != nil {
		return nil, err
	}
	r.programMu.Lock()
	if len(r.programCache) >= 256 {
		// Programs contain no runtime state. A bounded whole-cache reset keeps
		// memory predictable without adding hot-path LRU bookkeeping.
		r.programCache = make(map[string]*goja.Program)
	}
	if existing := r.programCache[key]; existing != nil {
		compiled = existing
	} else {
		r.programCache[key] = compiled
	}
	r.programMu.Unlock()
	return compiled, nil
}

func genericJSON(value any) any {
	if value == nil {
		return nil
	}
	encoded, err := json.Marshal(value)
	if err != nil {
		return nil
	}
	var output any
	if err := json.Unmarshal(encoded, &output); err != nil {
		return nil
	}
	return output
}

func failed(result Result, started time.Time, category, message string) Result {
	result.Status, result.ErrorCategory, result.ErrorMessage, result.DurationMS = "FAILED", category, message, time.Since(started).Milliseconds()
	return result
}

var externalPackagePattern = regexp.MustCompile(`^(npm|jsr):(@[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+|[A-Za-z0-9_.-]+)@([0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)$`)
var potentialSecretLiteralPattern = regexp.MustCompile(`(?i)\b(secret|password|token|private[_-]?key|client[_-]?secret)\w*\s*=\s*["']([^"']{8,})["']`)
var externalPackageCallPattern = regexp.MustCompile(`(?:pm\.)?require\(\s*["']((?:npm|jsr):(?:@[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+|[A-Za-z0-9_.-]+)@[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)["']\s*\)`)
var teamPackagePattern = regexp.MustCompile(`^@[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$`)

func (r *Runtime) resolvePackage(ctx context.Context, specifier string, packages []TeamPackage) (string, PackageImport, error) {
	specifier = strings.TrimSpace(specifier)
	if teamPackagePattern.MatchString(specifier) {
		started := time.Now()
		evidence := PackageImport{Specifier: specifier, Registry: "team", Version: "revision"}
		for _, item := range packages {
			if strings.TrimSpace(item.Name) != specifier {
				continue
			}
			if len(item.Code) > maxSourceBytes {
				evidence.DurationMS = time.Since(started).Milliseconds()
				return "", evidence, errors.New("team package exceeds the 64 KB source limit")
			}
			source := `"use strict";const module={exports:{}};const exports=module.exports;` + "\n" + item.Code + "\nreturn module.exports;"
			if _, err := goja.Compile("team-package.js", "(function(){"+source+"})", false); err != nil {
				evidence.DurationMS = time.Since(started).Milliseconds()
				return "", evidence, errors.New("team package contains invalid JavaScript")
			}
			evidence.Cached = true
			evidence.DurationMS = time.Since(started).Milliseconds()
			return source, evidence, nil
		}
		evidence.DurationMS = time.Since(started).Milliseconds()
		return "", evidence, fmt.Errorf("team package %q is not installed in this script", specifier)
	}
	return r.resolveExternalPackage(ctx, specifier)
}

func (r *Runtime) resolveExternalPackage(ctx context.Context, specifier string) (string, PackageImport, error) {
	started := time.Now()
	specifier = strings.TrimSpace(specifier)
	evidence := PackageImport{Specifier: specifier}
	match := externalPackagePattern.FindStringSubmatch(specifier)
	if len(match) != 4 {
		evidence.DurationMS = time.Since(started).Milliseconds()
		return "", evidence, errors.New("external packages require an exact npm: or jsr: version")
	}
	evidence.Registry, evidence.Version = match[1], match[3]
	r.packageMu.RLock()
	source, cached := r.packageCache[specifier]
	r.packageMu.RUnlock()
	if cached {
		evidence.Cached = true
		evidence.DurationMS = time.Since(started).Milliseconds()
		return source, evidence, nil
	}

	registrySpecifier := specifier
	if strings.HasPrefix(registrySpecifier, "npm:") {
		registrySpecifier = strings.TrimPrefix(registrySpecifier, "npm:")
	}
	entryURL := "https://esm.sh/" + registrySpecifier + "?bundle&target=es2020"
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, entryURL, nil)
	if err != nil {
		return "", evidence, errors.New("package registry request could not be created")
	}
	request.Header.Set("Accept", "application/javascript")
	packageClient := *r.client
	packageClient.CheckRedirect = func(request *http.Request, _ []*http.Request) error {
		if request.URL.Scheme != "https" || request.URL.Hostname() != "esm.sh" {
			return errors.New("package registry redirect was blocked")
		}
		return nil
	}
	response, err := packageClient.Do(request)
	if err != nil {
		evidence.DurationMS = time.Since(started).Milliseconds()
		return "", evidence, errors.New("package registry could not be reached")
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		evidence.DurationMS = time.Since(started).Milliseconds()
		return "", evidence, fmt.Errorf("package registry returned HTTP %d", response.StatusCode)
	}
	path := strings.TrimSpace(response.Header.Get("X-ESM-Path"))
	if path == "" || !strings.HasPrefix(path, "/") {
		evidence.DurationMS = time.Since(started).Milliseconds()
		return "", evidence, errors.New("package registry did not return a bundled module")
	}
	bundleURL := "https://esm.sh" + path
	bundleRequest, _ := http.NewRequestWithContext(ctx, http.MethodGet, bundleURL, nil)
	bundleRequest.Header.Set("Accept", "application/javascript")
	bundleResponse, err := packageClient.Do(bundleRequest)
	if err != nil {
		evidence.DurationMS = time.Since(started).Milliseconds()
		return "", evidence, errors.New("package bundle could not be downloaded")
	}
	defer bundleResponse.Body.Close()
	if bundleResponse.StatusCode != http.StatusOK {
		evidence.DurationMS = time.Since(started).Milliseconds()
		return "", evidence, fmt.Errorf("package bundle returned HTTP %d", bundleResponse.StatusCode)
	}
	raw, err := io.ReadAll(io.LimitReader(bundleResponse.Body, (2<<20)+1))
	if err != nil || len(raw) > 2<<20 {
		evidence.DurationMS = time.Since(started).Milliseconds()
		return "", evidence, errors.New("package bundle exceeds the 2 MB sandbox limit")
	}
	source, err = convertESModuleBundle(string(raw))
	if err != nil {
		evidence.DurationMS = time.Since(started).Milliseconds()
		return "", evidence, err
	}
	r.packageMu.Lock()
	if len(r.packageCache) < 32 {
		r.packageCache[specifier] = source
	}
	r.packageMu.Unlock()
	evidence.DurationMS = time.Since(started).Milliseconds()
	return source, evidence, nil
}

func convertESModuleBundle(source string) (string, error) {
	trimmed := strings.TrimSpace(source)
	if regexp.MustCompile(`(?m)^\s*import\s`).MatchString(trimmed) {
		return "", errors.New("package bundle contains unsupported external imports")
	}
	index := strings.LastIndex(trimmed, "export{")
	prefixLength := len("export{")
	if index < 0 {
		index = strings.LastIndex(trimmed, "export {")
		prefixLength = len("export {")
	}
	if index < 0 {
		return "", errors.New("package bundle has an unsupported module format")
	}
	end := strings.Index(trimmed[index+prefixLength:], "};")
	if end < 0 {
		return "", errors.New("package bundle export table is incomplete")
	}
	exportTable := trimmed[index+prefixLength : index+prefixLength+end]
	properties := make([]string, 0)
	for _, item := range strings.Split(exportTable, ",") {
		item = strings.TrimSpace(item)
		if item == "" {
			continue
		}
		parts := strings.Fields(item)
		sourceName, exportName := parts[0], parts[0]
		if len(parts) == 3 && parts[1] == "as" {
			exportName = parts[2]
		}
		if !regexp.MustCompile(`^[A-Za-z_$][A-Za-z0-9_$]*$`).MatchString(sourceName) {
			return "", errors.New("package bundle contains an invalid export")
		}
		properties = append(properties, strconv.Quote(exportName)+":"+sourceName)
	}
	if len(properties) == 0 {
		return "", errors.New("package bundle did not expose any exports")
	}
	return trimmed[:index] + "\nreturn {" + strings.Join(properties, ",") + "};\n", nil
}

func (r *Runtime) sendRequest(ctx context.Context, raw any, allowPrivate bool, allowedHosts, allowedCIDRs []string, inherited *TransportConfig) (response map[string]any, evidence AuxiliaryRequest, err error) {
	started := time.Now()
	evidence = AuxiliaryRequest{Source: "pm.sendRequest", Method: http.MethodGet}
	defer func() {
		if evidence.DurationMS == 0 {
			evidence.DurationMS = time.Since(started).Milliseconds()
		}
		evidence.Success = evidence.Error == "" && err == nil
		if evidence.Source == "" {
			evidence.Source = "pm.sendRequest"
		}
	}()

	config, ok := raw.(map[string]any)
	if !ok {
		if text, textOK := raw.(string); textOK {
			config = map[string]any{"url": text, "method": "GET"}
		} else {
			evidence.Error = "invalid request"
			return nil, evidence, errors.New("pm.sendRequest requires a URL or request object")
		}
	}
	if source := strings.TrimSpace(fmt.Sprint(config["__source"])); source == "rhythm.sendRequest" {
		evidence.Source = source
	}
	target := strings.TrimSpace(fmt.Sprint(config["url"]))
	method := strings.ToUpper(strings.TrimSpace(fmt.Sprint(config["method"])))
	if method == "" {
		method = http.MethodGet
	}
	evidence.Method, evidence.URL = method, safeURL(target)
	parsed, parseErr := url.Parse(target)
	if parseErr != nil || parsed.Scheme == "" || parsed.Hostname() == "" {
		evidence.Error = "invalid URL"
		return nil, evidence, errors.New("pm.sendRequest URL is invalid")
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		evidence.Error = "unsupported scheme"
		return nil, evidence, errors.New("pm.sendRequest supports HTTP and HTTPS only")
	}
	policy, policyErr := compileAuxiliaryNetworkPolicy(allowPrivate, allowedHosts, allowedCIDRs)
	if policyErr != nil {
		evidence.Error = "invalid target policy"
		return nil, evidence, errors.New("pm.sendRequest target policy is invalid")
	}
	if policyErr = policy.validate(ctx, parsed); policyErr != nil {
		evidence.Error = "target blocked by network policy"
		return nil, evidence, policyErr
	}
	bodyText := ""
	if bodyValue, exists := config["body"]; exists && bodyValue != nil {
		switch bodyConfig := bodyValue.(type) {
		case string:
			bodyText = bodyConfig
		case map[string]any:
			if rawBody := first(bodyConfig["raw"], bodyConfig["content"]); strings.TrimSpace(fmt.Sprint(rawBody)) != "" {
				bodyText = fmt.Sprint(rawBody)
			} else if encoded, encodeErr := json.Marshal(bodyConfig); encodeErr == nil {
				bodyText = string(encoded)
			}
		default:
			if encoded, encodeErr := json.Marshal(bodyValue); encodeErr == nil {
				bodyText = string(encoded)
			}
		}
	}
	body := strings.NewReader(bodyText)
	request, requestErr := http.NewRequestWithContext(ctx, method, target, body)
	if requestErr != nil {
		evidence.Error = "request construction failed"
		return nil, evidence, errors.New("pm.sendRequest request is invalid")
	}
	applySendRequestHeaders(request, config["header"])
	applySendRequestHeaders(request, config["headers"])
	if bodyText != "" && request.Header.Get("Content-Type") == "" {
		request.Header.Set("Content-Type", "application/json")
	}
	transport, transportErr := auxiliaryTransport(inherited)
	if transportErr != nil {
		evidence.Error = "transport configuration failed"
		return nil, evidence, transportErr
	}
	if inherited == nil || !slicesContain([]string{"http", "https"}, strings.ToLower(strings.TrimSpace(inherited.ProxyMode))) {
		transport.DialContext = policy.dialContext
	}
	client := *r.client
	client.Transport = transport
	if timeoutMS := int64FromScriptValue(config["timeout"]); timeoutMS > 0 {
		if timeoutMS > 30000 {
			timeoutMS = 30000
		}
		client.Timeout = time.Duration(timeoutMS) * time.Millisecond
	}
	client.CheckRedirect = func(next *http.Request, via []*http.Request) error {
		if len(via) >= 5 {
			return errors.New("pm.sendRequest redirect limit exceeded")
		}
		return policy.validate(next.Context(), next.URL)
	}
	defer transport.CloseIdleConnections()
	httpStarted := time.Now()
	httpResponse, doErr := client.Do(request)
	if doErr != nil {
		evidence.DurationMS = time.Since(httpStarted).Milliseconds()
		evidence.Error = "request failed"
		return nil, evidence, errors.New("pm.sendRequest failed")
	}
	defer httpResponse.Body.Close()
	limited := io.LimitReader(httpResponse.Body, maxAuxBody+1)
	data, readErr := io.ReadAll(limited)
	evidence.DurationMS = time.Since(httpStarted).Milliseconds()
	if readErr != nil {
		evidence.Error = "response read failed"
		return nil, evidence, errors.New("pm.sendRequest response could not be read")
	}
	if len(data) > maxAuxBody {
		evidence.Error = "response body limit exceeded"
		return nil, evidence, errors.New("pm.sendRequest response exceeds 2 MB")
	}
	evidence.Status = httpResponse.StatusCode
	headers := map[string]string{}
	for key, values := range httpResponse.Header {
		headers[key] = strings.Join(values, ", ")
	}
	return map[string]any{
		"code": httpResponse.StatusCode, "statusCode": httpResponse.StatusCode,
		"status": httpResponse.Status, "body": string(data), "headers": headers,
		"responseTimeMs": evidence.DurationMS, "responseSize": len(data),
	}, evidence, nil
}

func int64FromScriptValue(value any) int64 {
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
		parsed, _ := strconv.ParseInt(strings.TrimSpace(fmt.Sprint(value)), 10, 64)
		return parsed
	}
}

func auxiliaryTransport(config *TransportConfig) (*http.Transport, error) {
	transport := http.DefaultTransport.(*http.Transport).Clone()
	minimumVersion := uint16(tls.VersionTLS12)
	verifyHostname := true
	if config != nil {
		if config.MinimumTLSVersion == "TLS 1.3" {
			minimumVersion = tls.VersionTLS13
		}
		verifyHostname = config.VerifyHostname
	}
	transport.TLSClientConfig = &tls.Config{MinVersion: minimumVersion, InsecureSkipVerify: !verifyHostname} //nolint:gosec -- inherited explicit monitor setting
	if config == nil {
		return transport, nil
	}
	if config.CABundlePEM != "" {
		pool, err := x509.SystemCertPool()
		if err != nil || pool == nil {
			pool = x509.NewCertPool()
		}
		if !pool.AppendCertsFromPEM([]byte(config.CABundlePEM)) {
			return nil, errors.New("dependency request CA bundle is invalid")
		}
		transport.TLSClientConfig.RootCAs = pool
	}
	if config.ClientCertificate != "" || config.ClientKey != "" {
		certificate, err := tls.X509KeyPair([]byte(config.ClientCertificate), []byte(config.ClientKey))
		if err != nil {
			return nil, errors.New("dependency request client certificate is invalid")
		}
		transport.TLSClientConfig.Certificates = []tls.Certificate{certificate}
	}
	switch strings.ToLower(strings.TrimSpace(config.ProxyMode)) {
	case "", "environment":
		transport.Proxy = http.ProxyFromEnvironment
	case "none":
		transport.Proxy = nil
	case "http", "https":
		proxyURL, err := url.Parse(config.ProxyURL)
		if err != nil || proxyURL.Host == "" {
			return nil, errors.New("dependency request proxy URL is invalid")
		}
		if config.ProxyUsername != "" || config.ProxyPassword != "" {
			proxyURL.User = url.UserPassword(config.ProxyUsername, config.ProxyPassword)
		}
		transport.Proxy = func(request *http.Request) (*url.URL, error) {
			if auxiliaryProxyBypassed(request.URL.Hostname(), config.ProxyNoProxy) {
				return nil, nil
			}
			return proxyURL, nil
		}
		// The target was already DNS-validated above. The proxy itself is a
		// configured platform resource and may resolve to a private address.
		transport.DialContext = (&net.Dialer{Timeout: 10 * time.Second}).DialContext
	default:
		return nil, errors.New("dependency request proxy mode is unsupported")
	}
	return transport, nil
}

func slicesContain(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}

func auxiliaryProxyBypassed(host, rules string) bool {
	host = strings.ToLower(strings.TrimSuffix(strings.TrimSpace(host), "."))
	for _, raw := range strings.Split(rules, ",") {
		rule := strings.ToLower(strings.TrimSuffix(strings.TrimSpace(raw), "."))
		if rule == "*" || rule == host || strings.HasPrefix(rule, "*.") && strings.HasSuffix(host, strings.TrimPrefix(rule, "*")) {
			return true
		}
	}
	return false
}

type auxiliaryNetworkPolicy struct {
	allowPrivate bool
	hosts        []string
	networks     []*net.IPNet
}

func compileAuxiliaryNetworkPolicy(allowPrivate bool, hosts, cidrs []string) (auxiliaryNetworkPolicy, error) {
	policy := auxiliaryNetworkPolicy{allowPrivate: allowPrivate}
	for _, raw := range hosts {
		host := strings.ToLower(strings.TrimSuffix(strings.TrimSpace(raw), "."))
		if host == "" {
			continue
		}
		if host == "*" || (strings.Contains(host, "*") && !strings.HasPrefix(host, "*.")) {
			return auxiliaryNetworkPolicy{}, errors.New("invalid allowed host")
		}
		policy.hosts = append(policy.hosts, host)
	}
	for _, raw := range cidrs {
		_, network, err := net.ParseCIDR(strings.TrimSpace(raw))
		if err != nil {
			return auxiliaryNetworkPolicy{}, errors.New("invalid allowed CIDR")
		}
		policy.networks = append(policy.networks, network)
	}
	return policy, nil
}

func (p auxiliaryNetworkPolicy) validate(ctx context.Context, target *url.URL) error {
	if target == nil || target.Hostname() == "" || (target.Scheme != "http" && target.Scheme != "https") {
		return errors.New("pm.sendRequest target is invalid")
	}
	addresses, err := net.DefaultResolver.LookupIPAddr(ctx, target.Hostname())
	if err != nil {
		return errors.New("pm.sendRequest DNS resolution failed")
	}
	for _, address := range addresses {
		if !p.allowed(target.Hostname(), address.IP) {
			return errors.New("pm.sendRequest target is blocked by network policy")
		}
	}
	return nil
}

func (p auxiliaryNetworkPolicy) dialContext(ctx context.Context, network, address string) (net.Conn, error) {
	host, port, err := net.SplitHostPort(address)
	if err != nil {
		return nil, err
	}
	addresses, err := net.DefaultResolver.LookupIPAddr(ctx, host)
	if err != nil {
		return nil, err
	}
	for _, candidate := range addresses {
		if !p.allowed(host, candidate.IP) {
			continue
		}
		return (&net.Dialer{Timeout: 10 * time.Second}).DialContext(ctx, network, net.JoinHostPort(candidate.IP.String(), port))
	}
	return nil, errors.New("pm.sendRequest target has no allowed network address")
}

func (p auxiliaryNetworkPolicy) allowed(host string, address net.IP) bool {
	if p.allowPrivate || !privateIP(address) {
		return true
	}
	normalizedHost := strings.ToLower(strings.TrimSuffix(strings.TrimSpace(host), "."))
	for _, pattern := range p.hosts {
		if pattern == normalizedHost {
			return true
		}
		if strings.HasPrefix(pattern, "*.") {
			suffix := strings.TrimPrefix(pattern, "*")
			if strings.HasSuffix(normalizedHost, suffix) && normalizedHost != strings.TrimPrefix(suffix, ".") {
				return true
			}
		}
	}
	for _, network := range p.networks {
		if network.Contains(address) {
			return true
		}
	}
	return false
}

func digest(algorithm, value string) ([]int, error) {
	return digestBytes(algorithm, bytesToInts([]byte(value)))
}

func digestHMAC(algorithm, key, value string) ([]int, error) {
	return digestHMACBytes(algorithm, bytesToInts([]byte(key)), bytesToInts([]byte(value)))
}

func digestBytes(algorithm string, value []int) ([]int, error) {
	input := intsToBytes(value)
	var output []byte
	switch strings.ToUpper(strings.ReplaceAll(algorithm, "-", "")) {
	case "MD5":
		sum := md5.Sum(input) //nolint:gosec -- explicit legacy compatibility
		output = sum[:]
	case "SHA1":
		sum := sha1.Sum(input) //nolint:gosec -- explicit legacy compatibility
		output = sum[:]
	case "SHA256":
		sum := sha256.Sum256(input)
		output = sum[:]
	case "SHA384":
		sum := sha512.Sum384(input)
		output = sum[:]
	case "SHA512":
		sum := sha512.Sum512(input)
		output = sum[:]
	default:
		return nil, errors.New("unsupported digest algorithm")
	}
	return bytesToInts(output), nil
}

func digestHMACBytes(algorithm string, key, value []int) ([]int, error) {
	keyBytes, valueBytes := intsToBytes(key), intsToBytes(value)
	var factory func() hash.Hash
	switch strings.ToUpper(strings.ReplaceAll(algorithm, "-", "")) {
	case "MD5":
		factory = md5.New //nolint:gosec -- explicit legacy compatibility
	case "SHA1":
		factory = sha1.New //nolint:gosec -- explicit legacy compatibility
	case "SHA256":
		factory = sha256.New
	case "SHA384":
		factory = sha512.New384
	case "SHA512":
		factory = sha512.New
	default:
		return nil, errors.New("unsupported HMAC algorithm")
	}
	h := hmac.New(factory, keyBytes)
	_, _ = h.Write(valueBytes)
	return bytesToInts(h.Sum(nil)), nil
}

func intsToBytes(values []int) []byte {
	output := make([]byte, len(values))
	for index, value := range values {
		output[index] = byte(value)
	}
	return output
}

func bytesToInts(values []byte) []int {
	output := make([]int, len(values))
	for index, value := range values {
		output[index] = int(value)
	}
	return output
}

func diffMap(scope string, before, after map[string]string, secrets []string) []Change {
	keys := map[string]bool{}
	for key := range before {
		keys[key] = true
	}
	for key := range after {
		keys[key] = true
	}
	ordered := make([]string, 0, len(keys))
	for key := range keys {
		ordered = append(ordered, key)
	}
	sort.Strings(ordered)
	changes := make([]Change, 0)
	for _, key := range ordered {
		old, oldOK := before[key]
		next, nextOK := after[key]
		if oldOK && nextOK && old == next {
			continue
		}
		op := "updated"
		if !oldOK {
			op = "added"
		}
		if !nextOK {
			op = "removed"
		}
		state := "CAPTURED"
		oldSafe, nextSafe := mask(old, secrets), mask(next, secrets)
		if sensitiveRequestKey(key) || oldSafe != old || nextSafe != next {
			state, oldSafe, nextSafe = "MASKED", "MASKED", "MASKED"
		}
		changes = append(changes, Change{Scope: scope, Key: key, Operation: op, Before: oldSafe, After: nextSafe, State: state})
	}
	return changes
}

func diffRequest(before, after *Request, secrets []string) []Change {
	if before == nil || after == nil {
		return []Change{}
	}
	leftRaw, _ := json.Marshal(before)
	rightRaw, _ := json.Marshal(after)
	if string(leftRaw) == string(rightRaw) {
		return []Change{}
	}
	left, _ := json.Marshal(maskedRequest(before, secrets))
	right, _ := json.Marshal(maskedRequest(after, secrets))
	state := "CAPTURED"
	if string(left) != string(leftRaw) || string(right) != string(rightRaw) {
		state = "MASKED"
	}
	return []Change{{Scope: "request", Key: "renderedRequest", Operation: "updated", Before: string(left), After: string(right), State: state}}
}

func cloneMap(input map[string]string) map[string]string {
	output := map[string]string{}
	for key, value := range input {
		output[key] = value
	}
	return output
}
func maskedMap(input map[string]string, secrets []string) map[string]string {
	output := map[string]string{}
	for key, value := range input {
		if sensitiveRequestKey(key) {
			output[key] = "MASKED"
			continue
		}
		masked := mask(value, secrets)
		if masked != value {
			masked = "MASKED"
		}
		output[key] = masked
	}
	return output
}
func maskedRequest(input *Request, secrets []string) *Request {
	if input == nil {
		return nil
	}
	output := &Request{Method: input.Method, URL: mask(input.URL, secrets), Headers: make([]Entry, len(input.Headers)), Query: make([]Entry, len(input.Query)), Body: maskedObject(input.Body, secrets, false), Auth: maskedObject(input.Auth, secrets, true)}
	for index, entry := range input.Headers {
		output.Headers[index] = entry
		if entry.Sensitive || sensitiveRequestKey(entry.Key) || mask(entry.Value, secrets) != entry.Value {
			output.Headers[index].Value = "MASKED"
		}
	}
	for index, entry := range input.Query {
		output.Query[index] = entry
		if entry.Sensitive || sensitiveRequestKey(entry.Key) || mask(entry.Value, secrets) != entry.Value {
			output.Query[index].Value = "MASKED"
		}
	}
	return output
}

func maskedVisualizer(input *Visualizer, secrets []string) *Visualizer {
	if input == nil {
		return nil
	}
	return &Visualizer{
		Template: mask(input.Template, secrets),
		Data:     maskedObject(input.Data, secrets, false),
		Options:  maskedObject(input.Options, secrets, false),
	}
}

func maskedObject(input map[string]any, secrets []string, maskValues bool) map[string]any {
	output := make(map[string]any, len(input))
	for key, value := range input {
		if maskValues && key != "type" || sensitiveRequestKey(key) {
			output[key] = "MASKED"
			continue
		}
		output[key] = maskedValue(value, secrets)
	}
	return output
}
func maskedValue(value any, secrets []string) any {
	switch typed := value.(type) {
	case string:
		masked := mask(typed, secrets)
		if masked != typed {
			return "MASKED"
		}
		return typed
	case map[string]any:
		return maskedObject(typed, secrets, false)
	case []any:
		output := make([]any, len(typed))
		for index, item := range typed {
			output[index] = maskedValue(item, secrets)
		}
		return output
	default:
		return value
	}
}
func sensitiveRequestKey(key string) bool {
	normalized := strings.ToLower(strings.ReplaceAll(strings.ReplaceAll(key, "-", ""), "_", ""))
	for _, fragment := range []string{"authorization", "cookie", "token", "secret", "password", "credential", "apikey", "signature"} {
		if strings.Contains(normalized, fragment) {
			return true
		}
	}
	return false
}
func printable(value any) string {
	if text, ok := value.(string); ok {
		return text
	}
	encoded, err := json.Marshal(value)
	if err == nil {
		return string(encoded)
	}
	return fmt.Sprint(value)
}
func mask(value string, secrets []string) string {
	for _, secret := range secrets {
		if secret != "" {
			value = strings.ReplaceAll(value, secret, "MASKED")
		}
	}
	return value
}
func safeError(value string, secrets []string) string {
	value = mask(value, secrets)
	if len(value) > 2048 {
		value = value[:2048]
	}
	return value
}
func safeStack(value string) string {
	lines := strings.Split(value, "\n")
	if len(lines) > 8 {
		lines = lines[:8]
	}
	return strings.Join(lines, "\n")
}

var positionPattern = regexp.MustCompile(`pre-request\.js:(\d+):(\d+)`)

func errorPosition(value string) (int, int) {
	match := positionPattern.FindStringSubmatch(value)
	if len(match) != 3 {
		return 1, 1
	}
	var line, column int
	_, _ = fmt.Sscan(match[1], &line)
	_, _ = fmt.Sscan(match[2], &column)
	if line > 1 {
		line--
	}
	return line, column
}
func privateIP(ip net.IP) bool {
	return ip.IsPrivate() || ip.IsLoopback() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() || ip.IsUnspecified()
}
func safeURL(value string) string {
	parsed, err := url.Parse(value)
	if err != nil {
		return "invalid URL"
	}
	parsed.User = nil
	return parsed.String()
}
func queryPrefix(value string) string {
	if value == "" {
		return ""
	}
	return "?" + value
}
func fragmentPrefix(value string) string {
	if value == "" {
		return ""
	}
	return "#" + value
}
func first(values ...any) any {
	for _, value := range values {
		if value != nil && fmt.Sprint(value) != "" {
			return value
		}
	}
	return ""
}

func applySendRequestHeaders(request *http.Request, raw any) {
	switch typed := raw.(type) {
	case map[string]any:
		for key, value := range typed {
			request.Header.Set(key, fmt.Sprint(value))
		}
	case []any:
		for _, item := range typed {
			entry, ok := item.(map[string]any)
			if !ok {
				continue
			}
			key := strings.TrimSpace(fmt.Sprint(first(entry["key"], entry["name"])))
			if key == "" {
				continue
			}
			request.Header.Set(key, fmt.Sprint(entry["value"]))
		}
	}
}
func randomUUID() (string, error) {
	value := make([]byte, 16)
	if _, err := rand.Read(value); err != nil {
		return "", err
	}
	value[6] = (value[6] & 0x0f) | 0x40
	value[8] = (value[8] & 0x3f) | 0x80
	encoded := hex.EncodeToString(value)
	return encoded[:8] + "-" + encoded[8:12] + "-" + encoded[12:16] + "-" + encoded[16:20] + "-" + encoded[20:], nil
}

const runtimeBootstrap = `
"use strict";
const __clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
globalThis.__stores = { variables: __clone(__initial.variables || {}), environment: __clone(__initial.environment || {}), collection: __clone(__initial.collection || {}), globals: __clone(__initial.globals || {}), cookies: __clone(__initial.cookies || {}) };
globalThis.__request = __clone(__initial.request);
globalThis.__testResults = [];
globalThis.__tests = "[]";
const __dynamicVar = key => {
  const name = String(key).trim();
  if (name === "$guid" || name === "$uuid") return __host.randomUUID();
  if (name === "$timestamp") return String(Math.floor(Date.now() / 1000));
  if (name === "$isoTimestamp") return new Date().toISOString();
  if (name === "$randomInt") return String(Math.floor(Math.random() * 1000));
  return undefined;
};
const __replaceIn = (text, resolve) => String(text).replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_, key) => {
  const dynamic = __dynamicVar(key);
  if (dynamic !== undefined) return dynamic;
  const value = resolve(String(key).trim());
  return value == null ? "" : String(value);
});
const __scope = store => ({
  has: key => Object.prototype.hasOwnProperty.call(store, String(key)),
  get: key => store[String(key)],
  set: (key,value) => { store[String(key)] = value == null ? "" : String(value); },
  unset: key => { delete store[String(key)]; },
  replaceIn: text => __replaceIn(text, key => store[key]),
  toObject: () => __clone(store)
});
const __resolved = {
  has: key => [__stores.variables,__stores.environment,__stores.collection,__stores.globals].some(store => Object.prototype.hasOwnProperty.call(store,String(key))),
  get: key => { for (const store of [__stores.variables,__stores.environment,__stores.collection,__stores.globals]) if (Object.prototype.hasOwnProperty.call(store,String(key))) return store[String(key)]; },
  set: (key,value) => { __stores.variables[String(key)] = value == null ? "" : String(value); },
  unset: key => { delete __stores.variables[String(key)]; },
  replaceIn: text => __replaceIn(text, key => __resolved.get(key)),
  toObject: () => Object.assign({}, __stores.globals, __stores.collection, __stores.environment, __stores.variables)
};
const __list = entries => ({
  add: item => entries.push({key:String(item.key ?? item.name),value:String(item.value ?? ""),sensitive:Boolean(item.sensitive)}),
  upsert: item => { const key=String(item.key ?? item.name); const found=entries.find(entry=>entry.key.toLowerCase()===key.toLowerCase()); if(found){ found.value=String(item.value ?? ""); if(item.sensitive!=null) found.sensitive=Boolean(item.sensitive); } else entries.push({key,value:String(item.value ?? ""),sensitive:Boolean(item.sensitive)}); },
  remove: key => { const index=entries.findIndex(entry=>entry.key.toLowerCase()===String(key).toLowerCase()); if(index>=0) entries.splice(index,1); },
  get: key => entries.find(entry=>entry.key.toLowerCase()===String(key).toLowerCase())?.value,
  has: key => entries.some(entry=>entry.key.toLowerCase()===String(key).toLowerCase()),
  toObject: () => Object.fromEntries(entries.map(entry=>[entry.key,entry.value]))
});
const __cookies = {
  has: name => Object.prototype.hasOwnProperty.call(__stores.cookies,String(name)),
  get: name => __stores.cookies[String(name)],
  set: (name,value) => { __stores.cookies[String(name)] = value == null ? "" : String(value); },
  unset: name => { delete __stores.cookies[String(name)]; },
  clear: () => { for(const name of Object.keys(__stores.cookies)) delete __stores.cookies[name]; },
  toObject: () => __clone(__stores.cookies),
  jar: () => ({
    get: (_url,name,callback) => { const value=__stores.cookies[String(name)]; if(callback){callback(null,value);return;} return Promise.resolve(value); },
    getAll: (_url,callback) => { const value=__clone(__stores.cookies); if(callback){callback(null,value);return;} return Promise.resolve(value); },
    set: (_url,cookie,callback) => { const name=String(cookie?.name ?? cookie?.key ?? ""); if(!name)throw new Error("Cookie name is required"); __stores.cookies[name]=String(cookie?.value ?? ""); if(callback){callback(null,cookie);return;} return Promise.resolve(cookie); },
    unset: (_url,name,callback) => { delete __stores.cookies[String(name)]; if(callback){callback(null);return;} return Promise.resolve(); },
    clear: (_url,callback) => { for(const name of Object.keys(__stores.cookies))delete __stores.cookies[name]; if(callback){callback(null);return;} return Promise.resolve(); }
  })
};
if (__request) {
  globalThis.__requestHeaderEntries = __request.headers || []; globalThis.__requestQueryEntries = __request.query || []; __request.body = __request.body || {};
  Object.defineProperty(__request,"headers",{value:__list(__requestHeaderEntries),enumerable:false,configurable:true});
  Object.defineProperty(__request,"query",{value:__list(__requestQueryEntries),enumerable:false,configurable:true});
}
globalThis.__serializeRequest=()=>__request?Object.assign({},__request,{headers:__requestHeaderEntries,query:__requestQueryEntries}):null;
const __expect = actual => {
  let negate=false;
  const api={};
  Object.defineProperty(api,"not",{get(){negate=!negate;return api}});
  for(const name of ["to","be","have","and"]){Object.defineProperty(api,name,{get(){return api}})}
  const check=(passed,message)=>{if(negate)passed=!passed;if(!passed)throw new Error(message);return api};
  api.equal=api.eql=expected=>check(JSON.stringify(actual)===JSON.stringify(expected),"expected "+JSON.stringify(actual)+" to equal "+JSON.stringify(expected));
  api.include=expected=>check(typeof actual?.includes==="function"&&actual.includes(expected),"expected value to include "+JSON.stringify(expected));
  api.property=key=>check(actual!=null&&Object.prototype.hasOwnProperty.call(actual,key),"expected value to have property "+key);
  api.above=expected=>check(actual>expected,"expected "+actual+" to be above "+expected); api.below=expected=>check(actual<expected,"expected "+actual+" to be below "+expected);
  return api;
};
const __normalizeSendRequest = config => {
  if (typeof config === "string") return config;
  const next = __clone(config) || {};
  if (next.headers != null && next.header == null) next.header = next.headers;
  return next;
};
globalThis.pm = {
  variables: __resolved, environment: __scope(__stores.environment), collectionVariables: __scope(__stores.collection), globals: __scope(__stores.globals),
  cookies: __cookies,
  vault: { get: alias => Promise.resolve(__host.vaultGet(String(alias))), set: () => Promise.reject(new Error("Secret writes are blocked by policy")), unset: () => Promise.reject(new Error("Secret writes are blocked by policy")) },
  request: __request,
  info: Object.assign({eventName:"prerequest",runtimeVersion:"rhythm-js-1"},__initial.info || {}),
  expect: __expect,
  test: (name,fn) => { try { fn(); __testResults.push({name:String(name),passed:true}); } catch(error) { __testResults.push({name:String(name),passed:false,error:String(error?.message||error)}); } globalThis.__tests=JSON.stringify(__testResults); return pm; },
  sendRequest: (config,callback) => { try { const raw=__host.sendRequest(__normalizeSendRequest(config)); const response={code:raw.code,status:raw.status,headers:raw.headers,text:()=>raw.body,json:()=>JSON.parse(raw.body)}; if(callback){callback(null,response);return;} return Promise.resolve(response); } catch(error) { if(callback){callback(error);return;} return Promise.reject(error); } }
};
pm.test.skip=(name)=>{__testResults.push({name:String(name),passed:false,skipped:true});globalThis.__tests=JSON.stringify(__testResults);return pm};
globalThis.console={log:(...args)=>__host.log("log",...args),info:(...args)=>__host.log("info",...args),warn:(...args)=>__host.log("warn",...args),error:(...args)=>__host.log("error",...args),debug:(...args)=>__host.log("debug",...args),time:label=>{__stores.variables["__timer."+String(label)]=String(Date.now())},timeEnd:label=>{const key="__timer."+String(label);const start=Number(__stores.variables[key]||Date.now());delete __stores.variables[key];__host.log("info",String(label)+": "+(Date.now()-start)+"ms")}};
globalThis.setTimeout=(fn,ms=0)=>{__host.sleep(Number(ms));fn();return 1}; globalThis.clearTimeout=()=>{}; globalThis.setInterval=()=>{throw new Error("setInterval is blocked by policy")}; globalThis.clearInterval=()=>{};
globalThis.atob=value=>__host.base64Decode(String(value));
globalThis.btoa=value=>__host.base64Encode(String(value));
globalThis.TextEncoder=class{encode(value){return Uint8Array.from(Array.from(unescape(encodeURIComponent(String(value)))).map(char=>char.charCodeAt(0)))}};
globalThis.TextDecoder=class{decode(value){return decodeURIComponent(escape(String.fromCharCode(...Array.from(value||[]))))}};
globalThis.URLSearchParams=class{
  constructor(init=""){this._pairs=[];if(typeof init==="string"){for(const part of init.replace(/^\?/,"").split("&")){if(!part)continue;const [key,...rest]=part.split("=");this._pairs.push([decodeURIComponent(key.replace(/\+/g," ")),decodeURIComponent(rest.join("=").replace(/\+/g," "))])}}else if(Array.isArray(init)){this._pairs=init.map(pair=>[String(pair[0]),String(pair[1])])}else if(init&&typeof init==="object"){this._pairs=Object.entries(init).map(pair=>[String(pair[0]),String(pair[1])])}}
  append(key,value){this._pairs.push([String(key),String(value)])} set(key,value){this.delete(key);this.append(key,value)} get(key){return this._pairs.find(pair=>pair[0]===String(key))?.[1]??null} getAll(key){return this._pairs.filter(pair=>pair[0]===String(key)).map(pair=>pair[1])} has(key){return this._pairs.some(pair=>pair[0]===String(key))} delete(key){this._pairs=this._pairs.filter(pair=>pair[0]!==String(key))} sort(){this._pairs.sort((a,b)=>a[0].localeCompare(b[0]))} toString(){return this._pairs.map(pair=>encodeURIComponent(pair[0]).replace(/%20/g,"+")+"="+encodeURIComponent(pair[1]).replace(/%20/g,"+")).join("&")} entries(){return this._pairs[Symbol.iterator]()} keys(){return this._pairs.map(pair=>pair[0])[Symbol.iterator]()} values(){return this._pairs.map(pair=>pair[1])[Symbol.iterator]()} forEach(callback){for(const pair of this._pairs)callback(pair[1],pair[0],this)} [Symbol.iterator](){return this.entries()}
};
globalThis.URL=class{
  constructor(raw,base=""){const parsed=__host.parseURL(String(raw),String(base||""));Object.assign(this,parsed);this.searchParams=new URLSearchParams(this.search);}
  toString(){const query=this.searchParams.toString();return this.origin+this.pathname+(query?"?"+query:"")+this.hash} toJSON(){return this.toString()}
};
globalThis.crypto={randomUUID:()=>__host.randomUUID(),getRandomValues:array=>{const bytes=__host.randomBytes(array.length);for(let i=0;i<array.length;i++)array[i]=bytes[i];return array},subtle:{digest:async(algorithm,data)=>Uint8Array.from(__host.digest(String(algorithm),new TextDecoder().decode(data))).buffer,sign:async(algorithm,key,data)=>{const hash=typeof algorithm==="object"?(typeof algorithm.hash==="string"?algorithm.hash:algorithm.hash?.name):algorithm;return Uint8Array.from(__host.hmac(String(hash||"SHA-256"),String(key),new TextDecoder().decode(data))).buffer},importKey:async(_format,key)=>new TextDecoder().decode(key)}};
globalThis.fetch=undefined;globalThis.XMLHttpRequest=undefined;globalThis.require=undefined;globalThis.process=undefined;globalThis.WebAssembly=undefined;globalThis.SharedArrayBuffer=undefined;globalThis.eval=undefined;globalThis.Function=undefined;
`
