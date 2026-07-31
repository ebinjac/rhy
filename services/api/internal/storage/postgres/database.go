package postgres

import (
	"context"
	"fmt"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

func Open(ctx context.Context, databaseURL string) (*pgxpool.Pool, error) {
	return OpenWithOptions(ctx, databaseURL, PoolOptions{})
}

type PoolOptions struct {
	MaxConnections  int32
	MinConnections  int32
	TransactionPool bool
}

func OpenWithOptions(ctx context.Context, databaseURL string, options PoolOptions) (*pgxpool.Pool, error) {
	config, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		return nil, fmt.Errorf("parse PostgreSQL configuration: %w", err)
	}
	if options.MaxConnections > 0 {
		config.MaxConns = options.MaxConnections
	}
	if options.MinConnections >= 0 {
		config.MinConns = options.MinConnections
	}
	config.MaxConnLifetime = 30 * time.Minute
	config.MaxConnIdleTime = 5 * time.Minute
	config.HealthCheckPeriod = 30 * time.Second
	config.ConnConfig.ConnectTimeout = 5 * time.Second
	config.ConnConfig.RuntimeParams["statement_timeout"] = strconv.Itoa(int((15 * time.Second).Milliseconds()))
	config.ConnConfig.RuntimeParams["lock_timeout"] = strconv.Itoa(int((5 * time.Second).Milliseconds()))
	config.ConnConfig.RuntimeParams["idle_in_transaction_session_timeout"] = strconv.Itoa(int((30 * time.Second).Milliseconds()))
	config.ConnConfig.RuntimeParams["application_name"] = "rhythm"
	if options.TransactionPool {
		// PgBouncer transaction pooling cannot retain session-scoped prepared
		// statements. Simple protocol keeps every query transaction-local.
		config.ConnConfig.DefaultQueryExecMode = pgx.QueryExecModeSimpleProtocol
	}

	pool, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		return nil, fmt.Errorf("create PostgreSQL pool: %w", err)
	}
	pingContext, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	if err := pool.Ping(pingContext); err != nil {
		pool.Close()
		return nil, fmt.Errorf("connect to PostgreSQL: %w", err)
	}
	return pool, nil
}
