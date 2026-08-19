package runs

// apiResponsePhaseKeys are historical httptrace names for target-facing HTTP
// time. Older stored maps used networkTotalMs or these phase keys instead of
// apiResponseTimeMs; operators should see the current name.
var apiResponsePhaseKeys = []string{
	"dnsMs",
	"proxyConnectMs",
	"connectMs",
	"tlsHandshakeMs",
	"requestWriteMs",
	"serverWaitMs",
	"downloadMs",
}

// RecordedAPIResponseMS returns target-facing HTTP time from a step or attempt
// timing map. Missing apiResponseTimeMs is translated from older stored keys
// instead of being treated as absent.
func RecordedAPIResponseMS(timing map[string]any) (int64, bool) {
	if timing == nil {
		return 0, false
	}
	if _, ok := timing["apiResponseTimeMs"]; ok {
		return timingMilliseconds(timing, "apiResponseTimeMs"), true
	}
	if _, ok := timing["networkTotalMs"]; ok {
		return timingMilliseconds(timing, "networkTotalMs"), true
	}
	var sum int64
	found := false
	for _, key := range apiResponsePhaseKeys {
		if _, ok := timing[key]; !ok {
			continue
		}
		sum += timingMilliseconds(timing, key)
		found = true
	}
	if found {
		return sum, true
	}
	return 0, false
}

// RecordedPreparationMS returns Rhythm-side setup time from a timing map.
func RecordedPreparationMS(timing map[string]any) (int64, bool) {
	if timing == nil {
		return 0, false
	}
	if _, ok := timing["preparationMs"]; ok {
		return timingMilliseconds(timing, "preparationMs"), true
	}
	if _, ok := timing["preRequestScriptMs"]; ok {
		return timingMilliseconds(timing, "preRequestScriptMs"), true
	}
	return 0, false
}

func StepAPIResponseMS(step StepRun) (int64, bool) {
	if value, ok := RecordedAPIResponseMS(step.Timing); ok {
		return value, true
	}
	if len(step.Attempts) == 0 {
		return 0, false
	}
	last := step.Attempts[len(step.Attempts)-1]
	if value, ok := RecordedAPIResponseMS(last.Timing); ok {
		return value, true
	}
	if last.DurationMS > 0 {
		return last.DurationMS, true
	}
	return 0, false
}

func RunAPIResponseFromSteps(steps []StepRun) (int64, bool) {
	var total int64
	recorded := false
	for _, step := range steps {
		value, ok := StepAPIResponseMS(step)
		if !ok {
			continue
		}
		total += value
		recorded = true
	}
	return total, recorded
}

func RunPreparationFromSteps(steps []StepRun) (int64, bool) {
	var total int64
	recorded := false
	for _, step := range steps {
		value, ok := RecordedPreparationMS(step.Timing)
		if !ok {
			continue
		}
		total += value
		recorded = true
	}
	return total, recorded
}
