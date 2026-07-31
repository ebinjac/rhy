import { useEffect, useMemo, useState } from "react"
import { createFileRoute, Link } from "@tanstack/react-router"
import { Button } from "@workspace/ui/components/button"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@workspace/ui/components/tabs"
import {
  AlertTriangle,
  ArrowLeft,
  Ban,
  CheckCircle2,
  CircleAlert,
  Clock3,
  Code2,
  Eye,
  Gauge,
  LoaderCircle,
  MonitorCheck,
  Network,
  RefreshCw,
  ShieldCheck,
  Timer,
  Waypoints,
} from "lucide-react"
import { toast } from "@workspace/ui/components/sonner"

import { PageContainer } from "@/components/page-container"
import {
  BrowserRunBadge,
  formatDuration,
} from "@/features/ui-monitoring/browser-monitor-status"
import {
  cancelBrowserRun,
  getBrowserRun,
} from "@/lib/api-client/browser-monitoring"
import type {
  BrowserRun,
  BrowserStepRun,
} from "@/lib/api-client/browser-monitoring"
import { formatDateTime } from "@/lib/format-date"

const activeStatuses = new Set(["QUEUED", "STARTING", "RUNNING", "ANALYZING"])

export const Route = createFileRoute("/ui-monitoring/$monitorId/runs/$runId")({
  loader: ({ params }) => getBrowserRun({ data: { runId: params.runId } }),
  component: BrowserRunDiagnostics,
})

function BrowserRunDiagnostics() {
  const initial = Route.useLoaderData()
  const { monitorId, runId } = Route.useParams()
  const [run, setRun] = useState(initial)
  const [selectedStepID, setSelectedStepID] = useState(
    () => initial.failedStepId || initial.steps[0]?.stepDefinitionId || ""
  )
  const [cancelling, setCancelling] = useState(false)
  const [refreshFailed, setRefreshFailed] = useState(false)
  const active = activeStatuses.has(run.status)

  useEffect(() => {
    setRun(initial)
    setSelectedStepID(
      initial.failedStepId || initial.steps[0]?.stepDefinitionId || ""
    )
    setRefreshFailed(false)
  }, [initial, runId])

  useEffect(() => {
    if (!active) return
    let disposed = false
    let loading = false
    const refresh = async () => {
      if (loading) return
      if (document.visibilityState !== "visible") return
      loading = true
      try {
        const next = await getBrowserRun({ data: { runId } })
        if (!disposed) {
          setRun(next)
          setRefreshFailed(false)
          setSelectedStepID((current) =>
            current || next.steps[0]?.stepDefinitionId || ""
          )
        }
      } catch {
        if (!disposed) setRefreshFailed(true)
      } finally {
        loading = false
      }
    }
    const timer = window.setInterval(() => void refresh(), 1000)
    return () => {
      disposed = true
      window.clearInterval(timer)
    }
  }, [active, runId])

  const selectedStep =
    run.steps.find((step) => step.stepDefinitionId === selectedStepID) ??
    run.steps[0]
  const screenshots = run.artifacts.filter(
    (artifact) => artifact.contentType === "image/png"
  )
  const metrics = normalizeMetrics(run)
  const slowestStep = useMemo(
    () =>
      [...run.steps].sort(
        (left, right) => right.durationMs - left.durationMs
      )[0],
    [run.steps]
  )

  async function cancel() {
    if (!window.confirm("Cancel this active browser execution?")) return
    setCancelling(true)
    try {
      setRun(await cancelBrowserRun({ data: { runId } }))
      toast.success("Cancellation requested")
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Run could not be cancelled."
      )
    } finally {
      setCancelling(false)
    }
  }

  return (
    <PageContainer as="main" padding="compact">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button
          nativeButton={false}
          render={
            <Link params={{ monitorId }} to="/ui-monitoring/$monitorId/runs" />
          }
          variant="ghost"
        >
          <ArrowLeft />
          Run history
        </Button>
        <div className="flex items-center gap-2">
          {refreshFailed ? (
            <span className="inline-flex items-center gap-1 text-xs text-warning-foreground">
              <RefreshCw className="size-3.5" />
              Refresh failed · showing last evidence
            </span>
          ) : active ? (
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <LoaderCircle className="size-3.5 animate-spin motion-reduce:animate-none" />
              Live execution
            </span>
          ) : null}
          {active ? (
            <Button
              disabled={cancelling}
              onClick={() => void cancel()}
              variant="destructive"
            >
              <Ban />
              {cancelling ? "Cancelling…" : "Cancel run"}
            </Button>
          ) : null}
        </div>
      </div>

      <header className="mt-4">
        <div className="flex flex-wrap items-center gap-2">
          <BrowserRunBadge status={run.status} />
          <span className="font-mono text-xs text-muted-foreground">
            {run.id}
          </span>
        </div>
        <h1 className="mt-3 text-2xl font-semibold">Browser run diagnostics</h1>
        <p className="mt-1 max-w-3xl text-sm/6 text-muted-foreground">
          Journey actions, browser performance, visual evidence, console and
          network failures, and the exact checkpoint that determined this
          outcome.
        </p>
      </header>

      {run.failureReason ? (
        <section className="mt-5 rounded-xl border border-destructive/30 bg-destructive/5 p-4">
          <div className="flex items-start gap-3">
            <CircleAlert className="mt-0.5 size-5 shrink-0 text-destructive" />
            <div>
              <p className="font-semibold text-destructive">
                {friendlyFailure(run.failureCategory)}
              </p>
              <p className="mt-1 text-sm/6">{run.failureReason}</p>
              <p className="mt-2 text-xs text-muted-foreground">
                {failureGuidance(run.failureCategory)}
              </p>
            </div>
          </div>
        </section>
      ) : null}

      <section
        aria-label="Execution summary"
        className="mt-6 grid divide-y rounded-xl border sm:grid-cols-2 sm:divide-x sm:divide-y-0 xl:grid-cols-5"
      >
        <Summary label="Journey" value={formatDuration(run.durationMs)} />
        <Summary label="Queue delay" value={formatDuration(run.queueDelayMs)} />
        <Summary
          label="LCP"
          value={formatDuration(metrics.lcp)}
          hint="Controlled synthetic Largest Contentful Paint."
        />
        <Summary
          label="TBT"
          value={formatDuration(metrics.tbt)}
          hint="Lab proxy for responsiveness; not field INP."
        />
        <Summary
          label="Slowest action"
          value={
            slowestStep
              ? `${slowestStep.name} · ${formatDuration(slowestStep.durationMs)}`
              : "Not recorded"
          }
        />
      </section>

      {screenshots.length ? (
        <section className="mt-7" aria-labelledby="filmstrip-title">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold" id="filmstrip-title">
                Screenshot filmstrip
              </h2>
              <p className="text-sm text-muted-foreground">
                Masked evidence retained according to the monitor artifact
                policy.
              </p>
            </div>
            <span className="text-xs text-muted-foreground">
              {screenshots.length} frame{screenshots.length === 1 ? "" : "s"}
            </span>
          </div>
          <div className="mt-3 flex snap-x gap-3 overflow-x-auto pb-2">
            {screenshots.map((artifact, index) => (
              <a
                className="group w-64 shrink-0 snap-start overflow-hidden rounded-xl border bg-muted/30 outline-none focus-visible:ring-2 focus-visible:ring-ring"
                href={`/api/browser-artifacts/${artifact.id}`}
                key={artifact.id}
                rel="noreferrer"
                target="_blank"
              >
                <img
                  alt={`Masked browser evidence frame ${index + 1}`}
                  className="aspect-video w-full object-cover transition-transform group-hover:scale-[1.01] motion-reduce:transition-none"
                  loading="lazy"
                  src={`/api/browser-artifacts/${artifact.id}`}
                />
                <div className="flex items-center justify-between gap-2 px-3 py-2 text-xs">
                  <span className="truncate">
                    {readString(artifact.metadata?.checkpointId) ||
                      artifact.kind.toLowerCase().replaceAll("_", " ")}
                  </span>
                  <span className="shrink-0 text-muted-foreground">
                    {formatBytes(artifact.byteSize)}
                  </span>
                </div>
              </a>
            ))}
          </div>
        </section>
      ) : null}

      <div className="mt-7 grid gap-5 xl:grid-cols-[18rem_minmax(0,1fr)]">
        <aside aria-labelledby="journey-rail-title">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-semibold" id="journey-rail-title">
              Journey waterfall
            </h2>
            <span className="text-xs text-muted-foreground">
              {run.steps.length} steps
            </span>
          </div>
          {run.steps.length ? (
            <ol className="mt-3 space-y-1">
              {run.steps.map((step, index) => {
                const share = run.durationMs
                  ? Math.max(2, (step.durationMs / run.durationMs) * 100)
                  : 2
                return (
                  <li key={step.id}>
                    <button
                      aria-current={
                        step.stepDefinitionId === selectedStep?.stepDefinitionId
                          ? "step"
                          : undefined
                      }
                      className={`w-full rounded-lg px-3 py-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                        step.stepDefinitionId === selectedStep?.stepDefinitionId
                          ? "bg-primary/10"
                          : "hover:bg-muted"
                      }`}
                      onClick={() => setSelectedStepID(step.stepDefinitionId)}
                      type="button"
                    >
                      <div className="flex items-center gap-2">
                        <span className="flex size-6 items-center justify-center rounded-md border text-[11px]">
                          {index + 1}
                        </span>
                        {step.status === "PASSED" ? (
                          <CheckCircle2 className="size-3.5 text-success" />
                        ) : (
                          <CircleAlert className="size-3.5 text-destructive" />
                        )}
                        <span className="min-w-0 flex-1 truncate text-sm font-medium">
                          {step.name}
                        </span>
                        <span className="text-[11px] text-muted-foreground tabular-nums">
                          {formatDuration(step.durationMs)}
                        </span>
                      </div>
                      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                        <div
                          className={`h-full rounded-full ${
                            step.status === "PASSED"
                              ? "bg-primary/70"
                              : "bg-destructive"
                          }`}
                          style={{ width: `${Math.min(100, share)}%` }}
                        />
                      </div>
                    </button>
                  </li>
                )
              })}
            </ol>
          ) : (
            <p className="mt-3 rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
              Step evidence is not recorded yet.
            </p>
          )}
        </aside>

        <section className="min-w-0">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-medium text-primary">
                Selected action
              </p>
              <h2 className="mt-1 text-lg font-semibold">
                {selectedStep?.name ?? "Run evidence"}
              </h2>
              <p className="text-xs text-muted-foreground">
                {selectedStep
                  ? `${selectedStep.type.toLowerCase().replaceAll("_", " ")} · ${formatDuration(selectedStep.durationMs)}`
                  : "No action selected"}
              </p>
            </div>
            {selectedStep?.status ? (
              <span
                className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                  selectedStep.status === "PASSED"
                    ? "bg-success-soft text-success-foreground"
                    : "bg-destructive/10 text-destructive"
                }`}
              >
                {selectedStep.status.toLowerCase()}
              </span>
            ) : null}
          </div>
          <Tabs className="mt-4" defaultValue="overview">
            <TabsList className="h-auto w-full justify-start overflow-x-auto">
              <TabsTrigger value="overview">
                <Waypoints /> Overview
              </TabsTrigger>
              <TabsTrigger value="performance">
                <Gauge /> Performance
              </TabsTrigger>
              <TabsTrigger value="checks">
                <ShieldCheck /> Checks
              </TabsTrigger>
              <TabsTrigger value="network">
                <Network /> Network
              </TabsTrigger>
              <TabsTrigger value="events">
                <Clock3 /> Events
              </TabsTrigger>
            </TabsList>
            <TabsContent value="overview">
              <StepOverview step={selectedStep} />
            </TabsContent>
            <TabsContent value="performance">
              <PerformanceEvidence metrics={metrics} run={run} />
            </TabsContent>
            <TabsContent value="checks">
              <CheckEvidence step={selectedStep} />
            </TabsContent>
            <TabsContent value="network">
              <NetworkEvidence run={run} />
            </TabsContent>
            <TabsContent value="events">
              <EventTimeline run={run} />
            </TabsContent>
          </Tabs>
        </section>
      </div>
    </PageContainer>
  )
}

function StepOverview({ step }: { step?: BrowserStepRun }) {
  if (!step)
    return <MissingEvidence text="Action evidence has not been recorded yet." />
  const locatorEntries = Object.entries(step.locatorEvidence ?? {})
  return (
    <div className="mt-4 grid gap-4 md:grid-cols-2">
      <EvidenceCard icon={Timer} title="Timing">
        <dl className="space-y-2 text-sm">
          <KeyValue label="Duration" value={formatDuration(step.durationMs)} />
          <KeyValue
            label="Started"
            value={
              step.startedAt ? formatDateTime(step.startedAt) : "Not recorded"
            }
          />
          <KeyValue
            label="Ended"
            value={step.endedAt ? formatDateTime(step.endedAt) : "Not recorded"}
          />
        </dl>
      </EvidenceCard>
      <EvidenceCard icon={MonitorCheck} title="Locator evidence">
        {locatorEntries.length ? (
          <dl className="space-y-2 text-sm">
            {locatorEntries.map(([key, value]) => (
              <KeyValue
                key={key}
                label={key.replaceAll(/([A-Z])/g, " $1")}
                value={safeDisplay(value)}
              />
            ))}
          </dl>
        ) : (
          <p className="text-sm text-muted-foreground">
            This action did not use a locator or locator evidence was
            unavailable.
          </p>
        )}
      </EvidenceCard>
      {step.failureReason ? (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 md:col-span-2">
          <div className="flex gap-3">
            <CircleAlert className="mt-0.5 size-4 text-destructive" />
            <div>
              <p className="text-sm font-medium text-destructive">
                {friendlyFailure(step.failureCategory)}
              </p>
              <p className="mt-1 text-sm">{step.failureReason}</p>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function PerformanceEvidence({
  metrics,
  run,
}: {
  metrics: ReturnType<typeof normalizeMetrics>
  run: BrowserRun
}) {
  const values = [
    ["DNS", metrics.dns, "Name resolution for the document navigation."],
    ["TCP", metrics.tcp, "Connection establishment."],
    ["TLS", metrics.tls, "Secure-session negotiation."],
    ["TTFB", metrics.ttfb, "Target processing plus network latency."],
    ["DOMContentLoaded", metrics.domContentLoaded, "DOM parsing milestone."],
    ["Load event", metrics.load, "Document load event."],
    ["FCP", metrics.fcp, "First Contentful Paint in this lab run."],
    ["LCP", metrics.lcp, "Largest Contentful Paint in this lab run."],
    ["TBT", metrics.tbt, "Total Blocking Time, a lab responsiveness proxy."],
  ] as const
  return (
    <div className="mt-4">
      <div className="rounded-lg border border-primary/20 bg-primary/[0.035] px-4 py-3 text-sm">
        <p className="font-medium">Controlled synthetic performance</p>
        <p className="mt-1 text-xs/5 text-muted-foreground">
          These are repeatable lab measurements from the selected browser and
          agent profile. They are not real-user field data, and TBT is not field
          INP.
        </p>
      </div>
      <div className="mt-4 grid gap-px overflow-hidden rounded-xl border bg-border sm:grid-cols-2 xl:grid-cols-3">
        {values.map(([label, value, help]) => (
          <div className="bg-background p-4" key={label}>
            <p className="text-xs text-muted-foreground" title={help}>
              {label}
            </p>
            <p className="mt-1 text-xl font-semibold tabular-nums">
              {formatDuration(value)}
            </p>
          </div>
        ))}
      </div>
      <div className="mt-4 grid gap-4 md:grid-cols-3">
        <EvidenceCard icon={ActivityIcon} title="Layout stability">
          <p className="text-2xl font-semibold tabular-nums">
            {metrics.cls === null ? "Not recorded" : metrics.cls.toFixed(3)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Cumulative Layout Shift. Guidance is 0.1 or lower.
          </p>
        </EvidenceCard>
        <EvidenceCard icon={Network} title="Resources">
          <p className="text-2xl font-semibold tabular-nums">
            {readNumber(run.metrics.resourceCount) ?? "Not recorded"}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {formatBytes(
              readNumber(run.metrics.transferredBytes) ??
                readNumber(run.networkSummary.transferredBytes) ??
                0
            )}{" "}
            transferred
          </p>
        </EvidenceCard>
        <EvidenceCard icon={Code2} title="Browser errors">
          <p className="text-2xl font-semibold tabular-nums">
            {
              run.consoleEvents.filter((event) =>
                ["error", "pageerror"].includes(readString(event.type))
              ).length
            }
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Masked console and page exceptions.
          </p>
        </EvidenceCard>
      </div>
    </div>
  )
}

function CheckEvidence({ step }: { step?: BrowserStepRun }) {
  if (!step?.checkResults?.length)
    return (
      <MissingEvidence text="No checkpoint result was recorded for this action." />
    )
  return (
    <div className="mt-4 divide-y overflow-hidden rounded-xl border">
      {step.checkResults.map((check) => (
        <div className="p-4" key={check.id}>
          <div className="flex items-start gap-3">
            {check.passed ? (
              <CheckCircle2 className="mt-0.5 size-4 text-success" />
            ) : (
              <CircleAlert className="mt-0.5 size-4 text-destructive" />
            )}
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium">{check.name}</p>
                <span className="text-xs text-muted-foreground">
                  {check.gateMode.toLowerCase().replaceAll("_", " ")}
                </span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {check.kind.toLowerCase().replaceAll("_", " ")}
              </p>
              <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
                <KeyValue
                  label="Expected"
                  value={safeDisplay(check.expected)}
                />
                <KeyValue
                  label="Observed"
                  value={safeDisplay(check.observed)}
                />
              </dl>
              {check.error ? (
                <p className="mt-3 rounded-lg bg-destructive/5 p-3 text-sm text-destructive">
                  {check.error}
                </p>
              ) : null}
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

function NetworkEvidence({ run }: { run: BrowserRun }) {
  const failed = Array.isArray(run.networkSummary.failedRequests)
    ? run.networkSummary.failedRequests
    : []
  return (
    <div className="mt-4 grid gap-4 md:grid-cols-2">
      <EvidenceCard icon={Network} title="Resource summary">
        <dl className="space-y-2 text-sm">
          {Object.entries(run.networkSummary)
            .filter(([key]) => key !== "failedRequests")
            .map(([key, value]) => (
              <KeyValue
                key={key}
                label={key.replaceAll(/([A-Z])/g, " $1")}
                value={safeDisplay(value)}
              />
            ))}
        </dl>
      </EvidenceCard>
      <EvidenceCard icon={AlertTriangle} title="Failed requests">
        {failed.length ? (
          <ul className="space-y-2 text-sm">
            {failed.slice(0, 20).map((value, index) => (
              <li className="rounded-lg bg-muted/40 p-2 break-all" key={index}>
                {safeDisplay(value)}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">
            No failed resource request was recorded.
          </p>
        )}
      </EvidenceCard>
      <EvidenceCard icon={Code2} title="Console and page errors">
        {run.consoleEvents.length ? (
          <ul className="space-y-2 text-xs">
            {run.consoleEvents.slice(0, 50).map((event, index) => (
              <li className="rounded-lg border p-2" key={index}>
                <span className="font-medium">
                  {readString(event.type) || "console"}
                </span>
                <span className="mt-1 block break-all text-muted-foreground">
                  {readString(event.message) || safeDisplay(event)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">
            No console or page error was captured.
          </p>
        )}
      </EvidenceCard>
      <EvidenceCard icon={Eye} title="Graph and visual evidence">
        <dl className="space-y-2 text-sm">
          <KeyValue
            label="Graph checks"
            value={String(run.graphEvidence.length)}
          />
          <KeyValue
            label="Visual comparisons"
            value={String(run.visualEvidence.length)}
          />
          <KeyValue
            label="Stored artifacts"
            value={String(run.artifacts.length)}
          />
        </dl>
      </EvidenceCard>
    </div>
  )
}

function EventTimeline({ run }: { run: BrowserRun }) {
  if (!run.events.length)
    return (
      <MissingEvidence text="Structured events were not recorded for this execution." />
    )
  const start = new Date(run.events[0].occurredAt).getTime()
  return (
    <ol className="mt-4 space-y-0" aria-label="Structured execution events">
      {run.events.map((event, index) => {
        const relative = Math.max(
          0,
          new Date(event.occurredAt).getTime() - start
        )
        return (
          <li
            className="relative grid grid-cols-[5rem_1rem_1fr] gap-3 pb-5"
            key={`${event.occurredAt}-${index}`}
          >
            <time className="pt-0.5 text-right font-mono text-[11px] text-muted-foreground">
              +{formatDuration(relative)}
            </time>
            <span className="relative flex justify-center">
              <span className="mt-1.5 size-2 rounded-full bg-primary" />
              {index < run.events.length - 1 ? (
                <span className="absolute top-4 bottom-[-1.25rem] w-px bg-border" />
              ) : null}
            </span>
            <div>
              <p className="text-sm font-medium">
                {event.type.toLowerCase().replaceAll("_", " ")}
              </p>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {event.message}
              </p>
              <time
                className="mt-1 block text-[11px] text-muted-foreground"
                dateTime={event.occurredAt}
              >
                {formatDateTime(event.occurredAt)}
              </time>
            </div>
          </li>
        )
      })}
    </ol>
  )
}

function EvidenceCard({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof Timer
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="rounded-xl border p-4">
      <div className="flex items-center gap-2">
        <Icon className="size-4 text-primary" />
        <p className="font-medium">{title}</p>
      </div>
      <div className="mt-3">{children}</div>
    </div>
  )
}

function Summary({
  label,
  value,
  hint,
}: {
  label: string
  value: string
  hint?: string
}) {
  return (
    <div className="min-w-0 p-4" title={hint}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-2 truncate text-lg font-semibold tabular-nums">
        {value}
      </p>
    </div>
  )
}

function KeyValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <dt className="text-muted-foreground capitalize">{label}</dt>
      <dd className="max-w-[65%] text-right font-medium break-words">
        {value}
      </dd>
    </div>
  )
}

function MissingEvidence({ text }: { text: string }) {
  return (
    <div className="mt-4 flex min-h-40 items-center justify-center rounded-xl border border-dashed px-6 text-center text-sm text-muted-foreground">
      {text}
    </div>
  )
}

function normalizeMetrics(run: BrowserRun) {
  const navigation = asRecord(run.metrics.navigation)
  const paints = asRecord(run.metrics.paints)
  const vitals = asRecord(run.metrics.vitals)
  return {
    dns: readNumber(run.metrics.dnsMs) ?? readNumber(navigation.dnsMs),
    tcp: readNumber(run.metrics.tcpMs) ?? readNumber(navigation.tcpMs),
    tls: readNumber(run.metrics.tlsMs) ?? readNumber(navigation.tlsMs),
    ttfb: readNumber(run.metrics.ttfbMs) ?? readNumber(navigation.ttfbMs),
    domContentLoaded:
      readNumber(run.metrics.domContentLoadedMs) ??
      readNumber(navigation.domContentLoadedMs),
    load: readNumber(run.metrics.loadMs) ?? readNumber(navigation.loadMs),
    fcp: readNumber(run.metrics.fcpMs) ?? readNumber(paints.fcpMs),
    lcp: readNumber(run.metrics.lcpMs) ?? readNumber(vitals.lcpMs),
    cls: readNumber(run.metrics.cls) ?? readNumber(vitals.cls),
    tbt: readNumber(run.metrics.tbtMs) ?? readNumber(vitals.tbtMs),
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function readString(value: unknown): string {
  return typeof value === "string" ? value : ""
}

function safeDisplay(value: unknown): string {
  if (value === undefined || value === null || value === "")
    return "Not recorded"
  if (typeof value === "string") return value
  if (typeof value === "number" || typeof value === "boolean")
    return String(value)
  try {
    return JSON.stringify(value)
  } catch {
    return "Recorded"
  }
}

function friendlyFailure(category?: string) {
  return category
    ? category.toLowerCase().replaceAll("_", " ")
    : "Browser journey failed"
}

function failureGuidance(category?: string) {
  switch (category) {
    case "SELECTOR_NOT_FOUND":
      return "Confirm the page reached the expected state, then prefer an accessible role, label, or stable test ID."
    case "SELECTOR_AMBIGUOUS":
      return "Narrow the locator with an accessible name, containing region, or stable test ID."
    case "AUTHENTICATION_FAILED":
    case "SESSION_EXPIRED":
      return "Validate or renew the application-scoped browser session before rerunning the journey."
    case "PERFORMANCE_BUDGET_EXCEEDED":
      return "Inspect the page milestone and slowest resources, then compare against compatible historical runs."
    case "VISUAL_REGRESSION":
      return "Review expected, current, and diff evidence. Promote a new baseline only when the change is intentional."
    default:
      return "Open the failed action below and review its locator, check evidence, browser errors, and network activity."
  }
}

function formatBytes(value: number) {
  if (!value) return "Not recorded"
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}

const ActivityIcon = Gauge
