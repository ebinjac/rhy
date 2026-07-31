package runs

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"sync"
	"time"

	"github.com/redis/go-redis/v9"

	"github.com/rhythm-monitoring/rhythm/internal/id"
)

const (
	targetLeaseDuration = 30 * time.Second
	targetAcquirePoll   = 25 * time.Millisecond
)

var acquireTargetScript = redis.NewScript(`
local current = redis.call('TIME')
local now = (tonumber(current[1]) * 1000) + math.floor(tonumber(current[2]) / 1000)
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now)
if redis.call('ZCARD', KEYS[1]) >= tonumber(ARGV[1]) then
  return 0
end
redis.call('ZADD', KEYS[1], now + tonumber(ARGV[2]), ARGV[3])
redis.call('PEXPIRE', KEYS[1], tonumber(ARGV[2]) * 2)
return 1
`)

var renewTargetScript = redis.NewScript(`
local current = redis.call('TIME')
local now = (tonumber(current[1]) * 1000) + math.floor(tonumber(current[2]) / 1000)
if redis.call('ZSCORE', KEYS[1], ARGV[2]) == false then
  return 0
end
redis.call('ZADD', KEYS[1], 'XX', now + tonumber(ARGV[1]), ARGV[2])
redis.call('PEXPIRE', KEYS[1], tonumber(ARGV[1]) * 2)
return 1
`)

type RedisTargetLimiter struct {
	client *redis.Client
}

func NewRedisTargetLimiter(client *redis.Client) *RedisTargetLimiter {
	return &RedisTargetLimiter{client: client}
}

func (l *RedisTargetLimiter) Acquire(ctx context.Context, target string, limit int) (func(), error) {
	if l == nil || l.client == nil {
		return nil, ErrTargetLimiterUnavailable
	}
	if limit < 1 {
		limit = 1
	}
	token, err := id.NewUUID()
	if err != nil {
		return nil, errors.Join(ErrTargetLimiterUnavailable, err)
	}
	key := targetLimiterKey(target)
	leaseMS := targetLeaseDuration.Milliseconds()
	for {
		acquired, runErr := acquireTargetScript.Run(ctx, l.client, []string{key}, limit, leaseMS, token).Int()
		if runErr != nil {
			return nil, errors.Join(ErrTargetLimiterUnavailable, runErr)
		}
		if acquired == 1 {
			return l.releaseLease(key, token), nil
		}
		timer := time.NewTimer(targetAcquirePoll)
		select {
		case <-ctx.Done():
			if !timer.Stop() {
				<-timer.C
			}
			return nil, ctx.Err()
		case <-timer.C:
		}
	}
}

func (l *RedisTargetLimiter) releaseLease(key, token string) func() {
	renewCtx, stopRenewal := context.WithCancel(context.Background())
	go func() {
		ticker := time.NewTicker(targetLeaseDuration / 3)
		defer ticker.Stop()
		for {
			select {
			case <-renewCtx.Done():
				return
			case <-ticker.C:
				timeout, cancel := context.WithTimeout(context.Background(), 2*time.Second)
				_, _ = renewTargetScript.Run(timeout, l.client, []string{key}, targetLeaseDuration.Milliseconds(), token).Result()
				cancel()
			}
		}
	}()
	var once sync.Once
	return func() {
		once.Do(func() {
			stopRenewal()
			timeout, cancel := context.WithTimeout(context.Background(), 2*time.Second)
			defer cancel()
			_ = l.client.ZRem(timeout, key, token).Err()
		})
	}
}

func targetLimiterKey(target string) string {
	sum := sha256.Sum256([]byte(target))
	return "rhythm:target-limit:" + hex.EncodeToString(sum[:16])
}
