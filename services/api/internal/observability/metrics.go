package observability

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	"github.com/redis/go-redis/v9"
)

type Metrics struct {
	registry          *prometheus.Registry
	requests          *prometheus.CounterVec
	requestDuration   *prometheus.HistogramVec
	responseBytes     *prometheus.HistogramVec
	activeRequests    prometheus.Gauge
	webVitals         *prometheus.HistogramVec
	pool              *pgxpool.Pool
	redis             *redis.Client
	jobDepth          *prometheus.Desc
	oldestJobAge      *prometheus.Desc
	outboxDepth       *prometheus.Desc
	scheduleLag       *prometheus.Desc
	redisStreamLength *prometheus.Desc
	redisPending      *prometheus.Desc
}

func New(pool *pgxpool.Pool, redisClient *redis.Client) *Metrics {
	metrics := &Metrics{
		registry: prometheus.NewRegistry(),
		requests: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "rhythm_http_requests_total",
			Help: "Total HTTP requests handled by status, method, and route pattern.",
		}, []string{"method", "route", "status"}),
		requestDuration: prometheus.NewHistogramVec(prometheus.HistogramOpts{
			Name:    "rhythm_http_request_duration_seconds",
			Help:    "HTTP request duration by method and route pattern.",
			Buckets: prometheus.DefBuckets,
		}, []string{"method", "route"}),
		responseBytes: prometheus.NewHistogramVec(prometheus.HistogramOpts{
			Name:    "rhythm_http_response_size_bytes",
			Help:    "HTTP response size by route pattern.",
			Buckets: prometheus.ExponentialBuckets(256, 2, 14),
		}, []string{"route"}),
		activeRequests: prometheus.NewGauge(prometheus.GaugeOpts{
			Name: "rhythm_http_active_requests",
			Help: "HTTP requests currently being handled.",
		}),
		webVitals: prometheus.NewHistogramVec(prometheus.HistogramOpts{
			Name:    "rhythm_web_vital_value",
			Help:    "Privacy-safe browser Web Vital observations by metric and normalized route.",
			Buckets: []float64{0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 50, 100, 200, 500, 1000, 2500, 5000, 10000},
		}, []string{"metric", "route"}),
		pool:  pool,
		redis: redisClient,
		jobDepth: prometheus.NewDesc(
			"rhythm_execution_jobs", "Execution jobs by queue class and state.",
			[]string{"queue_class", "status"}, nil,
		),
		oldestJobAge: prometheus.NewDesc(
			"rhythm_execution_oldest_queued_job_age_seconds",
			"Age of the oldest queued execution job by queue class.",
			[]string{"queue_class"}, nil,
		),
		outboxDepth: prometheus.NewDesc(
			"rhythm_execution_outbox_pending", "Execution outbox records waiting to publish.",
			nil, nil,
		),
		scheduleLag: prometheus.NewDesc(
			"rhythm_scheduler_due_lag_seconds",
			"Age of the oldest due enabled schedule.", nil, nil,
		),
		redisStreamLength: prometheus.NewDesc(
			"rhythm_redis_stream_entries", "Redis execution stream length.",
			[]string{"queue_class"}, nil,
		),
		redisPending: prometheus.NewDesc(
			"rhythm_redis_stream_pending", "Redis execution entries pending acknowledgement.",
			[]string{"queue_class"}, nil,
		),
	}
	metrics.registry.MustRegister(
		metrics.requests,
		metrics.requestDuration,
		metrics.responseBytes,
		metrics.activeRequests,
		metrics.webVitals,
		prometheus.NewGoCollector(),
		prometheus.NewProcessCollector(prometheus.ProcessCollectorOpts{}),
		metrics,
	)
	return metrics
}

func (m *Metrics) WebVitalHandler() http.Handler {
	type observation struct {
		Metric string  `json:"metric"`
		Route  string  `json:"route"`
		Value  float64 `json:"value"`
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		var item observation
		decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096))
		if err := decoder.Decode(&item); err != nil {
			http.Error(w, "invalid observation", http.StatusBadRequest)
			return
		}
		item.Metric = strings.ToUpper(strings.TrimSpace(item.Metric))
		if item.Metric != "LCP" && item.Metric != "INP" && item.Metric != "CLS" {
			http.Error(w, "unsupported metric", http.StatusBadRequest)
			return
		}
		if item.Value < 0 || item.Value > 600000 {
			http.Error(w, "invalid metric value", http.StatusBadRequest)
			return
		}
		item.Route = normalizedRoute(item.Route)
		m.webVitals.WithLabelValues(item.Metric, item.Route).Observe(item.Value)
		w.WriteHeader(http.StatusNoContent)
	})
}

func normalizedRoute(value string) string {
	value = strings.TrimSpace(strings.SplitN(value, "?", 2)[0])
	if value == "" || value[0] != '/' {
		return "/unknown"
	}
	parts := strings.Split(value, "/")
	for index := range parts {
		if looksLikeIdentifier(parts[index]) {
			parts[index] = ":id"
		}
	}
	normalized := strings.Join(parts, "/")
	if len(normalized) > 120 {
		return "/other"
	}
	return normalized
}

func looksLikeIdentifier(value string) bool {
	if len(value) >= 20 {
		return true
	}
	if value == "" {
		return false
	}
	for _, character := range value {
		if character < '0' || character > '9' {
			return false
		}
	}
	return true
}

func (m *Metrics) Handler() http.Handler {
	return promhttp.HandlerFor(m.registry, promhttp.HandlerOpts{
		EnableOpenMetrics: true,
		Timeout:           5 * time.Second,
	})
}

func (m *Metrics) Wrap(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/metrics" {
			next.ServeHTTP(w, r)
			return
		}
		started := time.Now()
		recorder := &responseRecorder{ResponseWriter: w, status: http.StatusOK}
		m.activeRequests.Inc()
		defer m.activeRequests.Dec()
		next.ServeHTTP(recorder, r)
		route := r.Pattern
		if route == "" {
			route = "unmatched"
		}
		m.requests.WithLabelValues(r.Method, route, strconv.Itoa(recorder.status)).Inc()
		m.requestDuration.WithLabelValues(r.Method, route).Observe(time.Since(started).Seconds())
		m.responseBytes.WithLabelValues(route).Observe(float64(recorder.bytes))
	})
}

func (m *Metrics) Describe(ch chan<- *prometheus.Desc) {
	ch <- m.jobDepth
	ch <- m.oldestJobAge
	ch <- m.outboxDepth
	ch <- m.scheduleLag
	ch <- m.redisStreamLength
	ch <- m.redisPending
}

func (m *Metrics) Collect(ch chan<- prometheus.Metric) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	if m.pool != nil {
		stats := m.pool.Stat()
		ch <- prometheus.MustNewConstMetric(
			prometheus.NewDesc("rhythm_postgres_pool_connections", "PostgreSQL pool connections by state.", []string{"state"}, nil),
			prometheus.GaugeValue, float64(stats.AcquiredConns()), "acquired",
		)
		ch <- prometheus.MustNewConstMetric(
			prometheus.NewDesc("rhythm_postgres_pool_connections", "PostgreSQL pool connections by state.", []string{"state"}, nil),
			prometheus.GaugeValue, float64(stats.IdleConns()), "idle",
		)
		ch <- prometheus.MustNewConstMetric(
			prometheus.NewDesc("rhythm_postgres_pool_connections", "PostgreSQL pool connections by state.", []string{"state"}, nil),
			prometheus.GaugeValue, float64(stats.TotalConns()), "total",
		)
		ch <- prometheus.MustNewConstMetric(
			prometheus.NewDesc("rhythm_postgres_pool_max_connections", "Configured PostgreSQL pool connection limit.", nil, nil),
			prometheus.GaugeValue, float64(stats.MaxConns()),
		)
		ch <- prometheus.MustNewConstMetric(
			prometheus.NewDesc("rhythm_postgres_pool_acquire_total", "PostgreSQL pool acquisitions.", nil, nil),
			prometheus.CounterValue, float64(stats.AcquireCount()),
		)
		ch <- prometheus.MustNewConstMetric(
			prometheus.NewDesc("rhythm_postgres_pool_acquire_seconds_total", "Cumulative time waiting for PostgreSQL connections.", nil, nil),
			prometheus.CounterValue, stats.AcquireDuration().Seconds(),
		)
		ch <- prometheus.MustNewConstMetric(
			prometheus.NewDesc("rhythm_postgres_pool_acquire_cancelled_total", "Cancelled PostgreSQL pool acquisitions.", nil, nil),
			prometheus.CounterValue, float64(stats.CanceledAcquireCount()),
		)
		rows, err := m.pool.Query(ctx, `
			SELECT queue_class,status,COUNT(*),
				COALESCE(EXTRACT(EPOCH FROM (NOW()-MIN(created_at)))
					FILTER (WHERE status='QUEUED'),0)
			FROM execution_jobs GROUP BY queue_class,status`)
		if err == nil {
			for rows.Next() {
				var queueClass, status string
				var count int64
				var age float64
				if rows.Scan(&queueClass, &status, &count, &age) == nil {
					ch <- prometheus.MustNewConstMetric(m.jobDepth, prometheus.GaugeValue, float64(count), queueClass, status)
					if status == "QUEUED" {
						ch <- prometheus.MustNewConstMetric(m.oldestJobAge, prometheus.GaugeValue, age, queueClass)
					}
				}
			}
			rows.Close()
		}
		var outbox int64
		if m.pool.QueryRow(ctx, `SELECT COUNT(*) FROM execution_job_outbox WHERE published_at IS NULL`).Scan(&outbox) == nil {
			ch <- prometheus.MustNewConstMetric(m.outboxDepth, prometheus.GaugeValue, float64(outbox))
		}
		var lag float64
		if m.pool.QueryRow(ctx, `
			SELECT COALESCE(EXTRACT(EPOCH FROM (NOW()-MIN(s.next_run_at))),0)
			FROM monitor_schedules s JOIN monitors m ON m.id=s.monitor_id
			WHERE s.active=TRUE AND m.enabled=TRUE AND m.deleted_at IS NULL
			  AND s.next_run_at<NOW()`).Scan(&lag) == nil {
			ch <- prometheus.MustNewConstMetric(m.scheduleLag, prometheus.GaugeValue, lag)
		}
	}
	if m.redis != nil {
		for queueClass, target := range map[string]struct {
			stream string
			group  string
		}{
			"scheduled": {stream: "rhythm:execution:scheduled", group: "rhythm-api-workers"},
			"manual":    {stream: "rhythm:execution:manual", group: "rhythm-api-workers"},
			"browser":   {stream: "rhythm:execution:browser", group: "rhythm-browser-dispatchers"},
			"deployment": {
				stream: "rhythm:execution:deployment",
				group:  "rhythm-deployment-workers",
			},
		} {
			if count, err := m.redis.XLen(ctx, target.stream).Result(); err == nil {
				ch <- prometheus.MustNewConstMetric(m.redisStreamLength, prometheus.GaugeValue, float64(count), queueClass)
			}
			if pending, err := m.redis.XPending(ctx, target.stream, target.group).Result(); err == nil {
				ch <- prometheus.MustNewConstMetric(m.redisPending, prometheus.GaugeValue, float64(pending.Count), queueClass)
			}
		}
	}
}

type responseRecorder struct {
	http.ResponseWriter
	status int
	bytes  int64
}

func (r *responseRecorder) WriteHeader(status int) {
	r.status = status
	r.ResponseWriter.WriteHeader(status)
}

func (r *responseRecorder) Write(body []byte) (int, error) {
	written, err := r.ResponseWriter.Write(body)
	r.bytes += int64(written)
	return written, err
}

func (r *responseRecorder) Flush() {
	if flusher, ok := r.ResponseWriter.(http.Flusher); ok {
		flusher.Flush()
	}
}

func (r *responseRecorder) Unwrap() http.ResponseWriter { return r.ResponseWriter }

var _ http.Flusher = (*responseRecorder)(nil)
