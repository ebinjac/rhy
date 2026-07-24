import { useMemo, useState } from "react"
import { createFileRoute, Link, useRouter } from "@tanstack/react-router"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
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
  RefreshCw,
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
  listUnifiedAlerts,
} from "@/lib/api-client/opensearch-alerts"
import { formatDateTime } from "@/lib/format-date"

export const Route = createFileRoute("/alerts")({
  loader: async () => {
    const [alerts, applications] = await Promise.all([
      listUnifiedAlerts({
        data: {
          state: "",
          sourceType: "",
          applicationId: "",
          serviceId: "",
          severity: "",
        },
      }),
      listELFApplications(),
    ])
    return { alerts, applications }
  },
  component: AlertsPage,
})

function AlertsPage() {
  const { alerts, applications } = Route.useLoaderData()
  const [source, setSource] = useState("")
  const [state, setState] = useState("")
  const [severity, setSeverity] = useState("")
  const [applicationId, setApplicationId] = useState("")
  const [monitorType, setMonitorType] = useState("")
  const filtered = useMemo(
    () =>
      alerts.filter(
        (alert) =>
          (!source || alert.sourceType === source) &&
          (!state || alert.state === state) &&
          (!severity || alert.severity === severity) &&
          (!applicationId || alert.applicationId === applicationId) &&
          (!monitorType || alert.externalMonitorType === monitorType)
      ),
    [alerts, source, state, severity, applicationId, monitorType]
  )
  const active = alerts.filter(
    (alert) =>
      alert.state === "OPEN" ||
      alert.state === "ACKNOWLEDGED" ||
      alert.state === "ERROR"
  )
  return (
    <main className="mx-auto max-w-[1280px] px-4 py-6 md:px-6 md:py-8">
      <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">
            Alert inbox
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Triage synthetic monitor failures and OpenSearch Alerting events in
            one operational queue.
          </p>
        </div>
        <Badge variant="secondary" className="w-fit">
          <RefreshCw className="size-3" /> OpenSearch sync every minute
        </Badge>
      </header>

      <div className="mt-7 grid overflow-hidden rounded-xl border sm:grid-cols-4">
        <Metric
          label="Active"
          value={String(active.length)}
          icon={CircleAlert}
          danger={active.length > 0}
        />
        <Metric
          label="Critical / high"
          value={String(
            active.filter(
              (item) => item.severity === "CRITICAL" || item.severity === "HIGH"
            ).length
          )}
          icon={ShieldCheck}
        />
        <Metric
          label="OpenSearch"
          value={String(
            active.filter((item) => item.sourceType === "OPENSEARCH_ALERTING")
              .length
          )}
          icon={Webhook}
        />
        <Metric
          label="Resolved"
          value={String(
            alerts.filter((item) => item.state === "RESOLVED").length
          )}
          icon={Check}
        />
      </div>

      <section className="mt-7 border-y py-4" aria-label="Alert filters">
        <div className="flex flex-wrap gap-3">
          <Filter
            label="Source"
            value={source}
            onChange={setSource}
            options={[
              ["RHYTHM_MONITOR", "Rhythm monitors"],
              ["OPENSEARCH_ALERTING", "OpenSearch"],
            ]}
          />
          <Filter
            label="State"
            value={state}
            onChange={setState}
            options={[
              ["OPEN", "Open"],
              ["ACKNOWLEDGED", "Acknowledged"],
              ["ERROR", "Error"],
              ["RESOLVED", "Resolved"],
            ]}
          />
          <Filter
            label="Severity"
            value={severity}
            onChange={setSeverity}
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
            value={applicationId}
            onChange={setApplicationId}
            options={applications.map((application) => [
              application.id,
              application.name,
            ])}
          />
          <Filter
            label="OpenSearch type"
            value={monitorType}
            onChange={setMonitorType}
            options={[
              ["QUERY_LEVEL", "Query level"],
              ["BUCKET_LEVEL", "Bucket level"],
              ["DOCUMENT_LEVEL", "Document level"],
            ]}
          />
        </div>
        <p className="mt-3 text-xs text-muted-foreground" role="status">
          Showing {filtered.length} of {alerts.length} alerts
        </p>
      </section>

      <section className="mt-7" aria-labelledby="recent-alerts">
        <h2 id="recent-alerts" className="font-heading text-lg font-semibold">
          Recent alerts
        </h2>
        {filtered.length ? (
          <div className="mt-4 divide-y border-y">
            {filtered.map((alert) => (
              <AlertRow key={alert.id} alert={alert} />
            ))}
          </div>
        ) : (
          <div className="mt-4 border-y py-14 text-center">
            <Check className="mx-auto size-7 text-success" />
            <p className="mt-3 font-medium">No alerts match these filters</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Clear a filter or configure an OpenSearch receiver from
              Applications.
            </p>
          </div>
        )}
      </section>
    </main>
  )
}

function AlertRow({ alert }: { alert: AlertContract }) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState("")
  const [expanded, setExpanded] = useState(false)
  const [events, setEvents] = useState<AlertEventContract[] | null>(null)
  const active =
    alert.state === "OPEN" ||
    alert.state === "ACKNOWLEDGED" ||
    alert.state === "ERROR"
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
    if (next && events === null) {
      setEvents(await listAlertEvents({ data: { alertId: alert.id } }))
    }
  }
  const external = alert.sourceType === "OPENSEARCH_ALERTING"
  return (
    <article className="py-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <div
          className={`grid size-9 shrink-0 place-items-center rounded-lg ${active ? "bg-destructive/10 text-destructive" : "bg-success-soft text-success-foreground"}`}
        >
          {external ? (
            <Webhook className="size-4" />
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
              {external ? "OpenSearch" : "Rhythm monitor"}
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
            {external ? (
              <>
                <Link
                  className="font-medium text-primary hover:underline"
                  to="/applications"
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
          </div>
          {expanded ? <Evidence alert={alert} events={events} /> : null}
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
}: {
  alert: AlertContract
  events: AlertEventContract[] | null
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
          {events === null ? (
            <p className="mt-3 text-xs text-muted-foreground">
              Loading event history…
            </p>
          ) : events.length ? (
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
