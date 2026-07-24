package elf

import (
	"encoding/json"
	"fmt"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

var allowedQueries = map[string]bool{
	"bool": true, "term": true, "terms": true, "match": true, "match_phrase": true,
	"exists": true, "range": true, "nested": true, "match_all": true,
}

var deniedKeys = map[string]bool{
	"script": true, "script_fields": true, "runtime_mappings": true, "percolate": true,
	"wrapper": true, "regexp": true, "fuzzy": true, "wildcard": true, "pit": true,
	"search_after": true, "scroll": true, "ext": true, "profile": true,
}

var allowedAggs = map[string]bool{
	"terms": true, "date_histogram": true, "histogram": true, "range": true,
	"filters": true, "missing": true, "avg": true, "min": true, "max": true,
	"sum": true, "value_count": true, "cardinality": true, "percentiles": true,
	"stats": true, "extended_stats": true,
}

func ValidateAndCompile(body json.RawMessage, timeField string, from, to time.Time, size int) ValidationResult {
	result := ValidationResult{Valid: false, Problems: []ValidationProblem{}, PolicyNotes: []string{}}
	if len(body) == 0 || len(body) > 64*1024 {
		result.Problems = append(result.Problems, ValidationProblem{Path: "$", Code: "BODY_SIZE", Message: "Search JSON must be between 1 byte and 64 KB."})
		return result
	}
	var authored map[string]any
	if err := json.Unmarshal(body, &authored); err != nil {
		result.Problems = append(result.Problems, ValidationProblem{Path: "$", Code: "INVALID_JSON", Message: err.Error()})
		return result
	}
	clauses := 0
	validateNode(authored, "$", 0, &clauses, &result.Problems)
	if clauses > 100 {
		result.Problems = append(result.Problems, ValidationProblem{Path: "$.query", Code: "CLAUSE_LIMIT", Message: "Queries may contain at most 100 clauses."})
	}
	if len(result.Problems) > 0 {
		return result
	}
	query := authored["query"]
	if query == nil {
		query = map[string]any{"match_all": map[string]any{}}
	}
	compiled := map[string]any{}
	for key, value := range authored {
		if key != "query" && key != "size" && key != "sort" && key != "track_total_hits" && key != "timeout" {
			compiled[key] = value
		}
	}
	compiled["query"] = map[string]any{"bool": map[string]any{
		"must": []any{query},
		"filter": []any{map[string]any{"range": map[string]any{timeField: map[string]any{
			"gte": from.UTC().Format(time.RFC3339Nano), "lte": to.UTC().Format(time.RFC3339Nano), "format": "strict_date_optional_time_nanos",
		}}}},
	}}
	if size < 0 {
		size = 0
	}
	if size > 100 {
		size = 100
	}
	compiled["size"] = size
	compiled["track_total_hits"] = true
	compiled["timeout"] = "30s"
	compiled["sort"] = []any{map[string]any{timeField: map[string]any{"order": "desc", "unmapped_type": "date"}}, map[string]any{"_id": "desc"}}
	encoded, _ := json.MarshalIndent(compiled, "", "  ")
	result.Valid = true
	result.CompiledBody = encoded
	result.PolicyNotes = append(result.PolicyNotes, "Rhythm injected the UTC time filter, exact hit counting, bounded timeout, and deterministic sort.")
	return result
}

func validateNode(value any, path string, aggDepth int, clauses *int, problems *[]ValidationProblem) {
	switch node := value.(type) {
	case map[string]any:
		for key, child := range node {
			lower := strings.ToLower(key)
			if deniedKeys[lower] || lower == "query_string" || lower == "simple_query_string" {
				*problems = append(*problems, ValidationProblem{Path: path + "." + key, Code: "POLICY_DENIED", Message: fmt.Sprintf("%s is not available in governed ELF queries.", key)})
				continue
			}
			if path == "$.query" || strings.HasSuffix(path, ".must") || strings.HasSuffix(path, ".should") || strings.HasSuffix(path, ".filter") || strings.HasSuffix(path, ".must_not") {
				if !allowedQueries[lower] && lower != "minimum_should_match" {
					*problems = append(*problems, ValidationProblem{Path: path + "." + key, Code: "QUERY_NOT_ALLOWED", Message: fmt.Sprintf("Query type %s is not supported.", key)})
				}
				*clauses++
			}
			if lower == "aggs" || lower == "aggregations" {
				validateAggregations(child, path+"."+key, aggDepth+1, problems)
				continue
			}
			validateNode(child, path+"."+key, aggDepth, clauses, problems)
		}
	case []any:
		for i, child := range node {
			validateNode(child, fmt.Sprintf("%s[%d]", path, i), aggDepth, clauses, problems)
		}
	}
}

func validateAggregations(value any, path string, depth int, problems *[]ValidationProblem) {
	if depth > 3 {
		*problems = append(*problems, ValidationProblem{Path: path, Code: "AGGREGATION_DEPTH", Message: "Aggregation nesting is limited to three levels."})
		return
	}
	aggs, ok := value.(map[string]any)
	if !ok {
		return
	}
	for name, raw := range aggs {
		definition, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		for kind, options := range definition {
			if kind == "aggs" || kind == "aggregations" {
				validateAggregations(options, path+"."+name+"."+kind, depth+1, problems)
				continue
			}
			if !allowedAggs[kind] {
				*problems = append(*problems, ValidationProblem{Path: path + "." + name + "." + kind, Code: "AGGREGATION_NOT_ALLOWED", Message: fmt.Sprintf("Aggregation %s is not supported.", kind)})
				continue
			}
			if m, ok := options.(map[string]any); ok {
				if size, ok := number(m["size"]); ok && size > 50 {
					*problems = append(*problems, ValidationProblem{Path: path + "." + name + "." + kind + ".size", Code: "BUCKET_LIMIT", Message: "Aggregation bucket size is limited to 50."})
				}
			}
		}
	}
}

func IndexAllowed(index string, allowed []string) bool {
	if strings.TrimSpace(index) == "" || strings.ContainsAny(index, " \\/?#") {
		return false
	}
	for _, pattern := range allowed {
		if matched, _ := filepath.Match(pattern, index); matched {
			return true
		}
	}
	return false
}

func InferFields(samples []map[string]any, semantic map[string]string) []Field {
	values := map[string][]any{}
	for _, sample := range samples {
		flatten("", sample, values)
	}
	fields := make([]Field, 0, len(values))
	for path, found := range values {
		role := semantic[path]
		if role == "" {
			role = inferRole(path)
		}
		fields = append(fields, Field{Path: path, Type: inferType(found), Role: role, Samples: found, Usage: len(found)})
	}
	sort.Slice(fields, func(i, j int) bool { return fields[i].Path < fields[j].Path })
	return fields
}

func flatten(prefix string, value any, out map[string][]any) {
	m, ok := value.(map[string]any)
	if !ok {
		return
	}
	for key, child := range m {
		path := key
		if prefix != "" {
			path = prefix + "." + key
		}
		if nested, ok := child.(map[string]any); ok {
			flatten(path, nested, out)
			continue
		}
		if len(out[path]) < 5 {
			out[path] = append(out[path], child)
		}
	}
}

func inferRole(path string) string {
	lower := strings.ToLower(path)
	roles := []struct {
		role  string
		names []string
	}{{"time", []string{"@timestamp", "timestamp", "time"}}, {"level", []string{"level", "severity", "log.level"}}, {"message", []string{"message", "msg", "log.message"}}, {"service", []string{"service", "service.name", "application"}}, {"exception", []string{"exception", "error.stack", "stacktrace"}}, {"trace", []string{"trace.id", "traceid", "trace_id"}}, {"endpoint", []string{"url.path", "endpoint", "path"}}, {"latency", []string{"duration", "latency", "elapsed"}}}
	for _, candidate := range roles {
		for _, name := range candidate.names {
			if lower == name || strings.HasSuffix(lower, "."+name) {
				return candidate.role
			}
		}
	}
	return ""
}
func inferType(values []any) string {
	for _, v := range values {
		switch v.(type) {
		case bool:
			return "boolean"
		case float64:
			return "number"
		case []any:
			return "array"
		case nil:
			continue
		default:
			return "string"
		}
	}
	return "unknown"
}
func number(v any) (float64, bool) { n, ok := v.(float64); return n, ok }
