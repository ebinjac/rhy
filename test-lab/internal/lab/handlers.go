package lab

import (
	"bytes"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
)

func (s *Server) home(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	_, _ = io.WriteString(w, `<!doctype html><html><head><meta charset="utf-8"><title>Rhythm API Test Lab</title><style>body{font:16px system-ui;max-width:960px;margin:4rem auto;padding:0 1rem;color:#17202a}code{background:#eef3f8;padding:.15rem .35rem;border-radius:.25rem}li{margin:.45rem 0}</style></head><body><h1>Rhythm API Test Lab</h1><p>Disposable integration scenarios for Rhythm. <strong>TEST ONLY — NOT FOR PRODUCTION.</strong></p><p><a href="/scenarios">Machine-readable scenarios</a> · <a href="/openapi.json">OpenAPI</a> · <a href="/health">Health</a></p><h2>Categories</h2><ul><li>HTTP basics and bodies</li><li>Basic, Bearer, API key, HMAC, MAC, JWT and chained authentication</li><li>Cookies and workflows</li><li>Extractors and validation</li><li>Latency, failures, redirects, compression and streaming</li><li>TLS, custom CA and mTLS</li></ul></body></html>`)
}
func (s *Server) health(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"status": "healthy", "service": ServiceName, "uptimeSeconds": int(time.Since(s.started).Seconds())})
}
func (s *Server) version(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"service": ServiceName, "version": "0.1.0", "go": "1.26", "build": "development"})
}
func (s *Server) echo(w http.ResponseWriter, r *http.Request) {
	body, _ := io.ReadAll(io.LimitReader(r.Body, s.cfg.MaxBodyBytes))
	cookies := map[string]string{}
	for _, cookie := range r.Cookies() {
		cookies[cookie.Name] = safeHeader("cookie", cookie.Value, s.cfg.EchoSensitive)
	}
	writeJSON(w, http.StatusOK, map[string]any{"method": r.Method, "path": r.URL.Path, "query": r.URL.Query(), "headers": headersMap(r.Header, s.cfg.EchoSensitive), "cookies": cookies, "body": string(body), "contentLength": len(body), "remoteAddress": r.RemoteAddr, "protocol": r.Proto, "timestamp": time.Now().UTC().Format(time.RFC3339Nano), "tls": tlsSummary(r)})
}
func (s *Server) query(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"query": r.URL.Query()})
}
func (s *Server) headers(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"headers": headersMap(r.Header, s.cfg.EchoSensitive)})
}
func (s *Server) method(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodHead {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"method": r.Method})
}
func (s *Server) status(w http.ResponseWriter, r *http.Request) {
	code := parseInt(r.PathValue("code"), 200)
	if code < 100 || code > 599 {
		s.fail(w, r, http.StatusBadRequest, "INVALID_STATUS", "status must be between 100 and 599")
		return
	}
	if code == http.StatusNoContent {
		w.WriteHeader(code)
		return
	}
	writeJSON(w, code, map[string]any{"status": code, "message": http.StatusText(code)})
}
func (s *Server) delaySeconds(w http.ResponseWriter, r *http.Request) {
	s.delay(w, r, time.Duration(parseInt(r.PathValue("seconds"), 0))*time.Second)
}
func (s *Server) delayMillis(w http.ResponseWriter, r *http.Request) {
	s.delay(w, r, time.Duration(parseInt(r.PathValue("milliseconds"), 0))*time.Millisecond)
}
func (s *Server) delay(w http.ResponseWriter, r *http.Request, duration time.Duration) {
	if duration < 0 || duration > s.cfg.MaxDelay {
		s.fail(w, r, http.StatusBadRequest, "INVALID_DELAY", "delay exceeds the configured maximum")
		return
	}
	select {
	case <-time.After(duration):
		writeJSON(w, http.StatusOK, map[string]any{"delayMs": duration.Milliseconds()})
	case <-r.Context().Done():
		return
	}
}
func (s *Server) randomLatency(w http.ResponseWriter, r *http.Request) {
	min := clamp(parseInt(r.URL.Query().Get("min"), 100), 0, int(s.cfg.MaxDelay.Milliseconds()))
	max := clamp(parseInt(r.URL.Query().Get("max"), 2000), min, int(s.cfg.MaxDelay.Milliseconds()))
	actual := min
	if max > min {
		actual += s.state.RandomInt(max - min + 1)
	}
	s.delay(w, r, time.Duration(actual)*time.Millisecond)
}
func (s *Server) redirect(w http.ResponseWriter, r *http.Request) {
	count := clamp(parseInt(r.PathValue("count"), 0), 0, 50)
	if count == 0 {
		http.Redirect(w, r, "/redirect/final", http.StatusFound)
		return
	}
	http.Redirect(w, r, "/redirect/"+strconv.Itoa(count-1), http.StatusFound)
}

func (s *Server) responseJSON(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"status": "success", "data": map[string]any{"session": map[string]any{"token": "test-session-token", "user": map[string]any{"id": 78291, "name": "Rhythm Test User"}}}})
}
func (s *Server) responseDeep(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"data": map[string]any{"users": []map[string]any{{"id": 1, "active": true, "roles": []string{"operator", "viewer"}}, {"id": 2, "active": false, "roles": []string{}}}, "metrics": map[string]any{"p95": 123.45, "count": 2, "missing": nil}}, "tags": []string{"api", "synthetic"}})
}
func (s *Server) responseDynamic(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"timestamp": time.Now().UTC().Format(time.RFC3339Nano), "uuid": s.state.ID("uuid"), "randomNumber": s.state.RandomInt(1000), "nested": map[string]any{"requestId": r.Header.Get("X-Rhythm-Test-Request-ID")}})
}
func (s *Server) malformedJSON(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	_, _ = io.WriteString(w, `{"status":"broken", invalid}`)
}
func (s *Server) responseText(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	_, _ = io.WriteString(w, "Rhythm API Test Lab response")
}
func (s *Server) responseXML(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/xml; charset=utf-8")
	_, _ = io.WriteString(w, `<?xml version="1.0" encoding="UTF-8"?><response><status>success</status><session><token>xml-test-token</token></session><user><id>78291</id><name>Rhythm Test User</name></user></response>`)
}
func (s *Server) responseHeaders(w http.ResponseWriter, r *http.Request) {
	requestID := r.Header.Get("X-Rhythm-Test-Request-ID")
	w.Header().Set("X-Request-ID", requestID)
	w.Header().Set("X-Correlation-ID", s.state.ID("corr"))
	w.Header().Set("X-Test-Token", "header-test-token")
	w.Header().Set("X-Test-Environment", "DEV")
	writeJSON(w, http.StatusOK, map[string]any{"headersGenerated": true})
}
func (s *Server) responseRegex(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	_, _ = fmt.Fprintf(w, "Transaction completed successfully.\nTransaction-ID: TXN-%06d\nReference: REF-%06d\n", s.state.RandomInt(1_000_000), s.state.RandomInt(1_000_000))
}
func (s *Server) responseLarge(w http.ResponseWriter, r *http.Request) {
	sizes := map[string]int{"1kb": 1 << 10, "100kb": 100 << 10, "1mb": 1 << 20, "5mb": 5 << 20, "10mb": 10 << 20}
	size, ok := sizes[strings.ToLower(r.PathValue("size"))]
	if !ok {
		s.fail(w, r, http.StatusNotFound, "UNKNOWN_SIZE", "supported sizes are 1kb, 100kb, 1mb, 5mb and 10mb")
		return
	}
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Content-Length", strconv.Itoa(size))
	chunk := bytes.Repeat([]byte("RHYTHM-TEST-LAB\n"), 4096)
	remaining := size
	for remaining > 0 {
		n := len(chunk)
		if n > remaining {
			n = remaining
		}
		_, _ = w.Write(chunk[:n])
		remaining -= n
	}
}
func (s *Server) responseBinary(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Content-Disposition", `attachment; filename="rhythm-test.bin"`)
	_, _ = w.Write([]byte{0x52, 0x48, 0x59, 0x54, 0x48, 0x4d, 0x00, 0x01, 0xff})
}
func (s *Server) responseUnicode(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"english": "Rhythm", "malayalam": "റിഥം", "hindi": "रिदम", "japanese": "リズム", "emoji": "🎵✅", "special": "space + percent % ampersand & equals ="})
}

func (s *Server) upload(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, s.cfg.MaxUploadBytes)
	if err := r.ParseMultipartForm(2 << 20); err != nil {
		s.fail(w, r, http.StatusBadRequest, "INVALID_MULTIPART", "multipart body is invalid or too large")
		return
	}
	defer r.MultipartForm.RemoveAll()
	writeJSON(w, http.StatusOK, map[string]any{"files": multipartFiles(r.MultipartForm), "fields": r.MultipartForm.Value})
}
func (s *Server) form(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseForm(); err != nil {
		s.fail(w, r, http.StatusBadRequest, "INVALID_FORM", "form body is invalid")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"fields": r.PostForm})
}
func (s *Server) gzipResponse(w http.ResponseWriter, r *http.Request) {
	payload, _ := json.Marshal(map[string]any{"compressed": true, "message": "Rhythm API Test Lab gzip response"})
	gzipWrite(w, payload)
}
func (s *Server) acceptedEncoding(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"acceptEncoding": r.Header.Get("Accept-Encoding")})
}
func (s *Server) stream(w http.ResponseWriter, r *http.Request) {
	chunks := clamp(parseInt(r.URL.Query().Get("chunks"), 5), 1, 100)
	interval := clamp(parseInt(r.URL.Query().Get("intervalMs"), 100), 0, 5000)
	w.Header().Set("Content-Type", "text/plain")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	for i := 1; i <= chunks; i++ {
		_, _ = fmt.Fprintf(w, "chunk %d/%d\n", i, chunks)
		if flusher, ok := w.(http.Flusher); ok {
			flusher.Flush()
		}
		select {
		case <-time.After(time.Duration(interval) * time.Millisecond):
		case <-r.Context().Done():
			return
		}
	}
}

func (s *Server) validateJSON(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Name        string `json:"name"`
		Environment string `json:"environment"`
	}
	if err := readJSON(r, s.cfg.MaxBodyBytes, &input); err != nil || input.Name != "Rhythm" || input.Environment != "DEV" {
		s.fail(w, r, http.StatusUnprocessableEntity, "INVALID_BODY", "name must be Rhythm and environment must be DEV")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"valid": true})
}

var uuidPattern = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$`)

func (s *Server) validateDynamicBody(w http.ResponseWriter, r *http.Request) {
	var input struct {
		TransactionID string `json:"transactionId"`
		Timestamp     int64  `json:"timestamp"`
		Environment   string `json:"environment"`
	}
	if err := readJSON(r, s.cfg.MaxBodyBytes, &input); err != nil {
		s.fail(w, r, http.StatusUnprocessableEntity, "INVALID_BODY", "body must be valid JSON")
		return
	}
	timestamp := time.UnixMilli(input.Timestamp)
	if input.Timestamp < 10_000_000_000 {
		timestamp = time.Unix(input.Timestamp, 0)
	}
	errors := map[string]string{}
	if !uuidPattern.MatchString(input.TransactionID) {
		errors["transactionId"] = "must be a UUID"
	}
	if time.Since(timestamp) > 5*time.Minute || time.Until(timestamp) > 5*time.Minute {
		errors["timestamp"] = "must be within five minutes"
	}
	if input.Environment != "DEV" && input.Environment != "TEST" && input.Environment != "PROD" && input.Environment != "E1" && input.Environment != "E2" && input.Environment != "E3" {
		errors["environment"] = "must be a known environment"
	}
	if len(errors) > 0 {
		writeJSON(w, http.StatusUnprocessableEntity, map[string]any{"error": map[string]any{"code": "INVALID_BODY", "message": "Dynamic body validation failed", "fields": errors, "requestId": r.Header.Get("X-Rhythm-Test-Request-ID")}})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"valid": true, "transactionId": input.TransactionID})
}
func (s *Server) validationSchema(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"id": "schema-test-01", "name": "Rhythm Test Resource", "active": true, "count": 3, "tags": []string{"stable", "validation"}})
}
func (s *Server) correlation(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimSpace(r.Header.Get("X-Correlation-ID"))
	if id == "" {
		s.fail(w, r, http.StatusBadRequest, "MISSING_HEADER", "X-Correlation-ID is required")
		return
	}
	w.Header().Set("X-Correlation-ID", id)
	writeJSON(w, http.StatusOK, map[string]any{"correlationId": id})
}
func (s *Server) nonce(w http.ResponseWriter, r *http.Request) {
	nonce := r.Header.Get("X-Nonce")
	if len(nonce) != 36 {
		s.fail(w, r, http.StatusUnprocessableEntity, "INVALID_NONCE", "X-Nonce must contain 36 characters")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"valid": true, "length": len(nonce)})
}

func (s *Server) workflowStart(w http.ResponseWriter, r *http.Request) {
	id, token := s.state.ID("workflow"), s.state.ID("workflow-token")
	s.state.mu.Lock()
	s.state.workflows[id] = workflowRecord{Token: token}
	s.state.mu.Unlock()
	writeJSON(w, http.StatusCreated, map[string]any{"workflowId": id, "token": token})
}
func (s *Server) workflowStep(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("workflowId")
	token := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
	s.state.mu.Lock()
	record, ok := s.state.workflows[id]
	if ok && constantEqual(record.Token, token) {
		record.StepID = s.stateIDLocked("step")
		record.Complete = true
		s.state.workflows[id] = record
	}
	s.state.mu.Unlock()
	if !ok || !constantEqual(record.Token, token) {
		s.fail(w, r, http.StatusUnauthorized, "INVALID_TOKEN", "Workflow token is invalid")
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]any{"stepId": record.StepID, "status": "accepted"})
}
func (s *Server) workflowResult(w http.ResponseWriter, r *http.Request) {
	s.state.mu.Lock()
	record, ok := s.state.workflows[r.PathValue("workflowId")]
	s.state.mu.Unlock()
	if !ok {
		s.fail(w, r, http.StatusNotFound, "WORKFLOW_NOT_FOUND", "Workflow does not exist")
		return
	}
	status := "pending"
	if record.Complete {
		status = "completed"
	}
	writeJSON(w, http.StatusOK, map[string]any{"status": status, "stepId": record.StepID})
}
func (s *Server) stateIDLocked(prefix string) string {
	s.state.sequence++
	if s.state.deterministic {
		return prefix + "-deterministic-" + itoa(int(s.state.sequence))
	}
	return prefix + "-" + strconv.FormatInt(time.Now().UnixNano(), 36)
}
func (s *Server) chainStart(w http.ResponseWriter, r *http.Request) {
	id := s.state.ID("chain")
	s.state.mu.Lock()
	s.state.workflows[id] = workflowRecord{}
	s.state.mu.Unlock()
	writeJSON(w, http.StatusCreated, map[string]any{"chainId": id})
}
func (s *Server) chainToken(w http.ResponseWriter, r *http.Request) {
	id := r.URL.Query().Get("chainId")
	s.state.mu.Lock()
	_, ok := s.state.workflows[id]
	if ok {
		record := s.state.workflows[id]
		record.Token = s.stateIDLocked("chain-token")
		s.state.workflows[id] = record
	}
	record := s.state.workflows[id]
	s.state.mu.Unlock()
	if !ok {
		s.fail(w, r, http.StatusNotFound, "WORKFLOW_NOT_FOUND", "Chain does not exist")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"token": record.Token})
}
func (s *Server) chainSession(w http.ResponseWriter, r *http.Request) {
	id := r.URL.Query().Get("chainId")
	token := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
	s.state.mu.Lock()
	record, ok := s.state.workflows[id]
	if ok && constantEqual(record.Token, token) {
		record.StepID = s.stateIDLocked("chain-session")
		s.state.workflows[id] = record
	}
	s.state.mu.Unlock()
	if !ok || !constantEqual(record.Token, token) {
		s.fail(w, r, http.StatusUnauthorized, "INVALID_TOKEN", "Chain token is invalid")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"sessionId": record.StepID})
}
func (s *Server) chainProtected(w http.ResponseWriter, r *http.Request) {
	id, session := r.URL.Query().Get("chainId"), r.Header.Get("X-Session-ID")
	s.state.mu.Lock()
	record, ok := s.state.workflows[id]
	s.state.mu.Unlock()
	if !ok || !constantEqual(record.StepID, session) {
		s.fail(w, r, http.StatusUnauthorized, "SESSION_REQUIRED", "Chain session is invalid")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"authenticated": true, "chainId": id})
}

func (s *Server) rateLimit(w http.ResponseWriter, r *http.Request) {
	key := r.URL.Query().Get("clientId")
	if key == "" {
		key = r.RemoteAddr
	}
	now := time.Now()
	s.state.mu.Lock()
	record := s.state.rates[key]
	if record.Started.IsZero() || now.Sub(record.Started) >= 10*time.Second {
		record = rateRecord{Started: now}
	}
	record.Count++
	s.state.rates[key] = record
	s.state.mu.Unlock()
	remaining := 5 - record.Count
	if remaining < 0 {
		remaining = 0
	}
	w.Header().Set("X-RateLimit-Limit", "5")
	w.Header().Set("X-RateLimit-Remaining", strconv.Itoa(remaining))
	if record.Count > 5 {
		retry := int((10*time.Second - now.Sub(record.Started)).Seconds()) + 1
		w.Header().Set("Retry-After", strconv.Itoa(retry))
		s.fail(w, r, http.StatusTooManyRequests, "RATE_LIMITED", "Rate limit exceeded")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"allowed": true, "remaining": remaining})
}
func (s *Server) unstable(w http.ResponseWriter, r *http.Request) {
	successAfter := clamp(parseInt(r.PathValue("successAfter"), 1), 1, 20)
	key := r.URL.Query().Get("clientId") + ":" + r.PathValue("successAfter")
	s.state.mu.Lock()
	s.state.retries[key]++
	attempt := s.state.retries[key]
	s.state.mu.Unlock()
	if attempt < successAfter {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"attempt": attempt, "successAfter": successAfter, "status": "retry"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"attempt": attempt, "successAfter": successAfter, "status": "success"})
}
func (s *Server) chaos(w http.ResponseWriter, r *http.Request) {
	rate := parseFloat(r.URL.Query().Get("failureRate"), 0.25)
	if rate < 0 || rate > 1 {
		s.fail(w, r, http.StatusBadRequest, "INVALID_FAILURE_RATE", "failureRate must be between 0 and 1")
		return
	}
	failed := float64(s.state.RandomInt(10_000))/10_000 < rate
	if failed {
		code := http.StatusInternalServerError
		if s.state.RandomInt(2) == 1 {
			code = http.StatusServiceUnavailable
		}
		writeJSON(w, code, map[string]any{"status": "failure", "failureRate": rate})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"status": "success", "failureRate": rate})
}

func (s *Server) variables(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"environment": r.PathValue("environment"), "userId": r.PathValue("userId"), "baseUrl": scheme(r) + "://" + r.Host, "requestId": r.Header.Get("X-Rhythm-Test-Request-ID")})
}
func (s *Server) extractJSON(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"data": map[string]any{"token": "jsonpath-test-token", "user": map[string]any{"id": 78291}}})
}
func (s *Server) extractHeader(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("X-Test-Token", "header-extractor-token")
	writeJSON(w, http.StatusOK, map[string]any{"source": "header"})
}
func (s *Server) extractCookie(w http.ResponseWriter, r *http.Request) {
	http.SetCookie(w, &http.Cookie{Name: "extractor_token", Value: "cookie-extractor-token", Path: "/"})
	writeJSON(w, http.StatusOK, map[string]any{"source": "cookie"})
}
func (s *Server) extractRegex(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/plain")
	_, _ = io.WriteString(w, "token=regex-extractor-token")
}
func (s *Server) extractXML(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/xml")
	_, _ = io.WriteString(w, "<response><token>xml-extractor-token</token></response>")
}
func (s *Server) extractProtected(w http.ResponseWriter, r *http.Request) {
	token := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
	if token != "header-extractor-token" && token != "jsonpath-test-token" && token != "regex-extractor-token" && token != "xml-extractor-token" {
		s.fail(w, r, http.StatusUnauthorized, "INVALID_TOKEN", "Extracted token is invalid")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"authenticated": true})
}

func (s *Server) corsOpen(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	writeJSON(w, http.StatusOK, map[string]any{"cors": "open"})
}
func (s *Server) corsRestricted(w http.ResponseWriter, r *http.Request) {
	origin := r.Header.Get("Origin")
	if origin == "http://localhost:3100" {
		w.Header().Set("Access-Control-Allow-Origin", origin)
	}
	writeJSON(w, http.StatusOK, map[string]any{"cors": "restricted"})
}
func (s *Server) corsOptions(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Authorization,Content-Type,X-API-Key")
	if r.PathValue("kind") == "open" {
		w.Header().Set("Access-Control-Allow-Origin", "*")
	}
	w.WriteHeader(http.StatusNoContent)
}
func (s *Server) metrics(w http.ResponseWriter, r *http.Request) {
	s.state.mu.Lock()
	defer s.state.mu.Unlock()
	statuses := map[string]uint64{}
	keys := make([]int, 0, len(s.state.statuses))
	for key := range s.state.statuses {
		keys = append(keys, key)
	}
	sort.Ints(keys)
	for _, key := range keys {
		statuses[strconv.Itoa(key)] = s.state.statuses[key]
	}
	writeJSON(w, http.StatusOK, map[string]any{"requests": s.state.requests, "errors": s.state.errors, "requestsByStatus": statuses})
}
func (s *Server) reset(w http.ResponseWriter, r *http.Request) {
	if !s.cfg.AdminEnabled {
		s.fail(w, r, http.StatusNotFound, "NOT_FOUND", "Admin reset is disabled")
		return
	}
	s.state.Reset()
	writeJSON(w, http.StatusOK, map[string]any{"reset": true})
}
func (s *Server) certificates(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"ca": map[string]any{"commonName": s.certs.CA.Subject.CommonName, "notBefore": s.certs.CA.NotBefore, "notAfter": s.certs.CA.NotAfter}, "files": map[string]string{"ca": "ca.crt", "server": "server.crt", "client": "client.crt", "invalidClient": "invalid-client.crt", "selfSigned": "self-signed.crt", "wrongHost": "wrong-host.crt"}})
}
func (s *Server) tlsInfo(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"tls": tlsSummary(r)})
}
func (s *Server) mtls(w http.ResponseWriter, r *http.Request) {
	if r.TLS == nil || len(r.TLS.PeerCertificates) == 0 {
		s.fail(w, r, http.StatusUnauthorized, "CLIENT_CERTIFICATE_REQUIRED", "A valid client certificate is required")
		return
	}
	certificate := r.TLS.PeerCertificates[0]
	writeJSON(w, http.StatusOK, map[string]any{"authenticated": true, "type": "mTLS", "clientCertificate": map[string]any{"commonName": certificate.Subject.CommonName, "issuer": certificate.Issuer.CommonName, "notAfter": certificate.NotAfter}})
}
func tlsSummary(r *http.Request) map[string]any {
	if r.TLS == nil {
		return map[string]any{"enabled": false}
	}
	version := map[uint16]string{tls.VersionTLS12: "TLS 1.2", tls.VersionTLS13: "TLS 1.3"}[r.TLS.Version]
	return map[string]any{"enabled": true, "version": version, "serverName": r.TLS.ServerName, "clientCertificatePresent": len(r.TLS.PeerCertificates) > 0}
}
func scheme(r *http.Request) string {
	if r.TLS != nil {
		return "https"
	}
	return "http"
}
