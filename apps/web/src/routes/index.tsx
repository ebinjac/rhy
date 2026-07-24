import { createFileRoute, Link } from "@tanstack/react-router"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import {
  Activity,
  ArrowRight,
  Check,
  CircleAlert,
  Plus,
  Server,
  Workflow,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"

import { SystemNotice } from "@/components/app-shell/app-shell"
import type { MonitorSummary } from "@/features/monitors/seed-data"
import {
  listAlerts,
  listMonitors,
  listRecentRuns,
} from "@/lib/api-client/monitors"
import { listAgents } from "@/lib/api-client/agents"
import { formatDateTime, formatFullDate } from "@/lib/format-date"

export const Route = createFileRoute("/")({
  loader: async () => {
    const [monitors, alerts, runs, agents] = await Promise.all([
      listMonitors(),
      listAlerts({ data: { state: "OPEN" } }),
      listRecentRuns(),
      listAgents(),
    ])
    return { monitors, alerts, runs, agents }
  },
  component: OverviewPage,
})

const statusStyles = {
  passed: "bg-success-soft text-success-foreground",
  failed: "bg-destructive/10 text-destructive",
} as const

function OverviewPage() {
  const {
    monitors: monitorResult,
    alerts,
    runs,
    agents,
  } = Route.useLoaderData()
  const { monitors } = monitorResult
  const healthy = monitors.filter(
    (monitor) => monitor.status === "healthy"
  ).length
  const enabled = monitors.filter((monitor) => monitor.enabled).length

  return (
    <>
      <SystemNotice alert={alerts[0]} />
      <div className="mx-auto max-w-[1480px] px-4 py-6 md:px-6 md:py-8">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <p className="mb-1 text-sm text-muted-foreground">
              {formatFullDate(new Date())}
            </p>
            <h1 className="font-heading text-2xl font-semibold tracking-tight">
              System overview
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Live workflow health and the failures that need a decision.
            </p>
          </div>
          <Button
            render={<Link to="/monitors/new" />}
            nativeButton={false}
            size="lg"
          >
            <Plus data-icon="inline-start" /> New monitor
          </Button>
        </div>

        <section
          aria-label="Current health"
          className="mt-8 grid border-y sm:grid-cols-2 xl:grid-cols-4"
        >
          <Metric
            label="Enabled monitors"
            value={String(enabled)}
            detail={`${monitors.length - enabled} paused`}
            icon={Activity}
          />
          <Metric
            label="Healthy now"
            value={enabled ? `${Math.round((healthy / enabled) * 100)}%` : "—"}
            detail={`${healthy} of ${enabled} passing`}
            icon={Check}
            tone="success"
          />
          <Metric
            label="Active incidents"
            value={String(alerts.length)}
            detail={alerts.length ? "Threshold reached" : "No open alerts"}
            icon={CircleAlert}
            tone="danger"
          />
          <Metric
            label="Agent availability"
            value={`${agents.filter((agent) => agent.health === "HEALTHY").length} / ${agents.length}`}
            detail={
              agents.some((agent) => agent.health !== "HEALTHY")
                ? "Fleet needs attention"
                : "All locations reporting"
            }
            icon={Server}
          />
        </section>

        <div className="mt-9 grid gap-8 xl:grid-cols-[minmax(0,1.7fr)_minmax(320px,0.8fr)]">
          <section>
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="font-heading text-lg font-semibold">
                  Monitor health
                </h2>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  Latest result from each enabled production workflow.
                </p>
              </div>
              <Button
                render={<Link to="/monitors" />}
                nativeButton={false}
                variant="ghost"
              >
                View all <ArrowRight data-icon="inline-end" />
              </Button>
            </div>

            <div className="mt-4 overflow-hidden rounded-xl border">
              <div className="hidden grid-cols-[minmax(250px,1.5fr)_110px_110px_100px] gap-4 border-b bg-muted/45 px-4 py-2.5 text-xs font-medium text-muted-foreground md:grid">
                <span>Monitor</span>
                <span>State</span>
                <span>Last run</span>
                <span className="text-right">Latency</span>
              </div>
              {monitors.slice(0, 4).map((monitor) => (
                <Link
                  key={monitor.id}
                  to="/monitors"
                  className="grid gap-3 border-b px-4 py-4 transition-colors last:border-b-0 hover:bg-muted/35 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset md:grid-cols-[minmax(250px,1.5fr)_110px_110px_100px] md:items-center md:gap-4"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <StatusDot status={monitor.status} />
                      <p className="truncate text-sm font-medium">
                        {monitor.name}
                      </p>
                    </div>
                    <p className="mt-1 truncate pl-4 text-xs text-muted-foreground">
                      {monitor.stepCount} steps · {monitor.application}
                    </p>
                  </div>
                  <StatusBadge status={monitor.status} />
                  <span className="text-sm text-muted-foreground">
                    {monitor.lastRun}
                  </span>
                  <span className="font-mono text-sm md:text-right">
                    {monitor.latencyMs ? `${monitor.latencyMs} ms` : "—"}
                  </span>
                </Link>
              ))}
            </div>
          </section>

          <aside>
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="font-heading text-lg font-semibold">
                  Recent runs
                </h2>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  Newest execution evidence.
                </p>
              </div>
              <Button
                aria-label="View run history"
                size="icon-sm"
                variant="ghost"
              >
                <ArrowRight />
              </Button>
            </div>
            <div className="mt-4 divide-y rounded-xl border">
              {runs.slice(0, 5).map((run) => {
                const passed = run.status === "SUCCESS"
                const status = passed ? "passed" : "failed"
                const monitor = monitors.find(
                  (item) => item.id === run.monitorId
                )
                return (
                  <Link
                    to="/monitors/$monitorId/runs/$runId"
                    params={{ monitorId: run.monitorId, runId: run.id }}
                    className="flex items-start gap-3 px-4 py-4 transition-colors hover:bg-muted/35"
                    key={run.id}
                  >
                    <div
                      className={`mt-0.5 grid size-7 shrink-0 place-items-center rounded-full ${statusStyles[status]}`}
                    >
                      {passed ? (
                        <Check className="size-3.5" />
                      ) : (
                        <CircleAlert className="size-3.5" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {monitor?.name ?? run.monitorId}
                      </p>
                      <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                        <span>{formatDateTime(run.createdAt)}</span>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono">{run.durationMs} ms</span>
                      </div>
                    </div>
                    <Badge className={statusStyles[status]} variant="secondary">
                      {status}
                    </Badge>
                  </Link>
                )
              })}
            </div>

            <div className="mt-6 rounded-xl bg-foreground p-5 text-background">
              <Workflow aria-hidden="true" className="size-5 text-primary" />
              <h3 className="mt-5 font-heading text-base font-semibold">
                Build a complete API journey
              </h3>
              <p className="mt-2 text-sm leading-6 text-background/70">
                Chain requests, reuse outputs, and validate technical and
                business outcomes in one monitor.
              </p>
              <Button
                render={<Link to="/monitors/new" />}
                nativeButton={false}
                className="mt-5 bg-background text-foreground hover:bg-background/90"
                variant="secondary"
              >
                Create workflow <ArrowRight data-icon="inline-end" />
              </Button>
            </div>
          </aside>
        </div>
      </div>
    </>
  )
}

function Metric({
  label,
  value,
  detail,
  icon: Icon,
  tone = "default",
}: {
  label: string
  value: string
  detail: string
  icon: LucideIcon
  tone?: "default" | "success" | "danger"
}) {
  const toneClass =
    tone === "success"
      ? "text-success-foreground"
      : tone === "danger"
        ? "text-destructive"
        : "text-foreground"
  return (
    <div className="flex min-h-28 items-start gap-4 border-b p-4 last:border-b-0 sm:odd:border-r xl:border-b-0 xl:[&:nth-child(2)]:border-r sm:[&:nth-child(3)]:border-b-0 xl:[&:nth-child(3)]:border-r sm:[&:nth-child(4)]:border-b-0">
      <div className="grid size-8 place-items-center rounded-lg bg-muted">
        <Icon aria-hidden="true" className={`size-4 ${toneClass}`} />
      </div>
      <div>
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <p className={`mt-1 font-heading text-2xl font-semibold ${toneClass}`}>
          {value}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
      </div>
    </div>
  )
}

function StatusDot({ status }: { status: MonitorSummary["status"] }) {
  const color =
    status === "healthy"
      ? "bg-success"
      : status === "failing"
        ? "bg-destructive"
        : status === "warning"
          ? "bg-warning"
          : "bg-muted-foreground"
  return <span aria-hidden="true" className={`size-2 rounded-full ${color}`} />
}

export function StatusBadge({ status }: { status: MonitorSummary["status"] }) {
  const styles =
    status === "healthy"
      ? "bg-success-soft text-success-foreground"
      : status === "failing"
        ? "bg-destructive/10 text-destructive"
        : status === "warning"
          ? "bg-warning-soft text-warning-foreground"
          : "bg-muted text-muted-foreground"
  return (
    <Badge className={`capitalize ${styles}`} variant="secondary">
      {status}
    </Badge>
  )
}
