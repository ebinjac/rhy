package lab

import (
	"net/http"
	"strings"
	"time"
)

func (s *Server) cookieSet(w http.ResponseWriter, r *http.Request) {
	name := strings.TrimSpace(r.URL.Query().Get("name"))
	if name == "" {
		name = "theme"
	}
	value := r.URL.Query().Get("value")
	if value == "" {
		value = "dark"
	}
	http.SetCookie(w, &http.Cookie{Name: name, Value: value, Path: "/", SameSite: http.SameSiteLaxMode})
	writeJSON(w, http.StatusOK, map[string]any{"set": name})
}
func (s *Server) cookieRead(w http.ResponseWriter, r *http.Request) {
	cookies := map[string]string{}
	for _, cookie := range r.Cookies() {
		cookies[cookie.Name] = cookie.Value
	}
	writeJSON(w, http.StatusOK, map[string]any{"cookies": cookies})
}
func (s *Server) cookieDelete(w http.ResponseWriter, r *http.Request) {
	name := r.URL.Query().Get("name")
	if name == "" {
		name = "theme"
	}
	http.SetCookie(w, &http.Cookie{Name: name, Value: "", Path: "/", MaxAge: -1, Expires: time.Unix(1, 0)})
	writeJSON(w, http.StatusOK, map[string]any{"deleted": name})
}
func (s *Server) cookieAttributes(w http.ResponseWriter, r *http.Request) {
	secure := r.TLS != nil
	http.SetCookie(w, &http.Cookie{Name: "lax_cookie", Value: "lax", Path: "/", HttpOnly: true, Secure: secure, SameSite: http.SameSiteLaxMode, MaxAge: 300})
	http.SetCookie(w, &http.Cookie{Name: "strict_cookie", Value: "strict", Path: "/cookies", SameSite: http.SameSiteStrictMode, MaxAge: 300})
	http.SetCookie(w, &http.Cookie{Name: "none_cookie", Value: "none", Path: "/", Secure: true, SameSite: http.SameSiteNoneMode, Expires: time.Now().Add(5 * time.Minute)})
	writeJSON(w, http.StatusOK, map[string]any{"cookiesSet": 3, "secure": secure})
}
func (s *Server) cookieSessionStart(w http.ResponseWriter, r *http.Request) {
	s.startSession(w, r, "rhythm")
}
func (s *Server) cookieLogin(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if err := readJSON(r, s.cfg.MaxBodyBytes, &input); err != nil || !constantEqual(input.Username, basicUser) || !constantEqual(input.Password, basicPassword) {
		s.fail(w, r, http.StatusUnauthorized, "INVALID_CREDENTIALS", "Session credentials are invalid")
		return
	}
	s.startSession(w, r, input.Username)
}
func (s *Server) startSession(w http.ResponseWriter, r *http.Request, user string) {
	session := s.state.ID("session")
	s.state.mu.Lock()
	s.state.sessions[session] = tokenRecord{Subject: user, ExpiresAt: time.Now().Add(15 * time.Minute)}
	s.state.mu.Unlock()
	http.SetCookie(w, &http.Cookie{Name: "rhythm_session", Value: session, Path: "/", HttpOnly: true, Secure: r.TLS != nil, SameSite: http.SameSiteLaxMode, MaxAge: 900})
	writeJSON(w, http.StatusOK, map[string]any{"authenticated": true, "username": user})
}
func (s *Server) cookieProfile(w http.ResponseWriter, r *http.Request) {
	cookie, err := r.Cookie("rhythm_session")
	if err != nil {
		s.fail(w, r, http.StatusUnauthorized, "SESSION_REQUIRED", "Session cookie is required")
		return
	}
	s.state.mu.Lock()
	record, ok := s.state.sessions[cookie.Value]
	s.state.mu.Unlock()
	if !ok || time.Now().After(record.ExpiresAt) {
		s.fail(w, r, http.StatusUnauthorized, "SESSION_REQUIRED", "Session is invalid or expired")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"authenticated": true, "username": record.Subject, "profile": map[string]any{"displayName": "Rhythm Test User", "role": "tester"}})
}
func (s *Server) cookieLogout(w http.ResponseWriter, r *http.Request) {
	if cookie, err := r.Cookie("rhythm_session"); err == nil {
		s.state.mu.Lock()
		delete(s.state.sessions, cookie.Value)
		s.state.mu.Unlock()
	}
	http.SetCookie(w, &http.Cookie{Name: "rhythm_session", Value: "", Path: "/", HttpOnly: true, MaxAge: -1, Expires: time.Unix(1, 0)})
	writeJSON(w, http.StatusOK, map[string]any{"loggedOut": true})
}
