package scripts

import (
	"bytes"
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"
)

type HTTPServer struct {
	runtime *Runtime
	token   string
	slots   chan struct{}
}

func NewHTTPHandler(runtime *Runtime, token string) http.Handler {
	return NewHTTPHandlerWithConcurrency(runtime, token, 8)
}

func NewHTTPHandlerWithConcurrency(runtime *Runtime, token string, concurrency int) http.Handler {
	if concurrency <= 0 {
		concurrency = 8
	}
	server := &HTTPServer{runtime: runtime, token: strings.TrimSpace(token), slots: make(chan struct{}, concurrency)}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{"status": "ok", "runtimeVersion": RuntimeVersion, "capacity": cap(server.slots), "active": len(server.slots)})
	})
	mux.HandleFunc("POST /v1/validate", server.authorize(server.validate))
	mux.HandleFunc("POST /v1/execute", server.authorize(server.execute))
	return mux
}

func (s *HTTPServer) authorize(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		provided := strings.TrimSpace(strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer "))
		if s.token == "" || len(provided) != len(s.token) || subtle.ConstantTimeCompare([]byte(provided), []byte(s.token)) != 1 {
			writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
			return
		}
		next(w, r)
	}
}

func (s *HTTPServer) validate(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Code string `json:"code"`
	}
	if !decodeBody(w, r, &body) {
		return
	}
	writeJSON(w, http.StatusOK, s.runtime.Validate(body.Code))
}

func (s *HTTPServer) execute(w http.ResponseWriter, r *http.Request) {
	select {
	case s.slots <- struct{}{}:
		defer func() { <-s.slots }()
	default:
		w.Header().Set("Retry-After", "1")
		writeJSON(w, http.StatusTooManyRequests, map[string]any{"error": "script runner is at capacity"})
		return
	}
	var input Input
	if !decodeBody(w, r, &input) {
		return
	}
	result, err := s.runtime.Execute(r.Context(), input)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "script runtime unavailable"})
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func decodeBody(w http.ResponseWriter, r *http.Request, target any) bool {
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxInputBytes+maxSourceBytes))
	if err := decoder.Decode(target); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid request"})
		return false
	}
	return true
}
func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

type Client struct {
	baseURL string
	token   string
	http    *http.Client
}

func NewClient(baseURL, token string) *Client {
	return &Client{baseURL: strings.TrimRight(strings.TrimSpace(baseURL), "/"), token: strings.TrimSpace(token), http: &http.Client{Timeout: 15 * time.Second}}
}

func (c *Client) Execute(ctx context.Context, input Input) (Result, error) {
	var result Result
	if err := c.call(ctx, "/v1/execute", input, &result); err != nil {
		return Result{}, err
	}
	return result, nil
}
func (c *Client) Validate(ctx context.Context, code string) (Validation, error) {
	var result Validation
	if err := c.call(ctx, "/v1/validate", map[string]string{"code": code}, &result); err != nil {
		return Validation{}, err
	}
	return result, nil
}
func (c *Client) Health(ctx context.Context) error {
	request, _ := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+"/healthz", nil)
	response, err := c.http.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return fmt.Errorf("script runner returned %d", response.StatusCode)
	}
	return nil
}
func (c *Client) call(ctx context.Context, path string, input, output any) error {
	if c.baseURL == "" {
		return errors.New("script runner is not configured")
	}
	body, err := json.Marshal(input)
	if err != nil {
		return err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+path, bytes.NewReader(body))
	if err != nil {
		return err
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Authorization", "Bearer "+c.token)
	response, err := c.http.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return fmt.Errorf("script runner returned %d", response.StatusCode)
	}
	return json.NewDecoder(response.Body).Decode(output)
}
