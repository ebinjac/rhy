package dynatrace

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"strconv"
	"strings"
	"time"
)

const maxResponseBytes = 1 << 20

type Provider interface {
	ListEntities(context.Context, Connection, string, int) ([]Entity, error)
	MetricDescriptor(context.Context, Connection, string) (MetricDescriptor, error)
	QueryMetric(context.Context, Connection, MetricQuery) ([]ResourceMetric, string, error)
}

type Connection struct {
	BaseURL              string
	Token                string
	Timeout              time.Duration
	ClientCertificatePEM string
	ClientKeyPEM         string
	CABundlePEM          string
	ProxyURL             string
	ProxyNoProxy         string
	ProxyUsername        string
	ProxyPassword        string
}

type MetricQuery struct {
	MetricSelector         string
	EntitySelector         string
	ManagementZoneSelector string
	From                   time.Time
	To                     time.Time
	Resolution             string
	Units                  map[string]string
}

type EnvironmentV2Provider struct {
	transport    *http.Transport
	allowedHosts map[string]struct{}
}

func NewEnvironmentV2Provider(allowedHosts []string, allowPrivate bool) *EnvironmentV2Provider {
	hosts := map[string]struct{}{}
	for _, host := range allowedHosts {
		if normalized := strings.ToLower(strings.TrimSpace(host)); normalized != "" {
			hosts[normalized] = struct{}{}
		}
	}
	transport := http.DefaultTransport.(*http.Transport).Clone()
	dialer := &net.Dialer{Timeout: 5 * time.Second, KeepAlive: 30 * time.Second}
	transport.DialContext = func(ctx context.Context, network, address string) (net.Conn, error) {
		host, port, err := net.SplitHostPort(address)
		if err != nil {
			return nil, err
		}
		addresses, err := net.DefaultResolver.LookupNetIP(ctx, "ip", host)
		if err != nil {
			return nil, fmt.Errorf("resolve Dynatrace host: %w", err)
		}
		for _, address := range addresses {
			if !allowPrivate && unsafeAddress(address) {
				return nil, errors.New("Dynatrace host resolved to a private or reserved address")
			}
		}
		if len(addresses) == 0 {
			return nil, errors.New("Dynatrace host did not resolve")
		}
		return dialer.DialContext(ctx, network, net.JoinHostPort(addresses[0].String(), port))
	}
	return &EnvironmentV2Provider{
		allowedHosts: hosts,
		transport:    transport,
	}
}

func unsafeAddress(address netip.Addr) bool {
	return address.IsPrivate() || address.IsLoopback() || address.IsLinkLocalUnicast() ||
		address.IsLinkLocalMulticast() || address.IsMulticast() || address.IsUnspecified()
}

func (p *EnvironmentV2Provider) validateConnection(connection Connection) (*url.URL, error) {
	parsed, err := url.Parse(strings.TrimRight(strings.TrimSpace(connection.BaseURL), "/"))
	if err != nil || parsed.Host == "" || parsed.Scheme != "https" && parsed.Scheme != "http" {
		return nil, errors.New("Dynatrace connection URL is invalid")
	}
	if parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" {
		return nil, errors.New("Dynatrace connection URL must not contain credentials, query parameters, or fragments")
	}
	if _, allowed := p.allowedHosts[strings.ToLower(parsed.Hostname())]; !allowed {
		return nil, errors.New("Dynatrace endpoint is not in the administrator allowlist")
	}
	if strings.TrimSpace(connection.Token) == "" {
		return nil, errors.New("Dynatrace API token is unavailable")
	}
	return parsed, nil
}

func (p *EnvironmentV2Provider) request(ctx context.Context, connection Connection, path string, query url.Values, target any) (string, error) {
	base, err := p.validateConnection(connection)
	if err != nil {
		return "", err
	}
	base.Path = strings.TrimRight(base.Path, "/") + path
	base.RawQuery = query.Encode()
	client, err := p.clientFor(connection, base)
	if err != nil {
		return "", err
	}
	var last error
	for attempt := 0; attempt < 3; attempt++ {
		if attempt > 0 {
			wait := time.Duration(1<<uint(attempt-1)) * 200 * time.Millisecond
			select {
			case <-ctx.Done():
				return "", ctx.Err()
			case <-time.After(wait):
			}
		}
		req, requestErr := http.NewRequestWithContext(ctx, http.MethodGet, base.String(), nil)
		if requestErr != nil {
			return "", requestErr
		}
		req.Header.Set("Accept", "application/json")
		req.Header.Set("Authorization", "Api-Token "+connection.Token)
		response, requestErr := client.Do(req)
		if requestErr != nil {
			last = requestErr
			continue
		}
		correlationID := firstHeader(response.Header, "x-dynatrace-request-id", "x-request-id", "traceparent")
		body, readErr := io.ReadAll(io.LimitReader(response.Body, maxResponseBytes+1))
		_ = response.Body.Close()
		if readErr != nil {
			return correlationID, readErr
		}
		if len(body) > maxResponseBytes {
			return correlationID, errors.New("Dynatrace response exceeded the 1 MB evidence limit")
		}
		if response.StatusCode >= 200 && response.StatusCode < 300 {
			if err := json.Unmarshal(body, target); err != nil {
				return correlationID, errors.New("Dynatrace returned malformed JSON")
			}
			return correlationID, nil
		}
		safe := safeDynatraceError(response.StatusCode)
		if response.StatusCode == http.StatusTooManyRequests || response.StatusCode == http.StatusBadGateway ||
			response.StatusCode == http.StatusServiceUnavailable || response.StatusCode == http.StatusGatewayTimeout {
			last = errors.New(safe)
			if retryAfter := response.Header.Get("Retry-After"); retryAfter != "" {
				if seconds, parseErr := strconv.Atoi(retryAfter); parseErr == nil && seconds > 0 && seconds <= 5 {
					select {
					case <-ctx.Done():
						return correlationID, ctx.Err()
					case <-time.After(time.Duration(seconds) * time.Second):
					}
				}
			}
			continue
		}
		return correlationID, errors.New(safe)
	}
	if last == nil {
		last = errors.New("Dynatrace request failed")
	}
	return "", last
}

func (p *EnvironmentV2Provider) clientFor(connection Connection, target *url.URL) (*http.Client, error) {
	transport := p.transport.Clone()
	if connection.CABundlePEM != "" || connection.ClientCertificatePEM != "" || connection.ClientKeyPEM != "" {
		tlsConfig := &tls.Config{MinVersion: tls.VersionTLS12}
		if connection.CABundlePEM != "" {
			roots, err := x509.SystemCertPool()
			if err != nil || roots == nil {
				roots = x509.NewCertPool()
			}
			if !roots.AppendCertsFromPEM([]byte(connection.CABundlePEM)) {
				return nil, errors.New("Dynatrace CA profile does not contain a valid PEM certificate")
			}
			tlsConfig.RootCAs = roots
		}
		if connection.ClientCertificatePEM != "" || connection.ClientKeyPEM != "" {
			if connection.ClientCertificatePEM == "" || connection.ClientKeyPEM == "" {
				return nil, errors.New("Dynatrace client TLS profile requires both certificate and private key")
			}
			certificate, err := tls.X509KeyPair([]byte(connection.ClientCertificatePEM), []byte(connection.ClientKeyPEM))
			if err != nil {
				return nil, errors.New("Dynatrace client TLS certificate could not be loaded")
			}
			tlsConfig.Certificates = []tls.Certificate{certificate}
		}
		transport.TLSClientConfig = tlsConfig
	}
	if connection.ProxyURL != "" && !matchesNoProxy(target.Hostname(), connection.ProxyNoProxy) {
		proxyURL, err := url.Parse(connection.ProxyURL)
		if err != nil || proxyURL.Host == "" || proxyURL.Scheme != "http" && proxyURL.Scheme != "https" {
			return nil, errors.New("Dynatrace proxy profile URL is invalid")
		}
		if connection.ProxyUsername != "" {
			proxyURL.User = url.UserPassword(connection.ProxyUsername, connection.ProxyPassword)
		}
		transport.Proxy = http.ProxyURL(proxyURL)
	}
	timeout := connection.Timeout
	if timeout <= 0 || timeout > 30*time.Second {
		timeout = 30 * time.Second
	}
	return &http.Client{
		Transport: transport,
		Timeout:   timeout,
		CheckRedirect: func(_ *http.Request, _ []*http.Request) error {
			return errors.New("Dynatrace redirects are not allowed")
		},
	}, nil
}

func matchesNoProxy(host, configured string) bool {
	host = strings.ToLower(strings.TrimSpace(host))
	for _, entry := range strings.Split(configured, ",") {
		entry = strings.ToLower(strings.TrimSpace(entry))
		if entry == "" {
			continue
		}
		if host == entry || strings.HasPrefix(entry, ".") && strings.HasSuffix(host, entry) {
			return true
		}
	}
	return false
}

func firstHeader(header http.Header, keys ...string) string {
	for _, key := range keys {
		if value := strings.TrimSpace(header.Get(key)); value != "" {
			if len(value) > 160 {
				return value[:160]
			}
			return value
		}
	}
	return ""
}

func safeDynatraceError(status int) string {
	switch status {
	case http.StatusUnauthorized:
		return "Dynatrace rejected the API token"
	case http.StatusForbidden:
		return "Dynatrace token lacks metrics.read or entities.read permission"
	case http.StatusNotFound:
		return "Dynatrace metric or resource was not found"
	case http.StatusTooManyRequests:
		return "Dynatrace rate limit was reached"
	case http.StatusBadRequest:
		return "Dynatrace rejected the governed selector or metric query"
	default:
		return fmt.Sprintf("Dynatrace returned HTTP %d", status)
	}
}

type entitiesResponse struct {
	TotalCount  int    `json:"totalCount"`
	NextPageKey string `json:"nextPageKey"`
	Entities    []struct {
		EntityID struct {
			ID   string `json:"id"`
			Type string `json:"type"`
		} `json:"entityId"`
		DisplayName string         `json:"displayName"`
		Properties  map[string]any `json:"properties"`
		Tags        []struct {
			Context              string `json:"context"`
			Key                  string `json:"key"`
			Value                string `json:"value"`
			StringRepresentation string `json:"stringRepresentation"`
		} `json:"tags"`
		ManagementZones []struct {
			ID   string `json:"id"`
			Name string `json:"name"`
		} `json:"managementZones"`
	} `json:"entities"`
}

func (p *EnvironmentV2Provider) ListEntities(ctx context.Context, connection Connection, selector string, limit int) ([]Entity, error) {
	if limit <= 0 || limit > 500 {
		limit = 500
	}
	var out []Entity
	next := ""
	for len(out) < limit {
		query := url.Values{"pageSize": {strconv.Itoa(min(500, limit-len(out)))}}
		if next == "" {
			query.Set("entitySelector", selector)
			query.Set("fields", "+properties,+tags,+managementZones")
		} else {
			query.Set("nextPageKey", next)
		}
		var response entitiesResponse
		if _, err := p.request(ctx, connection, "/api/v2/entities", query, &response); err != nil {
			return nil, err
		}
		for _, item := range response.Entities {
			entity := Entity{ID: item.EntityID.ID, Type: item.EntityID.Type, Name: item.DisplayName, Properties: item.Properties, Tags: []string{}, ManagementZones: []string{}}
			for _, tag := range item.Tags {
				value := tag.StringRepresentation
				if value == "" {
					value = tag.Key
					if tag.Value != "" {
						value += ":" + tag.Value
					}
				}
				entity.Tags = append(entity.Tags, value)
			}
			for _, zone := range item.ManagementZones {
				entity.ManagementZones = append(entity.ManagementZones, zone.Name)
			}
			out = append(out, entity)
			if len(out) == limit {
				break
			}
		}
		next = response.NextPageKey
		if next == "" || len(response.Entities) == 0 {
			break
		}
	}
	return out, nil
}

func (p *EnvironmentV2Provider) MetricDescriptor(ctx context.Context, connection Connection, metricID string) (MetricDescriptor, error) {
	var response struct {
		MetricID             string   `json:"metricId"`
		DisplayName          string   `json:"displayName"`
		Description          string   `json:"description"`
		Unit                 string   `json:"unit"`
		DefaultAggregation   any      `json:"defaultAggregation"`
		AggregationTypes     []string `json:"aggregationTypes"`
		Transformations      []string `json:"transformations"`
		DimensionDefinitions []struct {
			Key string `json:"key"`
		} `json:"dimensionDefinitions"`
	}
	path := "/api/v2/metrics/" + url.PathEscape(strings.TrimSpace(metricID))
	if _, err := p.request(ctx, connection, path, nil, &response); err != nil {
		return MetricDescriptor{}, err
	}
	descriptor := MetricDescriptor{
		MetricID: response.MetricID, DisplayName: response.DisplayName, Description: response.Description,
		Unit: response.Unit, DefaultAggregation: defaultAggregation(response.DefaultAggregation),
		AggregationTypes: response.AggregationTypes, Transformations: response.Transformations,
	}
	for _, dimension := range response.DimensionDefinitions {
		descriptor.DimensionDefinitions = append(descriptor.DimensionDefinitions, dimension.Key)
	}
	return descriptor, nil
}

func defaultAggregation(value any) string {
	switch typed := value.(type) {
	case string:
		return typed
	case map[string]any:
		return textValue(typed["type"])
	default:
		return ""
	}
}

func textValue(value any) string {
	if value == nil {
		return ""
	}
	return strings.TrimSpace(fmt.Sprint(value))
}

func (p *EnvironmentV2Provider) QueryMetric(ctx context.Context, connection Connection, input MetricQuery) ([]ResourceMetric, string, error) {
	query := url.Values{
		"metricSelector": {input.MetricSelector},
		"from":           {input.From.UTC().Format(time.RFC3339Nano)},
		"to":             {input.To.UTC().Format(time.RFC3339Nano)},
		"resolution":     {defaultString(input.Resolution, "1m")},
	}
	if input.EntitySelector != "" {
		query.Set("entitySelector", input.EntitySelector)
	}
	if input.ManagementZoneSelector != "" {
		query.Set("mzSelector", input.ManagementZoneSelector)
	}
	var response struct {
		Result []struct {
			MetricID string `json:"metricId"`
			Data     []struct {
				Dimensions   []string          `json:"dimensions"`
				DimensionMap map[string]string `json:"dimensionMap"`
				Timestamps   []int64           `json:"timestamps"`
				Values       []*float64        `json:"values"`
			} `json:"data"`
		} `json:"result"`
	}
	correlationID, err := p.request(ctx, connection, "/api/v2/metrics/query", query, &response)
	if err != nil {
		return nil, correlationID, err
	}
	out := []ResourceMetric{}
	for _, result := range response.Result {
		for _, data := range result.Data {
			resourceID, resourceType, resourceName := resourceDimension(data.DimensionMap, data.Dimensions)
			points := make([]SeriesPoint, 0, min(len(data.Timestamps), len(data.Values)))
			for index := 0; index < len(data.Timestamps) && index < len(data.Values); index++ {
				points = append(points, SeriesPoint{Timestamp: time.UnixMilli(data.Timestamps[index]).UTC(), Value: data.Values[index]})
			}
			out = append(out, ResourceMetric{
				ResourceID: resourceID, ResourceName: resourceName, ResourceType: resourceType,
				Metric: metricKind(result.MetricID), Aggregation: metricAggregation(result.MetricID),
				Selector: result.MetricID, Unit: metricUnit(result.MetricID, input.Units),
				Series: downsample(points, 1000), Statistics: calculateStatistics(points),
			})
		}
	}
	return out, correlationID, nil
}

func resourceDimension(dimensions map[string]string, fallback []string) (string, string, string) {
	for _, key := range []string{"dt.entity.host", "dt.entity.container_group_instance", "dt.entity.container_group"} {
		if value := strings.TrimSpace(dimensions[key]); value != "" {
			return value, strings.ToUpper(strings.TrimPrefix(key, "dt.entity.")), dimensions[key+".name"]
		}
	}
	for key, value := range dimensions {
		lower := strings.ToLower(key)
		if strings.HasSuffix(lower, ".name") {
			continue
		}
		if strings.HasPrefix(lower, "dt.entity.") {
			return value, strings.ToUpper(strings.TrimPrefix(lower, "dt.entity.")), dimensions[key+".name"]
		}
		if lower == "container" || strings.Contains(lower, "container.name") {
			return value, "CONTAINER", value
		}
	}
	if len(fallback) > 0 {
		return fallback[0], "", fallback[0]
	}
	return "aggregate", "AGGREGATE", "Aggregate"
}

func metricAggregation(selector string) string {
	lower := strings.ToLower(selector)
	if strings.Contains(lower, ":max") || strings.Contains(lower, ":fold(max)") {
		return "MAX"
	}
	return "AVG"
}

func metricKind(selector string) string {
	lower := strings.ToLower(selector)
	if strings.Contains(lower, ".memory.") || strings.Contains(lower, ".mem.") {
		return "MEMORY"
	}
	return "CPU"
}

func metricUnit(selector string, units map[string]string) string {
	base := strings.Split(selector, ":splitBy")[0]
	base = strings.Split(base, ":fold")[0]
	if value := units[base]; value != "" {
		return value
	}
	return units[metricKind(selector)]
}

func calculateStatistics(points []SeriesPoint) Statistics {
	values := make([]float64, 0, len(points))
	var latest *float64
	for _, point := range points {
		if point.Value != nil && !math.IsNaN(*point.Value) && !math.IsInf(*point.Value, 0) {
			values = append(values, *point.Value)
			value := *point.Value
			latest = &value
		}
	}
	return statistics(values, latest)
}

func downsample(points []SeriesPoint, limit int) []SeriesPoint {
	if len(points) <= limit {
		return points
	}
	out := make([]SeriesPoint, 0, limit)
	step := float64(len(points)-1) / float64(limit-1)
	for index := 0; index < limit; index++ {
		out = append(out, points[int(math.Round(float64(index)*step))])
	}
	return out
}

func defaultString(value, fallback string) string {
	if strings.TrimSpace(value) == "" {
		return fallback
	}
	return strings.TrimSpace(value)
}
