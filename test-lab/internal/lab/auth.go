package lab

import (
	"crypto"
	"crypto/hmac"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/subtle"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"
)

const (
	basicUser       = "rhythm"
	basicPassword   = "rhythm-test"
	bearerToken     = "rhythm-test-token"
	apiKey          = "rhythm-api-key"
	hmacClient      = "rhythm-client"
	hmacSecret      = "rhythm-hmac-secret"
	macKey          = "rhythm-mac-key"
	macSecret       = "rhythm-mac-secret"
	appClient       = "rhythm-app-client"
	appSecretBase64 = "cmh5dGhtLWFwcC1zZWNyZXQ="
	jwtSecret       = "rhythm-jwt-secret"
	jwtIssuer       = "rhythm-test-lab"
	jwtAudience     = "rhythm"
	jwtSubject      = "rhythm-test-user"
)

func constantEqual(a, b string) bool {
	return len(a) == len(b) && subtle.ConstantTimeCompare([]byte(a), []byte(b)) == 1
}
func (s *Server) basicAuth(w http.ResponseWriter, r *http.Request) {
	user, password, ok := r.BasicAuth()
	if !ok || !constantEqual(user, basicUser) || !constantEqual(password, basicPassword) {
		w.Header().Set("WWW-Authenticate", `Basic realm="Rhythm Test Lab"`)
		s.fail(w, r, http.StatusUnauthorized, "INVALID_CREDENTIALS", "Basic credentials are invalid")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"authenticated": true, "type": "basic", "username": user})
}
func (s *Server) bearerAuth(w http.ResponseWriter, r *http.Request) {
	if !constantEqual(strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer "), bearerToken) {
		s.fail(w, r, http.StatusUnauthorized, "INVALID_TOKEN", "Bearer token is invalid")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"authenticated": true, "type": "bearer"})
}
func (s *Server) apiKeyAuth(w http.ResponseWriter, r *http.Request) {
	if !constantEqual(r.Header.Get("X-API-Key"), apiKey) {
		s.fail(w, r, http.StatusUnauthorized, "INVALID_CREDENTIALS", "API key is invalid")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"authenticated": true, "type": "api-key", "location": "header"})
}
func (s *Server) apiKeyQueryAuth(w http.ResponseWriter, r *http.Request) {
	if !constantEqual(r.URL.Query().Get("api_key"), apiKey) {
		s.fail(w, r, http.StatusUnauthorized, "INVALID_CREDENTIALS", "API key is invalid")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"authenticated": true, "type": "api-key", "location": "query"})
}

func (s *Server) validateTimestamp(raw string) (bool, string) {
	milliseconds, err := strconv.ParseInt(raw, 10, 64)
	if err != nil {
		return false, "INVALID_TIMESTAMP"
	}
	timestamp := time.UnixMilli(milliseconds)
	delta := time.Since(timestamp)
	if delta > s.cfg.SignatureWindow {
		return false, "TIMESTAMP_EXPIRED"
	}
	if delta < -s.cfg.SignatureWindow {
		return false, "TIMESTAMP_IN_FUTURE"
	}
	return true, ""
}
func hmacBase64(input, secret string) string {
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(input))
	return base64.StdEncoding.EncodeToString(mac.Sum(nil))
}
func (s *Server) hmacAuth(w http.ResponseWriter, r *http.Request) {
	client, timestamp, provided := r.Header.Get("X-Client-ID"), r.Header.Get("X-Timestamp"), r.Header.Get("X-Signature")
	timestampValid, timeCode := s.validateTimestamp(timestamp)
	clientValid := constantEqual(client, hmacClient)
	expected := hmacBase64(client+"-"+timestamp, hmacSecret)
	signatureValid := constantEqual(provided, expected)
	result := map[string]any{"authenticated": clientValid && timestampValid && signatureValid, "algorithm": "HMAC-SHA256", "clientIdValid": clientValid, "timestampValid": timestampValid, "signatureValid": signatureValid}
	if !timestampValid {
		s.fail(w, r, http.StatusUnauthorized, timeCode, "Timestamp is outside the accepted window")
		return
	}
	if !clientValid || !signatureValid {
		writeJSON(w, http.StatusUnauthorized, result)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

var macPair = regexp.MustCompile(`([a-z]+)="([^"]*)"`)

func parseMAC(value string) map[string]string {
	out := map[string]string{}
	if !strings.HasPrefix(value, "MAC ") {
		return out
	}
	for _, pair := range macPair.FindAllStringSubmatch(strings.TrimPrefix(value, "MAC "), -1) {
		out[pair[1]] = pair[2]
	}
	return out
}
func (s *Server) macAuth(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(io.LimitReader(r.Body, s.cfg.MaxBodyBytes))
	if err != nil {
		s.fail(w, r, http.StatusBadRequest, "INVALID_BODY", "Request body could not be read")
		return
	}
	fields := parseMAC(r.Header.Get("Authorization"))
	keyValid := constantEqual(fields["id"], macKey)
	timestampValid, timeCode := s.validateTimestamp(fields["ts"])
	nonceValid := len(fields["nonce"]) >= 8 && len(fields["nonce"]) <= 128
	bodyHash := hmacBase64(string(body), macSecret)
	bodyValid := constantEqual(fields["bodyhash"], bodyHash)
	host, port := requestHostPort(r)
	resource := r.URL.EscapedPath()
	if r.URL.RawQuery != "" {
		resource += "?" + r.URL.RawQuery
	}
	canonical := fields["ts"] + "\n" + fields["nonce"] + "\n" + r.Method + "\n" + resource + "\n" + host + "\n" + port + "\n" + bodyHash + "\n"
	expected := hmacBase64(canonical, macSecret)
	macValid := constantEqual(fields["mac"], expected)
	result := map[string]any{"authenticated": keyValid && timestampValid && nonceValid && bodyValid && macValid, "algorithm": "MAC-HMAC-SHA256", "keyValid": keyValid, "timestampValid": timestampValid, "nonceValid": nonceValid, "bodyHashValid": bodyValid, "macValid": macValid}
	if !timestampValid {
		s.fail(w, r, http.StatusUnauthorized, timeCode, "Timestamp is outside the accepted window")
		return
	}
	if !keyValid || !nonceValid || !bodyValid || !macValid {
		writeJSON(w, http.StatusUnauthorized, result)
		return
	}
	if s.cfg.MACReplayProtection {
		s.state.mu.Lock()
		replayKey := fields["id"] + ":" + fields["nonce"]
		seen := s.state.nonces[replayKey]
		if seen.IsZero() || time.Since(seen) > s.cfg.ReplayWindow {
			s.state.nonces[replayKey] = time.Now()
			seen = time.Time{}
		}
		s.state.mu.Unlock()
		if !seen.IsZero() {
			s.fail(w, r, http.StatusConflict, "MAC_NONCE_REPLAY", "MAC nonce has already been used")
			return
		}
	}
	writeJSON(w, http.StatusOK, result)
}

func appSignature(client, version, timestamp string) string {
	secret, _ := base64.StdEncoding.DecodeString(appSecretBase64)
	mac := hmac.New(sha256.New, secret)
	_, _ = mac.Write([]byte(client + "-" + version + "-" + timestamp))
	return base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}
func (s *Server) applicationToken(w http.ResponseWriter, r *http.Request) {
	client, version, timestamp, signature := r.Header.Get("X-Auth-AppID"), r.Header.Get("X-Auth-Version"), r.Header.Get("X-Auth-Timestamp"), r.Header.Get("X-Auth-Signature")
	validTime, code := s.validateTimestamp(timestamp)
	if !validTime {
		s.fail(w, r, http.StatusUnauthorized, code, "Authentication timestamp is invalid")
		return
	}
	if !constantEqual(client, appClient) || version != "2" || !constantEqual(signature, appSignature(client, version, timestamp)) {
		s.fail(w, r, http.StatusUnauthorized, "INVALID_SIGNATURE", "Application signature validation failed")
		return
	}
	var body struct {
		Scope []string `json:"scope"`
	}
	if err := readJSON(r, s.cfg.MaxBodyBytes, &body); err != nil || len(body.Scope) == 0 {
		s.fail(w, r, http.StatusUnprocessableEntity, "INVALID_BODY", "scope is required")
		return
	}
	expires := clamp(parseInt(r.URL.Query().Get("expiresIn"), int(s.cfg.TokenExpiry.Seconds())), 1, 3600)
	token := s.state.ID("token")
	s.state.mu.Lock()
	s.state.tokens[token] = tokenRecord{ExpiresAt: time.Now().Add(time.Duration(expires) * time.Second), Subject: client}
	s.state.mu.Unlock()
	writeJSON(w, http.StatusOK, map[string]any{"authorization_token": token, "token_type": "Bearer", "expires_in": expires})
}
func (s *Server) protectedKeysets(w http.ResponseWriter, r *http.Request) {
	token := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
	s.state.mu.Lock()
	record, ok := s.state.tokens[token]
	s.state.mu.Unlock()
	if !ok {
		s.fail(w, r, http.StatusUnauthorized, "INVALID_TOKEN", "Token is invalid")
		return
	}
	if time.Now().After(record.ExpiresAt) {
		s.fail(w, r, http.StatusUnauthorized, "TOKEN_EXPIRED", "Token has expired")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"keysets": []map[string]any{{"name": "TEST_KEYSET_01", "status": "ACTIVE"}, {"name": "TEST_KEYSET_02", "status": "ACTIVE"}}})
}

func encodeSegment(value any) string {
	encoded, _ := json.Marshal(value)
	return base64.RawURLEncoding.EncodeToString(encoded)
}
func (s *Server) jwtToken(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Algorithm string `json:"algorithm"`
		Issuer    string `json:"issuer"`
		Audience  string `json:"audience"`
		Subject   string `json:"subject"`
		ExpiresIn int    `json:"expiresIn"`
		NotBefore int    `json:"notBefore"`
	}
	_ = readJSON(r, s.cfg.MaxBodyBytes, &input)
	alg := strings.ToUpper(input.Algorithm)
	if alg == "" {
		alg = "HS256"
	}
	if alg != "HS256" && alg != "RS256" {
		s.fail(w, r, http.StatusUnprocessableEntity, "INVALID_ALGORITHM", "algorithm must be HS256 or RS256")
		return
	}
	if input.Issuer == "" {
		input.Issuer = jwtIssuer
	}
	if input.Audience == "" {
		input.Audience = jwtAudience
	}
	if input.Subject == "" {
		input.Subject = jwtSubject
	}
	if input.ExpiresIn == 0 {
		input.ExpiresIn = 300
	}
	now := time.Now().Unix()
	header := encodeSegment(map[string]any{"alg": alg, "typ": "JWT"})
	payload := encodeSegment(map[string]any{"iss": input.Issuer, "aud": input.Audience, "sub": input.Subject, "iat": now, "nbf": now + int64(input.NotBefore), "exp": now + int64(clamp(input.ExpiresIn, 1, 3600)), "jti": s.state.ID("jwt")})
	signing := header + "." + payload
	var signature []byte
	if alg == "HS256" {
		mac := hmac.New(sha256.New, []byte(jwtSecret))
		_, _ = mac.Write([]byte(signing))
		signature = mac.Sum(nil)
	} else {
		digest := sha256.Sum256([]byte(signing))
		signature, _ = rsa.SignPKCS1v15(rand.Reader, s.jwtKey, crypto.SHA256, digest[:])
	}
	token := signing + "." + base64.RawURLEncoding.EncodeToString(signature)
	writeJSON(w, http.StatusOK, map[string]any{"token": token, "token_type": "Bearer", "algorithm": alg, "expires_in": clamp(input.ExpiresIn, 1, 3600)})
}
func (s *Server) jwtProtected(w http.ResponseWriter, r *http.Request) {
	token := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
	claims, code := s.verifyJWT(token)
	if code != "" {
		s.fail(w, r, http.StatusUnauthorized, code, "JWT validation failed")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"authenticated": true, "type": "jwt", "claims": claims})
}
func (s *Server) verifyJWT(token string) (map[string]any, string) {
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return nil, "INVALID_TOKEN"
	}
	headerBytes, e1 := base64.RawURLEncoding.DecodeString(parts[0])
	payloadBytes, e2 := base64.RawURLEncoding.DecodeString(parts[1])
	sig, e3 := base64.RawURLEncoding.DecodeString(parts[2])
	if e1 != nil || e2 != nil || e3 != nil {
		return nil, "INVALID_TOKEN"
	}
	var header, claims map[string]any
	if json.Unmarshal(headerBytes, &header) != nil || json.Unmarshal(payloadBytes, &claims) != nil {
		return nil, "INVALID_TOKEN"
	}
	signing := parts[0] + "." + parts[1]
	alg, _ := header["alg"].(string)
	valid := false
	if alg == "HS256" {
		mac := hmac.New(sha256.New, []byte(jwtSecret))
		_, _ = mac.Write([]byte(signing))
		valid = hmac.Equal(sig, mac.Sum(nil))
	} else if alg == "RS256" {
		digest := sha256.Sum256([]byte(signing))
		valid = rsa.VerifyPKCS1v15(&s.jwtKey.PublicKey, crypto.SHA256, digest[:], sig) == nil
	}
	if !valid {
		return nil, "INVALID_SIGNATURE"
	}
	now := float64(time.Now().Unix())
	if exp, ok := claims["exp"].(float64); !ok || now >= exp {
		return nil, "TOKEN_EXPIRED"
	}
	if nbf, ok := claims["nbf"].(float64); ok && now < nbf {
		return nil, "TOKEN_NOT_ACTIVE"
	}
	if claims["iss"] != jwtIssuer {
		return nil, "INVALID_ISSUER"
	}
	if claims["aud"] != jwtAudience {
		return nil, "INVALID_AUDIENCE"
	}
	if claims["sub"] != jwtSubject {
		return nil, "INVALID_SUBJECT"
	}
	return claims, ""
}
func (s *Server) jwtPublicKey(w http.ResponseWriter, r *http.Request) {
	der, _ := x509.MarshalPKIXPublicKey(&s.jwtKey.PublicKey)
	writeJSON(w, http.StatusOK, map[string]any{"algorithm": "RS256", "publicKey": string(pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: der}))})
}

func BasicCredentials() (string, string)       { return basicUser, basicPassword }
func BearerCredential() string                 { return bearerToken }
func APIKeyCredential() string                 { return apiKey }
func HMACCredentials() (string, string)        { return hmacClient, hmacSecret }
func MACCredentials() (string, string)         { return macKey, macSecret }
func ApplicationCredentials() (string, string) { return appClient, appSecretBase64 }
func MACSignature(method, rawURL, body, timestamp, nonce, key, secret string) (string, error) {
	parsed, err := http.NewRequest(method, rawURL, strings.NewReader(body))
	if err != nil {
		return "", err
	}
	host, port := requestHostPort(parsed)
	resource := parsed.URL.EscapedPath()
	if parsed.URL.RawQuery != "" {
		resource += "?" + parsed.URL.RawQuery
	}
	bodyHash := hmacBase64(body, secret)
	canonical := timestamp + "\n" + nonce + "\n" + method + "\n" + resource + "\n" + host + "\n" + port + "\n" + bodyHash + "\n"
	return fmt.Sprintf(`MAC id="%s",ts="%s",nonce="%s",bodyhash="%s",mac="%s"`, key, timestamp, nonce, bodyHash, hmacBase64(canonical, secret)), nil
}
