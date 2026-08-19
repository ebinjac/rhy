import { useEffect, useState } from "react"
import { Button } from "@workspace/ui/components/button"
import { Link } from "@tanstack/react-router"
import {
  Check,
  CircleAlert,
  ExternalLink,
  LoaderCircle,
  RefreshCw,
} from "lucide-react"

import { InfoHint } from "@/components/info-hint"
import type {
  InvestigationItemContract,
  InvestigationReportContract,
} from "@/lib/api-client/contracts"
import { rerunAlertInvestigation } from "@/lib/api-client/investigation"

const activeStatuses = new Set(["PENDING", "RUNNING"])

export function InvestigationChecklist({
  alertId,
  report,
  onRefresh,
}: {
  alertId: string
  report: InvestigationReportContract
  onRefresh: () => Promise<InvestigationReportContract>
}) {
  const [items, setItems] = useState(report.items)
  const [runningId, setRunningId] = useState("")
  const [message, setMessage] = useState("")

  useEffect(() => {
    setItems(report.items)
  }, [report])

  const pending = items.some((item) => activeStatuses.has(item.status))
  useEffect(() => {
    if (!pending) return
    let disposed = false
    let loading = false
    const refresh = async () => {
      if (loading || document.visibilityState !== "visible") return
      loading = true
      try {
        const next = await onRefresh()
        if (!disposed) setItems(next.items)
      } finally {
        loading = false
      }
    }
    const timer = window.setInterval(() => void refresh(), 2000)
    return () => {
      disposed = true
      window.clearInterval(timer)
    }
  }, [pending, onRefresh])

  if (!items.length) return null

  async function rerun(checkId: string) {
    setRunningId(checkId)
    setMessage("")
    const result = await rerunAlertInvestigation({
      data: { alertId, checkId },
    })
    if (!result.ok) {
      setMessage(result.message)
      setRunningId("")
      return
    }
    setItems((current) =>
      current.map((item) => (item.id === checkId ? result.item : item))
    )
    setRunningId("")
    const next = await onRefresh()
    setItems(next.items)
  }

  return (
    <section aria-labelledby="investigation-heading">
      <div className="flex items-start gap-3">
        <div>
          <h2
            className="flex items-center gap-1.5 text-lg font-semibold"
            id="investigation-heading"
          >
            Investigation
            <InfoHint title="Investigation">
              Predefined ELF and Dynatrace checks for this journey. Re-run any
              item or open the source query with the failure time window.
            </InfoHint>
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Evidence gathered when this alert opened. Re-run a check without
            leaving the page.
          </p>
        </div>
      </div>
      {message ? (
        <p className="mt-3 text-sm text-destructive">{message}</p>
      ) : null}
      <ul className="mt-4 divide-y rounded-xl border">
        {items.map((item) => (
          <li className="flex gap-3 p-4" key={`${item.id}-${item.attempt}`}>
            <StatusMark status={item.status} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-medium">{item.label}</p>
                <span className="text-xs text-muted-foreground">
                  {item.kind === "ELF_QUERY" ? "ELF" : "Dynatrace"}
                </span>
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {item.summary || statusLabel(item.status)}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  disabled={runningId === item.id || activeStatuses.has(item.status)}
                  onClick={() => void rerun(item.id)}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  {runningId === item.id ? (
                    <LoaderCircle className="animate-spin" data-icon="inline-start" />
                  ) : (
                    <RefreshCw data-icon="inline-start" />
                  )}
                  Re-run
                </Button>
                {item.kind === "ELF_QUERY" && item.queryId ? (
                  <Button
                    nativeButton={false}
                    render={
                      <Link
                        params={{ queryId: item.queryId }}
                        to="/elf/$queryId"
                      />
                    }
                    size="sm"
                    variant="ghost"
                  >
                    <ExternalLink data-icon="inline-start" />
                    Open ELF
                  </Button>
                ) : null}
                {item.kind === "DYNATRACE" && item.applicationId ? (
                  <Button
                    nativeButton={false}
                    render={
                      <Link
                        params={{ applicationId: item.applicationId }}
                        to="/applications/$applicationId"
                      />
                    }
                    size="sm"
                    variant="ghost"
                  >
                    <ExternalLink data-icon="inline-start" />
                    Open Dynatrace
                  </Button>
                ) : null}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}

function statusLabel(status: InvestigationItemContract["status"]) {
  if (status === "PENDING" || status === "RUNNING") return "Running"
  if (status === "PASSED") return "Passed"
  if (status === "SKIPPED") return "Skipped"
  if (status === "ERROR") return "Error"
  return "Failed"
}

function StatusMark({
  status,
}: {
  status: InvestigationItemContract["status"]
}) {
  const failed = status === "FAILED" || status === "ERROR"
  const active = activeStatuses.has(status)
  const passed = status === "PASSED"
  return (
    <span
      className={`grid size-7 shrink-0 place-items-center rounded-full ${
        passed
          ? "bg-success-soft text-success-foreground"
          : active
            ? "bg-muted text-muted-foreground"
            : failed
              ? "bg-destructive/10 text-destructive"
              : "bg-muted text-muted-foreground"
      }`}
    >
      {passed ? (
        <Check className="size-3.5" />
      ) : active ? (
        <LoaderCircle className="size-3.5 animate-spin" />
      ) : (
        <CircleAlert className="size-3.5" />
      )}
    </span>
  )
}
