package agents

import (
	"context"
	"errors"
	"testing"

	"github.com/rhythm-monitoring/rhythm/internal/runs"
)

func TestAgentSelectionHonorsCapabilitiesCapacityAndDrain(t *testing.T) {
	service := New(NewMemoryRepository())
	first, err := service.Register(context.Background(), RegisterInput{Name: "private-zone-a", GroupID: "private", Version: "1.4.0", Tags: []string{"eu-west", "private"}, Capabilities: map[string]any{"mtls": true, "socks5": true}, MaxConcurrency: 2})
	if err != nil {
		t.Fatal(err)
	}
	second, err := service.Register(context.Background(), RegisterInput{Name: "private-zone-b", GroupID: "private", Version: "1.4.0", Tags: []string{"eu-west", "private"}, Capabilities: map[string]any{"mtls": true}, MaxConcurrency: 2})
	if err != nil {
		t.Fatal(err)
	}
	selected, err := service.Select(context.Background(), runs.AgentRequirements{GroupID: "private", RequiredTags: []string{"eu-west"}, RequiredCapabilities: []string{"socks5"}})
	if err != nil || selected != first.ID {
		t.Fatalf("capability routing selected %q, expected %q: %v", selected, first.ID, err)
	}
	if err := service.Release(context.Background(), selected); err != nil {
		t.Fatal(err)
	}
	if _, err := service.SetStatus(context.Background(), first.ID, "DRAINING"); err != nil {
		t.Fatal(err)
	}
	if _, err := service.Select(context.Background(), runs.AgentRequirements{GroupID: "private", RequiredCapabilities: []string{"socks5"}}); !errors.Is(err, ErrNoCapacity) {
		t.Fatalf("draining agent remained routable: %v", err)
	}
	selected, err = service.Select(context.Background(), runs.AgentRequirements{AgentID: second.ID, RequiredCapabilities: []string{"mtls"}})
	if err != nil || selected != second.ID {
		t.Fatalf("direct active agent routing failed: %q %v", selected, err)
	}
}

func TestRevokedAgentCannotHeartbeat(t *testing.T) {
	service := New(NewMemoryRepository())
	agent, err := service.Register(context.Background(), RegisterInput{Name: "revocable", MaxConcurrency: 1})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.SetStatus(context.Background(), agent.ID, "REVOKED"); err != nil {
		t.Fatal(err)
	}
	_, err = service.Heartbeat(context.Background(), agent.ID, HeartbeatInput{Version: "1.5.0", MaxConcurrency: 1})
	if err == nil {
		t.Fatal("revoked agent heartbeat was accepted")
	}
}
