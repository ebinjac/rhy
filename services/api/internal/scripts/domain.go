package scripts

import (
	"context"
	"time"
)

const RuntimeVersion = "rhythm-js-1"

type Script struct {
	Enabled        bool   `json:"enabled"`
	Language       string `json:"language"`
	Code           string `json:"code"`
	RuntimeVersion string `json:"runtimeVersion"`
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

type Info struct {
	MonitorID      string `json:"monitorId"`
	RunID          string `json:"runId"`
	RevisionID     string `json:"revisionId"`
	StepID         string `json:"stepId"`
	RequestName    string `json:"requestName"`
	EventName      string `json:"eventName"`
	RuntimeVersion string `json:"runtimeVersion"`
}

type Input struct {
	Script              Script            `json:"script"`
	Scope               string            `json:"scope"`
	Preview             bool              `json:"preview"`
	AllowPrivateTargets bool              `json:"allowPrivateTargets"`
	Variables           map[string]string `json:"variables"`
	Environment         map[string]string `json:"environment"`
	Collection          map[string]string `json:"collection"`
	Globals             map[string]string `json:"globals"`
	Secrets             map[string]string `json:"secrets"`
	Cookies             map[string]string `json:"cookies"`
	Request             *Request          `json:"request,omitempty"`
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

type AuxiliaryRequest struct {
	Method     string `json:"method"`
	URL        string `json:"url"`
	Status     int    `json:"status,omitempty"`
	DurationMS int64  `json:"durationMs"`
	Error      string `json:"error,omitempty"`
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
	Variables           map[string]string  `json:"variables"`
	Environment         map[string]string  `json:"environment"`
	Collection          map[string]string  `json:"collection"`
	Cookies             map[string]string  `json:"cookies"`
	InternalVariables   map[string]string  `json:"internalVariables,omitempty"`
	InternalEnvironment map[string]string  `json:"internalEnvironment,omitempty"`
	InternalCollection  map[string]string  `json:"internalCollection,omitempty"`
	InternalCookies     map[string]string  `json:"internalCookies,omitempty"`
	InternalRequest     *Request           `json:"internalRequest,omitempty"`
	Request             *Request           `json:"request,omitempty"`
	Problems            []Problem          `json:"problems"`
	ErrorCategory       string             `json:"errorCategory,omitempty"`
	ErrorMessage        string             `json:"errorMessage,omitempty"`
	ErrorLine           int                `json:"errorLine,omitempty"`
	ErrorColumn         int                `json:"errorColumn,omitempty"`
	SafeStack           string             `json:"safeStack,omitempty"`
}

type Validation struct {
	Valid    bool      `json:"valid"`
	Problems []Problem `json:"problems"`
}

type Executor interface {
	Execute(context.Context, Input) (Result, error)
}
