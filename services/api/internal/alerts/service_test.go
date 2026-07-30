package alerts

import (
	"encoding/json"
	"testing"
	"time"
)

func TestDecodeEnvelopeSupportsNotificationMessageWrapper(t *testing.T) {
	raw := []byte(`{"message":"{\"schema\":\"rhythm.opensearch-alert.v1\",\"event\":{\"monitorId\":\"m-1\",\"triggerId\":\"t-1\",\"alertId\":\"a-1\",\"monitorType\":\"QUERY_LEVEL\",\"state\":\"ACTIVE\"}}"}`)
	envelope, err := decodeEnvelope(raw)
	if err != nil {
		t.Fatalf("decode wrapper: %v", err)
	}
	if envelope.Event == nil || envelope.Event.AlertID != "a-1" {
		t.Fatalf("unexpected envelope: %#v", envelope)
	}
}

func TestNormalizeAndValidateExternalEvent(t *testing.T) {
	event := ExternalEvent{MonitorID: "m&amp;1", MonitorName: "Orders &quot;prod&quot;", MonitorType: "query_level", TriggerID: "trigger", AlertID: "alert", State: "active", Severity: "2"}
	normalizeEvent(&event)
	if event.MonitorID != "m&1" || event.MonitorName != `Orders "prod"` {
		t.Fatalf("HTML entities were not normalized: %#v", event)
	}
	if err := validateEvent(event, []string{"QUERY_LEVEL"}); err != nil {
		t.Fatalf("valid event rejected: %v", err)
	}
	if got := mapSeverity(event.Severity); got != "HIGH" {
		t.Fatalf("expected HIGH, got %s", got)
	}
	if got := mapState(event.State); got != "OPEN" {
		t.Fatalf("expected OPEN, got %s", got)
	}
}

func TestMaskValueBoundsSamplesAndMasksSensitiveKeys(t *testing.T) {
	samples := make([]map[string]any, 25)
	for i := range samples {
		samples[i] = map[string]any{"message": "safe", "authorization": "Bearer exact-secret"}
	}
	masked := maskValue(map[string]any{"samples": samples, "customer": map[string]any{"email": "person@example.com"}}, "", []string{"customer.email"}).(map[string]any)
	if len(masked["samples"].([]map[string]any)) != 20 {
		t.Fatalf("expected 20 bounded samples")
	}
	first := masked["samples"].([]map[string]any)[0]
	if first["authorization"] != "MASKED" {
		t.Fatalf("authorization was not masked: %#v", first)
	}
	customer := masked["customer"].(map[string]any)
	if customer["email"] != "MASKED" {
		t.Fatalf("configured field was not masked: %#v", customer)
	}
	encoded, _ := json.Marshal(masked)
	if string(encoded) == "" {
		t.Fatal("expected serializable masked evidence")
	}
}

func TestReceiverTokenRotationWindow(t *testing.T) {
	token, hash, err := newToken()
	if err != nil {
		t.Fatal(err)
	}
	if !validToken(token, hash, "", nil) {
		t.Fatal("new token did not validate")
	}
	expires := time.Now().Add(time.Minute)
	if !validToken(token, "not-current", hash, &expires) {
		t.Fatal("overlap token did not validate")
	}
	expired := time.Now().Add(-time.Minute)
	if validToken(token, "not-current", hash, &expired) {
		t.Fatal("expired overlap token validated")
	}
}

func TestNormalizeAlertIDsDeduplicatesSelection(t *testing.T) {
	ids, err := normalizeAlertIDs([]string{" alert-1 ", "alert-2", "alert-1"})
	if err != nil {
		t.Fatal(err)
	}
	if len(ids) != 2 || ids[0] != "alert-1" || ids[1] != "alert-2" {
		t.Fatalf("unexpected normalized IDs: %#v", ids)
	}
}

func TestNormalizeAlertIDsRequiresSelection(t *testing.T) {
	if _, err := normalizeAlertIDs(nil); err == nil {
		t.Fatal("expected an empty alert selection to be rejected")
	}
}
