import { useMemo, useState } from "react"
import type { ReactNode } from "react"
import { createFileRoute, Link } from "@tanstack/react-router"
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
  ArrowRight,
  Boxes,
  Check,
  CircleAlert,
  FileSearch,
  Plus,
  Rocket,
  Settings2,
  TriangleAlert,
  Workflow,
} from "lucide-react"

import { SystemNotice } from "@/components/app-shell/app-shell"
import { OnboardingChecklist } from "@/components/onboarding-checklist"
import {
  fromMonitorSummaryStatus,
  OperationalStatusBadge,
} from "@/components/operational-status"
import type { OnboardingStep } from "@/components/onboarding-checklist"
import type { MonitorSummary } from "@/features/monitors/seed-data"
import type {
  AlertContract,
  DeploymentValidationRunContract,
  ELFApplicationContract,
  RunContract,
} from "@/lib/api-client/contracts"
import {
  getELFSettings,
  listELFApplications,
  listELFQueries,
} from "@/lib/api-client/elf"
import { listMonitors, listRecentRuns } from "@/lib/api-client/monitors"
import { listUnifiedAlerts } from "@/lib/api-client/opensearch-alerts"
import { listDeploymentValidations, listSuites } from "@/lib/api-client/suites"
import { formatDateTime, formatFullDate } from "@/lib/format-date"

export const Route = createFileRoute("/")({
  loader: async () => {
    const [
      monitors,
      alerts,
      runs,
      deployments,
      applications,
      elfQueries,
      elfSettings,
      suites,
    ] = await Promise.all([
      listMonitors(),
      listUnifiedAlerts({
        data: {
          state: "",
          sourceType: "",
          applicationId: "",
          serviceId: "",
          severity: "",
        },
      }),
      listRecentRuns(),
      listDeploymentValidations().catch(
        () => [] as DeploymentValidationRunContract[]
      ),
      listELFApplications().catch(() => [] as ELFApplicationContract[]),
      listELFQueries().catch(() => []),
      getELFSettings().catch(() => null),
      listSuites().catch(() => []),
    ])
    return {
      monitors,
      alerts,
      runs,
      deployments,
      applications,
      elfQueries,
      elfSettings,
      suites,
    }
  },
  component: OverviewPage,
})

type FocusFilter = "attention" | "all" | "healthy"

const FAILED_RUN_STATUSES = new Set<RunContract["status"]>([
  "FAILED",
  "TIMED_OUT",
  "ABORTED",
])

const ACTIVE_ALERT_STATES = new Set<AlertContract["state"]>([
  "OPEN",
  "ACKNOWLEDGED",
  "ERROR",
])

function OverviewPage() {
  const {
    monitors: monitorResult,
    alerts,
    runs,
    deployments,
    applications,
    elfQueries,
    elfSettings,
    suites,
  } = Route.useLoaderData()
  const { monitors } = monitorResult
  const [focus, setFocus] = useState<FocusFilter>("attention")

  const activeAlerts = useMemo(
    () => alerts.filter((alert) => ACTIVE_ALERT_STATES.has(alert.state)),
    [alerts]
  )
  const criticalAlerts = activeAlerts.filter(
    (alert) => alert.severity === "CRITICAL" || alert.severity === "HIGH"
  )
  const enabled = monitors.filter((monitor) => monitor.enabled)
  const healthy = enabled.filter((monitor) => monitor.status === "healthy")
  const attentionMonitors = monitors
    .filter(
      (monitor) => monitor.status === "failing" || monitor.status === "warning"
    )
    .sort((left, right) => statusRank(left.status) - statusRank(right.status))
  const failedRuns = runs.filter((run) => FAILED_RUN_STATUSES.has(run.status))
  const recentDeployments = [...deployments]
    .sort(
      (left, right) =>
        new Date(right.deployment.deploymentStart).getTime() -
        new Date(left.deployment.deploymentStart).getTime()
    )
    .slice(0, 4)

  const posture = derivePosture({
    monitorCount: monitors.length,
    enabledCount: enabled.length,
    healthyCount: healthy.length,
    attentionCount: attentionMonitors.length,
    alertCount: activeAlerts.length,
    criticalCount: criticalAlerts.length,
  })

  const visibleMonitors = useMemo(() => {
    const sorted = [...monitors].sort(
      (left, right) => statusRank(left.status) - statusRank(right.status)
    )
    if (focus === "healthy") {
      return sorted.filter((monitor) => monitor.status === "healthy")
    }
    if (focus === "attention") {
      const needing = sorted.filter(
        (monitor) =>
          monitor.status === "failing" ||
          monitor.status === "warning" ||
          monitor.status === "unknown"
      )
      return needing.length ? needing : sorted.slice(0, 6)
    }
    return sorted
  }, [monitors, focus])

  const hasMonitors = monitors.length > 0
  const onboardingSteps: OnboardingStep[] = [
    {
      id: "configuration",
      label: "Configure credentials and integrations",
      description: "Add the profiles your monitors and log queries depend on.",
      complete: Boolean(elfSettings),
      to: "/configuration",
    },
    {
      id: "application",
      label: "Register an application",
      description: "Assign ownership, CAR ID, environment, and services.",
      complete: applications.length > 0,
      to: "/applications",
    },
    {
      id: "monitor",
      label: "Create and test a monitor",
      description: "Build a request workflow and verify its checks.",
      complete: monitors.length > 0,
      to: "/monitors/new",
    },
    {
      id: "schedule",
      label: "Enable a schedule",
      description: "Publish a monitor and establish a continuous signal.",
      complete: monitors.some((monitor) => monitor.enabled),
      to: "/monitors",
    },
    {
      id: "elf",
      label: "Create an ELF query",
      description: "Probe OpenSearch logs and define the deployment condition.",
      complete: elfQueries.length > 0,
      to: elfSettings ? "/elf" : "/elf/settings",
    },
    {
      id: "suite",
      label: "Build a validation suite",
      description: "Combine monitors and log checks into a release workflow.",
      complete: suites.length > 0 || deployments.length > 0,
      to: "/suites",
    },
  ]

  return (
    <>
      <SystemNotice alert={activeAlerts[0]} alertCount={activeAlerts.length} />
      <div className="mx-auto max-w-[1480px] px-4 py-6 md:px-6 md:py-8">
        <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <p className="mb-1 text-sm text-muted-foreground">
              {formatFullDate(new Date())}
            </p>
            <h1 className="font-heading text-2xl font-semibold tracking-tight text-balance">
              Operations
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-pretty text-muted-foreground">
              Monitor health, open alerts, and deployment gates in one place.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {activeAlerts.length ? (
              <Button
                render={<Link to="/alerts" />}
                nativeButton={false}
                variant="outline"
              >
                <CircleAlert data-icon="inline-start" />
                Open alerts
                <Badge className="ml-1" variant="secondary">
                  {activeAlerts.length}
                </Badge>
              </Button>
            ) : null}
            <Button
              render={<Link to="/monitors/new" />}
              nativeButton={false}
              size="lg"
            >
              <Plus data-icon="inline-start" /> New monitor
            </Button>
          </div>
        </header>
        <OnboardingChecklist steps={onboardingSteps} />

        <section
          aria-label="Operational posture"
          className={`mt-7 rounded-xl border px-5 py-5 ${posture.surface}`}
        >
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <div className="flex items-center gap-2.5">
                <span
                  aria-hidden="true"
                  className={`size-2.5 rounded-full ${posture.dot} ${
                    posture.pulse ? "motion-safe:animate-pulse" : ""
                  }`}
                />
                <p
                  className={`font-heading text-lg font-semibold ${posture.title}`}
                >
                  {posture.headline}
                </p>
              </div>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-pretty text-muted-foreground">
                {posture.summary}
              </p>
            </div>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4 lg:gap-x-8">
              <Stat label="Enabled" value={String(enabled.length)} />
              <Stat
                label="Healthy"
                value={
                  enabled.length ? `${healthy.length}/${enabled.length}` : "—"
                }
                tone={
                  attentionMonitors.some((m) => m.status === "failing")
                    ? "danger"
                    : healthy.length === enabled.length && enabled.length
                      ? "success"
                      : "default"
                }
              />
              <Stat
                label="Open alerts"
                value={String(activeAlerts.length)}
                tone={activeAlerts.length ? "danger" : "default"}
              />
              <Stat label="Applications" value={String(applications.length)} />
            </dl>
          </div>
        </section>

        {!hasMonitors ? (
          <EmptyWorkspace applicationCount={applications.length} />
        ) : (
          <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1.55fr)_minmax(280px,0.9fr)] lg:items-start">
            <div className="min-w-0 space-y-8">
              {activeAlerts.length ? (
                <section aria-labelledby="alerts-heading">
                  <SectionHeader
                    id="alerts-heading"
                    title="Needs triage"
                    description="Open and acknowledged alerts waiting on a decision."
                    action={
                      <Button
                        render={<Link to="/alerts" />}
                        nativeButton={false}
                        variant="ghost"
                      >
                        Alert inbox <ArrowRight data-icon="inline-end" />
                      </Button>
                    }
                  />
                  <ul className="mt-4 divide-y rounded-xl border">
                    {activeAlerts.slice(0, 5).map((alert) => (
                      <li key={alert.id}>
                        <Link
                          to="/alerts"
                          className="flex items-start gap-3 px-4 py-3.5 transition-colors duration-150 hover:bg-muted/35 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset"
                        >
                          <div className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-destructive/10 text-destructive">
                            <CircleAlert className="size-3.5" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium">
                              {alert.sourceType === "OPENSEARCH_ALERTING"
                                ? alert.title
                                : alert.monitorName || alert.title}
                            </p>
                            <p className="mt-1 truncate text-xs text-muted-foreground">
                              {alert.applicationName || "Unassigned"} ·{" "}
                              {alert.severity.toLowerCase()} ·{" "}
                              {alert.consecutiveFailures
                                ? `${alert.consecutiveFailures} consecutive`
                                : alert.state.toLowerCase()}
                            </p>
                          </div>
                          <Badge
                            className={
                              alert.severity === "CRITICAL" ||
                              alert.severity === "HIGH"
                                ? "bg-destructive/10 text-destructive"
                                : "bg-warning-soft text-warning-foreground"
                            }
                            variant="secondary"
                          >
                            {alert.state.toLowerCase()}
                          </Badge>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}

              <section aria-labelledby="monitors-heading">
                <SectionHeader
                  id="monitors-heading"
                  title="Monitor health"
                  description="Failing and warning workflows first, then the rest of the fleet."
                  action={
                    <div className="flex items-center gap-2">
                      <Select
                        value={focus}
                        onValueChange={(value) =>
                          setFocus(value ?? "attention")
                        }
                      >
                        <SelectTrigger
                          aria-label="Filter monitors"
                          className="w-[140px]"
                          size="sm"
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="attention">Attention</SelectItem>
                          <SelectItem value="all">All</SelectItem>
                          <SelectItem value="healthy">Healthy</SelectItem>
                        </SelectContent>
                      </Select>
                      <Button
                        render={<Link to="/monitors" />}
                        nativeButton={false}
                        variant="ghost"
                      >
                        View all <ArrowRight data-icon="inline-end" />
                      </Button>
                    </div>
                  }
                />

                <div className="mt-4 overflow-hidden rounded-xl border">
                  <div className="hidden grid-cols-[minmax(220px,1.5fr)_100px_110px_100px_90px] gap-4 border-b bg-muted/45 px-4 py-2.5 text-xs font-medium text-muted-foreground md:grid">
                    <span>Monitor</span>
                    <span>State</span>
                    <span>Last run</span>
                    <span>Success · 24h</span>
                    <span className="text-right">Latency</span>
                  </div>
                  {visibleMonitors.length ? (
                    visibleMonitors.slice(0, 8).map((monitor) => (
                      <Link
                        key={monitor.id}
                        to="/monitors/$monitorId/runs"
                        params={{ monitorId: monitor.id }}
                        className="grid gap-3 border-b px-4 py-3.5 transition-colors duration-150 last:border-b-0 hover:bg-muted/35 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset md:grid-cols-[minmax(220px,1.5fr)_100px_110px_100px_90px] md:items-center md:gap-4"
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <StatusDot status={monitor.status} />
                            <p className="truncate text-sm font-medium">
                              {monitor.name}
                            </p>
                          </div>
                          <p className="mt-1 truncate pl-4 text-xs text-muted-foreground">
                            {pluralCount(monitor.stepCount, "step")} ·{" "}
                            {monitor.application}
                          </p>
                        </div>
                        <OperationalStatusBadge
                          status={fromMonitorSummaryStatus(monitor.status)}
                        />
                        <span className="text-sm text-muted-foreground">
                          {monitor.lastRun}
                        </span>
                        <span className="font-mono text-sm text-muted-foreground">
                          {monitor.successRate != null
                            ? formatSuccessRate(monitor.successRate)
                            : "—"}
                        </span>
                        <span className="font-mono text-sm md:text-right">
                          {monitor.latencyMs ? `${monitor.latencyMs} ms` : "—"}
                        </span>
                      </Link>
                    ))
                  ) : (
                    <EmptyBlock
                      title="Nothing in this view"
                      body="Try switching the focus filter, or create another monitor."
                      actionLabel="New monitor"
                      actionTo="/monitors/new"
                    />
                  )}
                </div>
              </section>
            </div>

            <aside className="min-w-0 space-y-8">
              <section aria-labelledby="failures-heading">
                <SectionHeader
                  id="failures-heading"
                  title={failedRuns.length ? "Recent failures" : "Recent runs"}
                  description={
                    failedRuns.length
                      ? "Latest executions that need investigation."
                      : "Newest execution evidence across monitors."
                  }
                />
                <div className="mt-4 divide-y rounded-xl border">
                  {(failedRuns.length ? failedRuns : runs)
                    .slice(0, 5)
                    .map((run) => {
                      const failed = FAILED_RUN_STATUSES.has(run.status)
                      const monitor = monitors.find(
                        (item) => item.id === run.monitorId
                      )
                      return (
                        <Link
                          key={run.id}
                          to="/monitors/$monitorId/runs/$runId"
                          params={{
                            monitorId: run.monitorId,
                            runId: run.id,
                          }}
                          className="flex items-start gap-3 px-4 py-3.5 transition-colors duration-150 hover:bg-muted/35 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset"
                        >
                          <div
                            className={`mt-0.5 grid size-7 shrink-0 place-items-center rounded-full ${
                              failed
                                ? "bg-destructive/10 text-destructive"
                                : "bg-success-soft text-success-foreground"
                            }`}
                          >
                            {failed ? (
                              <CircleAlert className="size-3.5" />
                            ) : (
                              <Check className="size-3.5" />
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium">
                              {monitor?.name ?? run.monitorId}
                            </p>
                            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                              <span>{formatDateTime(run.createdAt)}</span>
                              <span aria-hidden="true">·</span>
                              <span className="font-mono">
                                {run.durationMs} ms
                              </span>
                              {run.failureCategory ? (
                                <>
                                  <span aria-hidden="true">·</span>
                                  <span className="truncate">
                                    {run.failureCategory
                                      .toLowerCase()
                                      .replaceAll("_", " ")}
                                  </span>
                                </>
                              ) : null}
                            </div>
                          </div>
                          <Badge
                            className={
                              failed
                                ? "bg-destructive/10 text-destructive"
                                : "bg-success-soft text-success-foreground"
                            }
                            variant="secondary"
                          >
                            {run.status === "SUCCESS"
                              ? "passed"
                              : run.status.toLowerCase().replaceAll("_", " ")}
                          </Badge>
                        </Link>
                      )
                    })}
                  {!runs.length ? (
                    <EmptyBlock
                      title="No runs yet"
                      body="Enable a monitor or trigger a manual run to see evidence here."
                      actionLabel="Open monitors"
                      actionTo="/monitors"
                    />
                  ) : null}
                </div>
              </section>

              <section aria-labelledby="deployments-heading">
                <SectionHeader
                  id="deployments-heading"
                  title="Deployment gates"
                  description="Latest validation runs and release decisions."
                  action={
                    <Button
                      render={<Link to="/suites" />}
                      nativeButton={false}
                      variant="ghost"
                      size="sm"
                    >
                      Suites <ArrowRight data-icon="inline-end" />
                    </Button>
                  }
                />
                <div className="mt-4 divide-y rounded-xl border">
                  {recentDeployments.length ? (
                    recentDeployments.map((run) => (
                      <Link
                        key={run.id}
                        to="/deployment-runs/$deploymentRunId"
                        params={{ deploymentRunId: run.id }}
                        className="flex items-start gap-3 px-4 py-3.5 transition-colors duration-150 hover:bg-muted/35 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset"
                      >
                        <div className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-muted">
                          <Rocket className="size-3.5 text-muted-foreground" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">
                            {run.suiteSnapshot.name}
                            {run.deployment.version
                              ? ` · ${run.deployment.version}`
                              : ""}
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {formatDateTime(run.deployment.deploymentStart)} ·{" "}
                            {run.phase.replaceAll("_", " ").toLowerCase()}
                          </p>
                        </div>
                        <GateBadge decision={run.gateDecision} />
                      </Link>
                    ))
                  ) : (
                    <EmptyBlock
                      title="No deployment validations"
                      body="Run a suite against a release to gate production with synthetic proof."
                      actionLabel="Open suites"
                      actionTo="/suites"
                    />
                  )}
                </div>
              </section>

              <section aria-labelledby="shortcuts-heading">
                <SectionHeader
                  id="shortcuts-heading"
                  title="Workspace"
                  description="Jump into applications, logs, and configuration."
                />
                <div className="mt-4 grid gap-2">
                  <ShortcutLink
                    to="/applications"
                    icon={AppWindow}
                    label="Applications"
                    detail={
                      applications.length
                        ? `${applications.length} configured`
                        : "Map monitors to services"
                    }
                  />
                  <ShortcutLink
                    to="/elf"
                    icon={FileSearch}
                    label="ELF log search"
                    detail="Query production evidence"
                  />
                  <ShortcutLink
                    to="/suites"
                    icon={Boxes}
                    label="Validation suites"
                    detail="Compose release gates"
                  />
                  <ShortcutLink
                    to="/configuration"
                    icon={Settings2}
                    label="Configuration"
                    detail="Secrets, notifications, proxies"
                  />
                </div>
                {applications.length ? (
                  <ul className="mt-3 divide-y rounded-xl border">
                    {applications.slice(0, 4).map((application) => (
                      <li key={application.id}>
                        <Link
                          to="/applications/$applicationId"
                          params={{ applicationId: application.id }}
                          search={{ section: "overview" }}
                          className="flex items-center justify-between gap-3 px-4 py-3 transition-colors duration-150 hover:bg-muted/35 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset"
                        >
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium">
                              {application.name}
                            </p>
                            <p className="mt-0.5 truncate text-xs text-muted-foreground">
                              {pluralCount(
                                application.services.length,
                                "service"
                              )}{" "}
                              ·{" "}
                              {pluralCount(
                                application.monitorIds.length,
                                "monitor"
                              )}
                            </p>
                          </div>
                          <Badge variant="secondary">
                            {application.active ? "active" : "inactive"}
                          </Badge>
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </section>
            </aside>
          </div>
        )}
      </div>
    </>
  )
}

function derivePosture({
  monitorCount,
  enabledCount,
  healthyCount,
  attentionCount,
  alertCount,
  criticalCount,
}: {
  monitorCount: number
  enabledCount: number
  healthyCount: number
  attentionCount: number
  alertCount: number
  criticalCount: number
}) {
  if (!monitorCount) {
    return {
      headline: "Workspace not configured",
      summary:
        "Create a monitor to start validating API journeys, then assign it to an application.",
      surface: "bg-muted/35",
      title: "text-foreground",
      dot: "bg-muted-foreground",
      pulse: false,
    }
  }
  if (criticalCount || attentionCount) {
    return {
      headline: criticalCount
        ? "Critical attention required"
        : "Attention needed",
      summary: [
        alertCount
          ? `${alertCount} open alert${alertCount === 1 ? "" : "s"}`
          : null,
        attentionCount
          ? `${attentionCount} monitor${attentionCount === 1 ? "" : "s"} failing or warning`
          : null,
        `${healthyCount} of ${enabledCount} enabled monitors healthy`,
      ]
        .filter(Boolean)
        .join(" · "),
      surface: "bg-destructive/8",
      title: "text-destructive",
      dot: "bg-destructive",
      pulse: true,
    }
  }
  if (alertCount) {
    return {
      headline: "Alerts waiting on triage",
      summary: `${alertCount} open alert${alertCount === 1 ? "" : "s"} · ${healthyCount} of ${enabledCount} enabled monitors healthy.`,
      surface: "bg-warning-soft",
      title: "text-warning-foreground",
      dot: "bg-warning",
      pulse: true,
    }
  }
  return {
    headline: "All clear",
    summary: `${healthyCount} of ${enabledCount} enabled monitor${enabledCount === 1 ? "" : "s"} healthy · no open alerts.`,
    surface: "bg-success-soft/60",
    title: "text-success-foreground",
    dot: "bg-success",
    pulse: false,
  }
}

function formatSuccessRate(value: number) {
  const rounded = Math.round(value * 10) / 10
  return Number.isInteger(rounded) ? `${rounded}%` : `${rounded.toFixed(1)}%`
}

function pluralCount(count: number, noun: string) {
  return `${count} ${noun}${count === 1 ? "" : "s"}`
}

function statusRank(status: MonitorSummary["status"]) {
  switch (status) {
    case "failing":
      return 0
    case "warning":
      return 1
    case "unknown":
      return 2
    case "paused":
      return 3
    case "healthy":
      return 4
    default:
      return 5
  }
}

function Stat({
  label,
  value,
  tone = "default",
}: {
  label: string
  value: string
  tone?: "default" | "success" | "danger"
}) {
  const toneClass =
    tone === "success"
      ? "text-success-foreground"
      : tone === "danger"
        ? "text-destructive"
        : "text-foreground"
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd
        className={`mt-0.5 font-heading text-xl font-semibold tabular-nums ${toneClass}`}
      >
        {value}
      </dd>
    </div>
  )
}

function SectionHeader({
  id,
  title,
  description,
  action,
}: {
  id: string
  title: string
  description: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h2 id={id} className="font-heading text-lg font-semibold text-balance">
          {title}
        </h2>
        <p className="mt-0.5 text-sm text-pretty text-muted-foreground">
          {description}
        </p>
      </div>
      {action}
    </div>
  )
}

function EmptyBlock({
  title,
  body,
  actionLabel,
  actionTo,
}: {
  title: string
  body: string
  actionLabel: string
  actionTo: "/monitors" | "/monitors/new" | "/suites" | "/applications"
}) {
  return (
    <div className="px-5 py-8 text-center">
      <p className="text-sm font-medium">{title}</p>
      <p className="mx-auto mt-1 max-w-sm text-xs leading-5 text-pretty text-muted-foreground">
        {body}
      </p>
      <Button
        render={<Link to={actionTo} />}
        nativeButton={false}
        className="mt-4"
        size="sm"
        variant="outline"
      >
        {actionLabel}
      </Button>
    </div>
  )
}

function EmptyWorkspace({ applicationCount }: { applicationCount: number }) {
  return (
    <section className="mt-8 rounded-xl border px-6 py-10 text-center md:px-10">
      <div className="mx-auto grid size-11 place-items-center rounded-xl bg-muted">
        <Workflow aria-hidden="true" className="size-5 text-muted-foreground" />
      </div>
      <h2 className="mt-5 font-heading text-xl font-semibold text-balance">
        Start your ops command center
      </h2>
      <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-pretty text-muted-foreground">
        Rhythm validates complete API journeys. Create a monitor, assign it to
        an application, and this page will surface health, alerts, and
        deployment gates.
      </p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
        <Button
          render={<Link to="/monitors/new" />}
          nativeButton={false}
          size="lg"
        >
          <Plus data-icon="inline-start" /> Create monitor
        </Button>
        <Button
          render={<Link to="/applications" />}
          nativeButton={false}
          variant="outline"
          size="lg"
        >
          <AppWindow data-icon="inline-start" />
          {applicationCount ? "Review applications" : "Configure applications"}
        </Button>
      </div>
      <ul className="mx-auto mt-8 grid max-w-2xl gap-3 text-left sm:grid-cols-3">
        {[
          {
            icon: Activity,
            title: "Synthetic monitors",
            body: "Multi-step journeys with assertions",
          },
          {
            icon: TriangleAlert,
            title: "Alert triage",
            body: "Rhythm and OpenSearch in one inbox",
          },
          {
            icon: Rocket,
            title: "Release gates",
            body: "Validate deployments before promote",
          },
        ].map((item) => (
          <li key={item.title} className="rounded-lg border px-4 py-3">
            <item.icon
              aria-hidden="true"
              className="size-4 text-muted-foreground"
            />
            <p className="mt-2 text-sm font-medium">{item.title}</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              {item.body}
            </p>
          </li>
        ))}
      </ul>
    </section>
  )
}

function ShortcutLink({
  to,
  icon: Icon,
  label,
  detail,
}: {
  to: "/applications" | "/elf" | "/suites" | "/configuration"
  icon: typeof AppWindow
  label: string
  detail: string
}) {
  return (
    <Link
      to={to}
      className="flex items-center gap-3 rounded-xl border px-3.5 py-3 transition-colors duration-150 hover:bg-muted/35 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      <div className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted">
        <Icon aria-hidden="true" className="size-4 text-muted-foreground" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{label}</p>
        <p className="truncate text-xs text-muted-foreground">{detail}</p>
      </div>
      <ArrowRight
        aria-hidden="true"
        className="size-3.5 shrink-0 text-muted-foreground"
      />
    </Link>
  )
}

function GateBadge({
  decision,
}: {
  decision: DeploymentValidationRunContract["gateDecision"]
}) {
  const styles =
    decision === "ALLOW"
      ? "bg-success-soft text-success-foreground"
      : decision === "ALLOW_WITH_WARNINGS"
        ? "bg-warning-soft text-warning-foreground"
        : decision === "BLOCK"
          ? "bg-destructive/10 text-destructive"
          : "bg-muted text-muted-foreground"
  return (
    <Badge className={styles} variant="secondary">
      {decision.toLowerCase().replaceAll("_", " ")}
    </Badge>
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
