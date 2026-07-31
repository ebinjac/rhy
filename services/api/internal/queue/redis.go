package queue

import (
	"context"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
)

func OpenRedis(ctx context.Context, redisURL string) (*redis.Client, error) {
	options, err := redis.ParseURL(redisURL)
	if err != nil {
		return nil, fmt.Errorf("parse Redis configuration: %w", err)
	}
	client := redis.NewClient(options)
	pingContext, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	if err := client.Ping(pingContext).Err(); err != nil {
		_ = client.Close()
		return nil, fmt.Errorf("connect to Redis: %w", err)
	}
	return client, nil
}

// AcknowledgeAndDelete keeps Redis Streams as a delivery transport rather than
// a second run-history store. PostgreSQL remains the durable source of truth.
func AcknowledgeAndDelete(
	ctx context.Context,
	client *redis.Client,
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
