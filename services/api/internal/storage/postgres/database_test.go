package postgres

import (
	"context"
	"testing"
)

func TestOpenCanDeferConnectivityUntilReadiness(t *testing.T) {
	pool, err := OpenWithOptions(
		context.Background(),
		"postgres://rhythm:unused@127.0.0.1:1/rhythm?sslmode=disable",
		PoolOptions{SkipInitialPing: true},
	)
	if err != nil {
		t.Fatalf("opening a deferred PostgreSQL pool must not require connectivity: %v", err)
	}
	pool.Close()
}
