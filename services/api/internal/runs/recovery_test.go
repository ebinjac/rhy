package runs

import (
	"testing"

	"github.com/rhythm-monitoring/rhythm/internal/scripts"
)

func TestDefinitionRecoverySafety(t *testing.T) {
	tests := []struct {
		name       string
		definition Definition
		safe       bool
	}{
		{
			name: "get workflow",
			definition: Definition{Steps: []StepDefinition{{
				Enabled: true,
				Type:    "HTTP_REQUEST",
				Request: RequestConfig{Method: "GET"},
			}}},
			safe: true,
		},
		{
			name: "post without idempotency key",
			definition: Definition{Steps: []StepDefinition{{
				Enabled: true,
				Type:    "HTTP_REQUEST",
				Request: RequestConfig{Method: "POST"},
			}}},
			safe: false,
		},
		{
			name: "post with stable idempotency key",
			definition: Definition{Steps: []StepDefinition{{
				Enabled: true,
				Type:    "HTTP_REQUEST",
				Request: RequestConfig{Method: "POST", Headers: []KeyValue{{
					Enabled: true, Key: "Idempotency-Key", Value: "deployment-validation-v1",
				}}},
			}}},
			safe: true,
		},
		{
			name: "script can create side effects",
			definition: Definition{
				Scripts: DefinitionScripts{PreRequest: scripts.Script{Code: "pm.sendRequest('https://example.com')"}},
				Steps: []StepDefinition{{
					Enabled: true,
					Type:    "HTTP_REQUEST",
					Request: RequestConfig{Method: "GET"},
				}},
			},
			safe: false,
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if actual := definitionRecoverySafe(test.definition); actual != test.safe {
				t.Fatalf("definitionRecoverySafe()=%v, want %v", actual, test.safe)
			}
		})
	}
}
