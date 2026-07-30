import { useEffect, useState } from "react"
import { createFileRoute, Link } from "@tanstack/react-router"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@workspace/ui/components/chart"
import type { ChartConfig } from "@workspace/ui/components/chart"
import {
  ArrowLeft,
  ArrowRight,
  Ban,
  Check,
  ChevronDown,
  CircleAlert,
  Download,
  FileJson,
  FileText,
  Info,
  LoaderCircle,
  ShieldCheck,
} from "lucide-react"
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  XAxis,
  YAxis,
} from "recharts"

import { PageContainer } from "@/components/page-container"

import type {
  DeploymentDistributionContract,
  DeploymentValidationRunContract,
} from "@/lib/api-client/contracts"
import {
  cancelDeploymentValidation,
  downloadDeploymentReport,
  getDeploymentValidation,
} from "@/lib/api-client/suites"

const comparisonChartConfig = {
  before: {
    label: "Before",
    color: "color-mix(in oklch, var(--muted-foreground) 45%, transparent)",
  },
  after: { label: "After", color: "var(--primary)" },
} satisfies ChartConfig

export const Route = createFileRoute("/deployment-runs/$deploymentRunId")({
  loader: ({ params }) =>
    getDeploymentValidation({ data: { runId: params.deploymentRunId } }),
  component: DeploymentRunPage,
})

const terminal = new Set(["COMPLETED", "FAILED", "CANCELLED"])

function DeploymentRunPage() {
  const initial = Route.useLoaderData()
  const [run, setRun] = useState(initial)
  const [pending, setPending] = useState("")
  const [message, setMessage] = useState("")

  useEffect(() => {
    if (terminal.has(run.status)) return
    const timer = window.setInterval(() => {
      void getDeploymentValidation({ data: { runId: run.id } })
        .then(setRun)
        .catch(() => setMessage("Live progress is temporarily unavailable."))
    }, 1000)
    return () => window.clearInterval(timer)
  }, [run.id, run.status])

  async function cancel() {
    if (
      !window.confirm(
        "Cancel this deployment validation? Completed evidence will be retained."
      )
    )
      return
    setPending("cancel")
    const result = await cancelDeploymentValidation({ data: { runId: run.id } })
    setPending("")
    if (!result.ok)
      setMessage("The validation could not be cancelled on its current worker.")
  }

  async function download(format: "pdf" | "json") {
    setPending(format)
    try {
      const result = await downloadDeploymentReport({
        data: { runId: run.id, format },
      })
      const binary = atob(result.content)
      const bytes = Uint8Array.from(binary, (character) =>
        character.charCodeAt(0)
      )
      const url = URL.createObjectURL(
        new Blob([bytes], { type: result.contentType })
      )
      const anchor = document.createElement("a")
      anchor.href = url
      anchor.download = result.filename
      anchor.click()
      URL.revokeObjectURL(url)
    } catch {
      setMessage(`Unable to download the ${format.toUpperCase()} report.`)
    } finally {
      setPending("")
    }
  }

  const report = run.report
  const complete = run.status === "COMPLETED"
  const percent = run.progress.total
    ? Math.round((run.progress.completed / run.progress.total) * 100)
    : 0
  return (
    <PageContainer as="main">
      <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
        <div>
          <Link
            to="/suites"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-4" /> Validation suites
          </Link>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <h1 className="font-heading text-2xl font-semibold">
              {run.suiteSnapshot.name}
            </h1>
            <DecisionBadge decision={run.gateDecision} />
            <Badge variant="secondary">
              {run.phase.toLowerCase().replaceAll("_", " ")}
            </Badge>
          </div>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            {run.deployment.version || "Unversioned deployment"}
            {run.deployment.commit ? ` · ${run.deployment.commit}` : ""} ·
            deployed {new Date(run.deployment.deploymentStart).toLocaleString()}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {!terminal.has(run.status) ? (
            <Button
              variant="outline"
              onClick={cancel}
              disabled={pending === "cancel"}
            >
              {pending === "cancel" ? (
                <LoaderCircle className="animate-spin" />
              ) : (
                <Ban />
              )}{" "}
              Cancel
            </Button>
          ) : null}
          <Button
            variant="outline"
            disabled={!complete || !!pending}
            onClick={() => download("json")}
          >
            {pending === "json" ? (
              <LoaderCircle className="animate-spin" />
            ) : (
              <FileJson />
            )}{" "}
            JSON
          </Button>
          <Button
            disabled={!complete || !!pending}
            onClick={() => download("pdf")}
          >
            {pending === "pdf" ? (
              <LoaderCircle className="animate-spin" />
            ) : (
              <Download />
            )}{" "}
            PDF report
          </Button>
        </div>
      </div>

      {message ? (
        <p
          className="mt-4 inline-flex items-center gap-2 text-sm text-destructive"
          role="alert"
        >
          <CircleAlert className="size-4" />
          {message}
        </p>
      ) : null}
      {!terminal.has(run.status) ? (
        <Progress run={run} percent={percent} />
      ) : null}

      {report.recommendation ? (
        <section
          className={`mt-6 border-y py-5 ${run.gateDecision === "BLOCK" ? "bg-destructive/5" : run.gateDecision === "ALLOW_WITH_WARNINGS" ? "bg-warning-soft/40" : "bg-success-soft/35"}`}
        >
          <div className="flex items-start gap-3 px-3 sm:px-5">
            {run.gateDecision === "BLOCK" ? (
              <CircleAlert className="mt-0.5 size-5 text-destructive" />
            ) : (
              <ShieldCheck className="mt-0.5 size-5 text-success-foreground" />
            )}
            <div>
              <h2 className="font-medium">Release recommendation</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {report.recommendation}
              </p>
            </div>
          </div>
        </section>
      ) : null}

      <section className="mt-7" aria-labelledby="overview-heading">
        <div className="flex items-center gap-2">
          <h2
            id="overview-heading"
            className="font-heading text-lg font-semibold"
          >
            Before and after
          </h2>
          <MetricInfo text="Latency uses API response time only. Preparation, scripts, extraction, assertions, queue delay, and post-processing do not affect the performance gate." />
        </div>
        <div className="mt-4 overflow-hidden border-y">
          <div className="grid grid-cols-2 divide-x sm:grid-cols-3 lg:grid-cols-10">
            <Metric
              label="Baseline window"
              value={run.configuration.baselineWindow}
              help="The historical period ending exactly at deployment start."
            />
            <Metric
              label="Post samples"
              value={String(run.configuration.sampleCount)}
              help="Controlled executions requested for each monitor."
            />
            <Metric
              label="Guardrail"
              value="25% + 100 ms"
              help="Both thresholds must be crossed by post p95 for a regression."
            />
            <Metric
              label="Minimum history"
              value={String(run.configuration.minimumSamples)}
              help="Fewer successful measurements are reported as insufficient history."
            />
            <Metric
              label="Monitors"
              value={String(report.monitors?.length ?? 0)}
            />
            <Metric
              label="ELF checks"
              value={String(report.elfResults?.length ?? 0)}
            />
            <Metric
              label="OS alerts"
              value={String(report.alertResults?.length ?? 0)}
            />
            <Metric
              label="Dynatrace"
              value={String(report.dynatraceResults?.length ?? 0)}
            />
            <Metric
              label="Completed evidence"
              value={`${run.progress.completed}/${run.progress.total}`}
            />
            <Metric
              label="Decision"
              value={run.gateDecision.replaceAll("_", " ")}
            />
          </div>
        </div>
      </section>

      <section className="mt-8" aria-labelledby="monitor-comparisons-heading">
        <h2
          id="monitor-comparisons-heading"
          className="font-heading text-lg font-semibold"
        >
          Monitor performance
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Aggregate workflow latency and every measured HTTP step.
        </p>
        <div className="mt-4 divide-y border-y">
          {(report.monitors ?? []).map((monitor) => (
            <MonitorResult key={monitor.monitorId} monitor={monitor} />
          ))}
          {!report.monitors?.length ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              Monitor comparison evidence will appear after baseline capture.
            </p>
          ) : null}
        </div>
      </section>

      <section className="mt-8" aria-labelledby="dynatrace-heading">
        <h2
          id="dynatrace-heading"
          className="font-heading text-lg font-semibold"
        >
          Dynatrace infrastructure comparison
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          CPU and memory evidence captured before deployment and after the
          configured stabilization window. Missing measurements are never
          treated as zero.
        </p>
        <div className="mt-4 divide-y border-y">
          {(report.dynatraceResults ?? []).map((result, index) => (
            <div className="py-5" key={`${result.checkId}-${result.serviceId ?? index}`}>
              <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
                <div>
                  <p className="font-medium">{result.name}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {result.gateMode.toLowerCase()} ·{" "}
                    {result.baselineResourceCount} baseline resources ·{" "}
                    {result.postResourceCount} post resources
                    {result.missingResources
                      ? ` · ${result.missingResources} missing`
                      : ""}
                    {result.addedResources
                      ? ` · ${result.addedResources} added`
                      : ""}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <StatusBadge status={result.status} />
                  <Link
                    className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                    params={{ applicationId: result.applicationId }}
                    search={{ section: "dynatrace" }}
                    to="/applications/$applicationId"
                  >
                    Dynatrace <ArrowRight className="size-3" />
                  </Link>
                </div>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {(["CPU", "MEMORY"] as const).flatMap((metric) => {
                  const before = result.baselineSummary[metric]
                  const after = result.postSummary[metric]
                  if (!before && !after) return []
                  return [
                    <div className="border-l pl-3" key={`${metric}-p95`}>
                      <p className="text-xs text-muted-foreground">
                        {metric} p95
                      </p>
                      <p className="mt-1 font-medium">
                        {before?.p95 == null
                          ? "Not recorded"
                          : before.p95.toFixed(2)}
                        {" → "}
                        {after?.p95 == null
                          ? "Not recorded"
                          : after.p95.toFixed(2)}
                      </p>
                    </div>,
                    <div className="border-l pl-3" key={`${metric}-average`}>
                      <p className="text-xs text-muted-foreground">
                        {metric} average
                      </p>
                      <p className="mt-1 font-medium">
                        {before?.average == null
                          ? "Not recorded"
                          : before.average.toFixed(2)}
                        {" → "}
                        {after?.average == null
                          ? "Not recorded"
                          : after.average.toFixed(2)}
                      </p>
                    </div>,
                  ]
                })}
              </div>
              {result.ruleResults.length ? (
                <div className="mt-4 space-y-2">
                  {result.ruleResults.map((rule) => (
                    <div
                      className="flex items-start justify-between gap-4 text-sm"
                      key={rule.ruleId}
                    >
                      <span>
                        {rule.ruleName}
                        <span className="ml-2 text-xs text-muted-foreground">
                          {rule.reason}
                        </span>
                      </span>
                      <Badge variant="outline">{rule.status.toLowerCase()}</Badge>
                    </div>
                  ))}
                </div>
              ) : null}
              {result.failureReason ? (
                <p className="mt-3 text-sm text-destructive">
                  {result.failureReason}
                </p>
              ) : null}
            </div>
          ))}
          {!report.dynatraceResults?.length ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Dynatrace checks have not run yet or this suite has none.
            </p>
          ) : null}
        </div>
      </section>

      <section className="mt-8" aria-labelledby="elf-heading">
        <h2 id="elf-heading" className="font-heading text-lg font-semibold">
          ELF deployment log checks
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Executed after monitor sampling, from deployment start through check
          time.
        </p>
        <div className="mt-4 divide-y border-y">
          {(report.elfResults ?? []).map((result) => (
            <div
              className="flex flex-col justify-between gap-2 py-4 sm:flex-row sm:items-center"
              key={result.checkId}
            >
              <div>
                <p className="font-medium">{result.name || result.queryId}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {result.gateMode} · {result.hitCount ?? 0} hits
                  {result.failureReason ? ` · ${result.failureReason}` : ""}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <StatusBadge status={result.status} />
                {result.queryId ? (
                  <Link
                    to="/elf/$queryId"
                    params={{ queryId: result.queryId }}
                    className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                  >
                    Evidence <ArrowRight className="size-3" />
                  </Link>
                ) : null}
              </div>
            </div>
          ))}
          {!report.elfResults?.length ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              ELF checks have not run yet or this suite has none.
            </p>
          ) : null}
        </div>
      </section>

      <section className="mt-8" aria-labelledby="alerts-heading">
        <h2 id="alerts-heading" className="font-heading text-lg font-semibold">
          OpenSearch alert checks
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Passes when the selected receiver alert is not firing. Triggers at or
          after deployment start also fail the gate.
        </p>
        <div className="mt-4 divide-y border-y">
          {(report.alertResults ?? []).map((result) => (
            <div
              className="flex flex-col justify-between gap-2 py-4 sm:flex-row sm:items-center"
              key={result.checkId}
            >
              <div>
                <p className="font-medium">
                  {result.name ||
                    result.externalTriggerName ||
                    result.externalMonitorName}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {result.alertState || "not observed"}
                  {result.required ? " · Required" : " · Optional"}
                  {result.failureReason ? ` · ${result.failureReason}` : ""}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <StatusBadge status={result.status} />
                <Link
                  to="/alerts"
                  className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                >
                  Alerts <ArrowRight className="size-3" />
                </Link>
              </div>
            </div>
          ))}
          {!report.alertResults?.length ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              OpenSearch alert checks have not run yet or this suite has none.
            </p>
          ) : null}
        </div>
      </section>

      {report.reasons?.length || report.warnings?.length ? (
        <section className="mt-8 grid gap-5 lg:grid-cols-2">
          <ReasonList
            title="Blocking reasons"
            values={report.reasons ?? []}
            danger
          />
          <ReasonList title="Warnings" values={report.warnings ?? []} />
        </section>
      ) : null}
    </PageContainer>
  )
}

function Progress({
  run,
  percent,
}: {
  run: DeploymentValidationRunContract
  percent: number
}) {
  return (
    <section className="mt-6 border-y py-4" aria-live="polite">
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="inline-flex items-center gap-2 font-medium">
          <LoaderCircle className="size-4 animate-spin" />
          {run.progress.message}
        </span>
        <span className="text-muted-foreground">{percent}%</span>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full bg-primary transition-[width] duration-200"
          style={{ width: `${percent}%` }}
        />
      </div>
    </section>
  )
}

type MonitorResultType = NonNullable<
  DeploymentValidationRunContract["report"]["monitors"]
>[number]
function formatMilliseconds(value?: number) {
  return value === undefined || value === null
    ? "Not recorded"
    : `${value.toLocaleString()} ms`
}

function MonitorResult({ monitor }: { monitor: MonitorResultType }) {
  return (
    <details className="group py-4">
      <summary className="flex cursor-pointer list-none flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-medium">{monitor.monitorName}</p>
            <ClassificationBadge value={monitor.classification} />
            <Badge variant="outline">
              {monitor.required ? "Required" : "Optional"}
            </Badge>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            p95 {formatMilliseconds(monitor.baseline.p95Ms)} →{" "}
            {formatMilliseconds(monitor.post.p95Ms)}·{" "}
            {monitor.deltaPercent > 0 ? "+" : ""}
            {monitor.deltaPercent}%
          </p>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-sm text-muted-foreground">
            {monitor.post.successRate}% post success
          </span>
          <ChevronDown className="size-4 transition-transform group-open:rotate-180" />
        </div>
      </summary>
      <div className="mt-5 border-t pt-5">
        <div className="grid gap-5 xl:grid-cols-[1fr_1fr]">
          <DistributionTable baseline={monitor.baseline} post={monitor.post} />
          <ComparisonChart baseline={monitor.baseline} post={monitor.post} />
        </div>
        <TimeSeriesChart baseline={monitor.baseline} post={monitor.post} />
        {(monitor.steps ?? []).length ? (
          <div className="mt-6">
            <h3 className="text-sm font-medium">HTTP-step comparison</h3>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full min-w-[680px] text-left text-xs">
                <thead className="text-muted-foreground">
                  <tr className="border-b">
                    <th className="py-2 font-medium">Step</th>
                    <th className="py-2 font-medium">Baseline p95</th>
                    <th className="py-2 font-medium">Post p95</th>
                    <th className="py-2 font-medium">Change</th>
                    <th className="py-2 font-medium">Result</th>
                  </tr>
                </thead>
                <tbody>
                  {(monitor.steps ?? []).map((step) => (
                    <tr
                      className="border-b last:border-0"
                      key={step.stepDefinitionId}
                    >
                      <td className="py-2.5 font-medium">{step.stepName}</td>
                      <td>{formatMilliseconds(step.baseline.p95Ms)}</td>
                      <td>{formatMilliseconds(step.post.p95Ms)}</td>
                      <td>
                        {step.deltaPercent > 0 ? "+" : ""}
                        {step.deltaPercent}%
                      </td>
                      <td>
                        <ClassificationBadge value={step.classification} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
        <div className="mt-6">
          <h3 className="text-sm font-medium">Post-validation executions</h3>
          <div className="mt-2 flex flex-wrap gap-2">
            {(monitor.samples ?? []).map((sample) =>
              sample.monitorRunId ? (
                <Link
                  key={sample.id}
                  to="/monitors/$monitorId/runs/$runId"
                  params={{
                    monitorId: monitor.monitorId,
                    runId: sample.monitorRunId,
                  }}
                  className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-muted"
                >
                  <StatusDot status={sample.status} /> Sample{" "}
                  {sample.sampleNumber}
                </Link>
              ) : (
                <span
                  key={sample.id}
                  className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs"
                >
                  <StatusDot status={sample.status} /> Sample{" "}
                  {sample.sampleNumber}
                </span>
              )
            )}
          </div>
        </div>
        {(monitor.reasons ?? []).length ? (
          <ul className="mt-5 list-disc space-y-1 pl-5 text-xs text-muted-foreground">
            {(monitor.reasons ?? []).map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        ) : null}
      </div>
    </details>
  )
}

function DistributionTable({
  baseline,
  post,
}: {
  baseline: DeploymentDistributionContract
  post: DeploymentDistributionContract
}) {
  const rows: Array<[string, string, string, string]> = [
    [
      "p50",
      formatMilliseconds(baseline.p50Ms),
      formatMilliseconds(post.p50Ms),
      "Median response time.",
    ],
    [
      "p95",
      formatMilliseconds(baseline.p95Ms),
      formatMilliseconds(post.p95Ms),
      "95% of measured executions are at or below this value.",
    ],
    [
      "p99",
      formatMilliseconds(baseline.p99Ms),
      formatMilliseconds(post.p99Ms),
      "Tail latency covering 99% of measured executions.",
    ],
    [
      "Average",
      formatMilliseconds(baseline.averageMs),
      formatMilliseconds(post.averageMs),
      "Arithmetic mean of successful measured executions.",
    ],
    [
      "Success",
      `${baseline.successRate}%`,
      `${post.successRate}%`,
      "Successful completed executions divided by all completed executions.",
    ],
    [
      "Std deviation",
      formatMilliseconds(baseline.standardDeviationMs),
      formatMilliseconds(post.standardDeviationMs),
      "Variation around the average response time.",
    ],
  ]
  return (
    <div className="overflow-hidden rounded-lg border">
      <div className="grid grid-cols-[1fr_1fr_1fr] bg-muted px-3 py-2 text-xs font-medium">
        <span>Metric</span>
        <span>Before</span>
        <span>After</span>
      </div>
      {rows.map(([label, before, after, help]) => (
        <div
          className="grid grid-cols-[1fr_1fr_1fr] border-t px-3 py-2.5 text-sm"
          key={label}
        >
          <span className="inline-flex items-center gap-1">
            {label}
            <MetricInfo text={help} />
          </span>
          <span>{before}</span>
          <span>{after}</span>
        </div>
      ))}
    </div>
  )
}
function ComparisonChart({
  baseline,
  post,
}: {
  baseline: DeploymentDistributionContract
  post: DeploymentDistributionContract
}) {
  const data = [
    { percentile: "p50", before: baseline.p50Ms, after: post.p50Ms },
    { percentile: "p95", before: baseline.p95Ms, after: post.p95Ms },
    { percentile: "p99", before: baseline.p99Ms, after: post.p99Ms },
  ]
  const hasData = data.some(
    (item) => item.before !== undefined || item.after !== undefined
  )
  return (
    <figure className="rounded-lg border p-4">
      <figcaption className="text-sm font-medium">
        Latency distribution
      </figcaption>
      {hasData ? (
        <ChartContainer
          className="mt-3 aspect-auto h-[240px] w-full"
          config={comparisonChartConfig}
          initialDimension={{ width: 420, height: 240 }}
        >
          <BarChart
            data={data}
            margin={{ left: 4, right: 8, top: 8, bottom: 0 }}
          >
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="percentile"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
            />
            <YAxis
              width={52}
              tickFormatter={compactLatency}
              tickLine={false}
              axisLine={false}
            />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  formatter={(value, name) => (
                    <>
                      <span className="text-muted-foreground">
                        {name === "before" ? "Before" : "After"}
                      </span>
                      <span className="ml-auto font-mono font-medium">
                        {formatLatencyMs(Number(value))}
                      </span>
                    </>
                  )}
                />
              }
            />
            <Bar
              dataKey="before"
              fill="var(--color-before)"
              radius={[4, 4, 0, 0]}
              maxBarSize={28}
            />
            <Bar
              dataKey="after"
              fill="var(--color-after)"
              radius={[4, 4, 0, 0]}
              maxBarSize={28}
            />
            <ChartLegend content={<ChartLegendContent />} />
          </BarChart>
        </ChartContainer>
      ) : (
        <p className="mt-8 text-sm text-muted-foreground">
          Latency was not recorded for either period.
        </p>
      )}
    </figure>
  )
}

function TimeSeriesChart({
  baseline,
  post,
}: {
  baseline: DeploymentDistributionContract
  post: DeploymentDistributionContract
}) {
  // In-progress runs can omit post series until sampling finishes (API may send null).
  const baselineSeries = baseline.series ?? []
  const postSeries = post.series ?? []
  const data = [
    ...baselineSeries.map((point, index) => ({
      sequence: index + 1,
      timestamp: point.createdAt,
      before: point.valueMs,
      after: undefined as number | undefined,
      period: "Before",
    })),
    ...postSeries.map((point, index) => ({
      sequence: baselineSeries.length + index + 1,
      timestamp: point.createdAt,
      before: undefined as number | undefined,
      after: point.valueMs,
      period: "After",
    })),
  ]
  if (!data.length) return null
  return (
    <figure className="mt-5 rounded-lg border p-4">
      <figcaption>
        <span className="text-sm font-medium">
          Measured executions over time
        </span>
        <span className="mt-1 block text-xs text-muted-foreground">
          Each point is API-only response time. The gap marks the deployment
          boundary.
        </span>
      </figcaption>
      <ChartContainer
        className="mt-3 aspect-auto h-[260px] w-full"
        config={comparisonChartConfig}
        initialDimension={{ width: 900, height: 260 }}
      >
        <LineChart
          data={data}
          margin={{ left: 4, right: 10, top: 8, bottom: 0 }}
        >
          <CartesianGrid vertical={false} />
          <XAxis dataKey="sequence" tickLine={false} axisLine={false} />
          <YAxis
            width={52}
            tickFormatter={compactLatency}
            tickLine={false}
            axisLine={false}
          />
          <ChartTooltip
            content={
              <ChartTooltipContent
                labelFormatter={(_, payload) => {
                  const point = payload?.[0]?.payload as
                    { timestamp?: string; period?: string } | undefined
                  return point?.timestamp
                    ? `${point.period} · ${new Date(point.timestamp).toLocaleString()}`
                    : "Execution"
                }}
                formatter={(value, name) => (
                  <>
                    <span className="text-muted-foreground">
                      {name === "before" ? "Before" : "After"}
                    </span>
                    <span className="ml-auto font-mono font-medium">
                      {formatLatencyMs(Number(value))}
                    </span>
                  </>
                )}
              />
            }
          />
          <Line
            dataKey="before"
            stroke="var(--color-before)"
            strokeWidth={2}
            dot={false}
            connectNulls={false}
          />
          <Line
            dataKey="after"
            stroke="var(--color-after)"
            strokeWidth={2}
            dot={false}
            connectNulls={false}
          />
          <ChartLegend content={<ChartLegendContent />} />
        </LineChart>
      </ChartContainer>
      <details className="mt-3">
        <summary className="cursor-pointer text-xs font-medium text-primary">
          View accessible chart data
        </summary>
        <div className="mt-3 max-h-64 overflow-auto">
          <table className="w-full text-left text-xs">
            <thead className="text-muted-foreground">
              <tr className="border-b">
                <th className="py-2 font-medium">Period</th>
                <th className="py-2 font-medium">Recorded at</th>
                <th className="py-2 text-right font-medium">API response</th>
              </tr>
            </thead>
            <tbody>
              {data.map((point) => (
                <tr className="border-b last:border-0" key={point.sequence}>
                  <td className="py-2">{point.period}</td>
                  <td className="py-2">
                    {new Date(point.timestamp).toLocaleString()}
                  </td>
                  <td className="py-2 text-right font-mono">
                    {formatMilliseconds(point.before ?? point.after)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  )
}

function formatLatencyMs(value: number) {
  if (Number.isNaN(value)) return "—"
  if (value < 1) return "<1 ms"
  if (value >= 1000)
    return `${(value / 1000).toFixed(value >= 10000 ? 1 : 2)} s`
  return `${Math.round(value).toLocaleString()} ms`
}

function compactLatency(value: number) {
  return value >= 1000 ? `${Number((value / 1000).toFixed(1))}s` : `${value}ms`
}
function Metric({
  label,
  value,
  help,
}: {
  label: string
  value: string
  help?: string
}) {
  return (
    <div className="min-w-0 p-3">
      <p className="flex items-center gap-1 text-xs text-muted-foreground">
        {label}
        {help ? <MetricInfo text={help} /> : null}
      </p>
      <p className="mt-1 truncate font-medium">{value}</p>
    </div>
  )
}
function MetricInfo({ text }: { text: string }) {
  return (
    <button
      type="button"
      className="rounded-sm text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      aria-label={text}
      title={text}
    >
      <Info className="size-3.5" />
    </button>
  )
}
function DecisionBadge({ decision }: { decision: string }) {
  return (
    <Badge
      className={
        decision === "BLOCK"
          ? "bg-destructive/10 text-destructive"
          : decision === "ALLOW"
            ? "bg-success-soft text-success-foreground"
            : decision === "ALLOW_WITH_WARNINGS"
              ? "bg-warning-soft text-warning-foreground"
              : ""
      }
      variant="secondary"
    >
      {decision.toLowerCase().replaceAll("_", " ")}
    </Badge>
  )
}
function ClassificationBadge({ value }: { value: string }) {
  return (
    <Badge
      className={
        value === "REGRESSED"
          ? "bg-destructive/10 text-destructive"
          : value === "IMPROVED"
            ? "bg-success-soft text-success-foreground"
            : value === "INSUFFICIENT_HISTORY"
              ? "bg-warning-soft text-warning-foreground"
              : ""
      }
      variant="secondary"
    >
      {value.toLowerCase().replaceAll("_", " ")}
    </Badge>
  )
}
function StatusBadge({ status }: { status: string }) {
  return (
    <Badge
      className={
        status === "SUCCESS"
          ? "bg-success-soft text-success-foreground"
          : "bg-destructive/10 text-destructive"
      }
      variant="secondary"
    >
      {status.toLowerCase()}
    </Badge>
  )
}
function StatusDot({ status }: { status: string }) {
  return status === "SUCCESS" || status === "SUCCESS_WITH_WARNINGS" ? (
    <Check className="size-3 text-success-foreground" />
  ) : (
    <CircleAlert className="size-3 text-destructive" />
  )
}
function ReasonList({
  title,
  values,
  danger = false,
}: {
  title: string
  values: string[]
  danger?: boolean
}) {
  return (
    <div className="border-y py-4">
      <h2 className="inline-flex items-center gap-2 font-medium">
        {danger ? (
          <CircleAlert className="size-4 text-destructive" />
        ) : (
          <FileText className="size-4 text-warning-foreground" />
        )}
        {title}
      </h2>
      {values.length ? (
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          {values.map((value) => (
            <li key={value}>{value}</li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">None recorded.</p>
      )}
    </div>
  )
}
