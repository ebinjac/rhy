package monitors

import "time"

func DevelopmentSeed() []Monitor {
	now := time.Now().UTC()
	return []Monitor{
		seedMonitor("payments-prod", "Protected payment journey", "protected-payment-journey", "JWT assertion, token exchange, signed payment status request", "Payments SRE", HealthHealthy, "env-production", 4, "Every 5 min", 99.98, 842, now.Add(-38*time.Second)),
		seedMonitor("customer-profile-prod", "Customer profile API", "customer-profile-api", "OAuth client credentials and profile schema validation", "Identity Platform", HealthFailing, "env-production", 3, "Every 2 min", 97.41, 1834, now.Add(-time.Minute)),
		seedMonitor("ledger-reconciliation", "Ledger reconciliation health", "ledger-reconciliation-health", "mTLS connectivity, ledger totals, and certificate policy", "Finance Platform", HealthWarning, "env-production", 5, "Every 15 min", 99.72, 1240, now.Add(-6*time.Minute)),
		seedMonitor("orders-staging", "Order lifecycle", "order-lifecycle", "Create, retrieve, update, validate, and clean up an order", "Commerce", HealthHealthy, "env-staging", 7, "Every 10 min", 100, 2210, now.Add(-8*time.Minute)),
		seedMonitor("partner-sandbox", "Partner gateway sandbox", "partner-gateway-sandbox", "Proxied HMAC request through the corporate egress agent", "Integrations", HealthPaused, "env-sandbox", 3, "Manual only", 0, 0, now.Add(-96*time.Hour)),
	}
}

func seedMonitor(id, name, slug, description, owner string, health Health, environmentID string, stepCount int, schedule string, successRate float64, latency int64, lastRun time.Time) Monitor {
	now := time.Now().UTC()
	monitor := Monitor{ID: id, Name: name, Slug: slug, Description: description, OwnerID: owner, Tags: []string{}, EnvironmentID: environmentID, State: StateEnabled, Health: health, Enabled: health != HealthPaused, StepCount: stepCount, ScheduleSummary: schedule, CreatedBy: "seed", UpdatedBy: "seed", CreatedAt: now, UpdatedAt: now, LastRunAt: &lastRun}
	if health != HealthPaused {
		monitor.SuccessRate24h = &successRate
		monitor.LastLatencyMS = &latency
	}
	return monitor
}
