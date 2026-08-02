package authz

import (
	"errors"
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

func TestTrustedHeaderAuthenticator(t *testing.T) {
	authenticator, err := NewTrustedHeaderAuthenticator(TrustedHeaderConfig{
		IdentityHeader:    "X-Rhythm-User",
		GroupsHeader:      "X-Rhythm-Groups",
		TrustedProxyCIDRs: []string{"127.0.0.0/8"},
		RoleGroups: map[Role][]string{
			RoleAdministrator: {"rhythm-admins"},
			RoleOperator:      {"rhythm-operators"},
		},
	})
	if err != nil {
		t.Fatalf("configure authenticator: %v", err)
	}
	request, _ := http.NewRequest(http.MethodGet, "http://rhythm.local/api/v1/session", nil)
	request.RemoteAddr = "127.0.0.1:40000"
	request.Header.Set("X-Rhythm-User", "employee@example.com")
	request.Header.Set("X-Rhythm-Groups", "unrelated; RHYTHM-OPERATORS")
	principal, err := authenticator.Authenticate(request)
	if err != nil {
		t.Fatalf("authenticate trusted request: %v", err)
	}
	if principal.ID != "employee@example.com" || !HasRole(principal, RoleOperator) {
		t.Fatalf("unexpected principal: %#v", principal)
	}
}

func TestTrustedHeaderAuthenticatorRejectsUntrustedSourceAndMissingRole(t *testing.T) {
	authenticator, err := NewTrustedHeaderAuthenticator(TrustedHeaderConfig{
		IdentityHeader:    "X-Rhythm-User",
		GroupsHeader:      "X-Rhythm-Groups",
		TrustedProxyCIDRs: []string{"127.0.0.0/8"},
		RoleGroups:        map[Role][]string{RoleViewer: {"rhythm-viewers"}},
	})
	if err != nil {
		t.Fatalf("configure authenticator: %v", err)
	}
	request, _ := http.NewRequest(http.MethodGet, "http://rhythm.local/api/v1/session", nil)
	request.RemoteAddr = "10.20.30.40:1234"
	request.Header.Set("X-Rhythm-User", "employee@example.com")
	request.Header.Set("X-Rhythm-Groups", "rhythm-viewers")
	if _, err := authenticator.Authenticate(request); !errors.Is(err, ErrUnauthenticated) {
		t.Fatalf("expected untrusted source to be rejected, got %v", err)
	}

	request.RemoteAddr = "127.0.0.1:1234"
	request.Header.Set("X-Rhythm-Groups", "unmapped-group")
	if _, err := authenticator.Authenticate(request); !errors.Is(err, ErrUnauthenticated) {
		t.Fatalf("expected unmapped role to be rejected, got %v", err)
	}
}
