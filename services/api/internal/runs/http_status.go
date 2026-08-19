package runs

import "strconv"

const NoResponseStatusKey = "NO_RESPONSE"

const (
	StatusClass1xx        = "1xx"
	StatusClass2xx        = "2xx"
	StatusClass3xx        = "3xx"
	StatusClass4xx        = "4xx"
	StatusClass5xx        = "5xx"
	StatusClassTimeout    = "timeout"
	StatusClassNoResponse = "no_response"
)

// LastAttemptResponseStatus returns the HTTP status of the last attempt on the
// last step that recorded attempts. Earlier retries are ignored so a later
// failure without a response is not reported as the previous 200.
func LastAttemptResponseStatus(steps []StepRun) (int, bool) {
	for index := len(steps) - 1; index >= 0; index-- {
		attempts := steps[index].Attempts
		if len(attempts) == 0 {
			continue
		}
		status := attempts[len(attempts)-1].ResponseStatus
		if status > 0 {
			return status, true
		}
		return 0, false
	}
	return 0, false
}

func HTTPStatusClass(status Status, responseStatus int, hasStatus bool) string {
	if hasStatus && responseStatus > 0 {
		switch responseStatus / 100 {
		case 1:
			return StatusClass1xx
		case 2:
			return StatusClass2xx
		case 3:
			return StatusClass3xx
		case 4:
			return StatusClass4xx
		case 5:
			return StatusClass5xx
		}
	}
	if status == StatusTimedOut {
		return StatusClassTimeout
	}
	return StatusClassNoResponse
}

func ResponseStatusDistributionKey(responseStatus int, hasStatus bool) string {
	if hasStatus && responseStatus > 0 {
		return strconv.Itoa(responseStatus)
	}
	return NoResponseStatusKey
}

func incrementBucketCounts(counts *HistoryBucketCounts, point HistoryMetricPoint) {
	switch point.Status {
	case StatusSuccess, StatusSuccessWithWarnings:
		counts.Success++
	case StatusTimedOut:
		counts.Timeout++
	case StatusFailed, StatusAborted:
		counts.Failed++
	}
	if !countsHTTPOutcome(point.Status) {
		return
	}
	if point.ResponseStatus != nil && *point.ResponseStatus > 0 {
		switch *point.ResponseStatus / 100 {
		case 1:
			counts.Class1xx++
		case 2:
			counts.Class2xx++
		case 3:
			counts.Class3xx++
		case 4:
			counts.Class4xx++
		case 5:
			counts.Class5xx++
		}
		return
	}
	if point.Status == StatusTimedOut {
		counts.HTTPTimeout++
		return
	}
	counts.NoResponse++
}

func countsHTTPOutcome(status Status) bool {
	switch status {
	case StatusQueued, StatusStarting, StatusRunning, StatusCancelled, StatusSkipped:
		return false
	default:
		return true
	}
}
