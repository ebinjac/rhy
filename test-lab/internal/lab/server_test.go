package lab

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"os"
	"strconv"
	"strings"
	"testing"
	"time"
)

func testServer(t *testing.T) (*Server, *httptest.Server) {
	t.Helper()
	cfg := DefaultConfig()
	cfg.CertDir = t.TempDir()
	cfg.EnableHTTPS = false
	cfg.EnableMTLS = false
	cfg.EnableProxy = false
	cfg.Deterministic = true
	server, err := New(cfg)
	if err != nil {
		t.Fatal(err)
	}
	httpServer := httptest.NewServer(server.Handler())
	t.Cleanup(httpServer.Close)
	return server, httpServer
}
func decode(t *testing.T, response *http.Response) map[string]any {
	t.Helper()
	defer response.Body.Close()
	var body map[string]any
	if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	return body
}
func request(t *testing.T, client *http.Client, method, url string, body io.Reader, headers map[string]string) *http.Response {
	t.Helper()
	req, err := http.NewRequest(method, url, body)
	if err != nil {
		t.Fatal(err)
	}
	for key, value := range headers {
		req.Header.Set(key, value)
	}
	response, err := client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	return response
}

func TestHealthEchoAndHTTPScenarios(t *testing.T) {
	_, server := testServer(t)
	client := server.Client()
	t.Run("health", func(t *testing.T) {
		response := request(t, client, "GET", server.URL+"/health", nil, nil)
		if response.StatusCode != 200 || decode(t, response)["status"] != "healthy" {
			t.Fatal("health failed")
		}
	})
	t.Run("echo masks credentials", func(t *testing.T) {
		response := request(t, client, "POST", server.URL+"/api/echo?tag=a&tag=b", strings.NewReader(`{"hello":"world"}`), map[string]string{"Authorization": "Bearer private", "X-Custom": "visible"})
		body := decode(t, response)
		headers := body["headers"].(map[string]any)
		if !strings.Contains(strings.Join(anyStrings(headers["Authorization"]), ""), "REDACTED") || body["body"] != `{"hello":"world"}` {
			t.Fatalf("unexpected echo %#v", body)
		}
	})
	t.Run("query repeats", func(t *testing.T) {
		body := decode(t, request(t, client, "GET", server.URL+"/api/query?tag=a&tag=b", nil, nil))
		query := body["query"].(map[string]any)
		if len(query["tag"].([]any)) != 2 {
			t.Fatalf("unexpected query %#v", query)
		}
	})
	t.Run("status and redirect", func(t *testing.T) {
		if response := request(t, client, "GET", server.URL+"/status/422", nil, nil); response.StatusCode != 422 {
			t.Fatal(response.StatusCode)
		}
		response := request(t, client, "GET", server.URL+"/redirect/3", nil, nil)
		if response.StatusCode != 200 || !decode(t, response)["final"].(bool) {
			t.Fatal("redirect failed")
		}
	})
	t.Run("delay", func(t *testing.T) {
		started := time.Now()
		response := request(t, client, "GET", server.URL+"/delay-ms/20", nil, nil)
		response.Body.Close()
		if time.Since(started) < 15*time.Millisecond {
			t.Fatal("delay was not applied")
		}
	})
	t.Run("malformed JSON and XML", func(t *testing.T) {
		response := request(t, client, "GET", server.URL+"/response/malformed-json", nil, nil)
		payload, _ := io.ReadAll(response.Body)
		response.Body.Close()
		if json.Valid(payload) {
			t.Fatal("malformed JSON became valid")
		}
		response = request(t, client, "GET", server.URL+"/response/xml", nil, nil)
		payload, _ = io.ReadAll(response.Body)
		response.Body.Close()
		if !bytes.Contains(payload, []byte("xml-test-token")) {
			t.Fatal("XML fixture missing")
		}
	})
}

func TestAuthenticationScenarios(t *testing.T) {
	_, server := testServer(t)
	client := server.Client()
	t.Run("basic", func(t *testing.T) {
		req, _ := http.NewRequest("GET", server.URL+"/auth/basic", nil)
		req.SetBasicAuth(basicUser, basicPassword)
		response, err := client.Do(req)
		if err != nil || response.StatusCode != 200 {
			t.Fatalf("basic failed %v", err)
		}
		response.Body.Close()
	})
	t.Run("bearer and API key", func(t *testing.T) {
		for path, header := range map[string]map[string]string{"/auth/bearer": {"Authorization": "Bearer " + bearerToken}, "/auth/api-key": {"X-API-Key": apiKey}} {
			response := request(t, client, "GET", server.URL+path, nil, header)
			if response.StatusCode != 200 {
				t.Fatalf("%s failed", path)
			}
			response.Body.Close()
		}
	})
	t.Run("HMAC valid invalid and expired", func(t *testing.T) {
		timestamp := strconv.FormatInt(time.Now().UnixMilli(), 10)
		signature := hmacBase64(hmacClient+"-"+timestamp, hmacSecret)
		valid := request(t, client, "POST", server.URL+"/auth/hmac", nil, map[string]string{"X-Client-ID": hmacClient, "X-Timestamp": timestamp, "X-Signature": signature})
		if valid.StatusCode != 200 {
			t.Fatalf("valid HMAC: %#v", decode(t, valid))
		}
		invalid := request(t, client, "POST", server.URL+"/auth/hmac", nil, map[string]string{"X-Client-ID": hmacClient, "X-Timestamp": timestamp, "X-Signature": "bad"})
		if invalid.StatusCode != 401 {
			t.Fatal("invalid HMAC accepted")
		}
		invalid.Body.Close()
		expiredTimestamp := strconv.FormatInt(time.Now().Add(-10*time.Minute).UnixMilli(), 10)
		expired := request(t, client, "POST", server.URL+"/auth/hmac", nil, map[string]string{"X-Client-ID": hmacClient, "X-Timestamp": expiredTimestamp, "X-Signature": hmacBase64(hmacClient+"-"+expiredTimestamp, hmacSecret)})
		if expired.StatusCode != 401 || nestedCode(decode(t, expired)) != "TIMESTAMP_EXPIRED" {
			t.Fatal("expired HMAC accepted")
		}
	})
	t.Run("MAC valid and tampered", func(t *testing.T) {
		timestamp := strconv.FormatInt(time.Now().UnixMilli(), 10)
		url := server.URL + "/auth/mac?case=golden"
		signature, err := MACSignature("POST", url, `{"amount":10}`, timestamp, "nonce-0123456789", macKey, macSecret)
		if err != nil {
			t.Fatal(err)
		}
		valid := request(t, client, "POST", url, strings.NewReader(`{"amount":10}`), map[string]string{"Authorization": signature})
		if valid.StatusCode != 200 {
			t.Fatalf("valid MAC: %#v", decode(t, valid))
		}
		tampered := request(t, client, "POST", url, strings.NewReader(`{"amount":11}`), map[string]string{"Authorization": signature})
		if tampered.StatusCode != 401 {
			t.Fatal("tampered body accepted")
		}
		tampered.Body.Close()
		replay := request(t, client, "POST", url, strings.NewReader(`{"amount":10}`), map[string]string{"Authorization": signature})
		if replay.StatusCode != http.StatusConflict || nestedCode(decode(t, replay)) != "MAC_NONCE_REPLAY" {
			t.Fatal("replayed MAC nonce accepted")
		}
	})
}

func TestTokenChainJWTAndCookies(t *testing.T) {
	_, server := testServer(t)
	client := server.Client()
	t.Run("application token chain", func(t *testing.T) {
		timestamp := strconv.FormatInt(time.Now().UnixMilli(), 10)
		response := request(t, client, "POST", server.URL+"/auth/application-token?expiresIn=5", strings.NewReader(`{"scope":["*"]}`), map[string]string{"Content-Type": "application/json", "X-Auth-AppID": appClient, "X-Auth-Version": "2", "X-Auth-Timestamp": timestamp, "X-Auth-Signature": appSignature(appClient, "2", timestamp)})
		if response.StatusCode != 200 {
			t.Fatalf("token failed %#v", decode(t, response))
		}
		token := decode(t, response)["authorization_token"].(string)
		protected := request(t, client, "GET", server.URL+"/protected/keysets", nil, map[string]string{"Authorization": "Bearer " + token})
		if protected.StatusCode != 200 {
			t.Fatal("protected endpoint rejected token")
		}
		protected.Body.Close()
	})
	t.Run("JWT HS256 and RS256", func(t *testing.T) {
		for _, algorithm := range []string{"HS256", "RS256"} {
			tokenResponse := request(t, client, "POST", server.URL+"/auth/jwt/token", strings.NewReader(`{"algorithm":"`+algorithm+`"}`), map[string]string{"Content-Type": "application/json"})
			if tokenResponse.StatusCode != 200 {
				t.Fatalf("JWT %s issue failed", algorithm)
			}
			token := decode(t, tokenResponse)["token"].(string)
			verified := request(t, client, "GET", server.URL+"/auth/jwt/protected", nil, map[string]string{"Authorization": "Bearer " + token})
			if verified.StatusCode != 200 {
				t.Fatalf("JWT %s verification failed %#v", algorithm, decode(t, verified))
			}
			verified.Body.Close()
		}
	})
	t.Run("cookie session", func(t *testing.T) {
		jar, _ := cookiejar.New(nil)
		cookieClient := &http.Client{Jar: jar}
		login := request(t, cookieClient, "POST", server.URL+"/cookies/login", strings.NewReader(`{"username":"rhythm","password":"rhythm-test"}`), map[string]string{"Content-Type": "application/json"})
		if login.StatusCode != 200 {
			t.Fatal("login failed")
		}
		login.Body.Close()
		profile := request(t, cookieClient, "GET", server.URL+"/cookies/profile", nil, nil)
		if profile.StatusCode != 200 {
			t.Fatal("cookie was not reused")
		}
		profile.Body.Close()
		logout := request(t, cookieClient, "POST", server.URL+"/cookies/logout", nil, nil)
		logout.Body.Close()
		profile = request(t, cookieClient, "GET", server.URL+"/cookies/profile", nil, nil)
		if profile.StatusCode != 401 {
			t.Fatal("deleted session remained active")
		}
		profile.Body.Close()
	})
}

func TestStatefulExtractorsUploadAndValidation(t *testing.T) {
	_, server := testServer(t)
	client := server.Client()
	t.Run("retry and reset", func(t *testing.T) {
		for attempt := 1; attempt <= 3; attempt++ {
			response := request(t, client, "GET", server.URL+"/unstable/3?clientId=test-a", nil, nil)
			if attempt < 3 && response.StatusCode != 503 {
				t.Fatal("retry endpoint succeeded early")
			}
			if attempt == 3 && response.StatusCode != 200 {
				t.Fatal("retry endpoint did not recover")
			}
			response.Body.Close()
		}
		response := request(t, client, "POST", server.URL+"/admin/reset", nil, nil)
		if response.StatusCode != 200 {
			t.Fatal("reset failed")
		}
		response.Body.Close()
	})
	t.Run("rate limit", func(t *testing.T) {
		for attempt := 1; attempt <= 6; attempt++ {
			response := request(t, client, "GET", server.URL+"/rate-limit?clientId=isolated", nil, nil)
			if attempt == 6 && response.StatusCode != 429 {
				t.Fatal("rate limit not enforced")
			}
			response.Body.Close()
		}
	})
	t.Run("extractors", func(t *testing.T) {
		tests := map[string]string{"/extract/json": "jsonpath-test-token", "/extract/header": "header-extractor-token", "/extract/regex": "regex-extractor-token", "/extract/xml": "xml-extractor-token"}
		for path, expected := range tests {
			response := request(t, client, "GET", server.URL+path, nil, nil)
			payload, _ := io.ReadAll(response.Body)
			response.Body.Close()
			if !bytes.Contains(payload, []byte(expected)) && response.Header.Get("X-Test-Token") != expected {
				t.Fatalf("%s did not expose %s", path, expected)
			}
		}
	})
	t.Run("multipart", func(t *testing.T) {
		var body bytes.Buffer
		writer := multipart.NewWriter(&body)
		part, _ := writer.CreateFormFile("document", "test.txt")
		_, _ = part.Write([]byte("rhythm"))
		_ = writer.WriteField("environment", "DEV")
		_ = writer.Close()
		response := request(t, client, "POST", server.URL+"/upload", &body, map[string]string{"Content-Type": writer.FormDataContentType()})
		if response.StatusCode != 200 {
			t.Fatal("upload failed")
		}
		result := decode(t, response)
		if len(result["files"].([]any)) != 1 {
			t.Fatal("file metadata missing")
		}
	})
	t.Run("dynamic body", func(t *testing.T) {
		payload := `{"transactionId":"550e8400-e29b-41d4-a716-446655440000","timestamp":` + strconv.FormatInt(time.Now().UnixMilli(), 10) + `,"environment":"DEV"}`
		response := request(t, client, "POST", server.URL+"/validate/dynamic-body", strings.NewReader(payload), map[string]string{"Content-Type": "application/json"})
		if response.StatusCode != 200 {
			t.Fatalf("dynamic body failed %#v", decode(t, response))
		}
		response.Body.Close()
	})
}

func TestMTLSHandler(t *testing.T) {
	cfg := DefaultConfig()
	cfg.CertDir = t.TempDir()
	cfg.EnableHTTPS = false
	cfg.EnableMTLS = false
	cfg.EnableProxy = false
	server, err := New(cfg)
	if err != nil {
		t.Fatal(err)
	}
	pool := x509.NewCertPool()
	caPEM, err := os.ReadFile(server.certs.ServerCert[:len(server.certs.ServerCert)-len("server.crt")] + "ca.crt")
	if err != nil {
		t.Fatal(err)
	}
	pool.AppendCertsFromPEM(caPEM)
	cert, err := tls.LoadX509KeyPair(server.certs.ClientCert, server.certs.ClientKey)
	if err != nil {
		t.Fatal(err)
	}
	tlsServer := httptest.NewUnstartedServer(server.Handler())
	tlsServer.TLS = &tls.Config{ClientAuth: tls.RequireAndVerifyClientCert, ClientCAs: pool}
	tlsServer.StartTLS()
	defer tlsServer.Close()
	client := tlsServer.Client()
	transport := client.Transport.(*http.Transport)
	transport.TLSClientConfig.Certificates = []tls.Certificate{cert}
	response := request(t, client, "GET", tlsServer.URL+"/mtls", nil, nil)
	if response.StatusCode != 200 {
		t.Fatalf("mTLS failed %#v", decode(t, response))
	}
	response.Body.Close()
}
func TestProductionGuard(t *testing.T) {
	cfg := DefaultConfig()
	cfg.CertDir = t.TempDir()
	cfg.Environment = "production"
	if _, err := New(cfg); err == nil {
		t.Fatal("Test Lab started in production")
	}
}

func nestedCode(body map[string]any) string {
	if value, ok := body["error"].(map[string]any); ok {
		if code, ok := value["code"].(string); ok {
			return code
		}
	}
	return ""
}
func anyStrings(value any) []string {
	items, ok := value.([]any)
	if !ok {
		return nil
	}
	result := make([]string, 0, len(items))
	for _, item := range items {
		result = append(result, item.(string))
	}
	return result
}
func goldenHMAC(input, secret string) string {
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(input))
	return base64.StdEncoding.EncodeToString(mac.Sum(nil))
}
func TestGoldenHMACCompatibility(t *testing.T) {
	const input = "rhythm-client-1787106243123"
	const expected = "g6CP7INUdFwgpNVa0Mj1+EFmp2fqMwXN+GOsIoXPe1A="
	if actual := goldenHMAC(input, hmacSecret); actual != expected {
		t.Fatalf("golden HMAC changed: %s", actual)
	}
}
func TestServerStopsWithContext(t *testing.T) {
	cfg := DefaultConfig()
	cfg.CertDir = t.TempDir()
	cfg.HTTPAddr = ":0"
	cfg.EnableHTTPS = false
	cfg.EnableMTLS = false
	cfg.EnableProxy = false
	server, err := New(cfg)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err = server.Start(ctx); err != nil {
		t.Fatal(err)
	}
}
