package elf

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"
)

func TestValidateAndCompileInjectsGovernedExecution(t *testing.T) {
	now := time.Date(2026, 7, 22, 12, 0, 0, 0, time.UTC)
	result := ValidateAndCompile(json.RawMessage(`{"query":{"term":{"service.name":"checkout-api"}},"size":999}`), "@timestamp", now.Add(-15*time.Minute), now, 20)
	if !result.Valid {
		t.Fatalf("expected valid: %#v", result.Problems)
	}
	var compiled map[string]any
	if err := json.Unmarshal(result.CompiledBody, &compiled); err != nil {
		t.Fatal(err)
	}
	if compiled["track_total_hits"] != true || compiled["size"].(float64) != 20 {
		t.Fatalf("server controls missing: %#v", compiled)
	}
	query := compiled["query"].(map[string]any)["bool"].(map[string]any)
	if len(query["filter"].([]any)) != 1 {
		t.Fatalf("time filter missing: %#v", query)
	}
}

func TestValidateAndCompileRejectsExpensiveAndScriptedQueries(t *testing.T) {
	for _, body := range []string{`{"query":{"wildcard":{"message":"*secret*"}}}`, `{"query":{"bool":{"filter":[{"term":{"service":"api"}}]}},"script_fields":{"x":{"script":"1"}}}`} {
		result := ValidateAndCompile(json.RawMessage(body), "@timestamp", time.Now().Add(-time.Minute), time.Now(), 10)
		if result.Valid || len(result.Problems) == 0 {
			t.Fatalf("expected policy rejection for %s", body)
		}
	}
}

func TestMaskDocumentUsesFullPathsAndSensitiveNames(t *testing.T) {
	masked := maskDocument(map[string]any{"customer": map[string]any{"email": "person@example.com", "name": "Visible"}, "apiToken": "never"}, []string{"customer.email"})
	customer := masked["customer"].(map[string]any)
	if customer["email"] != "MASKED" || customer["name"] != "Visible" || masked["apiToken"] != "MASKED" {
		t.Fatalf("unexpected mask result: %#v", masked)
	}
}

func TestIndexAllowed(t *testing.T) {
	if !IndexAllowed("checkout-logs-2026.07.22", []string{"checkout-logs-*"}) {
		t.Fatal("expected matching index")
	}
	if IndexAllowed("security-audit", []string{"checkout-logs-*"}) {
		t.Fatal("unexpected index access")
	}
}

func TestInferFieldsDetectsSemanticRoles(t *testing.T) {
	fields := InferFields([]map[string]any{{"@timestamp": "2026-07-22T00:00:00Z", "log": map[string]any{"level": "ERROR"}, "message": "failure"}}, nil)
	roles := map[string]string{}
	for _, field := range fields {
		roles[field.Path] = field.Role
	}
	if roles["@timestamp"] != "time" || roles["log.level"] != "level" || roles["message"] != "message" {
		t.Fatalf("unexpected roles: %#v", roles)
	}
}

func TestEvaluateHitCountCriteriaWithoutAggregationPath(t *testing.T) {
	criteria := map[string]any{"operator": "LTE", "value": float64(0)}
	if evaluateCriteria(criteria, 1, nil, nil) {
		t.Fatal("one hit must fail a maximum-zero criterion")
	}
	if !evaluateCriteria(criteria, 0, nil, nil) {
		t.Fatal("zero hits must pass a maximum-zero criterion")
	}
}

func TestSampleFiveHundredErrorQueryIsGovernedAndUsesExactHitCount(t *testing.T) {
	now := time.Date(2026, 7, 22, 12, 0, 0, 0, time.UTC)
	body := json.RawMessage(`{
		"size": 1000,
		"query": {"bool": {"filter": [
			{"match_all": {}},
			{"match_phrase": {"service": "sample-web-app"}},
			{"exists": {"field": "responseTimeMs"}},
			{"match_phrase": {"endpoint": "/api/orders"}},
			{"term": {"statusCode": 500}},
			{"range": {"@timestamp": {"gte": "now-15m", "lte": "now"}}}
		]}},
		"sort": [{"@timestamp": {"order": "desc"}}]
	}`)
	result := ValidateAndCompile(body, "@timestamp", now.Add(-15*time.Minute), now, 1000)
	if !result.Valid {
		t.Fatalf("sample ELF query must be accepted: %#v", result.Problems)
	}
	var compiled map[string]any
	if err := json.Unmarshal(result.CompiledBody, &compiled); err != nil {
		t.Fatal(err)
	}
	if compiled["size"].(float64) != 100 || compiled["track_total_hits"] != true {
		t.Fatalf("expected governed size and exact hit counting: %#v", compiled)
	}
	if !evaluateCriteria(map[string]any{"operator": "LTE", "value": float64(0)}, 0, nil, nil) {
		t.Fatal("zero matching 500-error documents must pass a maximum-zero check")
	}
	if evaluateCriteria(map[string]any{"operator": "LTE", "value": float64(0)}, 1, nil, nil) {
		t.Fatal("one matching 500-error document must fail a maximum-zero check")
	}
}

func TestFieldCriteriaInjectsExactFilterAggregation(t *testing.T) {
	criteria := map[string]any{"kind": "FIELD", "field": "responseTimeMs", "operator": "GT", "value": float64(1000), "quantifier": "ANY"}
	body, err := withFieldCriteria([]byte(`{"query":{"match_all":{}},"track_total_hits":true}`), criteria)
	if err != nil {
		t.Fatal(err)
	}
	var compiled map[string]any
	if err = json.Unmarshal(body, &compiled); err != nil {
		t.Fatal(err)
	}
	aggs := compiled["aggregations"].(map[string]any)
	condition := aggs[fieldConditionAggregation].(map[string]any)["filter"].(map[string]any)
	rangeQuery := condition["range"].(map[string]any)["responseTimeMs"].(map[string]any)
	if rangeQuery["gt"].(float64) != 1000 {
		t.Fatalf("unexpected field condition: %#v", condition)
	}
}

func TestFieldCriteriaQuantifiers(t *testing.T) {
	aggs := map[string]any{fieldConditionAggregation: map[string]any{"doc_count": float64(2)}}
	for _, test := range []struct {
		quantifier string
		hits       int64
		want       bool
	}{
		{quantifier: "ANY", hits: 5, want: true},
		{quantifier: "ALL", hits: 2, want: true},
		{quantifier: "ALL", hits: 5, want: false},
		{quantifier: "NONE", hits: 5, want: false},
	} {
		criteria := map[string]any{"kind": "FIELD", "field": "statusCode", "operator": "GTE", "value": float64(500), "quantifier": test.quantifier}
		evidence, passed, err := fieldCriteriaResult(criteria, test.hits, aggs)
		if err != nil {
			t.Fatal(err)
		}
		if passed != test.want || evaluateCriteria(criteria, test.hits, nil, evidence) != test.want {
			t.Fatalf("%s with %d hits: got %v, want %v", test.quantifier, test.hits, passed, test.want)
		}
	}
}

func TestFieldCriteriaRejectsSensitiveFields(t *testing.T) {
	err := validateFieldCriteria(map[string]any{"kind": "FIELD", "field": "authorization.token", "operator": "EQ", "value": "secret", "quantifier": "ANY"})
	if err == nil {
		t.Fatal("sensitive fields must not be accepted as field conditions")
	}
}

func TestDeleteApplicationBlockedByQueries(t *testing.T) {
	if err := errDeleteApplicationBlockedByQueries(0); err != nil {
		t.Fatalf("expected no block for empty app: %v", err)
	}
	err := errDeleteApplicationBlockedByQueries(1)
	if !errors.Is(err, ErrConflict) {
		t.Fatalf("expected ErrConflict, got %v", err)
	}
	if !strings.Contains(err.Error(), "1 ELF query") {
		t.Fatalf("unexpected message: %v", err)
	}
	err = errDeleteApplicationBlockedByQueries(3)
	if !errors.Is(err, ErrConflict) || !strings.Contains(err.Error(), "3 ELF queries") {
		t.Fatalf("unexpected plural message: %v", err)
	}
}
