package dynatrace

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"
)

func TestEnvironmentV2ProviderQueriesNormalizedMetricEvidence(t *testing.T) {
	var authorization string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		authorization = r.Header.Get("Authorization")
		if r.URL.Path != "/api/v2/metrics/query" {
			t.Fatalf("path=%s", r.URL.Path)
		}
		if r.URL.Query().Get("entitySelector") != `type(HOST),entityId("HOST-1")` {
			t.Fatalf("entity selector=%s", r.URL.Query().Get("entitySelector"))
		}
		if r.URL.Query().Get("mzSelector") != `mzName("Payments")` {
			t.Fatalf("management zone selector=%s", r.URL.Query().Get("mzSelector"))
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"result": []any{map[string]any{
				"metricId": "builtin:host.cpu.usage:splitBy(\"dt.entity.host\"):avg:names",
				"data": []any{map[string]any{
					"dimensionMap": map[string]string{"dt.entity.host": "HOST-1", "dt.entity.host.name": "host-one"},
					"timestamps":   []int64{1_700_000_000_000, 1_700_000_060_000},
					"values":       []any{20.0, 40.0},
				}},
			}},
		})
	}))
	defer server.Close()
	parsed, _ := url.Parse(server.URL)
	provider := NewEnvironmentV2Provider([]string{parsed.Hostname()}, true)
	from := time.Unix(1_700_000_000, 0).UTC()
	result, _, err := provider.QueryMetric(context.Background(), Connection{BaseURL: server.URL, Token: "exact-secret-token"}, MetricQuery{
		MetricSelector:         "builtin:host.cpu.usage:splitBy(\"dt.entity.host\"):avg:names",
		EntitySelector:         `type(HOST),entityId("HOST-1")`,
		ManagementZoneSelector: `mzName("Payments")`,
		From:                   from, To: from.Add(time.Minute), Resolution: "1m",
		Units: map[string]string{"builtin:host.cpu.usage": "Percent"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if authorization != "Api-Token exact-secret-token" {
		t.Fatalf("authorization=%q", authorization)
	}
	if len(result) != 1 || result[0].ResourceID != "HOST-1" {
		t.Fatalf("result=%+v", result)
	}
	if result[0].ResourceName != "host-one" || result[0].Metric != "CPU" || result[0].Aggregation != "AVG" {
		t.Fatalf("identity=%+v", result[0])
	}
	if result[0].Statistics.Average == nil || *result[0].Statistics.Average != 30 {
		t.Fatalf("statistics=%+v", result[0].Statistics)
	}
}

func TestMetricSpecsMatchHydraAndTIMSProductionShape(t *testing.T) {
	hydra := metricSpecs("HYDRA", MetricMapping{})
	if len(hydra) != 4 ||
		hydra[0].Selector != `builtin:containers.cpu.usagePercent:splitBy("Container"):avg:names` ||
		hydra[3].Selector != `builtin:containers.memory.usagePercent:splitBy("Container"):max:names` {
		t.Fatalf("hydra=%+v", hydra)
	}
	tims := metricSpecs("TIMS", MetricMapping{})
	if len(tims) != 4 ||
		tims[0].Selector != `builtin:host.cpu.usage:splitBy("dt.entity.host"):avg:names` ||
		tims[3].Selector != `builtin:host.mem.usage:splitBy("dt.entity.host"):max:names` {
		t.Fatalf("tims=%+v", tims)
	}
}

func TestMetricDescriptorParsingAndAggregationValidation(t *testing.T) {
	if actual := defaultAggregation(map[string]any{"type": "avg"}); actual != "avg" {
		t.Fatalf("default aggregation=%q", actual)
	}
	descriptor := MetricDescriptor{AggregationTypes: []string{"auto", "avg", "max"}}
	if !supportsAggregation(descriptor, "AVG") || !supportsAggregation(descriptor, "MAX") {
		t.Fatal("expected explicit avg and max aggregations to be supported")
	}
	if supportsAggregation(MetricDescriptor{AggregationTypes: []string{"auto", "avg"}}, "MAX") {
		t.Fatal("auto must not be treated as support for an unavailable max aggregation")
	}
}

func TestSummarizeResourcesUsesAverageSeriesAndPeakSeries(t *testing.T) {
	average, peak := 42.0, 91.0
	summary := summarizeResources([]ResourceMetric{
		{Metric: "CPU", Aggregation: "AVG", Series: []SeriesPoint{{Value: &average}}},
		{Metric: "CPU", Aggregation: "MAX", Series: []SeriesPoint{{Value: &peak}}},
	})
	if summary["CPU"].Average == nil || *summary["CPU"].Average != 42 {
		t.Fatalf("average=%+v", summary["CPU"])
	}
	if summary["CPU"].Maximum == nil || *summary["CPU"].Maximum != 91 {
		t.Fatalf("maximum=%+v", summary["CPU"])
	}
}

func TestCompileSelectorsIntersectsManagementZoneAndEscapesInput(t *testing.T) {
	selectors, unmatched, err := compileSelectors([]ResourceMapping{{
		Platform: "HYDRA", EntityType: "KUBERNETES_WORKLOAD", MappingType: "NAMESPACE",
		Value: `orders"prod`, Enabled: true,
	}}, []string{"CAR-100 Production"})
	if err != nil {
		t.Fatal(err)
	}
	if len(unmatched) != 0 || len(selectors) != 1 {
		t.Fatalf("selectors=%v unmatched=%v", selectors, unmatched)
	}
	if !strings.Contains(selectors[0], `tag("Kubernetes namespace:orders\"prod")`) ||
		!strings.Contains(selectors[0], `mzName("CAR-100 Production")`) {
		t.Fatalf("selector=%s", selectors[0])
	}
}

func TestRuleEvaluationPreservesNoDataAndBaselinePercent(t *testing.T) {
	baselineValue, postValue := 40.0, 60.0
	baseline := map[string]Statistics{"CPU": {Average: &baselineValue, SampleCount: 1}}
	post := map[string]Statistics{"CPU": {Average: &postValue, SampleCount: 1}}
	results := evaluateRules([]Rule{
		{ID: "relative", Name: "CPU increase", Metric: "CPU", Statistic: "AVERAGE", Operator: "GTE", Threshold: 25, Comparison: "BASELINE_PERCENT", GateMode: "BLOCKING", Enabled: true},
		{ID: "missing", Name: "Memory", Metric: "MEMORY", Statistic: "P95", Operator: "GT", Threshold: 80, Comparison: "ABSOLUTE", GateMode: "ADVISORY", Enabled: true},
	}, "", post, 100, baseline)
	if len(results) != 2 || results[0].Status != "FAIL" {
		t.Fatalf("results=%+v", results)
	}
	if results[1].Status != "NO_DATA" || results[1].Observed != nil {
		t.Fatalf("missing result=%+v", results[1])
	}
}

func TestProviderRejectsEndpointOutsideAllowlist(t *testing.T) {
	provider := NewEnvironmentV2Provider([]string{"amex.live.dynatrace.com"}, true)
	var response map[string]any
	_, err := provider.request(context.Background(), Connection{BaseURL: "https://unapproved.example", Token: "token"}, "/api/v2/entities", nil, &response)
	if err == nil || !strings.Contains(err.Error(), "allowlist") {
		t.Fatalf("err=%v", err)
	}
}
