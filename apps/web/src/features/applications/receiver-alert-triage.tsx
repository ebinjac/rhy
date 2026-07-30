import { useEffect, useMemo, useState } from "react"
import { Link } from "@tanstack/react-router"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { Checkbox } from "@workspace/ui/components/checkbox"
import { Input } from "@workspace/ui/components/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
import {
  Check,
  CircleAlert,
  ExternalLink,
  Inbox,
  LoaderCircle,
  Search,
  Server,
  Tag,
} from "lucide-react"

import type {
  AlertContract,
  ELFApplicationContract,
  OpenSearchAlertReceiverContract,
} from "@/lib/api-client/contracts"
import { assignOpenSearchAlertsToService } from "@/lib/api-client/opensearch-alerts"
import { formatDateTime } from "@/lib/format-date"

const ACTIVE_STATES = new Set<AlertContract["state"]>([
  "OPEN",
  "ACKNOWLEDGED",
  "ERROR",
])

export function ReceiverAlertTriage({
  application,
  alerts,
  receivers,
  refresh,
}: {
  application: ELFApplicationContract
  alerts: AlertContract[]
  receivers: OpenSearchAlertReceiverContract[]
  refresh: () => Promise<void>
}) {
  const externalAlerts = useMemo(
    () => alerts.filter((alert) => alert.sourceType === "OPENSEARCH_ALERTING"),
    [alerts]
  )
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [query, setQuery] = useState("")
  const [receiverFilter, setReceiverFilter] = useState("__all__")
  const [stateFilter, setStateFilter] = useState("__active__")
  const [serviceChoice, setServiceChoice] = useState("__choose__")
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")

  useEffect(() => {
    const available = new Set(externalAlerts.map((alert) => alert.id))
    setSelected(
      (current) => new Set([...current].filter((id) => available.has(id)))
    )
  }, [externalAlerts])

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return externalAlerts.filter((alert) => {
      if (receiverFilter !== "__all__" && alert.receiverId !== receiverFilter) {
        return false
      }
      if (stateFilter === "__active__" && !ACTIVE_STATES.has(alert.state)) {
        return false
      }
      if (stateFilter !== "__all__" && stateFilter !== "__active__") {
        if (alert.state !== stateFilter) return false
      }
      if (!needle) return true
      return [
        alert.title,
        alert.externalMonitorName,
        alert.externalTriggerName,
        alert.serviceName,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(needle)
    })
  }, [externalAlerts, query, receiverFilter, stateFilter])

  const visibleIds = visible.map((alert) => alert.id)
  const allVisibleSelected =
    visibleIds.length > 0 && visibleIds.every((id) => selected.has(id))
  const someVisibleSelected = visibleIds.some((id) => selected.has(id))
  const unassignedCount = externalAlerts.filter(
    (alert) => !alert.serviceId
  ).length
  const activeCount = externalAlerts.filter((alert) =>
    ACTIVE_STATES.has(alert.state)
  ).length
  const receiverItems = useMemo(
    () =>
      Object.fromEntries([
        ["__all__", "All receivers"],
        ...receivers.map((receiver) => [receiver.id, receiver.name]),
      ]),
    [receivers]
  )
  const stateItems = {
    __active__: "Active only",
    __all__: "All states",
    OPEN: "Open",
    ACKNOWLEDGED: "Acknowledged",
    ERROR: "Error",
    RESOLVED: "Resolved",
  }
  const serviceItems = useMemo(
    () =>
      Object.fromEntries([
        ["__choose__", "Choose a service"],
        ["__unassigned__", "Unassigned"],
        ...application.services.map((service) => [service.id, service.name]),
      ]),
    [application.services]
  )

  function toggleAlert(alertId: string, checked: boolean) {
    setSelected((current) => {
      const next = new Set(current)
      if (checked) next.add(alertId)
      else next.delete(alertId)
      return next
    })
  }

  function toggleVisible(checked: boolean) {
    setSelected((current) => {
      const next = new Set(current)
      visibleIds.forEach((id) => {
        if (checked) next.add(id)
        else next.delete(id)
      })
      return next
    })
  }

  async function assignService() {
    if (!selected.size || serviceChoice === "__choose__") return
    setPending(true)
    setError("")
    setMessage("")
    const result = await assignOpenSearchAlertsToService({
      data: {
        applicationId: application.id,
        alertIds: [...selected],
        serviceId: serviceChoice === "__unassigned__" ? "" : serviceChoice,
      },
    })
    setPending(false)
    if (!result.ok) {
      setError(result.message)
      return
    }
    const destination = result.result.serviceName || "Unassigned"
    setMessage(
      `${result.result.assignedCount} alert${result.result.assignedCount === 1 ? "" : "s"} tagged as ${destination}.`
    )
    setSelected(new Set())
    setServiceChoice("__choose__")
    await refresh()
  }

  function SelectVisible() {
    return (
      <Checkbox
        aria-label="Select all visible receiver alerts"
        aria-checked={
          someVisibleSelected && !allVisibleSelected
            ? "mixed"
            : allVisibleSelected
        }
        checked={allVisibleSelected}
        onCheckedChange={(checked) => toggleVisible(checked === true)}
      />
    )
  }

  return (
    <section className="mt-10" aria-labelledby="receiver-alert-queue">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div>
          <h2
            id="receiver-alert-queue"
            className="inline-flex items-center gap-2 text-xl font-semibold"
          >
            <Inbox aria-hidden="true" className="size-5" />
            Incoming alerts
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Triage alerts from every receiver in one queue. Select any
            combination and tag it to the service that owns the response.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          <Badge variant="secondary">{activeCount} active</Badge>
          <Badge
            className={
              unassignedCount
                ? "bg-warning-soft text-warning-foreground"
                : "bg-success-soft text-success-foreground"
            }
            variant="secondary"
          >
            {unassignedCount} unassigned
          </Badge>
          <Badge variant="outline">{externalAlerts.length} total</Badge>
        </div>
      </div>

      {externalAlerts.length ? (
        <>
          <div
            className="mt-5 flex flex-col gap-3 border-y bg-muted/15 py-4 lg:flex-row lg:items-center"
            aria-label="Receiver alert filters"
          >
            <div className="relative min-w-56 flex-1">
              <Search
                aria-hidden="true"
                className="absolute top-2.5 left-3 size-4 text-muted-foreground"
              />
              <Input
                aria-label="Search receiver alerts"
                className="pl-9"
                placeholder="Search alert, monitor, trigger, or service"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
            <Select
              items={receiverItems}
              value={receiverFilter}
              onValueChange={(value) => value && setReceiverFilter(value)}
            >
              <SelectTrigger
                aria-label="Filter by receiver"
                className="w-full lg:w-56"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All receivers</SelectItem>
                {receivers.map((receiver) => (
                  <SelectItem key={receiver.id} value={receiver.id}>
                    {receiver.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              items={stateItems}
              value={stateFilter}
              onValueChange={(value) => value && setStateFilter(value)}
            >
              <SelectTrigger
                aria-label="Filter by alert state"
                className="w-full lg:w-44"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__active__">Active only</SelectItem>
                <SelectItem value="__all__">All states</SelectItem>
                <SelectItem value="OPEN">Open</SelectItem>
                <SelectItem value="ACKNOWLEDGED">Acknowledged</SelectItem>
                <SelectItem value="ERROR">Error</SelectItem>
                <SelectItem value="RESOLVED">Resolved</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div
            className={`flex flex-col gap-3 border-b px-3 py-3 sm:flex-row sm:items-center sm:justify-between ${
              selected.size ? "bg-primary/5" : "bg-muted/20"
            }`}
          >
            <div className="flex items-center gap-3">
              <SelectVisible />
              <span className="text-sm font-medium">
                {selected.size
                  ? `${selected.size} selected`
                  : `Select all ${visible.length} visible alerts`}
              </span>
              {selected.size ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setSelected(new Set())}
                >
                  Clear
                </Button>
              ) : null}
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <Select
                items={serviceItems}
                value={serviceChoice}
                onValueChange={(value) => value && setServiceChoice(value)}
              >
                <SelectTrigger
                  aria-label="Service assignment"
                  className="w-full sm:w-60"
                >
                  <SelectValue placeholder="Choose a service" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__choose__" disabled>
                    Choose a service
                  </SelectItem>
                  <SelectItem value="__unassigned__">Unassigned</SelectItem>
                  {application.services.map((service) => (
                    <SelectItem key={service.id} value={service.id}>
                      {service.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                disabled={
                  pending || !selected.size || serviceChoice === "__choose__"
                }
                onClick={() => void assignService()}
              >
                {pending ? (
                  <LoaderCircle aria-hidden="true" className="animate-spin" />
                ) : (
                  <Tag aria-hidden="true" />
                )}
                {pending ? "Applying…" : "Apply service"}
              </Button>
            </div>
          </div>

          {error ? (
            <p className="mt-3 text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
          {message ? (
            <p className="mt-3 text-sm text-success-foreground" role="status">
              {message}
            </p>
          ) : null}

          {visible.length ? (
            <div className="divide-y border-b">
              {visible.map((alert) => (
                <AlertSelectionRow
                  alert={alert}
                  checked={selected.has(alert.id)}
                  key={alert.id}
                  receiverName={
                    receivers.find(
                      (receiver) => receiver.id === alert.receiverId
                    )?.name || "Deleted receiver"
                  }
                  onCheckedChange={(checked) => toggleAlert(alert.id, checked)}
                />
              ))}
            </div>
          ) : (
            <div className="border-b py-12 text-center">
              <Search
                aria-hidden="true"
                className="mx-auto size-6 text-muted-foreground"
              />
              <p className="mt-3 font-medium">No alerts match these filters</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Change the receiver, state, or search text to widen the queue.
              </p>
            </div>
          )}
        </>
      ) : (
        <div className="mt-5 border-y py-12 text-center">
          <Inbox
            aria-hidden="true"
            className="mx-auto size-7 text-muted-foreground"
          />
          <h3 className="mt-3 font-medium">No receiver alerts yet</h3>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            Incoming OpenSearch alerts will be consolidated here after the first
            webhook delivery or receiver test.
          </p>
        </div>
      )}
    </section>
  )
}

function AlertSelectionRow({
  alert,
  checked,
  receiverName,
  onCheckedChange,
}: {
  alert: AlertContract
  checked: boolean
  receiverName: string
  onCheckedChange: (checked: boolean) => void
}) {
  return (
    <article
      className={`grid gap-3 py-4 transition-colors sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center ${
        checked ? "bg-primary/5" : ""
      }`}
    >
      <div className="px-2 sm:pl-3">
        <Checkbox
          aria-label={`Select ${alert.title}`}
          checked={checked}
          onCheckedChange={(value) => onCheckedChange(value === true)}
        />
      </div>
      <div className="min-w-0 px-3 sm:px-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className="truncate text-sm font-medium">{alert.title}</p>
          <SeverityBadge severity={alert.severity} />
          <StateBadge state={alert.state} />
        </div>
        <p className="mt-1 truncate text-xs text-muted-foreground">
          {alert.externalMonitorName || "OpenSearch monitor"}
          {alert.externalTriggerName ? ` · ${alert.externalTriggerName}` : ""}
          {typeof alert.hitCount === "number"
            ? ` · ${alert.hitCount} hits`
            : ""}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <Inbox aria-hidden="true" className="size-3.5" />
            {receiverName}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Server aria-hidden="true" className="size-3.5" />
            {alert.serviceName || "Unassigned"}
          </span>
          <span>{formatDateTime(alert.updatedAt)}</span>
        </div>
      </div>
      <div className="flex justify-end px-3">
        <Button
          nativeButton={false}
          render={
            <Link
              aria-label={`View details for ${alert.title}`}
              params={{ alertId: alert.id }}
              to="/alerts/$alertId"
            />
          }
          size="sm"
          variant="ghost"
        >
          Details <ExternalLink aria-hidden="true" data-icon="inline-end" />
        </Button>
      </div>
    </article>
  )
}

function SeverityBadge({ severity }: { severity: AlertContract["severity"] }) {
  const critical = severity === "CRITICAL" || severity === "HIGH"
  const warning = severity === "WARNING"
  return (
    <Badge
      className={
        critical
          ? "bg-destructive/10 text-destructive"
          : warning
            ? "bg-warning-soft text-warning-foreground"
            : undefined
      }
      variant="secondary"
    >
      {critical ? (
        <CircleAlert aria-hidden="true" />
      ) : warning ? null : (
        <Check aria-hidden="true" />
      )}
      {severity.toLowerCase()}
    </Badge>
  )
}

function StateBadge({ state }: { state: AlertContract["state"] }) {
  const resolved = state === "RESOLVED"
  return (
    <Badge
      className={
        resolved ? "bg-success-soft text-success-foreground" : undefined
      }
      variant={resolved ? "secondary" : "outline"}
    >
      {state.toLowerCase().replaceAll("_", " ")}
    </Badge>
  )
}
