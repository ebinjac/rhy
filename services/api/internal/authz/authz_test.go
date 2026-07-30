package authz

import (
	"net/http"
	"testing"
)

func TestRolePermissions(t *testing.T) {
	tests := []struct {
		name         string
		role         Role
		method, path string
		allowed      bool
	}{
		{"viewer reads monitors", RoleViewer, http.MethodGet, "/api/v1/monitors", true},
		{"viewer cannot create", RoleViewer, http.MethodPost, "/api/v1/monitors", false},
		{"editor publishes", RoleEditor, http.MethodPost, "/api/v1/monitors/one/publish", true},
		{"editor cannot control agents", RoleEditor, http.MethodPost, "/api/v1/agents/one/drain", false},
		{"editor cannot manage secret references", RoleEditor, http.MethodPost, "/api/v1/config/secrets", false},
		{"operator runs monitor", RoleOperator, http.MethodPost, "/api/v1/monitors/one/runs", true},
		{"operator acknowledges alert", RoleOperator, http.MethodPost, "/api/v1/alerts/one/acknowledge", true},
		{"operator queries dynatrace", RoleOperator, http.MethodPost, "/api/v1/applications/one/environments/two/dynatrace/query", true},
		{"operator previews dynatrace resources", RoleOperator, http.MethodPost, "/api/v1/applications/one/environments/two/dynatrace/resources/preview", true},
		{"operator discovers dynatrace resources", RoleOperator, http.MethodPost, "/api/v1/applications/one/environments/two/dynatrace/resources/discover", true},
		{"operator cannot edit", RoleOperator, http.MethodPut, "/api/v1/monitors/one/draft", false},
		{"administrator controls agents", RoleAdministrator, http.MethodPost, "/api/v1/agents/one/revoke", true},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			actual := Can(Principal{ID: "user", Roles: []Role{test.role}}, test.method, test.path)
			if actual != test.allowed {
				t.Fatalf("permission=%v expected %v", actual, test.allowed)
			}
		})
	}
}
