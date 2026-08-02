package queue

import (
	"context"
	"crypto/tls"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"
)

type RedisConfig struct {
	URL      string
	Mode     string
	Addrs    []string
	Username string
	Password string
	DB       int
	TLS      bool
}

func OpenRedis(ctx context.Context, redisURL string) (redis.UniversalClient, error) {
	return OpenRedisWithConfig(ctx, RedisConfig{URL: redisURL})
}

func OpenRedisWithConfig(ctx context.Context, config RedisConfig) (redis.UniversalClient, error) {
	options, err := universalOptions(config)
	if err != nil {
		return nil, err
	}
	client := redis.NewUniversalClient(options)
	pingContext, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	if err := client.Ping(pingContext).Err(); err != nil {
		_ = client.Close()
		return nil, fmt.Errorf("connect to Redis: %w", err)
	}
	return client, nil
}

func universalOptions(config RedisConfig) (*redis.UniversalOptions, error) {
	mode := strings.ToLower(strings.TrimSpace(config.Mode))
	if mode == "" {
		mode = "single"
	}
	if mode != "single" && mode != "cluster" {
		return nil, fmt.Errorf("Redis mode must be single or cluster")
	}
	if rawURL := strings.TrimSpace(config.URL); rawURL != "" && len(config.Addrs) == 0 {
		parsed, err := redis.ParseURL(rawURL)
		if err != nil {
			return nil, fmt.Errorf("parse Redis configuration: %w", err)
		}
		return &redis.UniversalOptions{
			Addrs:      []string{parsed.Addr},
			Username:   parsed.Username,
			Password:   parsed.Password,
			DB:         parsed.DB,
			TLSConfig:  parsed.TLSConfig,
			ClientName: "rhythm",
		}, nil
	}
	if len(config.Addrs) == 0 {
		return nil, fmt.Errorf("at least one Redis address is required")
	}
	if mode == "cluster" && config.DB != 0 {
		return nil, fmt.Errorf("Redis Cluster requires database 0")
	}
	options := &redis.UniversalOptions{
		Addrs:      config.Addrs,
		Username:   strings.TrimSpace(config.Username),
		Password:   config.Password,
		DB:         config.DB,
		ClientName: "rhythm",
	}
	if config.TLS {
		options.TLSConfig = &tls.Config{MinVersion: tls.VersionTLS12}
	}
	return options, nil
}

func ParseRedisDB(raw string) (int, error) {
	if strings.TrimSpace(raw) == "" {
		return 0, nil
	}
	value, err := strconv.Atoi(raw)
	if err != nil || value < 0 {
		return 0, fmt.Errorf("Redis database must be a non-negative integer")
	}
	return value, nil
}

// AcknowledgeAndDelete keeps Redis Streams as a delivery transport rather than
// a second run-history store. PostgreSQL remains the durable source of truth.
func AcknowledgeAndDelete(
	ctx context.Context,
	client redis.UniversalClient,
	stream string,
	group string,
	messageIDs ...string,
) error {
	if client == nil || len(messageIDs) == 0 {
		return nil
	}
	_, err := client.Pipelined(ctx, func(pipe redis.Pipeliner) error {
		pipe.XAck(ctx, stream, group, messageIDs...)
		pipe.XDel(ctx, stream, messageIDs...)
		return nil
	})
	return err
}
