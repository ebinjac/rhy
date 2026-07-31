package browsermonitors

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

type Runner interface {
	Health(context.Context) error
	Execute(context.Context, RunnerRequest) (RunnerResult, error)
}

type RunnerRequest struct {
	RunID           string                 `json:"runId"`
	MonitorID       string                 `json:"monitorId"`
	RevisionID      string                 `json:"revisionId"`
	Definition      Definition             `json:"definition"`
	Variables       map[string]string      `json:"variables"`
	SensitiveValues []string               `json:"sensitiveValues,omitempty"`
	StorageState    string                 `json:"storageState,omitempty"`
	Baselines       []RunnerBaseline       `json:"baselines,omitempty"`
	ArtifactUploads []RunnerArtifactUpload `json:"artifactUploads,omitempty"`
}

type RunnerBaseline struct {
	CheckpointID string `json:"checkpointId"`
	Fingerprint  string `json:"fingerprint"`
	ContentURL   string `json:"contentUrl"`
	MaxBytes     int64  `json:"maxBytes"`
}

type RunnerArtifactUpload struct {
	ID       string `json:"id"`
	URL      string `json:"url"`
	MaxBytes int64  `json:"maxBytes"`
}

type RunnerResult struct {
	Status                 string            `json:"status"`
	BrowserName            string            `json:"browserName"`
	BrowserVersion         string            `json:"browserVersion"`
	AgentImageVersion      string            `json:"agentImageVersion"`
	DurationMS             int64             `json:"durationMs"`
	WarningCount           int               `json:"warningCount"`
	FailureCategory        string            `json:"failureCategory,omitempty"`
	FailureReason          string            `json:"failureReason,omitempty"`
	FailedStepID           string            `json:"failedStepId,omitempty"`
	Metrics                map[string]any    `json:"metrics"`
	GraphEvidence          []map[string]any  `json:"graphEvidence"`
	VisualEvidence         []map[string]any  `json:"visualEvidence"`
	NetworkSummary         map[string]any    `json:"networkSummary"`
	ConsoleEvents          []map[string]any  `json:"consoleEvents"`
	Events                 []Event           `json:"events"`
	Steps                  []StepRun         `json:"steps"`
	Artifacts              []ArtifactPayload `json:"artifacts"`
	ArtifactUploadFailures int               `json:"artifactUploadFailures,omitempty"`
}

type ArtifactPayload struct {
	UploadID      string `json:"uploadId"`
	Kind          string `json:"kind"`
	CheckpointID  string `json:"checkpointId,omitempty"`
	ContentType   string `json:"contentType"`
	ByteSize      int64  `json:"byteSize"`
	ETag          string `json:"etag,omitempty"`
	ContentBase64 string `json:"contentBase64,omitempty"`
	Masked        bool   `json:"masked"`
}

type HTTPRunner struct {
	baseURL string
	token   string
	client  *http.Client
}

func NewHTTPRunner(baseURL, token string) *HTTPRunner {
	return &HTTPRunner{
		baseURL: strings.TrimRight(strings.TrimSpace(baseURL), "/"),
		token:   strings.TrimSpace(token),
		client:  &http.Client{Timeout: 2 * time.Minute},
	}
}

func (r *HTTPRunner) Health(ctx context.Context) error {
	if r.baseURL == "" {
		return errors.New("browser runner URL is not configured")
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, r.baseURL+"/healthz", nil)
	if err != nil {
		return err
	}
	response, err := r.client.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return fmt.Errorf("browser runner health returned %d", response.StatusCode)
	}
	return nil
}

func (r *HTTPRunner) Execute(ctx context.Context, input RunnerRequest) (RunnerResult, error) {
	body, err := json.Marshal(input)
	if err != nil {
		return RunnerResult{}, err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, r.baseURL+"/v1/execute", bytes.NewReader(body))
	if err != nil {
		return RunnerResult{}, err
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Accept", "application/json")
	if r.token != "" {
		request.Header.Set("Authorization", "Bearer "+r.token)
	}
	response, err := r.client.Do(request)
	if err != nil {
		return RunnerResult{}, err
	}
	defer response.Body.Close()
	limited, err := io.ReadAll(io.LimitReader(response.Body, 16<<20))
	if err != nil {
		return RunnerResult{}, err
	}
	if response.StatusCode != http.StatusOK {
		var failure struct {
			Error string `json:"error"`
		}
		_ = json.Unmarshal(limited, &failure)
		if failure.Error == "" {
			failure.Error = "browser runner rejected the execution"
		}
		return RunnerResult{}, errors.New(failure.Error)
	}
	var result RunnerResult
	if err := json.Unmarshal(limited, &result); err != nil {
		return RunnerResult{}, fmt.Errorf("decode browser runner response: %w", err)
	}
	return result, nil
}
