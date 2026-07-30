import { createFileRoute, Link, useRouter } from "@tanstack/react-router"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import {
  Activity,
  ArrowRight,
  CircleAlert,
  FilePenLine,
  Play,
  Rocket,
} from "lucide-react"

import { OperationalStatusBadge } from "@/components/operational-status"
import type { AlertContract } from "@/lib/api-client/contracts"
import {
  getMonitorDraft,
  getMonitorSchedule,
  listMonitorRuns,
  runMonitor,
} from "@/lib/api-client/monitors"
import { listUnifiedAlerts } from "@/lib/api-client/opensearch-alerts"
import { formatDateTime } from "@/lib/format-date"
import { PageContainer } from "@/components/page-container"

export const Route = createFileRoute("/monitors/$monitorId/")({
  loader: async ({ params }) => {
    const [draft, schedule, runs, alerts] = await Promise.all([
      getMonitorDraft({ data: { monitorId: params.monitorId } }),
      getMonitorSchedule({ data: { monitorId: params.monitorId } }),
      listMonitorRuns({ data: { monitorId: params.monitorId } }),
      listUnifiedAlerts({
        data: {
          state: "",
          sourceType: "RHYTHM_MONITOR",
          applicationId: "",
          serviceId: "",
          severity: "",
        },
      }),
    ])
    return {
      draft,
      schedule,
      runs,
      alerts: alerts.filter((alert) => alert.monitorId === params.monitorId),
    }
  },
  component: MonitorOverview,
})

const activeAlertStates = new Set<AlertContract["state"]>([
  "OPEN",
  "ACKNOWLEDGED",
  "ERROR",
])

function MonitorOverview() {
  const { draft, schedule, runs, alerts } = Route.useLoaderData()
  const router = useRouter()
  const monitor = draft.monitor
  const activeAlerts = alerts.filter((alert) => activeAlertStates.has(alert.state))
  const latestRun = runs[0]
  const completed = runs.filter(
    (run) => !["QUEUED", "STARTING", "RUNNING"].includes(run.status)
  )
  const successful = completed.filter((run) =>
    ["SUCCESS", "SUCCESS_WITH_WARNINGS"].includes(run.status)
  ).length
  const successRate = completed.length
    ? Math.round((successful / completed.length) * 1000) / 10
    : undefined
  const status = !monitor.enabled
    ? "PAUSED"
    : activeAlerts.some((alert) =>
          ["CRITICAL", "HIGH"].includes(alert.severity)
        ) || latestRun?.status === "FAILED"
      ? "FAILING"
      : activeAlerts.length || (successRate !== undefined && successRate < 99)
        ? "DEGRADED"
        : latestRun
          ? "HEALTHY"
          : "NO_SIGNAL"

  async function execute() {
    const result = await runMonitor({ data: { monitorId: monitor.id } })
    if (result.ok) {
      await router.navigate({
        to: "/monitors/$monitorId/runs/$runId",
        params: { monitorId: monitor.id, runId: result.run.id },
      })
    }
  }

  return (
    <PageContainer as="main">
      <header className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <OperationalStatusBadge status={status} />
            <Badge variant="outline">
              {monitor.state.toLowerCase().replaceAll("_", " ")}
            </Badge>
          </div>
          <h1 className="mt-3 text-2xl font-semibold">Monitor overview</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Current operational state, schedule, revision readiness, and the
            fastest path to the next action.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => void execute()}>
            <Play />
            Run now
          </Button>
          <Button
            nativeButton={false}
            render={
              <Link
                params={{ monitorId: monitor.id }}
                to="/monitors/$monitorId/edit"
              />
            }
            variant="outline"
          >
            <FilePenLine />
            Edit draft
          </Button>
          {activeAlerts.length ? (
            <Button nativeButton={false} render={<Link to="/alerts" />} variant="outline">
              <CircleAlert />
              View failure
            </Button>
          ) : null}
        </div>
      </header>

      <section
        aria-label="Monitor status summary"
        className="mt-7 grid divide-y rounded-lg border sm:grid-cols-2 sm:divide-x sm:divide-y-0 xl:grid-cols-4"
      >
        <Summary
          label="Latest outcome"
          value={latestRun?.status.replaceAll("_", " ") ?? "No execution"}
          detail={
            latestRun
              ? formatDateTime(latestRun.startedAt ?? latestRun.createdAt)
              : "Run the published monitor to establish a signal."
          }
        />
        <Summary
          label="Reliability"
          value={successRate === undefined ? "Not recorded" : `${successRate}%`}
          detail={`${completed.length} recorded execution${completed.length === 1 ? "" : "s"}`}
        />
        <Summary
          label="Next run"
          value={
            schedule?.active && schedule.nextRunAt
              ? formatDateTime(schedule.nextRunAt)
              : schedule?.active
                ? "Scheduling"
                : "Not scheduled"
          }
          detail={schedule?.type ?? "Manual execution only"}
        />
        <Summary
          label="Active alerts"
          value={String(activeAlerts.length)}
          detail={
            activeAlerts.length
              ? "Resolve the underlying failure before relying on health."
              : "No alert currently needs attention."
          }
        />
      </section>

      <div className="mt-8 grid gap-6 lg:grid-cols-[1.2fr_.8fr]">
        <section>
          <h2 className="text-lg font-semibold">Recommended next action</h2>
          <div className="mt-3 flex items-start gap-3 border-y py-4">
            {activeAlerts.length ? (
              <CircleAlert className="mt-0.5 size-5 text-destructive" />
            ) : monitor.latestPublishedRevisionId !==
              monitor.currentDraftRevisionId ? (
              <Rocket className="mt-0.5 size-5 text-primary" />
            ) : (
              <Activity className="mt-0.5 size-5 text-primary" />
            )}
            <div>
              <p className="font-medium">
                {activeAlerts.length
                  ? "Inspect the latest failed execution"
                  : monitor.latestPublishedRevisionId !==
                      monitor.currentDraftRevisionId
                    ? "Review and publish the current draft"
                    : "Review recent performance"}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {activeAlerts.length
                  ? "The monitor is not considered healthy while an actionable alert remains active."
                  : monitor.latestPublishedRevisionId !==
                      monitor.currentDraftRevisionId
                    ? "Scheduled runs continue using the published revision until the draft is published."
                    : "Use Metrics for API-only percentiles and spike analysis."}
              </p>
              <Link
                className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
                params={{ monitorId: monitor.id }}
                to={
                  activeAlerts.length
                    ? "/monitors/$monitorId/runs"
                    : monitor.latestPublishedRevisionId !==
                        monitor.currentDraftRevisionId
                      ? "/monitors/$monitorId/edit"
                      : "/monitors/$monitorId/metrics"
                }
              >
                Continue
                <ArrowRight className="size-4" />
              </Link>
            </div>
          </div>
        </section>
        <section>
          <h2 className="text-lg font-semibold">Configuration readiness</h2>
          <dl className="mt-3 divide-y border-y text-sm">
            <Readiness
              label="Published revision"
              value={
                monitor.latestPublishedRevisionId
                  ? "Available"
                  : "Publish required"
              }
            />
            <Readiness
              label="Draft changes"
              value={
                monitor.latestPublishedRevisionId ===
                monitor.currentDraftRevisionId
                  ? "No divergence"
                  : "Unpublished changes"
              }
            />
            <Readiness
              label="Schedule"
              value={schedule?.active ? "Enabled" : "Disabled"}
            />
            <Readiness
              label="Workflow"
              value={`${Array.isArray(draft.revision.definition.steps) ? draft.revision.definition.steps.length : 0} step(s)`}
            />
          </dl>
        </section>
      </div>
    </PageContainer>
  )
}

function Summary({
  label,
  value,
  detail,
}: {
  label: string
  value: string
  detail: string
}) {
  return (
    <div className="min-w-0 p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 truncate text-lg font-semibold">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
    </div>
  )
}

function Readiness({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium">{value}</dd>
    </div>
  )
}
