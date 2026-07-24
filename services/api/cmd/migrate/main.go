package main

import (
	"context"
	"log/slog"
	"os"
	"strings"

	"github.com/rhythm-monitoring/rhythm/db/migrations"
	"github.com/rhythm-monitoring/rhythm/internal/storage/postgres"
)

func main() {
	databaseURL := strings.TrimSpace(os.Getenv("RHYTHM_DATABASE_URL"))
	if databaseURL == "" {
		slog.Error("RHYTHM_DATABASE_URL is required")
		os.Exit(1)
	}
	ctx := context.Background()
	pool, err := postgres.Open(ctx, databaseURL)
	if err != nil {
		slog.Error("open PostgreSQL", "error", err)
		os.Exit(1)
	}
	defer pool.Close()
	if err := migrations.Up(ctx, pool); err != nil {
		slog.Error("apply migrations", "error", err)
		os.Exit(1)
	}
	slog.Info("database migrations applied")
}
