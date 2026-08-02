package authz

import (
	"context"
	"errors"
	"net"
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
	ID    string `json:"id"`
	Roles []Role `json:"roles"`
}

type Authenticator interface {
	Authenticate(*http.Request) (Principal, error)
}

type principalContextKey struct{}

var ErrUnauthenticated = errors.New("unauthenticated")

type RejectingAuthenticator struct{}

func (RejectingAuthenticator) Authenticate(*http.Request) (Principal, error) {
	return Principal{}, ErrUnauthenticated
}

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

type TrustedHeaderConfig struct {
	IdentityHeader    string
	GroupsHeader      string
	TrustedProxyCIDRs []string
	RoleGroups        map[Role][]string
}

type TrustedHeaderAuthenticator struct {
	identityHeader string
	groupsHeader   string
	trustedProxies []*net.IPNet
	roleGroups     map[string]Role
}

func NewTrustedHeaderAuthenticator(config TrustedHeaderConfig) (TrustedHeaderAuthenticator, error) {
	identityHeader := strings.TrimSpace(config.IdentityHeader)
	groupsHeader := strings.TrimSpace(config.GroupsHeader)
	if identityHeader == "" || groupsHeader == "" {
		return TrustedHeaderAuthenticator{}, errors.New("trusted identity and group headers are required")
	}
	authenticator := TrustedHeaderAuthenticator{
		identityHeader: identityHeader,
		groupsHeader:   groupsHeader,
		roleGroups:     map[string]Role{},
	}
	for _, rawCIDR := range config.TrustedProxyCIDRs {
		_, network, err := net.ParseCIDR(strings.TrimSpace(rawCIDR))
		if err != nil {
			return TrustedHeaderAuthenticator{}, errors.New("trusted proxy CIDR is invalid")
		}
		authenticator.trustedProxies = append(authenticator.trustedProxies, network)
	}
	if len(authenticator.trustedProxies) == 0 {
		return TrustedHeaderAuthenticator{}, errors.New("at least one trusted proxy CIDR is required")
	}
	for role, groups := range config.RoleGroups {
		for _, group := range groups {
			if normalized := strings.ToLower(strings.TrimSpace(group)); normalized != "" {
				authenticator.roleGroups[normalized] = role
			}
		}
	}
	if len(authenticator.roleGroups) == 0 {
		return TrustedHeaderAuthenticator{}, errors.New("at least one trusted role group is required")
	}
	return authenticator, nil
}

func (a TrustedHeaderAuthenticator) Authenticate(request *http.Request) (Principal, error) {
	host, _, err := net.SplitHostPort(strings.TrimSpace(request.RemoteAddr))
	if err != nil {
		host = strings.TrimSpace(request.RemoteAddr)
	}
	remoteIP := net.ParseIP(host)
	trusted := false
	for _, network := range a.trustedProxies {
		if remoteIP != nil && network.Contains(remoteIP) {
			trusted = true
			break
		}
	}
	if !trusted {
		return Principal{}, ErrUnauthenticated
	}
	actorID := strings.TrimSpace(request.Header.Get(a.identityHeader))
	if actorID == "" || strings.ContainsAny(actorID, "\r\n") || len(actorID) > 255 {
		return Principal{}, ErrUnauthenticated
	}
	roles := make([]Role, 0, 4)
	seen := map[Role]struct{}{}
	for _, group := range strings.FieldsFunc(request.Header.Get(a.groupsHeader), func(character rune) bool {
		return character == ',' || character == ';'
	}) {
		role, ok := a.roleGroups[strings.ToLower(strings.TrimSpace(group))]
		if !ok {
			continue
		}
		if _, exists := seen[role]; !exists {
			seen[role] = struct{}{}
			roles = append(roles, role)
		}
	}
	if len(roles) == 0 {
		return Principal{}, ErrUnauthenticated
	}
	return Principal{ID: actorID, Roles: roles}, nil
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
		return strings.HasPrefix(path, "/api/v1/monitors") || strings.HasPrefix(path, "/api/v1/browser-monitors") || strings.HasPrefix(path, "/api/v1/browser-baselines") || strings.HasPrefix(path, "/api/v1/suites") || strings.HasPrefix(path, "/api/v1/suite-runs") || strings.HasPrefix(path, "/api/v1/deployment-runs") || strings.HasPrefix(path, "/api/v1/config/") || strings.HasPrefix(path, "/api/v1/applications") || strings.HasPrefix(path, "/api/v1/opensearch-alert-receivers") || (strings.HasPrefix(path, "/api/v1/elf/queries") && !strings.Contains(path, "/probe") && !strings.Contains(path, "/test"))
	}
	if HasRole(principal, RoleOperator) {
		return method == http.MethodPost && (strings.Contains(path, "/runs") || strings.HasSuffix(path, "/cancel") || strings.HasSuffix(path, "/acknowledge") || strings.HasSuffix(path, "/resolve") || strings.HasSuffix(path, "/probe") || strings.HasSuffix(path, "/preview") || strings.HasSuffix(path, "/test") || strings.HasSuffix(path, "/validate") || strings.HasSuffix(path, "/renew") || strings.HasSuffix(path, "/reconcile") || strings.HasSuffix(path, "/query") || strings.HasSuffix(path, "/resources/preview") || strings.HasSuffix(path, "/resources/discover"))
	}
	return false
}
