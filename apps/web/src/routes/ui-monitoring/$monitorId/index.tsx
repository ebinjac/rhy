import { useState } from "react"
import { createFileRoute, Link, useRouter } from "@tanstack/react-router"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import {
  Activity,
  ArrowRight,
  CheckCircle2,
  CircleAlert,
  Clock3,
  Eye,
  FilePenLine,
  LoaderCircle,
  Play,
  Rocket,
  ShieldCheck,
} from "lucide-react"
import { toast } from "@workspace/ui/components/sonner"

import { PageContainer } from "@/components/page-container"
import {
  BrowserHealthBadge,
  BrowserRunBadge,
  formatDuration,
  formatFrequency,
  isSuccessfulBrowserStepStatus,
} from "@/features/ui-monitoring/browser-monitor-status"
import {
  getBrowserMonitor,
  listBrowserBaselines,
  listBrowserMonitorRevisions,
  listBrowserRuns,
  publishBrowserMonitor,
  runBrowserMonitor,
  updateBrowserMonitor,
} from "@/lib/api-client/browser-monitoring"
import { formatDateTime } from "@/lib/format-date"

export const Route = createFileRoute("/ui-monitoring/$monitorId/")({
  loader: async ({ params }) => {
    const [monitor, runs, revisions, baselines] = await Promise.all([
      getBrowserMonitor({ data: { monitorId: params.monitorId } }),
      listBrowserRuns({ data: { monitorId: params.monitorId, limit: 20 } }),
      listBrowserMonitorRevisions({ data: { monitorId: params.monitorId } }),
      listBrowserBaselines({ data: { monitorId: params.monitorId } }),
    ])
    return { monitor, runs, revisions, baselines }
  },
  component: BrowserMonitorOverview,
})

function BrowserMonitorOverview() {
  const { monitor, runs, revisions, baselines } = Route.useLoaderData()
  const router = useRouter()
  const [action, setAction] = useState("")
  const latest = runs[0]
  const draft = revisions.find(
    (revision) => revision.id === monitor.currentDraftRevisionId
  )
  const published = revisions.find(
    (revision) => revision.id === monitor.latestPublishedRevisionId
  )
  const draftDiverged =
    Boolean(draft && published) && draft?.id !== published?.id
  const activeBaselines = baselines.filter(
    (baseline) => baseline.status === "APPROVED"
  )
  const definition = draft?.definition ?? published?.definition
  const enabledSteps =
    definition?.steps.filter((step) => step.enabled).length ?? 0
  const blockingChecks =
    definition?.steps.reduce(
      (count, step) =>
        count +
        (step.checks?.filter(
          (check) => check.enabled && check.gateMode === "BLOCKING"
        ).length ?? 0) +
        (step.graph?.gateMode === "BLOCKING" ? 1 : 0),
      0
    ) ?? 0

  async function execute() {
    setAction("run")
    try {
      const result = await runBrowserMonitor({
        data: { monitorId: monitor.id, revision: "" },
      })
      await router.navigate({
        to: "/ui-monitoring/$monitorId/runs/$runId",
        params: { monitorId: monitor.id, runId: result.run.id },
      })
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Run was not started."
      )
      setAction("")
    }
  }

  async function publish() {
    setAction("publish")
    try {
      await publishBrowserMonitor({
        data: {
          monitorId: monitor.id,
          changeSummary: "Published from UI monitor overview",
        },
      })
      toast.success("Browser journey published")
      await router.invalidate()
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "The draft was not published."
      )
    } finally {
      setAction("")
    }
  }

  async function toggleEnabled() {
    setAction("enable")
    try {
      await updateBrowserMonitor({
        data: {
          monitorId: monitor.id,
          input: { enabled: !monitor.enabled },
        },
      })
      toast.success(monitor.enabled ? "Schedule paused" : "Schedule enabled")
      await router.invalidate()
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Schedule was not changed."
      )
    } finally {
      setAction("")
    }
  }

  return (
    <PageContainer as="main">
      <header className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <BrowserHealthBadge monitor={monitor} />
            <Badge variant="outline">
              {monitor.state.toLowerCase().replaceAll("_", " ")}
            </Badge>
          </div>
          <h1 className="mt-3 text-2xl font-semibold">UI monitor overview</h1>
          <p className="mt-1 max-w-2xl text-sm/6 text-muted-foreground">
            Browser journey readiness, latest outcome, schedule, approved visual
            baselines, and the safest next operational action.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={action === "run" || !monitor.latestPublishedRevisionId}
            onClick={() => void execute()}
          >
            {action === "run" ? (
              <LoaderCircle className="animate-spin motion-reduce:animate-none" />
            ) : (
              <Play />
            )}
            Run now
          </Button>
          <Button
            nativeButton={false}
            render={
              <Link
                params={{ monitorId: monitor.id }}
                to="/ui-monitoring/$monitorId/journey"
              />
            }
            variant="outline"
          >
            <FilePenLine />
            Edit journey
          </Button>
          {draftDiverged || !published ? (
            <Button
              disabled={action === "publish"}
              onClick={() => void publish()}
              variant="outline"
            >
              <Rocket />
              Publish
            </Button>
          ) : null}
          <Button
            disabled={action === "enable" || (!published && !monitor.enabled)}
            onClick={() => void toggleEnabled()}
            variant="outline"
          >
            <Clock3 />
            {monitor.enabled ? "Pause" : "Enable"}
          </Button>
        </div>
      </header>

      <section
        aria-label="Browser monitor summary"
        className="mt-7 grid divide-y rounded-lg border sm:grid-cols-2 sm:divide-x sm:divide-y-0 xl:grid-cols-4"
      >
        <Summary
          label="Latest outcome"
          value={
            latest ? <BrowserRunBadge status={latest.status} /> : "No execution"
          }
          detail={
            latest
              ? formatDateTime(latest.startedAt ?? latest.createdAt)
              : "Run the published journey to establish a signal."
          }
        />
        <Summary
          label="Journey duration"
          value={formatDuration(latest?.durationMs)}
          detail="Full controlled synthetic journey"
        />
        <Summary
          label="Next run"
          value={
            monitor.enabled && monitor.nextRunAt
              ? formatDateTime(monitor.nextRunAt)
              : monitor.enabled
                ? "Scheduling"
                : "Paused"
          }
          detail={formatFrequency(monitor.frequencySeconds)}
        />
        <Summary
          label="Visual baselines"
          value={String(activeBaselines.length)}
          detail={`${baselines.filter((item) => item.status === "PROPOSED").length} awaiting review`}
        />
      </section>

      <div className="mt-8 grid gap-6 lg:grid-cols-[1.15fr_.85fr]">
        <section aria-labelledby="latest-journey-title">
          <div className="flex items-end justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold" id="latest-journey-title">
                Latest journey
              </h2>
              <p className="mt-0.5 text-sm text-muted-foreground">
                The most recent action and checkpoint evidence.
              </p>
            </div>
            <Link
              className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
              params={{ monitorId: monitor.id }}
              to="/ui-monitoring/$monitorId/runs"
            >
              View runs
              <ArrowRight className="size-4" />
            </Link>
          </div>
          {latest ? (
            <div className="mt-4 overflow-hidden rounded-xl border">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b bg-muted/20 px-4 py-3">
                <div className="flex items-center gap-2">
                  <BrowserRunBadge status={latest.status} />
                  <span className="font-mono text-xs text-muted-foreground">
                    {latest.id.slice(0, 8)}
                  </span>
                </div>
                <Link
                  className="text-sm font-medium text-primary hover:underline"
                  params={{ monitorId: monitor.id, runId: latest.id }}
                  to="/ui-monitoring/$monitorId/runs/$runId"
                >
                  Open diagnostics
                </Link>
              </div>
              <ol
                className="divide-y"
                aria-label="Latest browser journey steps"
              >
                {(latest.steps ?? []).slice(0, 8).map((step, index) => (
                  <li
                    className="flex items-center gap-3 px-4 py-3"
                    key={step.id}
                  >
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-md border text-xs tabular-nums">
                      {index + 1}
                    </span>
                    {isSuccessfulBrowserStepStatus(step.status) ? (
                      <CheckCircle2 className="size-4 shrink-0 text-success" />
                    ) : (
                      <CircleAlert className="size-4 shrink-0 text-destructive" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {step.name}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {step.type.toLowerCase().replaceAll("_", " ")}
                      </p>
                    </div>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {formatDuration(step.durationMs)}
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          ) : (
            <div className="mt-4 flex min-h-64 flex-col items-center justify-center rounded-xl border border-dashed px-6 text-center">
              <Activity className="size-6 text-primary" />
              <p className="mt-3 font-medium">No browser execution yet</p>
              <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                Publish the draft, then run it once to capture journey,
                performance, console, network, and screenshot evidence.
              </p>
            </div>
          )}
        </section>

        <aside aria-labelledby="readiness-title">
          <h2 className="text-lg font-semibold" id="readiness-title">
            Configuration readiness
          </h2>
          <div className="mt-4 divide-y rounded-xl border">
            <ReadinessRow
              label="Published revision"
              ready={Boolean(published)}
              text={
                published
                  ? `Revision ${published.revisionNumber}`
                  : "Publish the draft"
              }
            />
            <ReadinessRow
              label="Enabled steps"
              ready={enabledSteps > 0}
              text={`${enabledSteps} configured`}
            />
            <ReadinessRow
              advisory
              label="Blocking checkpoints"
              ready={blockingChecks > 0}
              text={
                blockingChecks
                  ? `${blockingChecks} protects the outcome`
                  : "Add one to define success"
              }
            />
            <ReadinessRow
              advisory
              label="Approved visual baselines"
              ready={
                !definition?.steps.some((step) => step.type === "SCREENSHOT") ||
                activeBaselines.length > 0
              }
              text={
                definition?.steps.some((step) => step.type === "SCREENSHOT")
                  ? activeBaselines.length
                    ? `${activeBaselines.length} active`
                    : "Review proposed evidence"
                  : "No visual check configured"
              }
            />
            <ReadinessRow
              label="Application ownership"
              ready={Boolean(monitor.applicationId)}
              text={monitor.applicationName || "Link an application"}
            />
          </div>
          <div className="mt-5 rounded-xl border bg-primary/[0.035] p-4">
            <div className="flex items-start gap-3">
              {latest?.failureReason ? (
                <CircleAlert className="mt-0.5 size-5 text-destructive" />
              ) : draftDiverged || !published ? (
                <Rocket className="mt-0.5 size-5 text-primary" />
              ) : (
                <ShieldCheck className="mt-0.5 size-5 text-primary" />
              )}
              <div>
                <p className="font-medium">
                  {latest?.failureReason
                    ? "Inspect the exact failed action"
                    : draftDiverged || !published
                      ? "Publish the current browser journey"
                      : "Review synthetic performance"}
                </p>
                <p className="mt-1 text-sm/6 text-muted-foreground">
                  {latest?.failureReason
                    ? latest.failureReason
                    : draftDiverged || !published
                      ? "Scheduled runs continue using the last published definition until the draft is published."
                      : "Metrics separate page milestones, interaction timing, resources, and the complete journey."}
                </p>
                <Link
                  className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
                  params={{ monitorId: monitor.id }}
                  to={
                    latest?.failureReason
                      ? "/ui-monitoring/$monitorId/runs"
                      : draftDiverged || !published
                        ? "/ui-monitoring/$monitorId/journey"
                        : "/ui-monitoring/$monitorId/metrics"
                  }
                >
                  Continue
                  <ArrowRight className="size-4" />
                </Link>
              </div>
            </div>
          </div>
        </aside>
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
  value: React.ReactNode
  detail: string
}) {
  return (
    <div className="min-w-0 p-4 md:p-5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="mt-2 min-h-6 text-xl font-semibold">{value}</div>
      <p className="mt-1 truncate text-xs text-muted-foreground">{detail}</p>
    </div>
  )
}

function ReadinessRow({
  label,
  ready,
  text,
  advisory = false,
}: {
  label: string
  ready: boolean
  text: string
  advisory?: boolean
}) {
  return (
    <div className="flex items-start gap-3 px-4 py-3">
      {ready ? (
        <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
      ) : advisory ? (
        <Eye className="mt-0.5 size-4 shrink-0 text-warning" />
      ) : (
        <CircleAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
      )}
      <div className="min-w-0">
        <p className="text-sm font-medium">{label}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{text}</p>
      </div>
    </div>
  )
}
