package ai

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

const (
	ProviderCompass360     = "COMPASS360"
	ProviderOpenRouterDemo = "OPENROUTER_DEMO"
	ProviderOpenRouter     = "OPENROUTER"

	DefaultOpenRouterBaseURL        = "https://openrouter.ai/api/v1"
	DefaultOpenRouterCompletionPath = "/chat/completions"
	DefaultOpenRouterModel          = "dots-studio/dots-3-note-preview:free"
	openRouterHTTPReferer           = "http://localhost:3200"
	openRouterAppTitle              = "Rhythm"
)

func IsOpenRouter(providerType string) bool {
	switch strings.ToUpper(strings.TrimSpace(providerType)) {
	case ProviderOpenRouter, ProviderOpenRouterDemo:
		return true
	default:
		return false
	}
}

type Capabilities struct {
	ChatMessages        bool `json:"chatMessages"`
	Streaming           bool `json:"streaming"`
	ToolCalling         bool `json:"toolCalling"`
	ParallelToolCalling bool `json:"parallelToolCalling"`
	StructuredOutput    bool `json:"structuredOutput"`
	MaxContextTokens    int  `json:"maxContextTokens"`
	MaxOutputTokens     int  `json:"maxOutputTokens"`
	Temperature         bool `json:"temperature"`
	Sampling            bool `json:"sampling"`
}

type ChatRequest struct {
	Model             string
	FallbackModels    []string
	Messages          []ChatMessage
	Tools             []ToolDefinition
	Temperature       *float64
	TopP              *float64
	MaxOutputTokens   int
	ParallelToolCalls bool
	ToolChoice        string
}

type ChatMessage struct {
	Role       string
	Content    string
	ToolCallID string
	ToolCalls  []ToolCall
}

type ToolDefinition struct {
	Name        string         `json:"name"`
	Description string         `json:"description"`
	InputSchema map[string]any `json:"inputSchema"`
}

type ToolCall struct {
	ID        string          `json:"id"`
	Name      string          `json:"name"`
	Arguments json.RawMessage `json:"arguments"`
}

type Citation struct {
	Label        string `json:"label"`
	ResourceType string `json:"resourceType"`
	ResourceID   string `json:"resourceId"`
	Href         string `json:"href"`
}

type ToolResult struct {
	Content   string     `json:"content"`
	Citations []Citation `json:"citations,omitempty"`
}

type ChatEvent struct {
	Type         string      `json:"type"`
	Text         string      `json:"text,omitempty"`
	ToolCall     *ToolCall   `json:"toolCall,omitempty"`
	FinishReason string      `json:"finishReason,omitempty"`
	RequestID    string      `json:"requestId,omitempty"`
	Usage        *Usage      `json:"usage,omitempty"`
	Data         interface{} `json:"data,omitempty"`
}

type Usage struct {
	PromptTokens     int `json:"promptTokens"`
	CompletionTokens int `json:"completionTokens"`
	TotalTokens      int `json:"totalTokens"`
}

type ProviderError struct {
	Category   string
	StatusCode int
	RetryAfter time.Duration
	Message    string
	Retryable  bool
}

func (e *ProviderError) Error() string { return e.Message }

type Provider interface {
	Name() string
	Capabilities(context.Context) (Capabilities, error)
	StreamChat(context.Context, ChatRequest, func(ChatEvent) error) (Usage, error)
}

type OpenAICompatibleConfig struct {
	Name           string
	BaseURL        string
	CompletionPath string
	BearerToken    string
	ProxyURL       string
	Timeout        time.Duration
	Capabilities   Capabilities
	ExtraHeaders   map[string]string
}

type OpenAICompatibleProvider struct {
	name         string
	endpoint     string
	bearerToken  string
	extraHeaders map[string]string
	client       *http.Client
	capabilities Capabilities
}

func joinProviderEndpoint(baseURL, completionPath string) (string, error) {
	base, err := url.Parse(strings.TrimSpace(baseURL))
	if err != nil || base.Scheme == "" || base.Host == "" {
		return "", errors.New("AI provider base URL is invalid")
	}
	path := strings.TrimSpace(completionPath)
	if path == "" {
		path = "/v1/completions"
	}
	if !strings.HasPrefix(path, "/") {
		path = "/" + path
	}
	base.Path = strings.TrimRight(base.Path, "/") + path
	base.RawQuery = ""
	base.Fragment = ""
	return base.String(), nil
}

func NewOpenAICompatibleProvider(config OpenAICompatibleConfig) (*OpenAICompatibleProvider, error) {
	endpoint, err := joinProviderEndpoint(config.BaseURL, config.CompletionPath)
	if err != nil {
		return nil, err
	}
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.MaxIdleConns = 32
	transport.MaxIdleConnsPerHost = 16
	transport.IdleConnTimeout = 60 * time.Second
	transport.TLSHandshakeTimeout = 10 * time.Second
	if rawProxy := strings.TrimSpace(config.ProxyURL); rawProxy != "" {
		proxy, parseErr := url.Parse(rawProxy)
		if parseErr != nil || proxy.Scheme == "" || proxy.Host == "" {
			return nil, errors.New("AI provider proxy URL is invalid")
		}
		transport.Proxy = http.ProxyURL(proxy)
	}
	timeout := config.Timeout
	if timeout <= 0 || timeout > 120*time.Second {
		timeout = 120 * time.Second
	}
	// Non-streaming completions send headers only after the model finishes, so
	// header wait must cover the full provider timeout rather than a short SSE start.
	transport.ResponseHeaderTimeout = timeout
	return &OpenAICompatibleProvider{
		name: config.Name, endpoint: endpoint, bearerToken: strings.TrimSpace(config.BearerToken),
		extraHeaders: config.ExtraHeaders,
		client:       &http.Client{Transport: transport, Timeout: timeout}, capabilities: config.Capabilities,
	}, nil
}

func (p *OpenAICompatibleProvider) Name() string { return p.name }

func (p *OpenAICompatibleProvider) Capabilities(context.Context) (Capabilities, error) {
	return p.capabilities, nil
}

type openAIRequest struct {
	Model             string          `json:"model"`
	Models            []string        `json:"models,omitempty"`
	Route             string          `json:"route,omitempty"`
	Messages          []openAIMessage `json:"messages"`
	Tools             []openAITool    `json:"tools,omitempty"`
	ToolChoice        any             `json:"tool_choice,omitempty"`
	Temperature       *float64        `json:"temperature,omitempty"`
	TopP              *float64        `json:"top_p,omitempty"`
	MaxTokens         int             `json:"max_tokens,omitempty"`
	Stream            bool            `json:"stream"`
	ParallelToolCalls *bool           `json:"parallel_tool_calls,omitempty"`
}

type openAIMessage struct {
	Role       string           `json:"role"`
	Content    string           `json:"content,omitempty"`
	ToolCallID string           `json:"tool_call_id,omitempty"`
	ToolCalls  []openAIToolCall `json:"tool_calls,omitempty"`
}

type openAITool struct {
	Type     string         `json:"type"`
	Function openAIFunction `json:"function"`
}

type openAIFunction struct {
	Name        string         `json:"name"`
	Description string         `json:"description,omitempty"`
	Parameters  map[string]any `json:"parameters,omitempty"`
	Arguments   string         `json:"arguments,omitempty"`
}

type openAIToolCall struct {
	Index    int            `json:"index,omitempty"`
	ID       string         `json:"id,omitempty"`
	Type     string         `json:"type,omitempty"`
	Function openAIFunction `json:"function"`
}

type openAICompletion struct {
	ID      string `json:"id"`
	Choices []struct {
		Message struct {
			Content   string           `json:"content"`
			ToolCalls []openAIToolCall `json:"tool_calls"`
		} `json:"message"`
		FinishReason string `json:"finish_reason"`
	} `json:"choices"`
	Usage struct {
		PromptTokens     int `json:"prompt_tokens"`
		CompletionTokens int `json:"completion_tokens"`
		TotalTokens      int `json:"total_tokens"`
	} `json:"usage"`
}

func (p *OpenAICompatibleProvider) StreamChat(ctx context.Context, request ChatRequest, emit func(ChatEvent) error) (Usage, error) {
	payload := openAIRequest{Model: request.Model, Temperature: request.Temperature, TopP: request.TopP, MaxTokens: request.MaxOutputTokens, Stream: false}
	if len(request.FallbackModels) > 0 {
		payload.Models = append([]string{}, request.FallbackModels...)
		payload.Route = "fallback"
	}
	if len(request.Tools) > 0 {
		parallel := request.ParallelToolCalls
		payload.ParallelToolCalls = &parallel
	}
	for _, message := range request.Messages {
		converted := openAIMessage{Role: message.Role, Content: message.Content, ToolCallID: message.ToolCallID}
		for _, call := range message.ToolCalls {
			converted.ToolCalls = append(converted.ToolCalls, openAIToolCall{ID: call.ID, Type: "function", Function: openAIFunction{Name: call.Name, Arguments: string(call.Arguments)}})
		}
		payload.Messages = append(payload.Messages, converted)
	}
	for _, tool := range request.Tools {
		payload.Tools = append(payload.Tools, openAITool{Type: "function", Function: openAIFunction{Name: tool.Name, Description: tool.Description, Parameters: tool.InputSchema}})
	}
	if len(payload.Tools) > 0 {
		payload.ToolChoice = request.ToolChoice
		if payload.ToolChoice == nil || payload.ToolChoice == "" {
			payload.ToolChoice = "auto"
		}
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return Usage{}, fmt.Errorf("encode provider request: %w", err)
	}
	if len(body) > 1024*1024 {
		return Usage{}, &ProviderError{Category: "REQUEST_LIMIT", Message: "AI provider request exceeded the 1 MB safety limit."}
	}
	return p.complete(ctx, body, emit, true)
}

func (p *OpenAICompatibleProvider) complete(ctx context.Context, body []byte, emit func(ChatEvent) error, allowRetry bool) (Usage, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, p.endpoint, strings.NewReader(string(body)))
	if err != nil {
		return Usage{}, err
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+p.bearerToken)
	for key, value := range p.extraHeaders {
		if strings.TrimSpace(key) != "" && strings.TrimSpace(value) != "" {
			req.Header.Set(key, value)
		}
	}
	response, err := p.client.Do(req)
	if err != nil {
		category := "CONNECTION"
		var dnsErr *net.DNSError
		if errors.As(err, &dnsErr) {
			category = "DNS"
		}
		if errors.Is(err, context.DeadlineExceeded) {
			category = "TIMEOUT"
		}
		return Usage{}, &ProviderError{Category: category, Message: "AI provider could not be reached.", Retryable: true}
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		retryAfter := parseRetryAfter(response.Header.Get("Retry-After"))
		retryable := response.StatusCode == 429 || response.StatusCode == 502 || response.StatusCode == 503 || response.StatusCode == 504
		if allowRetry && retryable {
			wait := retryAfter
			if wait <= 0 || wait > 2*time.Second {
				wait = 250 * time.Millisecond
			}
			timer := time.NewTimer(wait)
			select {
			case <-ctx.Done():
				timer.Stop()
				return Usage{}, ctx.Err()
			case <-timer.C:
			}
			return p.complete(ctx, body, emit, false)
		}
		category := "PROVIDER_ERROR"
		if response.StatusCode == 401 {
			category = "AUTHENTICATION"
		}
		if response.StatusCode == 403 {
			category = "AUTHORIZATION"
		}
		if response.StatusCode == 429 {
			category = "RATE_LIMIT"
		}
		return Usage{}, &ProviderError{Category: category, StatusCode: response.StatusCode, RetryAfter: retryAfter, Message: "AI provider rejected the request.", Retryable: retryable}
	}
	return decodeCompletion(response, emit)
}

func parseRetryAfter(value string) time.Duration {
	if seconds, err := strconv.Atoi(strings.TrimSpace(value)); err == nil && seconds >= 0 {
		return time.Duration(seconds) * time.Second
	}
	if when, err := http.ParseTime(value); err == nil {
		return max(0, time.Until(when))
	}
	return 0
}
