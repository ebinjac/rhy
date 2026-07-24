package scripts

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestHTTPRunnerRequiresTokenAndServesClient(t *testing.T) {
	server := httptest.NewServer(NewHTTPHandler(NewRuntime(), "internal-test-token"))
	defer server.Close()

	unauthorized, err := http.Post(server.URL+"/v1/validate", "application/json", nil)
	if err != nil {
		t.Fatal(err)
	}
	_ = unauthorized.Body.Close()
	if unauthorized.StatusCode != http.StatusUnauthorized {
		t.Fatalf("expected unauthorized request to be rejected, got %d", unauthorized.StatusCode)
	}

	client := NewClient(server.URL, "internal-test-token")
	if err := client.Health(context.Background()); err != nil {
		t.Fatal(err)
	}
	validation, err := client.Validate(context.Background(), `pm.variables.set("ready", "yes")`)
	if err != nil || !validation.Valid {
		t.Fatalf("expected authenticated validation, got %#v %v", validation, err)
	}
	result, err := client.Execute(context.Background(), Input{Script: Script{Enabled: true, Language: "javascript", RuntimeVersion: RuntimeVersion, Code: `pm.variables.set("ready", "yes")`}, Variables: map[string]string{}, TimeoutMS: 1000})
	if err != nil || result.Status != "SUCCESS" || result.Variables["ready"] != "yes" {
		t.Fatalf("expected authenticated execution, got %#v %v", result, err)
	}
}
