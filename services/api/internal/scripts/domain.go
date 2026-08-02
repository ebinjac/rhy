package scripts

import (
	"context"
	"time"
)

const (
	RuntimeVersion       = "rhythm-js-2"
	LegacyRuntimeVersion = "rhythm-js-1"
)

type Script struct {
	Enabled        bool          `json:"enabled"`
	Language       string        `json:"language"`
	Code           string        `json:"code"`
	RuntimeVersion string        `json:"runtimeVersion"`
	Packages       []TeamPackage `json:"packages,omitempty"`
}

type TeamPackage struct {
	Name string `json:"name"`
	Code string `json:"code"`
}

type Entry struct {
	Key       string `json:"key"`
	Value     string `json:"value"`
	Sensitive bool   `json:"sensitive,omitempty"`
}

type Request struct {
	Method  string         `json:"method"`
	URL     string         `json:"url"`
	Headers []Entry        `json:"headers"`
	Query   []Entry        `json:"query"`
	Body    map[string]any `json:"body"`
	Auth    map[string]any `json:"auth"`
}

type Response struct {
	Code           int               `json:"code"`
	Status         string            `json:"status"`
	Headers        map[string]string `json:"headers"`
	Body           string            `json:"body"`
	ResponseTimeMS int64             `json:"responseTimeMs"`
	ResponseSize   int               `json:"responseSize"`
	ContentType    string            `json:"contentType,omitempty"`
	Truncated      bool              `json:"truncated,omitempty"`
}

type Info struct {
	MonitorID      string `json:"monitorId"`
	RunID          string `json:"runId"`
	RevisionID     string `json:"revisionId"`
	StepID         string `json:"stepId"`
	RequestName    string `json:"requestName"`
	EventName      string `json:"eventName"`
	Iteration      int    `json:"iteration"`
	IterationCount int    `json:"iterationCount"`
	RuntimeVersion string `json:"runtimeVersion"`
}

type Input struct {
	Script              Script            `json:"script"`
	Scope               string            `json:"scope"`
	Preview             bool              `json:"preview"`
	AllowPrivateTargets bool              `json:"allowPrivateTargets"`
	AllowedPrivateHosts []string          `json:"allowedPrivateHosts,omitempty"`
	AllowedPrivateCIDRs []string          `json:"allowedPrivateCidrs,omitempty"`
	Variables           map[string]string `json:"variables"`
	Environment         map[string]string `json:"environment"`
	Collection          map[string]string `json:"collection"`
	Globals             map[string]string `json:"globals"`
	Secrets             map[string]string `json:"secrets"`
	Cookies             map[string]string `json:"cookies"`
	Request             *Request          `json:"request,omitempty"`
	Response            *Response         `json:"response,omitempty"`
	IterationData       map[string]string `json:"iterationData,omitempty"`
	State               map[string]any    `json:"state,omitempty"`
	Info                Info              `json:"info"`
	TimeoutMS           int               `json:"timeoutMs"`
}

type Log struct {
	Level     string    `json:"level"`
	Message   string    `json:"message"`
	Timestamp time.Time `json:"timestamp"`
}

type Test struct {
	Name    string `json:"name"`
	Passed  bool   `json:"passed"`
	Skipped bool   `json:"skipped,omitempty"`
	Error   string `json:"error,omitempty"`
}

type Change struct {
	Scope     string `json:"scope"`
	Key       string `json:"key"`
	Operation string `json:"operation"`
	Before    any    `json:"before,omitempty"`
	After     any    `json:"after,omitempty"`
	State     string `json:"state"`
}

// AuxiliaryRequest is evidence for one pm.sendRequest call made from a script.
// It is recorded in call order and nested under Result.AuxiliaryRequests
// (preview and persisted pre-request / setup script evidence share this shape).
type AuxiliaryRequest struct {
	Source     string `json:"source"` // always "pm.sendRequest"
	Method     string `json:"method"`
	URL        string `json:"url"`
	Status     int    `json:"status,omitempty"`
	DurationMS int64  `json:"durationMs"`
	Success    bool   `json:"success"`
	Error      string `json:"error,omitempty"`
}

type PackageImport struct {
	Specifier  string `json:"specifier"`
	Registry   string `json:"registry"`
	Version    string `json:"version"`
	DurationMS int64  `json:"durationMs"`
	Cached     bool   `json:"cached"`
}

type Problem struct {
	Severity string `json:"severity"`
	Message  string `json:"message"`
	Line     int    `json:"line"`
	Column   int    `json:"column"`
	Code     string `json:"code"`
}

type Result struct {
	Status              string             `json:"status"`
	RuntimeVersion      string             `json:"runtimeVersion"`
	DurationMS          int64              `json:"durationMs"`
	Logs                []Log              `json:"logs"`
	Tests               []Test             `json:"tests"`
	VariableChanges     []Change           `json:"variableChanges"`
	RequestChanges      []Change           `json:"requestChanges"`
	AuxiliaryRequests   []AuxiliaryRequest `json:"auxiliaryRequests"`
	PackageImports      []PackageImport    `json:"packageImports"`
	Variables           map[string]string  `json:"variables"`
	Environment         map[string]string  `json:"environment"`
	Collection          map[string]string  `json:"collection"`
	Globals             map[string]string  `json:"globals"`
	Cookies             map[string]string  `json:"cookies"`
	InternalVariables   map[string]string  `json:"internalVariables,omitempty"`
	InternalEnvironment map[string]string  `json:"internalEnvironment,omitempty"`
	InternalCollection  map[string]string  `json:"internalCollection,omitempty"`
	InternalGlobals     map[string]string  `json:"internalGlobals,omitempty"`
	InternalCookies     map[string]string  `json:"internalCookies,omitempty"`
	InternalState       map[string]any     `json:"internalState,omitempty"`
	InternalRequest     *Request           `json:"internalRequest,omitempty"`
	Request             *Request           `json:"request,omitempty"`
	State               map[string]any     `json:"state,omitempty"`
	Visualizer          *Visualizer        `json:"visualizer,omitempty"`
	Execution           Execution          `json:"execution"`
	Problems            []Problem          `json:"problems"`
	ErrorCategory       string             `json:"errorCategory,omitempty"`
	ErrorMessage        string             `json:"errorMessage,omitempty"`
	ErrorLine           int                `json:"errorLine,omitempty"`
	ErrorColumn         int                `json:"errorColumn,omitempty"`
	SafeStack           string             `json:"safeStack,omitempty"`
}

type Visualizer struct {
	Template string         `json:"template"`
	Data     map[string]any `json:"data"`
	Options  map[string]any `json:"options,omitempty"`
}

type Execution struct {
	RequestSkipped bool   `json:"requestSkipped,omitempty"`
	NextRequestSet bool   `json:"nextRequestSet,omitempty"`
	NextRequest    string `json:"nextRequest,omitempty"`
}

type Validation struct {
	Valid    bool      `json:"valid"`
	Problems []Problem `json:"problems"`
}

// AuxiliaryRequestDurationMS sums wall-clock durations of every pm.sendRequest
// recorded on a script result (call order preserved in AuxiliaryRequests).
func AuxiliaryRequestDurationMS(result Result) int64 {
	var total int64
	for _, request := range result.AuxiliaryRequests {
		total += request.DurationMS
	}
	return total
}

type Executor interface {
	Execute(context.Context, Input) (Result, error)
}
