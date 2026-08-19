package ai

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestOpenAICompatibleProviderNormalizesCompletionTextAndToolCalls(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("Authorization"); got != "Bearer test-credential" {
			t.Fatalf("authorization = %q", got)
		}
		var request map[string]any
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Fatal(err)
		}
		if request["model"] != "internal-llama" {
			t.Fatalf("unexpected request: %#v", request)
		}
		if stream, _ := request["stream"].(bool); stream {
			t.Fatalf("streaming must be disabled, got %#v", request["stream"])
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"id": "req-safe",
			"choices": []map[string]any{{
				"message": map[string]any{
					"content": "Monitor ",
					"tool_calls": []map[string]any{{
						"id": "call-1",
						"type": "function",
						"function": map[string]any{
							"name": "get_monitor_health",
							"arguments": `{"monitorId":"abc"}`,
						},
					}},
				},
				"finish_reason": "tool_calls",
			}},
			"usage": map[string]int{"prompt_tokens": 12, "completion_tokens": 4, "total_tokens": 16},
		})
	}))
	defer server.Close()

	provider, err := NewOpenAICompatibleProvider(OpenAICompatibleConfig{Name: "COMPASS360", BaseURL: server.URL, CompletionPath: "/", BearerToken: "test-credential", Timeout: time.Second, Capabilities: Capabilities{Streaming: false, ToolCalling: true}})
	if err != nil {
		t.Fatal(err)
	}
	events := []ChatEvent{}
	usage, err := provider.StreamChat(context.Background(), ChatRequest{Model: "internal-llama", Messages: []ChatMessage{{Role: "user", Content: "status"}}, Tools: []ToolDefinition{{Name: "get_monitor_health", InputSchema: map[string]any{"type": "object"}}}}, func(event ChatEvent) error { events = append(events, event); return nil })
	if err != nil {
		t.Fatal(err)
	}
	if usage.TotalTokens != 16 {
		t.Fatalf("usage = %#v", usage)
	}
	if len(events) < 2 || events[0].Text != "Monitor " {
		t.Fatalf("events = %#v", events)
	}
	var call *ToolCall
	for index := range events {
		if events[index].ToolCall != nil {
			call = events[index].ToolCall
			break
		}
	}
	if call == nil || call.Name != "get_monitor_health" || string(call.Arguments) != `{"monitorId":"abc"}` {
		t.Fatalf("tool call = %#v", call)
	}
}

func TestProviderErrorsNeverExposeUpstreamBodyOrCredential(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, `credential test-credential rejected`, http.StatusUnauthorized)
	}))
	defer server.Close()
	provider, err := NewOpenAICompatibleProvider(OpenAICompatibleConfig{Name: "COMPASS360", BaseURL: server.URL, CompletionPath: "/", BearerToken: "test-credential", Timeout: time.Second})
	if err != nil {
		t.Fatal(err)
	}
	_, err = provider.StreamChat(context.Background(), ChatRequest{Model: "model", Messages: []ChatMessage{{Role: "user", Content: "hello"}}}, func(ChatEvent) error { return nil })
	if err == nil {
		t.Fatal("expected provider error")
	}
	if strings.Contains(err.Error(), "test-credential") || strings.Contains(err.Error(), "credential rejected") {
		t.Fatalf("unsafe error: %v", err)
	}
}

func TestValidateSettingsRestrictsProductionProviderHost(t *testing.T) {
	input := SettingsInput{Name: "Compass360", ProviderType: ProviderCompass360, BaseURL: "https://example.com", CompletionPath: "/v1/completions", DefaultModel: "model", TimeoutSeconds: 120, MaxConcurrency: 4, MaxToolRounds: 8, MaxInputTokens: 16000, MaxOutputTokens: 4096, DailyRequestLimit: 100}
	if err := validateSettings(&input); err == nil {
		t.Fatal("expected host policy error")
	}
	input.BaseURL = "https://compass360-dev.aexp.com"
	if err := validateSettings(&input); err != nil {
		t.Fatalf("approved host rejected: %v", err)
	}
}

func TestOpenRouterJoinsChatCompletionsOntoOpenAICompatibleBase(t *testing.T) {
	endpoint, err := joinProviderEndpoint(DefaultOpenRouterBaseURL, DefaultOpenRouterCompletionPath)
	if err != nil {
		t.Fatal(err)
	}
	if endpoint != "https://openrouter.ai/api/v1/chat/completions" {
		t.Fatalf("endpoint = %q", endpoint)
	}
}

func TestValidateSettingsAcceptsOpenRouterAliasAndHost(t *testing.T) {
	input := OpenRouterSettingsInput("sk-or-v1-test", DefaultOpenRouterModel)
	input.ProviderType = ProviderOpenRouter
	if err := validateSettings(&input); err != nil {
		t.Fatalf("openrouter rejected: %v", err)
	}
	if input.ProviderType != ProviderOpenRouterDemo {
		t.Fatalf("provider type = %q", input.ProviderType)
	}
	input.BaseURL = "https://example.com/api/v1"
	if err := validateSettings(&input); err == nil {
		t.Fatal("expected openrouter host policy error")
	}
}

func TestOpenRouterSendsModelRouterFallbacksAndReferer(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/chat/completions" {
			t.Fatalf("path = %q", r.URL.Path)
		}
		if got := r.Header.Get("Authorization"); got != "Bearer sk-or-v1-test" {
			t.Fatalf("authorization = %q", got)
		}
		if r.Header.Get("HTTP-Referer") == "" || r.Header.Get("X-Title") == "" {
			t.Fatalf("missing OpenRouter identification headers: %v", r.Header)
		}
		var request map[string]any
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Fatal(err)
		}
		if request["model"] != DefaultOpenRouterModel {
			t.Fatalf("model = %#v", request["model"])
		}
		models, _ := request["models"].([]any)
		if len(models) != 1 || models[0] != "openrouter/auto" {
			t.Fatalf("models = %#v", request["models"])
		}
		if request["route"] != "fallback" {
			t.Fatalf("route = %#v", request["route"])
		}
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, `{"choices":[{"message":{"content":"ok"},"finish_reason":"stop"}]}`)
	}))
	defer server.Close()

	provider, err := NewOpenAICompatibleProvider(OpenAICompatibleConfig{
		Name: ProviderOpenRouterDemo, BaseURL: server.URL + "/api/v1", CompletionPath: "/chat/completions",
		BearerToken: "sk-or-v1-test", Timeout: time.Second,
		ExtraHeaders: map[string]string{"HTTP-Referer": openRouterHTTPReferer, "X-Title": openRouterAppTitle},
	})
	if err != nil {
		t.Fatal(err)
	}
	_, err = provider.StreamChat(context.Background(), ChatRequest{
		Model: DefaultOpenRouterModel, FallbackModels: []string{"openrouter/auto"},
		Messages: []ChatMessage{{Role: "user", Content: "ping"}},
	}, func(ChatEvent) error { return nil })
	if err != nil {
		t.Fatal(err)
	}
}
