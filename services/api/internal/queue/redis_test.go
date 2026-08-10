package queue

import (
	"context"
	"testing"
)

func TestOpenRedisCanDeferConnectivityUntilReadiness(t *testing.T) {
	client, err := OpenRedisWithConfig(context.Background(), RedisConfig{
		URL: "redis://127.0.0.1:1/0", SkipInitialPing: true,
	})
	if err != nil {
		t.Fatalf("opening a deferred Redis client must not require connectivity: %v", err)
	}
	_ = client.Close()
}

func TestUniversalOptionsSupportsRedisEnterpriseTLS(t *testing.T) {
	options, err := universalOptions(RedisConfig{
		Mode: "cluster", Addrs: []string{"redis-one.internal:6379", "redis-two.internal:6379"},
		Username: "rhythm", Password: "masked", TLS: true,
	})
	if err != nil {
		t.Fatalf("configure Redis Enterprise: %v", err)
	}
	if len(options.Addrs) != 2 || options.TLSConfig == nil || options.Username != "rhythm" || options.ClientName != "rhythm" {
		t.Fatalf("unexpected Redis options: %#v", options)
	}
}

func TestUniversalOptionsRejectsClusterDatabase(t *testing.T) {
	if _, err := universalOptions(RedisConfig{Mode: "cluster", Addrs: []string{"redis.internal:6379"}, DB: 1}); err == nil {
		t.Fatal("expected Redis Cluster database validation")
	}
}
