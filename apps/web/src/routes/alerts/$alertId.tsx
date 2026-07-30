import { createFileRoute, Link } from "@tanstack/react-router"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import {
  Activity,
  AppWindow,
  ArrowLeft,
  Clock3,
  ExternalLink,
  ShieldCheck,
} from "lucide-react"

import {
  getUnifiedAlert,
  listAlertEvents,
} from "@/lib/api-client/opensearch-alerts"
import { formatDateTime } from "@/lib/format-date"
import { PageContainer } from "@/components/page-container"

export const Route = createFileRoute("/alerts/$alertId")({
  loader: async ({ params }) => {
    const [alert, events] = await Promise.all([
      getUnifiedAlert({ data: { alertId: params.alertId } }),
      listAlertEvents({ data: { alertId: params.alertId } }),
    ])
    return { alert, events }
  },
  component: AlertDetail,
})

function AlertDetail() {
  const { alert, events } = Route.useLoaderData()
  const external = alert.sourceType === "OPENSEARCH_ALERTING"
  return (
    <PageContainer as="main">
      <Button
        nativeButton={false}
        render={<Link aria-label="Alert inbox" to="/alerts" />}
        variant="ghost"
      >
        <ArrowLeft data-icon="inline-start" />
        Alert inbox
      </Button>
      <header className="mt-4 flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              className={severityClass(alert.severity)}
              variant="secondary"
            >
              {alert.severity}
            </Badge>
            <Badge variant="outline">{alert.state}</Badge>
            <Badge variant="secondary">
              {external ? "OpenSearch Alerting" : "Rhythm monitor"}
            </Badge>
          </div>
          <h1 className="mt-3 text-2xl font-semibold">{alert.title}</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            {alert.description ||
              alert.failureCategory?.replaceAll("_", " ") ||
              "Alert threshold reached"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {alert.applicationId ? (
            <Button
              nativeButton={false}
              render={
                <Link
                  aria-label="View application"
                  params={{ applicationId: alert.applicationId }}
                  search={{ section: "alerts" }}
                  to="/applications/$applicationId"
                />
              }
              variant="outline"
            >
              <AppWindow data-icon="inline-start" />
              View application
            </Button>
          ) : null}
          {alert.dashboardUrl ? (
            <Button
              nativeButton={false}
              render={
                <a
                  aria-label="Open alert in OpenSearch"
                  href={alert.dashboardUrl}
                  rel="noreferrer"
                  target="_blank"
                />
              }
            >
              Open in OpenSearch
              <ExternalLink />
            </Button>
          ) : null}
        </div>
      </header>

      <section className="mt-7 grid divide-y rounded-lg border sm:grid-cols-2 sm:divide-x sm:divide-y-0 lg:grid-cols-4">
        <Metric label="Application" value={alert.applicationName || "Not linked"} />
        <Metric label="Service" value={alert.serviceName || "All services"} />
        <Metric
          label={external ? "Upstream state" : "Consecutive failures"}
          value={
            external
              ? alert.upstreamState?.toLowerCase() || "Not recorded"
              : String(alert.consecutiveFailures)
          }
        />
        <Metric
          label="Last observed"
          value={formatDateTime(alert.lastTriggeredAt ?? alert.updatedAt)}
        />
      </section>

      <div className="mt-8 grid gap-8 lg:grid-cols-2">
        <section>
          <div className="flex items-start gap-3">
            <Activity className="mt-0.5 size-5 text-primary" />
            <div>
              <h2 className="text-lg font-semibold">Trigger evidence</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Masked evidence describing what triggered this alert.
              </p>
            </div>
          </div>
          <dl className="mt-4 divide-y border-y text-sm">
            <Definition
              label="Monitor"
              value={alert.externalMonitorName || alert.monitorName || "Not recorded"}
            />
            <Definition
              label="Trigger"
              value={alert.externalTriggerName || "Not recorded"}
            />
            <Definition
              label="hits.total.value"
              value={
                alert.hitCount === undefined
                  ? "Not recorded"
                  : alert.hitCount.toLocaleString()
              }
            />
            <Definition
              label="Last reconciled"
              value={
                alert.lastReconciledAt
                  ? formatDateTime(alert.lastReconciledAt)
                  : "Not recorded"
              }
            />
          </dl>
          <pre className="mt-4 max-h-80 overflow-auto rounded-lg border bg-muted/25 p-4 font-mono text-xs leading-5 whitespace-pre-wrap">
            {Object.keys(alert.evidence).length
              ? JSON.stringify(alert.evidence, null, 2)
              : "Not recorded for this alert."}
          </pre>
        </section>
        <section>
          <div className="flex items-start gap-3">
            <Clock3 className="mt-0.5 size-5 text-primary" />
            <div>
              <h2 className="text-lg font-semibold">Lifecycle</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Webhook, acknowledgement, reconciliation, and resolution
                transitions in chronological order.
              </p>
            </div>
          </div>
          <ol className="mt-4 divide-y border-y">
            {events.map((event) => (
              <li className="flex gap-3 py-4" key={event.id}>
                <span className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" />
                <div>
                  <p className="text-sm font-medium">
                    {event.eventType.replaceAll("_", " ")}
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {event.summary}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {formatDateTime(event.occurredAt)}
                  </p>
                </div>
              </li>
            ))}
            {!events.length ? (
              <li className="py-10 text-center text-sm text-muted-foreground">
                No structured lifecycle events were recorded.
              </li>
            ) : null}
          </ol>
          {external ? (
            <div className="mt-6 flex items-start gap-3 border-y py-4">
              <ShieldCheck className="mt-0.5 size-5 text-primary" />
              <p className="text-sm leading-6 text-muted-foreground">
                Acknowledgement in Rhythm is local. OpenSearch remains the
                authority for active and completed state; reconciliation updates
                that upstream lifecycle without removing local acknowledgement.
              </p>
            </div>
          ) : null}
        </section>
      </div>
    </PageContainer>
  )
}

function severityClass(severity: string) {
  if (severity === "CRITICAL" || severity === "HIGH")
    return "bg-destructive/10 text-destructive"
  if (severity === "WARNING")
    return "bg-warning-soft text-warning-foreground"
  return "bg-muted text-muted-foreground"
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 break-words font-semibold capitalize">{value}</p>
    </div>
  )
}

function Definition({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[140px_1fr] gap-3 py-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="break-words">{value}</dd>
    </div>
  )
}
