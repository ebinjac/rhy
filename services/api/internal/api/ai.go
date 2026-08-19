package api

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"net/http"
	"strings"
	"time"

	copilot "github.com/rhythm-monitoring/rhythm/internal/ai"
	"github.com/rhythm-monitoring/rhythm/internal/authz"
	"github.com/rhythm-monitoring/rhythm/internal/suites"
)

const aiOwnerCookie = "rhythm_ai_owner"

func (s *server) aiAvailable(w http.ResponseWriter, r *http.Request) bool {
	if s.ai == nil {
		s.writeError(w, r, http.StatusServiceUnavailable, "AI_UNAVAILABLE", "Ask Rhythm requires persistent storage and encrypted credential support.", nil)
		return false
	}
	return true
}

func (s *server) aiOwner(w http.ResponseWriter, r *http.Request) string {
	if cookie, err := r.Cookie(aiOwnerCookie); err == nil && len(cookie.Value) >= 32 && len(cookie.Value) <= 128 {
		return copilot.HashOwner(cookie.Value)
	}
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return copilot.HashOwner(requestIDFromRequest(r))
	}
	token := base64.RawURLEncoding.EncodeToString(raw)
	secure := r.TLS != nil || strings.EqualFold(strings.TrimSpace(r.Header.Get("X-Forwarded-Proto")), "https")
	http.SetCookie(w, &http.Cookie{Name: aiOwnerCookie, Value: token, Path: "/", MaxAge: 30 * 24 * 60 * 60, HttpOnly: true, Secure: secure, SameSite: http.SameSiteLaxMode})
	return copilot.HashOwner(token)
}

func (s *server) getAISettings(w http.ResponseWriter, r *http.Request) {
	if !s.aiAvailable(w, r) {
		return
	}
	item, err := s.ai.GetSettings(r.Context())
	if err != nil {
		s.aiError(w, r, err, "Unable to load AI provider settings.")
		return
	}
	s.writeJSON(w, r, http.StatusOK, successResponse{Data: item, Meta: s.meta(r)})
}

func (s *server) saveAISettings(w http.ResponseWriter, r *http.Request) {
	if !s.aiAvailable(w, r) {
		return
	}
	var input copilot.SettingsInput
	if decodeStrictJSON(w, r, &input) != nil {
		s.writeError(w, r, http.StatusBadRequest, "INVALID_REQUEST", "AI provider settings are invalid.", nil)
		return
	}
	item, err := s.ai.SaveSettings(r.Context(), input, actor(r))
	if err != nil {
		s.aiError(w, r, err, "Unable to save AI provider settings.")
		return
	}
	s.writeJSON(w, r, http.StatusOK, successResponse{Data: item, Meta: s.meta(r)})
}

func (s *server) testAISettings(w http.ResponseWriter, r *http.Request) {
	if !s.aiAvailable(w, r) {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 120*time.Second)
	defer cancel()
	item, err := s.ai.Test(ctx)
	if errors.Is(err, copilot.ErrNotConfigured) {
		s.aiError(w, r, err, "AI provider settings are incomplete.")
		return
	}
	// Connectivity and capability failures are valid test results. Returning the
	// structured result lets the configuration UI show the provider's safe
	// remediation message without treating the test itself as an API failure.
	s.writeJSON(w, r, http.StatusOK, successResponse{Data: item, Meta: s.meta(r)})
}

func (s *server) getAICapabilities(w http.ResponseWriter, r *http.Request) {
	if !s.aiAvailable(w, r) {
		return
	}
	item, err := s.ai.Capabilities(r.Context())
	if err != nil {
		s.aiError(w, r, err, "AI provider capabilities are unavailable.")
		return
	}
	s.writeJSON(w, r, http.StatusOK, successResponse{Data: item, Meta: s.meta(r)})
}

func (s *server) listAIConversations(w http.ResponseWriter, r *http.Request) {
	if !s.aiAvailable(w, r) {
		return
	}
	items, err := s.ai.ListConversations(r.Context(), s.aiOwner(w, r))
	if err != nil {
		s.aiError(w, r, err, "Unable to list AI conversations.")
		return
	}
	s.writeJSON(w, r, http.StatusOK, successResponse{Data: items, Meta: s.meta(r)})
}

func (s *server) createAIConversation(w http.ResponseWriter, r *http.Request) {
	if !s.aiAvailable(w, r) {
		return
	}
	var input copilot.CreateConversationInput
	if r.ContentLength > 0 && decodeStrictJSON(w, r, &input) != nil {
		s.writeError(w, r, http.StatusBadRequest, "INVALID_REQUEST", "Conversation input is invalid.", nil)
		return
	}
	principal, _ := authz.PrincipalFromContext(r.Context())
	item, err := s.ai.CreateConversation(r.Context(), s.aiOwner(w, r), principal.ID, input)
	if err != nil {
		s.aiError(w, r, err, "Unable to create an AI conversation.")
		return
	}
	w.Header().Set("Location", "/api/v1/ai/conversations/"+item.ID)
	s.writeJSON(w, r, http.StatusCreated, successResponse{Data: item, Meta: s.meta(r)})
}

func (s *server) getAIConversation(w http.ResponseWriter, r *http.Request) {
	if !s.aiAvailable(w, r) {
		return
	}
	item, err := s.ai.GetConversation(r.Context(), s.aiOwner(w, r), r.PathValue("conversationId"))
	if err != nil {
		s.aiError(w, r, err, "Unable to load this AI conversation.")
		return
	}
	s.writeJSON(w, r, http.StatusOK, successResponse{Data: item, Meta: s.meta(r)})
}

func (s *server) updateAIConversation(w http.ResponseWriter, r *http.Request) {
	if !s.aiAvailable(w, r) {
		return
	}
	var input copilot.CreateConversationInput
	if decodeStrictJSON(w, r, &input) != nil {
		s.writeError(w, r, http.StatusBadRequest, "INVALID_REQUEST", "Conversation input is invalid.", nil)
		return
	}
	item, err := s.ai.UpdateConversation(r.Context(), s.aiOwner(w, r), r.PathValue("conversationId"), input)
	if err != nil {
		s.aiError(w, r, err, "Unable to update this AI conversation.")
		return
	}
	s.writeJSON(w, r, http.StatusOK, successResponse{Data: item, Meta: s.meta(r)})
}

func (s *server) deleteAIConversation(w http.ResponseWriter, r *http.Request) {
	if !s.aiAvailable(w, r) {
		return
	}
	if err := s.ai.DeleteConversation(r.Context(), s.aiOwner(w, r), r.PathValue("conversationId")); err != nil {
		s.aiError(w, r, err, "Unable to delete this AI conversation.")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *server) sendAIMessage(w http.ResponseWriter, r *http.Request) {
	if !s.aiAvailable(w, r) {
		return
	}
	var input copilot.MessageInput
	if decodeStrictJSON(w, r, &input) != nil {
		s.writeError(w, r, http.StatusBadRequest, "INVALID_REQUEST", "Message input is invalid.", nil)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 120*time.Second)
	defer cancel()
	owner := s.aiOwner(w, r)
	conversationID := r.PathValue("conversationId")
	type toolActivity struct {
		Name   string `json:"name"`
		Status string `json:"status"`
	}
	tools := []toolActivity{}
	toolIndex := map[string]int{}
	err := s.ai.StreamMessage(ctx, owner, conversationID, input, func(event copilot.StreamEnvelope) error {
		if event.ToolName == "" || (event.Type != "tool_started" && event.Type != "tool_completed") {
			return nil
		}
		status := "COMPLETE"
		if event.Type == "tool_started" {
			status = "RUNNING"
		}
		if index, ok := toolIndex[event.ToolName]; ok {
			tools[index].Status = status
			return nil
		}
		toolIndex[event.ToolName] = len(tools)
		tools = append(tools, toolActivity{Name: event.ToolName, Status: status})
		return nil
	})
	if err != nil {
		s.aiError(w, r, err, "Ask Rhythm could not complete this response. Your conversation was preserved.")
		return
	}
	item, err := s.ai.GetConversation(r.Context(), owner, conversationID)
	if err != nil {
		s.aiError(w, r, err, "Ask Rhythm completed, but the conversation could not be reloaded.")
		return
	}
	s.writeJSON(w, r, http.StatusOK, successResponse{Data: map[string]any{"conversation": item.Conversation, "messages": item.Messages, "tools": tools}, Meta: s.meta(r)})
}

func (s *server) getAIDeploymentReport(w http.ResponseWriter, r *http.Request) {
	if !s.aiAvailable(w, r) {
		return
	}
	runID := r.PathValue("deploymentRunId")
	if _, err := s.suites.GetDeploymentRun(r.Context(), runID); err != nil {
		s.writeError(w, r, http.StatusNotFound, "DEPLOYMENT_RUN_NOT_FOUND", "Deployment validation was not found.", nil)
		return
	}
	item, err := s.ai.GetDeploymentReport(r.Context(), runID)
	if err != nil {
		s.aiError(w, r, err, "No AI deployment report has been generated yet.")
		return
	}
	s.writeJSON(w, r, http.StatusOK, successResponse{Data: item, Meta: s.meta(r)})
}

func (s *server) generateAIDeploymentReport(w http.ResponseWriter, r *http.Request) {
	if !s.aiAvailable(w, r) {
		return
	}
	runID := r.PathValue("deploymentRunId")
	run, err := s.suites.GetDeploymentRun(r.Context(), runID)
	if err != nil {
		s.writeError(w, r, http.StatusNotFound, "DEPLOYMENT_RUN_NOT_FOUND", "Deployment validation was not found.", nil)
		return
	}
	if run.Status != "COMPLETED" && run.Status != "FAILED" {
		s.writeError(w, r, http.StatusConflict, "DEPLOYMENT_RUN_NOT_COMPLETE", "Generate an AI report after deployment validation finishes.", nil)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 120*time.Second)
	defer cancel()
	item, err := s.ai.GenerateDeploymentReport(ctx, run.ID, actor(r), suites.BuildDeploymentReportFacts(run))
	if err != nil {
		s.aiError(w, r, err, "Ask Rhythm could not generate this deployment report.")
		return
	}
	s.writeJSON(w, r, http.StatusOK, successResponse{Data: item, Meta: s.meta(r)})
}

func (s *server) saveAIMessageFeedback(w http.ResponseWriter, r *http.Request) {
	if !s.aiAvailable(w, r) {
		return
	}
	var input struct {
		Rating  string `json:"rating"`
		Comment string `json:"comment"`
	}
	if decodeStrictJSON(w, r, &input) != nil {
		s.writeError(w, r, http.StatusBadRequest, "INVALID_REQUEST", "Feedback input is invalid.", nil)
		return
	}
	if err := s.ai.Feedback(r.Context(), s.aiOwner(w, r), r.PathValue("messageId"), copilot.FeedbackInput{Rating: input.Rating, Comment: input.Comment}); err != nil {
		s.aiError(w, r, err, "Unable to save message feedback.")
		return
	}
	s.writeJSON(w, r, http.StatusOK, successResponse{Data: map[string]bool{"saved": true}, Meta: s.meta(r)})
}

func (s *server) aiError(w http.ResponseWriter, r *http.Request, err error, message string) {
	status := http.StatusInternalServerError
	code := "AI_REQUEST_FAILED"
	safe := message
	if errors.Is(err, copilot.ErrNotConfigured) {
		status = http.StatusPreconditionRequired
		code = "AI_NOT_CONFIGURED"
		safe = "Configure and test an AI provider before using Ask Rhythm."
	} else if errors.Is(err, copilot.ErrNotFound) {
		status = http.StatusNotFound
		code = "AI_NOT_FOUND"
	} else if errors.Is(err, copilot.ErrForbidden) {
		status = http.StatusForbidden
		code = "AI_FORBIDDEN"
		safe = "This AI conversation belongs to another browser session."
	} else if errors.Is(err, copilot.ErrBudget) {
		status = http.StatusTooManyRequests
		code = "AI_BUDGET_REACHED"
		safe = "The configured daily AI request budget has been reached."
	} else if errors.Is(err, context.Canceled) {
		status = http.StatusBadRequest
		code = "AI_CANCELLED"
		safe = "Generation was cancelled."
	} else if errors.Is(err, context.DeadlineExceeded) {
		status = http.StatusGatewayTimeout
		code = "AI_TIMEOUT"
		safe = "Ask Rhythm did not complete within 120 seconds."
	} else {
		var providerErr *copilot.ProviderError
		if errors.As(err, &providerErr) {
			status = http.StatusBadGateway
			code = "AI_PROVIDER_" + providerErr.Category
			safe = providerErr.Message
			if providerErr.Category == "AUTHENTICATION" {
				status = http.StatusUnauthorized
			} else if providerErr.Category == "AUTHORIZATION" {
				status = http.StatusForbidden
			} else if providerErr.Category == "RATE_LIMIT" {
				status = http.StatusTooManyRequests
			} else if providerErr.Category == "REQUEST_LIMIT" {
				status = http.StatusRequestEntityTooLarge
			}
		} else if strings.Contains(strings.ToLower(err.Error()), "required") || strings.Contains(strings.ToLower(err.Error()), "must") || strings.Contains(strings.ToLower(err.Error()), "invalid") {
			status = http.StatusUnprocessableEntity
			code = "AI_VALIDATION_FAILED"
			safe = err.Error()
		}
	}
	s.writeError(w, r, status, code, safe, nil)
}
