package api

import (
	"context"
	"net/http"
)

func contextWithRequestID(r *http.Request, requestID string) context.Context {
	return context.WithValue(r.Context(), requestIDContextKey{}, requestID)
}

func requestIDFromRequest(r *http.Request) string {
	requestID, _ := r.Context().Value(requestIDContextKey{}).(string)
	if requestID == "" {
		return r.Header.Get("X-Request-ID")
	}
	return requestID
}
