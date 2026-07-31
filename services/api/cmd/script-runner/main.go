package main

import (
	"errors"
	"log/slog"
	"net/http"
	"os"
	"strconv"
	"time"

	"github.com/rhythm-monitoring/rhythm/internal/scripts"
)

func main() {
	address := os.Getenv("RHYTHM_SCRIPT_RUNNER_ADDR")
	if address == "" {
		address = ":8090"
	}
	token := os.Getenv("RHYTHM_SCRIPT_RUNNER_TOKEN")
	if token == "" {
		slog.Error("RHYTHM_SCRIPT_RUNNER_TOKEN is required")
		os.Exit(1)
	}
	concurrency := 8
	if raw := os.Getenv("RHYTHM_SCRIPT_RUNNER_CONCURRENCY"); raw != "" {
		value, err := strconv.Atoi(raw)
		if err != nil || value < 1 || value > 64 {
			slog.Error("RHYTHM_SCRIPT_RUNNER_CONCURRENCY must be between 1 and 64")
			os.Exit(1)
		}
		concurrency = value
	}
	server := &http.Server{Addr: address, Handler: scripts.NewHTTPHandlerWithConcurrency(scripts.NewRuntime(), token, concurrency), ReadHeaderTimeout: 3 * time.Second, ReadTimeout: 15 * time.Second, WriteTimeout: 15 * time.Second, IdleTimeout: 30 * time.Second}
	slog.Info("Rhythm script runner listening", "address", address, "runtimeVersion", scripts.RuntimeVersion)
	if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		slog.Error("script runner stopped", "error", err)
		os.Exit(1)
	}
}
