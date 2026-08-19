package ai

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
)

const maxProviderResponseBytes = 1024 * 1024

func decodeCompletion(response *http.Response, emit func(ChatEvent) error) (Usage, error) {
	limited := io.LimitReader(response.Body, maxProviderResponseBytes+1)
	raw, err := io.ReadAll(limited)
	if err != nil {
		return Usage{}, &ProviderError{Category: "CONNECTION", Message: "AI provider response could not be read.", Retryable: true}
	}
	if len(raw) > maxProviderResponseBytes {
		return Usage{}, &ProviderError{Category: "RESPONSE_LIMIT", Message: "AI provider response exceeded the safe size limit."}
	}
	var completion openAICompletion
	if err := json.Unmarshal(raw, &completion); err != nil {
		return Usage{}, &ProviderError{Category: "MALFORMED_RESPONSE", Message: "AI provider returned an invalid chat completion."}
	}
	usage := Usage{
		PromptTokens:     completion.Usage.PromptTokens,
		CompletionTokens: completion.Usage.CompletionTokens,
		TotalTokens:      completion.Usage.TotalTokens,
	}
	requestID := completion.ID
	for _, choice := range completion.Choices {
		if choice.Message.Content != "" {
			if emitErr := emit(ChatEvent{Type: "text_delta", Text: choice.Message.Content, RequestID: requestID}); emitErr != nil {
				return usage, emitErr
			}
		}
		for _, fragment := range choice.Message.ToolCalls {
			arguments := json.RawMessage(fragment.Function.Arguments)
			if len(arguments) == 0 {
				arguments = json.RawMessage(`{}`)
			}
			if !json.Valid(arguments) {
				return usage, fmt.Errorf("provider returned invalid tool arguments")
			}
			call := ToolCall{ID: fragment.ID, Name: fragment.Function.Name, Arguments: arguments}
			if emitErr := emit(ChatEvent{Type: "tool_call", ToolCall: &call, RequestID: requestID}); emitErr != nil {
				return usage, emitErr
			}
		}
		if choice.FinishReason != "" {
			if emitErr := emit(ChatEvent{Type: "status", FinishReason: choice.FinishReason, RequestID: requestID}); emitErr != nil {
				return usage, emitErr
			}
		}
	}
	return usage, nil
}
