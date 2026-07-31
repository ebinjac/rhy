import { useEffect, useState } from "react"
import {
  createFileRoute,
  Link,
  useNavigate,
  useRouter,
  useRouterState,
} from "@tanstack/react-router"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
import {
  Activity,
  AppWindow,
  Check,
  ChevronDown,
  CircleAlert,
  Clock3,
  ExternalLink,
  LoaderCircle,
  MonitorCheck,
  RefreshCw,
  Search,
  Server,
  ShieldCheck,
  Webhook,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"

import type {
  AlertContract,
  AlertEventContract,
} from "@/lib/api-client/contracts"
import { listELFApplications } from "@/lib/api-client/elf"
import { mutateAlert } from "@/lib/api-client/monitors"
import {
  listAlertEvents,
  listUnifiedAlertsPage,
} from "@/lib/api-client/opensearch-alerts"
import { formatDateTime } from "@/lib/format-date"
import { PageContainer } from "@/components/page-container"

export const Route = createFileRoute("/alerts/")({
  validateSearch: (
    search: Record<string, unknown>
  ): {
    query?: string
    source?: string
    state?: string
    severity?: string
    application?: string
    monitorType?: string
    page?: number
  } => ({
    query: typeof search.query === "string" ? search.query : undefined,
    source: typeof search.source === "string" ? search.source : undefined,
    state: typeof search.state === "string" ? search.state : undefined,
    severity: typeof search.severity === "string" ? search.severity : undefined,
    application:
      typeof search.application === "string" ? search.application : undefined,
    monitorType:
      typeof search.monitorType === "string" ? search.monitorType : undefined,
    page:
      typeof search.page === "number" && search.page > 0
        ? Math.floor(search.page)
        : undefined,
  }),
  loaderDeps: ({ search }) => search,
  loader: async ({ deps }) => {
    const [alertPage, applications] = await Promise.all([
      listUnifiedAlertsPage({
        data: {
          query: deps.query ?? "",
          sourceType: deps.source ?? "",
          state: deps.state ?? "",
          severity: deps.severity ?? "",
          applicationId: deps.application ?? "",
          monitorType: deps.monitorType ?? "",
          page: deps.page ?? 1,
          limit: 25,
        },
      }),
      listELFApplications(),
    ])
    return { ...alertPage, applications }
  },
  component: AlertsPage,
})

function AlertsPage() {
  const { alerts, applications, summary, total, limit } = Route.useLoaderData()
  const search = Route.useSearch()
  const filters = {
    query: search.query ?? "",
    source: search.source ?? "",
    state: search.state ?? "",
    severity: search.severity ?? "",
    application: search.application ?? "",
    monitorType: search.monitorType ?? "",
    page: search.page ?? 1,
  }
  const navigate = useNavigate({ from: Route.fullPath })
  const highlightedAlertId = useRouterState({
    select: (state) => {
      const hash = state.location.hash.replace(/^#/, "")
      return hash.startsWith("alert-") ? hash.slice("alert-".length) : ""
    },
  })
  const filtersActive = Boolean(
    filters.query ||
      filters.source ||
      filters.state ||
      filters.severity ||
      filters.application ||
      filters.monitorType
  )
  const pageCount = Math.max(1, Math.ceil(total / limit))
  const currentPage = Math.min(filters.page, pageCount)
  function updateFilter(
    key:
      "query" | "source" | "state" | "severity" | "application" | "monitorType",
    value: string
  ) {
    void navigate({
      search: (previous) => ({ ...previous, [key]: value, page: 1 }),
      replace: true,
    })
  }
  return (
    <PageContainer as="main">
      <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">
            Alert inbox
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Triage API monitor failures, browser journey failures, and
            OpenSearch Alerting events in one operational queue.
          </p>
        </div>
        <Badge variant="secondary" className="w-fit">
          <RefreshCw className="size-3" /> OpenSearch sync every minute
        </Badge>
      </header>

      <div className="mt-7 grid overflow-hidden rounded-xl border sm:grid-cols-4">
        <Metric
          label="Active"
          value={String(summary.activeCount)}
          icon={CircleAlert}
          danger={summary.activeCount > 0}
        />
        <Metric
          label="Critical / high"
          value={String(summary.criticalHighCount)}
          icon={ShieldCheck}
        />
        <Metric
          label="OpenSearch"
          value={String(summary.openSearchActiveCount)}
          icon={Webhook}
        />
        <Metric
          label="Resolved"
          value={String(summary.resolvedCount)}
          icon={Check}
        />
      </div>

      <section className="mt-7 border-y py-4" aria-label="Alert filters">
        <div className="flex flex-wrap gap-3">
          <div className="relative min-w-64 flex-1">
            <Search className="absolute top-2.5 left-3 size-4 text-muted-foreground" />
            <Input
              aria-label="Search alerts"
              className="pl-9"
              value={filters.query}
              onChange={(event) => updateFilter("query", event.target.value)}
              placeholder="Search alert, monitor, or application"
            />
          </div>
          <Filter
            label="Source"
            value={filters.source}
            onChange={(value) => updateFilter("source", value)}
            options={[
              ["RHYTHM_MONITOR", "Rhythm monitors"],
              ["RHYTHM_BROWSER_MONITOR", "UI monitors"],
              ["OPENSEARCH_ALERTING", "OpenSearch"],
            ]}
          />
          <Filter
            label="State"
            value={filters.state}
            onChange={(value) => updateFilter("state", value)}
            options={[
              ["OPEN", "Open"],
              ["ACKNOWLEDGED", "Acknowledged"],
              ["ERROR", "Error"],
              ["RESOLVED", "Resolved"],
            ]}
          />
          <Filter
            label="Severity"
            value={filters.severity}
            onChange={(value) => updateFilter("severity", value)}
            options={[
              ["CRITICAL", "Critical"],
              ["HIGH", "High"],
              ["WARNING", "Warning"],
              ["LOW", "Low"],
              ["INFO", "Info"],
            ]}
          />
          <Filter
            label="Application"
            value={filters.application}
            onChange={(value) => updateFilter("application", value)}
            options={applications.map((application) => [
              application.id,
              application.name,
            ])}
          />
          <Filter
            label="OpenSearch type"
            value={filters.monitorType}
            onChange={(value) => updateFilter("monitorType", value)}
            options={[
              ["QUERY_LEVEL", "Query level"],
              ["BUCKET_LEVEL", "Bucket level"],
              ["DOCUMENT_LEVEL", "Document level"],
            ]}
          />
        </div>
        <p className="mt-3 text-xs text-muted-foreground" role="status">
          Showing {alerts.length} of {total} matching alerts
        </p>
      </section>

      <section className="mt-7" aria-labelledby="recent-alerts">
        <h2 id="recent-alerts" className="font-heading text-lg font-semibold">
          Recent alerts
        </h2>
        {alerts.length ? (
          <div className="mt-4 divide-y border-y">
            {alerts.map((alert) => (
              <AlertRow
                key={alert.id}
                alert={alert}
                initiallyExpanded={highlightedAlertId === alert.id}
              />
            ))}
          </div>
        ) : (
          <div className="mt-4 border-y py-14 text-center">
            <Check className="mx-auto size-7 text-success" />
            <p className="mt-3 font-medium">
              {total === 0 && !filtersActive
                ? "No alerts yet"
                : filtersActive
                  ? "No alerts match these filters"
                  : "No alerts to show"}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {total === 0 && !filtersActive
                ? "When monitors fail or OpenSearch deliveries arrive, they will appear here. Configure a receiver from Applications."
                : filtersActive
                  ? "Clear a filter to widen the inbox, or configure an OpenSearch receiver from Applications."
                  : "Configure an OpenSearch receiver from Applications to ingest alerts."}
            </p>
          </div>
        )}
        {total > limit ? (
          <div className="mt-4 flex items-center justify-between gap-3">
            <Button
              disabled={currentPage === 1}
              size="sm"
              variant="outline"
              onClick={() =>
                void navigate({
                  search: (previous) => ({
                    ...previous,
                    page: currentPage - 1,
                  }),
                })
              }
            >
              Previous
            </Button>
            <span className="text-xs text-muted-foreground">
              Page {currentPage} of {pageCount}
            </span>
            <Button
              disabled={currentPage === pageCount}
              size="sm"
              variant="outline"
              onClick={() =>
                void navigate({
                  search: (previous) => ({
                    ...previous,
                    page: currentPage + 1,
                  }),
                })
              }
            >
              Next
            </Button>
          </div>
        ) : null}
      </section>
    </PageContainer>
  )
}

function AlertRow({
  alert,
  initiallyExpanded = false,
}: {
  alert: AlertContract
  initiallyExpanded?: boolean
}) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState("")
  const [expanded, setExpanded] = useState(initiallyExpanded)
  const [events, setEvents] = useState<AlertEventContract[] | null>(null)
  const [eventsLoading, setEventsLoading] = useState(false)
  const [eventsError, setEventsError] = useState("")
  const active =
    alert.state === "OPEN" ||
    alert.state === "ACKNOWLEDGED" ||
    alert.state === "ERROR"

  async function loadEvents() {
    setEventsLoading(true)
    setEventsError("")
    try {
      setEvents(await listAlertEvents({ data: { alertId: alert.id } }))
    } catch (error) {
      setEventsError(
        error instanceof Error
          ? error.message
          : "Event history could not be loaded."
      )
    } finally {
      setEventsLoading(false)
    }
  }

  useEffect(() => {
    if (!initiallyExpanded) return
    void loadEvents()
  }, [alert.id, initiallyExpanded])

  async function act(action: "acknowledge" | "resolve") {
    setPending(true)
    setMessage("")
    const result = await mutateAlert({ data: { alertId: alert.id, action } })
    setPending(false)
    if (!result.ok) {
      setMessage(result.message)
      return
    }
    await router.invalidate()
  }
  async function toggleEvidence() {
    const next = !expanded
    setExpanded(next)
    if (next && events === null && !eventsLoading) {
      await loadEvents()
    }
  }
  const external = alert.sourceType === "OPENSEARCH_ALERTING"
  const browser = alert.sourceType === "RHYTHM_BROWSER_MONITOR"
  useEffect(() => {
    if (!initiallyExpanded) return
    const node = document.getElementById(`alert-${alert.id}`)
    node?.scrollIntoView({ block: "center", behavior: "smooth" })
  }, [alert.id, initiallyExpanded])

  return (
    <article
      id={`alert-${alert.id}`}
      className={`py-5 ${initiallyExpanded ? "rounded-lg bg-muted/40 ring-1 ring-ring/40" : ""}`}
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <div
          className={`grid size-9 shrink-0 place-items-center rounded-lg ${
            !active
              ? "bg-success-soft text-success-foreground"
              : alert.severity === "CRITICAL" || alert.severity === "HIGH"
                ? "bg-destructive/10 text-destructive"
                : alert.severity === "WARNING"
                  ? "bg-warning-soft text-warning-foreground"
                  : "bg-muted text-muted-foreground"
          }`}
        >
          {external ? (
            <Webhook className="size-4" />
          ) : browser ? (
            <MonitorCheck className="size-4" />
          ) : active ? (
            <CircleAlert className="size-4" />
          ) : (
            <Check className="size-4" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-medium">{alert.title}</h3>
            <Badge variant="secondary">{alert.state}</Badge>
            <Severity severity={alert.severity} />
            <Badge variant="outline">
              {external ? "OpenSearch" : browser ? "UI monitor" : "API monitor"}
            </Badge>
          </div>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            {alert.description ||
              alert.failureCategory?.replaceAll("_", " ") ||
              "Alert threshold reached"}
          </p>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-xs text-muted-foreground">
            {external ? (
              <>
                <span className="inline-flex items-center gap-1">
                  <AppWindow className="size-3" />
                  {alert.applicationName}
                  {alert.applicationCarId ? ` · ${alert.applicationCarId}` : ""}
                </span>
                {alert.serviceName ? (
                  <span className="inline-flex items-center gap-1">
                    <Server className="size-3" />
                    {alert.serviceName}
                  </span>
                ) : null}
                <span>
                  {alert.externalMonitorName || alert.externalMonitorId} ·{" "}
                  {alert.externalTriggerName || alert.externalTriggerId}
                </span>
                {alert.hitCount !== undefined ? (
                  <span>{alert.hitCount.toLocaleString()} hits</span>
                ) : null}
                <span>Upstream {alert.upstreamState?.toLowerCase()}</span>
              </>
            ) : (
              <span>{alert.consecutiveFailures} consecutive failures</span>
            )}
            <span className="inline-flex items-center gap-1">
              <Clock3 className="size-3" />
              {formatDateTime(alert.updatedAt)}
            </span>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
            {!external && alert.monitorId ? (
              <Link
                className="font-medium text-primary hover:underline"
                params={{ monitorId: alert.monitorId }}
                to="/monitors/$monitorId/runs"
              >
                View runs
              </Link>
            ) : null}
            {browser && alert.browserMonitorId ? (
              <Link
                className="font-medium text-primary hover:underline"
                params={{ monitorId: alert.browserMonitorId }}
                to="/ui-monitoring/$monitorId/runs"
              >
                View browser runs
              </Link>
            ) : null}
            {external ? (
              <>
                <Link
                  className="font-medium text-primary hover:underline"
                  params={{ applicationId: alert.applicationId! }}
                  search={{ section: "alerts" }}
                  to="/applications/$applicationId"
                  disabled={!alert.applicationId}
                >
                  View application
                </Link>
                {alert.dashboardUrl ? (
                  <a
                    className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
                    href={alert.dashboardUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open in OpenSearch <ExternalLink className="size-3" />
                  </a>
                ) : null}
              </>
            ) : null}
            <button
              type="button"
              className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
              aria-expanded={expanded}
              onClick={toggleEvidence}
            >
              View evidence{" "}
              <ChevronDown
                className={`size-3 transition-transform ${expanded ? "rotate-180" : ""}`}
              />
            </button>
            <Link
              className="font-medium text-primary hover:underline"
              params={{ alertId: alert.id }}
              to="/alerts/$alertId"
            >
              Open alert details
            </Link>
          </div>
          {expanded ? (
            <Evidence
              alert={alert}
              events={events}
              eventsError={eventsError}
              eventsLoading={eventsLoading}
              onRetryEvents={() => void loadEvents()}
            />
          ) : null}
          {message ? (
            <p className="mt-2 text-xs text-destructive" role="alert">
              {message}
            </p>
          ) : null}
        </div>
        {active ? (
          <div className="flex gap-2">
            {alert.state !== "ACKNOWLEDGED" ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() => act("acknowledge")}
              >
                {pending ? <LoaderCircle className="animate-spin" /> : null}
                Acknowledge
              </Button>
            ) : null}
            {!external ? (
              <Button
                type="button"
                size="sm"
                disabled={pending}
                onClick={() => act("resolve")}
              >
                Resolve
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    </article>
  )
}

function Evidence({
  alert,
  events,
  eventsLoading,
  eventsError,
  onRetryEvents,
}: {
  alert: AlertContract
  events: AlertEventContract[] | null
  eventsLoading: boolean
  eventsError: string
  onRetryEvents: () => void
}) {
  const evidenceEntries = Object.entries(alert.evidence).filter(
    ([, value]) => value !== "" && value !== null
  )
  return (
    <div className="mt-4 border-y bg-muted/15 py-4">
      <div className="grid gap-5 lg:grid-cols-2">
        <section>
          <h4 className="inline-flex items-center gap-2 text-sm font-medium">
            <Activity className="size-4" /> Trigger evidence
          </h4>
          <dl className="mt-3 grid gap-2 text-xs">
            {alert.externalMonitorType ? (
              <EvidenceRow
                label="Monitor type"
                value={alert.externalMonitorType.replaceAll("_", " ")}
              />
            ) : null}
            {alert.externalAlertId ? (
              <EvidenceRow
                label="OpenSearch alert ID"
                value={alert.externalAlertId}
                mono
              />
            ) : null}
            {alert.bucketKey ? (
              <EvidenceRow label="Bucket" value={alert.bucketKey} mono />
            ) : null}
            {alert.lastReceivedAt ? (
              <EvidenceRow
                label="Last webhook"
                value={formatDateTime(alert.lastReceivedAt)}
              />
            ) : null}
            {alert.lastReconciledAt ? (
              <EvidenceRow
                label="Last reconciled"
                value={formatDateTime(alert.lastReconciledAt)}
              />
            ) : null}
          </dl>
          {evidenceEntries.length ? (
            <pre className="mt-3 max-h-64 overflow-auto rounded-lg bg-muted p-3 text-xs break-words whitespace-pre-wrap">
              {JSON.stringify(alert.evidence, null, 2)}
            </pre>
          ) : (
            <p className="mt-3 text-xs text-muted-foreground">
              No additional evidence was recorded for this alert.
            </p>
          )}
        </section>
        <section>
          <h4 className="inline-flex items-center gap-2 text-sm font-medium">
            <Clock3 className="size-4" /> Lifecycle
          </h4>
          {eventsLoading && events === null ? (
            <div
              aria-busy="true"
              className="mt-3 flex items-center gap-2 text-xs text-muted-foreground"
              role="status"
            >
              <LoaderCircle className="size-3.5 animate-spin motion-reduce:animate-none" />
              Loading event history…
            </div>
          ) : eventsError && events === null ? (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs">
              <span className="text-muted-foreground">{eventsError}</span>
              <Button onClick={onRetryEvents} size="sm" variant="outline">
                <RefreshCw /> Retry
              </Button>
            </div>
          ) : events?.length ? (
            <ol className="mt-3 space-y-3">
              {events.map((event) => (
                <li
                  key={event.id}
                  className="grid grid-cols-[8px_1fr] gap-3 text-xs"
                >
                  <span className="mt-1 size-2 rounded-full bg-primary" />
                  <div>
                    <p className="font-medium">
                      {event.eventType.replaceAll("_", " ")}
                    </p>
                    <p className="mt-0.5 text-muted-foreground">
                      {event.summary} · {formatDateTime(event.occurredAt)}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <p className="mt-3 text-xs text-muted-foreground">
              No structured lifecycle events were recorded.
            </p>
          )}
        </section>
      </div>
    </div>
  )
}

function EvidenceRow({
  label,
  value,
  mono = false,
}: {
  label: string
  value: string
  mono?: boolean
}) {
  return (
    <div className="grid grid-cols-[130px_1fr] gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={mono ? "font-mono break-all" : ""}>{value}</dd>
    </div>
  )
}
function Severity({ severity }: { severity: AlertContract["severity"] }) {
  return (
    <Badge
      className={
        severity === "CRITICAL" || severity === "HIGH"
          ? "bg-destructive/10 text-destructive"
          : severity === "WARNING"
            ? "bg-warning-soft text-warning-foreground"
            : ""
      }
      variant="secondary"
    >
      {severity}
    </Badge>
  )
}
function Filter({
  label,
  value,
  onChange,
  options,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  options: string[][]
}) {
  const allLabel = `All ${label.toLowerCase()}s`
  return (
    <label className="text-xs font-medium">
      <span className="sr-only">{label}</span>
      <Select
        value={value || null}
        onValueChange={(next) => onChange(next ?? "")}
        items={[
          { value: null, label: allLabel },
          ...options.map(([optionValue, optionLabel]) => ({
            value: optionValue,
            label: optionLabel,
          })),
        ]}
      >
        <SelectTrigger className="h-9 font-normal">
          <SelectValue placeholder={allLabel} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={null}>{allLabel}</SelectItem>
          {options.map(([optionValue, optionLabel]) => (
            <SelectItem key={optionValue} value={optionValue}>
              {optionLabel}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  )
}
function Metric({
  label,
  value,
  icon: Icon,
  danger = false,
}: {
  label: string
  value: string
  icon: LucideIcon
  danger?: boolean
}) {
  return (
    <div className="flex items-center justify-between border-b p-4 last:border-b-0 sm:border-r sm:border-b-0 sm:last:border-r-0">
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p
          className={`mt-1 text-xl font-semibold ${danger ? "text-destructive" : ""}`}
        >
          {value}
        </p>
      </div>
      <Icon
        className={`size-4 ${danger ? "text-destructive" : "text-muted-foreground"}`}
      />
    </div>
  )
}
