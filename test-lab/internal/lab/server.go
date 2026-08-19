package lab

import (
	"compress/gzip"
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"mime/multipart"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"
)

const ServiceName = "rhythm-api-test-lab"

type Server struct {
	cfg     Config
	state   *State
	logger  *slog.Logger
	handler http.Handler
	certs   Certificates
	jwtKey  *rsa.PrivateKey
	started time.Time
	servers []*http.Server
	wait    sync.WaitGroup
}

func New(cfg Config) (*Server, error) {
	if err := cfg.Validate(); err != nil {
		return nil, err
	}
	certs, err := EnsureCertificates(cfg.CertDir)
	if err != nil {
		return nil, fmt.Errorf("generate test certificates: %w", err)
	}
	jwtKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		return nil, err
	}
	s := &Server{cfg: cfg, state: NewState(cfg.Deterministic), logger: slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo})), certs: certs, jwtKey: jwtKey, started: time.Now().UTC()}
	s.handler = s.middleware(s.routes())
	return s, nil
}
func NewHandler(cfg Config) (http.Handler, error) {
	cfg.EnableHTTPS = false
	cfg.EnableMTLS = false
	cfg.EnableProxy = false
	s, err := New(cfg)
	if err != nil {
		return nil, err
	}
	return s.Handler(), nil
}
func (s *Server) Handler() http.Handler      { return s.handler }
func (s *Server) State() *State              { return s.state }
func (s *Server) Certificates() Certificates { return s.certs }

func (s *Server) routes() http.Handler {
	m := http.NewServeMux()
	m.HandleFunc("GET /", s.home)
	m.HandleFunc("GET /health", s.health)
	m.HandleFunc("GET /ready", s.health)
	m.HandleFunc("GET /version", s.version)
	m.HandleFunc("GET /scenarios", s.scenarios)
	m.HandleFunc("GET /openapi.json", s.openapi)
	for _, method := range []string{"GET", "POST", "PUT", "PATCH", "DELETE"} {
		m.HandleFunc(method+" /api/echo", s.echo)
	}
	for _, method := range []string{"GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"} {
		m.HandleFunc(method+" /api/method", s.method)
	}
	m.HandleFunc("GET /api/query", s.query)
	m.HandleFunc("GET /api/headers", s.headers)
	m.HandleFunc("GET /auth/basic", s.basicAuth)
	m.HandleFunc("GET /auth/bearer", s.bearerAuth)
	m.HandleFunc("GET /auth/api-key", s.apiKeyAuth)
	m.HandleFunc("GET /auth/api-key-query", s.apiKeyQueryAuth)
	m.HandleFunc("POST /auth/hmac", s.hmacAuth)
	m.HandleFunc("POST /auth/mac", s.macAuth)
	m.HandleFunc("POST /auth/application-token", s.applicationToken)
	m.HandleFunc("GET /protected/keysets", s.protectedKeysets)
	m.HandleFunc("POST /auth/jwt/token", s.jwtToken)
	m.HandleFunc("GET /auth/jwt/protected", s.jwtProtected)
	m.HandleFunc("GET /auth/jwt/public-key", s.jwtPublicKey)
	m.HandleFunc("GET /cookies/set", s.cookieSet)
	m.HandleFunc("GET /cookies/read", s.cookieRead)
	m.HandleFunc("GET /cookies/delete", s.cookieDelete)
	m.HandleFunc("GET /cookies/attributes", s.cookieAttributes)
	m.HandleFunc("GET /cookies/session/start", s.cookieSessionStart)
	m.HandleFunc("GET /cookies/session/check", s.cookieProfile)
	m.HandleFunc("POST /cookies/login", s.cookieLogin)
	m.HandleFunc("GET /cookies/profile", s.cookieProfile)
	m.HandleFunc("POST /cookies/logout", s.cookieLogout)
	m.HandleFunc("GET /status/{code}", s.status)
	m.HandleFunc("GET /delay/{seconds}", s.delaySeconds)
	m.HandleFunc("GET /delay-ms/{milliseconds}", s.delayMillis)
	m.HandleFunc("GET /latency/random", s.randomLatency)
	m.HandleFunc("GET /redirect/loop", func(w http.ResponseWriter, r *http.Request) { http.Redirect(w, r, "/redirect/loop", http.StatusFound) })
	m.HandleFunc("GET /redirect/final", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{"redirected": true, "final": true})
	})
	m.HandleFunc("GET /redirect/{count}", s.redirect)
	m.HandleFunc("GET /response/json", s.responseJSON)
	m.HandleFunc("GET /response/json/deep", s.responseDeep)
	m.HandleFunc("GET /response/json/dynamic", s.responseDynamic)
	m.HandleFunc("GET /response/malformed-json", s.malformedJSON)
	m.HandleFunc("GET /response/text", s.responseText)
	m.HandleFunc("GET /response/xml", s.responseXML)
	m.HandleFunc("GET /response/headers", s.responseHeaders)
	m.HandleFunc("GET /response/regex", s.responseRegex)
	m.HandleFunc("GET /response/large/{size}", s.responseLarge)
	m.HandleFunc("GET /response/binary", s.responseBinary)
	m.HandleFunc("GET /response/unicode", s.responseUnicode)
	m.HandleFunc("POST /upload", s.upload)
	m.HandleFunc("POST /form", s.form)
	m.HandleFunc("GET /compression/gzip", s.gzipResponse)
	m.HandleFunc("GET /compression/accepted", s.acceptedEncoding)
	m.HandleFunc("GET /stream", s.stream)
	m.HandleFunc("POST /validate/json", s.validateJSON)
	m.HandleFunc("POST /validate/dynamic-body", s.validateDynamicBody)
	m.HandleFunc("GET /validation/schema", s.validationSchema)
	m.HandleFunc("GET /trace/correlation", s.correlation)
	m.HandleFunc("GET /trace/nonce", s.nonce)
	m.HandleFunc("POST /workflow/start", s.workflowStart)
	m.HandleFunc("POST /workflow/{workflowId}/step", s.workflowStep)
	m.HandleFunc("GET /workflow/{workflowId}/result", s.workflowResult)
	m.HandleFunc("POST /chain/start", s.chainStart)
	m.HandleFunc("GET /chain/token", s.chainToken)
	m.HandleFunc("GET /chain/session", s.chainSession)
	m.HandleFunc("GET /chain/protected", s.chainProtected)
	m.HandleFunc("GET /rate-limit", s.rateLimit)
	m.HandleFunc("GET /unstable/{successAfter}", s.unstable)
	m.HandleFunc("GET /chaos/random-error", s.chaos)
	m.HandleFunc("GET /variables/{environment}/{userId}", s.variables)
	m.HandleFunc("GET /extract/json", s.extractJSON)
	m.HandleFunc("GET /extract/header", s.extractHeader)
	m.HandleFunc("GET /extract/cookie", s.extractCookie)
	m.HandleFunc("GET /extract/regex", s.extractRegex)
	m.HandleFunc("GET /extract/xml", s.extractXML)
	m.HandleFunc("GET /extract/protected", s.extractProtected)
	m.HandleFunc("GET /cors/open", s.corsOpen)
	m.HandleFunc("GET /cors/restricted", s.corsRestricted)
	m.HandleFunc("OPTIONS /cors/{kind}", s.corsOptions)
	m.HandleFunc("GET /metrics/test-lab", s.metrics)
	m.HandleFunc("POST /admin/reset", s.reset)
	m.HandleFunc("GET /certificates", s.certificates)
	m.HandleFunc("GET /tls", s.tlsInfo)
	m.HandleFunc("GET /mtls", s.mtls)
	return m
}

type statusWriter struct {
	http.ResponseWriter
	status int
	bytes  int
}

func (w *statusWriter) WriteHeader(code int) {
	if w.status == 0 {
		w.status = code
	}
	w.ResponseWriter.WriteHeader(code)
}
func (w *statusWriter) Write(p []byte) (int, error) {
	if w.status == 0 {
		w.status = http.StatusOK
	}
	n, err := w.ResponseWriter.Write(p)
	w.bytes += n
	return n, err
}
func (w *statusWriter) Flush() {
	if f, ok := w.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

func (s *Server) middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		started := time.Now()
		requestID := strings.TrimSpace(r.Header.Get("X-Rhythm-Test-Request-ID"))
		if requestID == "" {
			requestID = s.state.ID("req")
		}
		w.Header().Set("X-Rhythm-Test-Request-ID", requestID)
		w.Header().Set("X-Content-Type-Options", "nosniff")
		r.Header.Set("X-Rhythm-Test-Request-ID", requestID)
		sw := &statusWriter{ResponseWriter: w}
		next.ServeHTTP(sw, r)
		if sw.status == 0 {
			sw.status = http.StatusOK
		}
		s.state.mu.Lock()
		s.state.requests++
		s.state.statuses[sw.status]++
		if sw.status >= 400 {
			s.state.errors++
		}
		s.state.mu.Unlock()
		s.logger.Info("test lab request", "requestId", requestID, "method", r.Method, "path", r.URL.Path, "status", sw.status, "durationMs", time.Since(started).Milliseconds(), "responseBytes", sw.bytes)
	})
}

func (s *Server) Start(ctx context.Context) error {
	if s.cfg.EnableHTTP {
		s.add(&http.Server{Addr: s.cfg.HTTPAddr, Handler: s.handler, ReadHeaderTimeout: 5 * time.Second}, nil)
	}
	if s.cfg.EnableHTTPS {
		s.add(&http.Server{Addr: s.cfg.HTTPSAddr, Handler: s.handler, ReadHeaderTimeout: 5 * time.Second, TLSConfig: &tls.Config{MinVersion: tls.VersionTLS12}}, []string{s.certs.ServerCert, s.certs.ServerKey})
		s.add(&http.Server{Addr: s.cfg.SelfSignedAddr, Handler: s.handler, ReadHeaderTimeout: 5 * time.Second, TLSConfig: &tls.Config{MinVersion: tls.VersionTLS12}}, []string{s.certs.SelfSignedCert, s.certs.SelfSignedKey})
		s.add(&http.Server{Addr: s.cfg.WrongHostAddr, Handler: s.handler, ReadHeaderTimeout: 5 * time.Second, TLSConfig: &tls.Config{MinVersion: tls.VersionTLS12}}, []string{s.certs.WrongHostCert, s.certs.WrongHostKey})
	}
	if s.cfg.EnableMTLS {
		pool := x509.NewCertPool()
		pool.AddCert(s.certs.CA)
		s.add(&http.Server{Addr: s.cfg.MTLSAddr, Handler: s.handler, ReadHeaderTimeout: 5 * time.Second, TLSConfig: &tls.Config{MinVersion: tls.VersionTLS12, ClientAuth: tls.RequireAndVerifyClientCert, ClientCAs: pool}}, []string{s.certs.ServerCert, s.certs.ServerKey})
	}
	if s.cfg.EnableProxy {
		s.add(&http.Server{Addr: s.cfg.ProxyAddr, Handler: s.proxyHandler(), ReadHeaderTimeout: 5 * time.Second}, nil)
	}
	<-ctx.Done()
	shutdown, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	for _, server := range s.servers {
		_ = server.Shutdown(shutdown)
	}
	s.wait.Wait()
	return nil
}
func (s *Server) add(server *http.Server, certs []string) {
	s.servers = append(s.servers, server)
	s.wait.Add(1)
	go func() {
		defer s.wait.Done()
		var err error
		if len(certs) == 2 {
			err = server.ListenAndServeTLS(certs[0], certs[1])
		} else {
			err = server.ListenAndServe()
		}
		if err != nil && !errors.Is(err, http.ErrServerClosed) {
			s.logger.Error("listener stopped", "address", server.Addr, "error", err)
		}
	}()
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
func (s *Server) fail(w http.ResponseWriter, r *http.Request, status int, code, message string) {
	writeJSON(w, status, map[string]any{"error": map[string]any{"code": code, "message": message, "requestId": r.Header.Get("X-Rhythm-Test-Request-ID")}})
}
func readJSON(r *http.Request, max int64, target any) error {
	defer r.Body.Close()
	decoder := json.NewDecoder(io.LimitReader(r.Body, max))
	decoder.DisallowUnknownFields()
	return decoder.Decode(target)
}
func safeHeader(name, value string, unmask bool) string {
	if unmask {
		return value
	}
	lower := strings.ToLower(name)
	for _, part := range []string{"authorization", "proxy-authorization", "api-key", "cookie", "auth-signature", "secret", "password", "token", "private-key", "private_key"} {
		if strings.Contains(lower, part) {
			return "[REDACTED]"
		}
	}
	return value
}
func headersMap(h http.Header, unmask bool) map[string][]string {
	out := map[string][]string{}
	for key, values := range h {
		for _, value := range values {
			out[key] = append(out[key], safeHeader(key, value, unmask))
		}
	}
	return out
}
func clamp(v, min, max int) int {
	if v < min {
		return min
	}
	if v > max {
		return max
	}
	return v
}
func parseInt(value string, fallback int) int {
	parsed, err := strconv.Atoi(value)
	if err != nil {
		return fallback
	}
	return parsed
}
func parseFloat(value string, fallback float64) float64 {
	parsed, err := strconv.ParseFloat(value, 64)
	if err != nil {
		return fallback
	}
	return parsed
}
func requestHostPort(r *http.Request) (string, string) {
	host := r.URL.Hostname()
	port := r.URL.Port()
	if host == "" {
		host = r.Host
		if parsed, err := url.Parse("//" + r.Host); err == nil {
			host = parsed.Hostname()
			port = parsed.Port()
		}
	}
	if port == "" {
		if r.TLS != nil {
			port = "443"
		} else {
			port = "80"
		}
	}
	return host, port
}
func multipartFiles(form *multipart.Form) []map[string]any {
	files := []map[string]any{}
	for _, items := range form.File {
		for _, item := range items {
			files = append(files, map[string]any{"name": item.Filename, "size": item.Size, "contentType": item.Header.Get("Content-Type")})
		}
	}
	return files
}
func gzipWrite(w http.ResponseWriter, payload []byte) {
	w.Header().Set("Content-Encoding", "gzip")
	w.Header().Set("Content-Type", "application/json")
	writer := gzip.NewWriter(w)
	defer writer.Close()
	_, _ = writer.Write(payload)
}
