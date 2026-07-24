package authz

import (
	"context"
	"errors"
	"net/http"
	"strings"
)

type Role string

const (
	RoleAdministrator Role = "ADMINISTRATOR"
	RoleEditor        Role = "EDITOR"
	RoleOperator      Role = "OPERATOR"
	RoleViewer        Role = "VIEWER"
)

type Principal struct {
	ID    string
	Roles []Role
}

type Authenticator interface {
	Authenticate(*http.Request) (Principal, error)
}

type principalContextKey struct{}

var ErrUnauthenticated = errors.New("unauthenticated")

func PrincipalFromContext(ctx context.Context) (Principal, bool) {
	principal, ok := ctx.Value(principalContextKey{}).(Principal)
	return principal, ok
}

func WithPrincipal(ctx context.Context, principal Principal) context.Context {
	return context.WithValue(ctx, principalContextKey{}, principal)
}

type DevelopmentAuthenticator struct {
	actorID string
}

func NewDevelopmentAuthenticator(actorID string) DevelopmentAuthenticator {
	return DevelopmentAuthenticator{actorID: actorID}
}

func (a DevelopmentAuthenticator) Authenticate(_ *http.Request) (Principal, error) {
	if a.actorID == "" {
		return Principal{}, ErrUnauthenticated
	}
	return Principal{ID: a.actorID, Roles: []Role{RoleAdministrator}}, nil
}

func HasRole(principal Principal, role Role) bool {
	for _, assigned := range principal.Roles {
		if assigned == role {
			return true
		}
	}
	return false
}

func Can(principal Principal, method, path string) bool {
	if HasRole(principal, RoleAdministrator) {
		return true
	}
	if method == http.MethodGet {
		if strings.HasPrefix(path, "/api/v1/config/") {
			return HasRole(principal, RoleEditor)
		}
		return HasRole(principal, RoleEditor) || HasRole(principal, RoleOperator) || HasRole(principal, RoleViewer)
	}
	if HasRole(principal, RoleEditor) {
		if strings.HasPrefix(path, "/api/v1/agents") || strings.HasPrefix(path, "/api/v1/alerts/") || strings.HasPrefix(path, "/api/v1/config/secrets") {
			return false
		}
		return strings.HasPrefix(path, "/api/v1/monitors") || strings.HasPrefix(path, "/api/v1/suites") || strings.HasPrefix(path, "/api/v1/suite-runs") || strings.HasPrefix(path, "/api/v1/deployment-runs") || strings.HasPrefix(path, "/api/v1/config/") || strings.HasPrefix(path, "/api/v1/applications") || strings.HasPrefix(path, "/api/v1/opensearch-alert-receivers") || (strings.HasPrefix(path, "/api/v1/elf/queries") && !strings.Contains(path, "/probe") && !strings.Contains(path, "/test"))
	}
	if HasRole(principal, RoleOperator) {
		return method == http.MethodPost && (strings.Contains(path, "/runs") || strings.HasSuffix(path, "/cancel") || strings.HasSuffix(path, "/acknowledge") || strings.HasSuffix(path, "/resolve") || strings.HasSuffix(path, "/probe") || strings.HasSuffix(path, "/test") || strings.HasSuffix(path, "/validate") || strings.HasSuffix(path, "/reconcile"))
	}
	return false
}
