import { useEffect, useEffectEvent, useId, useRef, useState } from "react"
import { Link, useNavigate } from "@tanstack/react-router"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@workspace/ui/components/popover"
import {
  Bell,
  Check,
  CircleAlert,
  LoaderCircle,
  MonitorCheck,
  Webhook,
} from "lucide-react"

import type { AlertContract } from "@/lib/api-client/contracts"
import { listUnifiedAlerts } from "@/lib/api-client/opensearch-alerts"

const ACTIVE_STATES = new Set<AlertContract["state"]>([
  "OPEN",
  "ACKNOWLEDGED",
  "ERROR",
])
const POLL_MS = 60_000
const PREVIEW_LIMIT = 8

function isActiveAlert(alert: AlertContract) {
  return ACTIVE_STATES.has(alert.state)
}

function relativeTime(value?: string) {
  if (!value) return "Unknown time"
  const elapsedSeconds = Math.max(
    0,
    Math.round((Date.now() - new Date(value).getTime()) / 1000)
  )
  if (elapsedSeconds < 60) return `${elapsedSeconds}s ago`
  if (elapsedSeconds < 3600) return `${Math.floor(elapsedSeconds / 60)}m ago`
  if (elapsedSeconds < 86400) return `${Math.floor(elapsedSeconds / 3600)}h ago`
  return `${Math.floor(elapsedSeconds / 86400)}d ago`
}

function severityClass(severity: AlertContract["severity"]) {
  if (severity === "CRITICAL" || severity === "HIGH") {
    return "bg-destructive/10 text-destructive"
  }
  if (severity === "WARNING") {
    return "bg-warning-soft text-warning-foreground"
  }
  return ""
}

function alertAriaLabel(count: number) {
  if (count === 0) return "No active alerts"
  if (count === 1) return "One active alert"
  return `${count} active alerts`
}

export function AlertsInbox() {
  const navigate = useNavigate()
  const listId = useId()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [alerts, setAlerts] = useState<AlertContract[]>([])
  const requestIdRef = useRef(0)

  const loadAlerts = useEffectEvent(async (reason: "mount" | "open" | "poll") => {
    const requestId = ++requestIdRef.current
    if (reason !== "poll") setLoading(true)
    setError("")
    try {
      const next = await listUnifiedAlerts({
        data: {
          state: "",
          sourceType: "",
          applicationId: "",
          serviceId: "",
          severity: "",
        },
      })
      if (requestId !== requestIdRef.current) return
      setAlerts(next.filter(isActiveAlert))
    } catch (err) {
      if (requestId !== requestIdRef.current) return
      setError(
        err instanceof Error ? err.message : "Unable to load alerts."
      )
    } finally {
      if (requestId === requestIdRef.current) setLoading(false)
    }
  })

  useEffect(() => {
    void loadAlerts("mount")
  }, [])

  useEffect(() => {
    if (!open) return
    void loadAlerts("open")
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible") return
      void loadAlerts("poll")
    }, POLL_MS)
    return () => window.clearInterval(timer)
  }, [open])

  const preview = alerts.slice(0, PREVIEW_LIMIT)
  const count = alerts.length
  const label = alertAriaLabel(count)

  async function openAlert(alertId: string) {
    setOpen(false)
    await navigate({
      to: "/alerts",
      hash: `alert-${alertId}`,
    })
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            aria-controls={listId}
            aria-expanded={open}
            aria-haspopup="dialog"
            aria-label={label}
            className="relative"
            size="icon"
            title={label}
            type="button"
            variant="ghost"
          />
        }
      >
        <Bell aria-hidden="true" />
        {count > 0 ? (
          <span
            className="absolute top-1.5 right-1.5 flex size-2 items-center justify-center"
            aria-hidden="true"
          >
            <span className="size-1.5 rounded-full bg-destructive" />
          </span>
        ) : null}
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-[min(380px,calc(100vw-1.5rem))] gap-0 overflow-hidden rounded-xl p-0"
        sideOffset={8}
      >
        <PopoverHeader className="border-b px-4 py-3">
          <PopoverTitle className="text-sm font-semibold">
            Active alerts
          </PopoverTitle>
          <PopoverDescription className="text-xs">
            {loading && alerts.length === 0
              ? "Checking the inbox…"
              : count === 0
                ? "Nothing needs attention right now."
                : `${count} open or acknowledged`}
          </PopoverDescription>
        </PopoverHeader>

        <div
          id={listId}
          className="max-h-[min(420px,60vh)] overflow-y-auto"
          role="region"
          aria-label="Active alerts list"
          aria-busy={loading}
        >
          {loading && alerts.length === 0 ? (
            <div className="flex items-center justify-center gap-2 px-4 py-10 text-sm text-muted-foreground">
              <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
              Loading alerts…
            </div>
          ) : error && alerts.length === 0 ? (
            <div className="space-y-3 px-4 py-8 text-center" role="alert">
              <p className="text-sm text-destructive">{error}</p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => void loadAlerts("open")}
              >
                Retry
              </Button>
            </div>
          ) : preview.length === 0 ? (
            <div className="px-4 py-10 text-center">
              <Check className="mx-auto size-6 text-success" aria-hidden="true" />
              <p className="mt-3 text-sm font-medium">All clear</p>
              <p className="mt-1 text-xs text-muted-foreground">
                No open, acknowledged, or error alerts.
              </p>
            </div>
          ) : (
            <ul className="divide-y">
              {preview.map((alert) => {
                const external = alert.sourceType === "OPENSEARCH_ALERTING"
                const browser =
                  alert.sourceType === "RHYTHM_BROWSER_MONITOR"
                return (
                  <li key={alert.id}>
                    <button
                      type="button"
                      className="flex w-full gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/55 focus-visible:bg-muted/55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                      onClick={() => void openAlert(alert.id)}
                    >
                      <span
                        className={`mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg ${
                          alert.severity === "CRITICAL" ||
                          alert.severity === "HIGH"
                            ? "bg-destructive/10 text-destructive"
                            : "bg-muted text-muted-foreground"
                        }`}
                        aria-hidden="true"
                      >
                        {external ? (
                          <Webhook className="size-3.5" />
                        ) : browser ? (
                          <MonitorCheck className="size-3.5" />
                        ) : (
                          <CircleAlert className="size-3.5" />
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">
                          {alert.title}
                        </span>
                        <span className="mt-1 flex flex-wrap items-center gap-1.5">
                          <Badge
                            className={severityClass(alert.severity)}
                            variant="secondary"
                          >
                            {alert.severity.toLowerCase()}
                          </Badge>
                          <Badge variant="outline">
                            {alert.state.toLowerCase()}
                          </Badge>
                          <span className="text-[11px] text-muted-foreground">
                            {relativeTime(
                              alert.lastTriggeredAt ||
                                alert.updatedAt ||
                                alert.createdAt
                            )}
                          </span>
                        </span>
                        {(alert.monitorName ||
                          alert.browserMonitorName ||
                          alert.applicationName) && (
                          <span className="mt-1 block truncate text-xs text-muted-foreground">
                            {alert.monitorName ||
                              alert.browserMonitorName ||
                              alert.applicationName}
                          </span>
                        )}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
          {error && alerts.length > 0 ? (
            <p className="border-t px-4 py-2 text-xs text-destructive" role="alert">
              {error}
            </p>
          ) : null}
        </div>

        <div className="border-t px-2 py-2">
          <Button
            render={
              <Link
                aria-label="View all alerts"
                to="/alerts"
                onClick={() => setOpen(false)}
              />
            }
            className="w-full justify-center"
            nativeButton={false}
            size="sm"
            variant="ghost"
          >
            View all alerts
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
