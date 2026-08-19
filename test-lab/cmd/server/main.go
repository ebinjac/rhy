package main

import (
	"context"
	"fmt"
	"os"
	"os/signal"
	"syscall"

	"github.com/rhythm-monitoring/rhythm-test-lab/internal/lab"
)

func main() {
	cfg := lab.ConfigFromEnv()
	server, err := lab.New(cfg)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	fmt.Printf("Rhythm API Test Lab (TEST ONLY) HTTP=%s HTTPS=%s mTLS=%s proxy=%s\n", cfg.HTTPAddr, cfg.HTTPSAddr, cfg.MTLSAddr, cfg.ProxyAddr)
	if err = server.Start(ctx); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
