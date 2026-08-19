package investigation

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/rhythm-monitoring/rhythm/internal/dynatrace"
	"github.com/rhythm-monitoring/rhythm/internal/elf"
	"github.com/rhythm-monitoring/rhythm/internal/id"
)

func ParseChecks(definition map[string]any) []Check {
	if definition == nil {
		return nil
	}
	raw, ok := definition["investigationChecks"]
	if !ok {
		raw = definition["investigation_checks"]
	}
	items, ok := raw.([]any)
	if !ok {
		if typed, ok := raw.([]Check); ok {
			items = make([]any, len(typed))
			for i, check := range typed {
				items[i] = check
			}
		} else {
			return nil
		}
	}
	checks := make([]Check, 0, len(items))
	seen := map[string]bool{}
	for _, item := range items {
		if len(checks) >= MaxPlaybookLen {
			break
		}
		check, ok := parseCheck(item)
		if !ok {
			continue
		}
		if seen[check.ID] {
			continue
		}
		seen[check.ID] = true
		checks = append(checks, check)
	}
	return checks
}

func parseCheck(raw any) (Check, bool) {
	switch value := raw.(type) {
	case Check:
		return normalizeCheck(value)
	case map[string]any:
		serviceIDs := stringSlice(first(value, "serviceIds", "service_ids"))
		check := Check{
			ID:                   strings.TrimSpace(asString(first(value, "id"))),
			Kind:                 strings.TrimSpace(asString(first(value, "kind"))),
			Label:                strings.TrimSpace(asString(first(value, "label"))),
			QueryID:              strings.TrimSpace(asString(first(value, "queryId", "query_id"))),
			ApplicationID:        strings.TrimSpace(asString(first(value, "applicationId", "application_id"))),
			EnvironmentBindingID: strings.TrimSpace(asString(first(value, "environmentBindingId", "environment_binding_id"))),
			ServiceIDs:           serviceIDs,
			Blocking:             asBool(value["blocking"]),
		}
		return normalizeCheck(check)
	default:
		encoded, err := json.Marshal(raw)
		if err != nil {
			return Check{}, false
		}
		var check Check
		if err := json.Unmarshal(encoded, &check); err != nil {
			return Check{}, false
		}
		return normalizeCheck(check)
	}
}

func normalizeCheck(check Check) (Check, bool) {
	check.ID = strings.TrimSpace(check.ID)
	check.Kind = strings.ToUpper(strings.TrimSpace(check.Kind))
	check.Label = strings.TrimSpace(check.Label)
	check.QueryID = strings.TrimSpace(check.QueryID)
	check.ApplicationID = strings.TrimSpace(check.ApplicationID)
	check.EnvironmentBindingID = strings.TrimSpace(check.EnvironmentBindingID)
	if check.Kind != KindELFQuery && check.Kind != KindDynatrace {
		return Check{}, false
	}
	if check.ID == "" {
		generated, err := id.NewUUID()
		if err != nil {
			return Check{}, false
		}
		check.ID = generated
	}
	if check.Label == "" {
		if check.Kind == KindELFQuery {
			check.Label = "ELF query"
		} else {
			check.Label = "Dynatrace"
		}
	}
	if check.ServiceIDs == nil {
		check.ServiceIDs = []string{}
	}
	return check, true
}

func pendingFromPlaybook(checks []Check, alertID, monitorID, runID, applicationID string, now time.Time) []Result {
	rows := make([]Result, 0, len(checks))
	for index, check := range checks {
		appID := check.ApplicationID
		if appID == "" {
			appID = applicationID
		}
		identifier, err := id.NewUUID()
		if err != nil {
			continue
		}
		rows = append(rows, Result{
			ID:                   identifier,
			AlertID:              alertID,
			CheckID:              check.ID,
			MonitorID:            monitorID,
			RunID:                runID,
			Kind:                 check.Kind,
			Label:                check.Label,
			QueryID:              check.QueryID,
			ApplicationID:        appID,
			EnvironmentBindingID: check.EnvironmentBindingID,
			ServiceIDs:           check.ServiceIDs,
			Status:               StatusPending,
			Attempt:              1,
			Position:             index,
			Evidence:             map[string]any{},
			CreatedAt:            now,
			UpdatedAt:            now,
		})
	}
	return rows
}

func skipReason(item Result, elfConfigured, dynatraceConfigured bool) string {
	switch item.Kind {
	case KindELFQuery:
		if !elfConfigured {
			return "ELF is not configured."
		}
		if item.QueryID == "" {
			return "ELF query is missing."
		}
	case KindDynatrace:
		if !dynatraceConfigured {
			return "Dynatrace is not configured."
		}
		if item.ApplicationID == "" {
			return "No application is linked to this monitor."
		}
		if item.EnvironmentBindingID == "" {
			return "Dynatrace environment binding is missing."
		}
	default:
		return "Unsupported investigation check."
	}
	return ""
}

func mapELFResult(summary elf.RunSummary, err error) (status, text string, evidence map[string]any) {
	evidence = map[string]any{
		"hitCount":      summary.HitCount,
		"decision":      summary.Decision,
		"queryId":       summary.QueryID,
		"timeFrom":      summary.TimeFrom,
		"timeTo":        summary.TimeTo,
		"elfRunId":      summary.ID,
		"resolvedIndex": summary.ResolvedIndex,
	}
	if err != nil {
		reason := strings.TrimSpace(summary.FailureReason)
		if reason == "" {
			reason = err.Error()
		}
		return StatusError, truncateSummary(reason), evidence
	}
	if summary.Status == "SUCCESS" && summary.Decision == "PASS" {
		return StatusPassed, fmt.Sprintf("%d hits · pass", summary.HitCount), evidence
	}
	reason := strings.TrimSpace(summary.FailureReason)
	if reason == "" {
		reason = fmt.Sprintf("%d hits · fail", summary.HitCount)
	}
	return StatusFailed, truncateSummary(reason), evidence
}

func mapDynatraceResult(run dynatrace.Run, err error) (status, text string, evidence map[string]any) {
	evidence = map[string]any{
		"decision":        run.Decision,
		"dynatraceRunId":  run.ID,
		"timeFrom":        run.TimeFrom,
		"timeTo":          run.TimeTo,
		"coveragePercent": run.CoveragePercent,
		"resourceCount":   run.ResourceCount,
	}
	if err != nil {
		reason := strings.TrimSpace(run.FailureReason)
		if reason == "" {
			reason = err.Error()
		}
		return StatusError, truncateSummary(reason), evidence
	}
	switch run.Decision {
	case "BLOCK":
		reason := strings.TrimSpace(run.FailureReason)
		if reason == "" {
			reason = "Dynatrace blocked this check."
		}
		return StatusFailed, truncateSummary(reason), evidence
	case "ALLOW_WITH_WARNINGS":
		return StatusPassed, "Passed with warnings", evidence
	default:
		return StatusPassed, "Passed", evidence
	}
}

func itemFromResult(result Result) Item {
	item := Item{
		ID:                   result.CheckID,
		Kind:                 result.Kind,
		Label:                result.Label,
		QueryID:              result.QueryID,
		ApplicationID:        result.ApplicationID,
		EnvironmentBindingID: result.EnvironmentBindingID,
		ServiceIDs:           result.ServiceIDs,
		Status:               result.Status,
		Attempt:              result.Attempt,
		Summary:              result.Summary,
		Evidence:             result.Evidence,
		LastError:            result.LastError,
		StartedAt:            result.StartedAt,
		EndedAt:              result.EndedAt,
	}
	if item.Evidence == nil {
		item.Evidence = map[string]any{}
	}
	if result.Kind == KindELFQuery && result.QueryID != "" {
		item.ELFHref = "/elf/" + result.QueryID
	}
	if result.Kind == KindDynatrace && result.ApplicationID != "" {
		item.DynatraceHref = "/applications/" + result.ApplicationID
	}
	return item
}

func first(value map[string]any, keys ...string) any {
	for _, key := range keys {
		if item, ok := value[key]; ok && item != nil {
			return item
		}
	}
	return nil
}

func asString(value any) string {
	switch typed := value.(type) {
	case string:
		return typed
	case fmt.Stringer:
		return typed.String()
	default:
		if value == nil {
			return ""
		}
		return strings.TrimSpace(fmt.Sprint(value))
	}
}

func asBool(value any) bool {
	typed, _ := value.(bool)
	return typed
}

func stringSlice(value any) []string {
	switch typed := value.(type) {
	case []string:
		return typed
	case []any:
		items := make([]string, 0, len(typed))
		for _, item := range typed {
			text := strings.TrimSpace(asString(item))
			if text != "" {
				items = append(items, text)
			}
		}
		return items
	default:
		return []string{}
	}
}

func truncateSummary(value string) string {
	value = strings.TrimSpace(value)
	if len(value) <= 400 {
		return value
	}
	return value[:400]
}
