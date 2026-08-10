package main

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestRoleHealthIsIndependentFromReadiness(t *testing.T) {
	handler := roleHealthHandler("worker", map[string]func(context.Context) error{
		"postgres": func(context.Context) error { return errors.New("unavailable") },
	})

	for _, path := range []string{"/health", "/healthz", "/livez"} {
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, path, nil))
		if response.Code != http.StatusOK {
			t.Fatalf("%s must remain live during a dependency outage; got %d", path, response.Code)
		}
	}

	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/readyz", nil))
	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("/readyz must expose the outage; got %d", response.Code)
	}
}
