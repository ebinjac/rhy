package runs

import "testing"

func TestRecordedAPIResponseMSMapsCurrentAndHistoricalKeys(t *testing.T) {
	t.Parallel()
	value, ok := RecordedAPIResponseMS(map[string]any{"apiResponseTimeMs": int64(42), "networkTotalMs": int64(99)})
	if !ok || value != 42 {
		t.Fatalf("current key should win: value=%d ok=%t", value, ok)
	}
	value, ok = RecordedAPIResponseMS(map[string]any{"networkTotalMs": int64(85)})
	if !ok || value != 85 {
		t.Fatalf("networkTotalMs fallback: value=%d ok=%t", value, ok)
	}
	value, ok = RecordedAPIResponseMS(map[string]any{"dnsMs": int64(10), "tlsHandshakeMs": int64(20), "serverWaitMs": int64(30)})
	if !ok || value != 60 {
		t.Fatalf("phase-key fallback: value=%d ok=%t", value, ok)
	}
	if _, ok = RecordedAPIResponseMS(map[string]any{"totalMs": int64(500), "preparationMs": int64(12)}); ok {
		t.Fatal("full-step totalMs must not be treated as API response time")
	}
}

func TestRecordedPreparationMSMapsScriptSetup(t *testing.T) {
	t.Parallel()
	value, ok := RecordedPreparationMS(map[string]any{"preparationMs": int64(15)})
	if !ok || value != 15 {
		t.Fatalf("preparationMs: value=%d ok=%t", value, ok)
	}
	value, ok = RecordedPreparationMS(map[string]any{"preRequestScriptMs": int64(9)})
	if !ok || value != 9 {
		t.Fatalf("preRequestScriptMs fallback: value=%d ok=%t", value, ok)
	}
}
