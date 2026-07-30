import { Link } from "@tanstack/react-router"
import { Badge } from "@workspace/ui/components/badge"
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@workspace/ui/components/chart"
import type { ChartConfig } from "@workspace/ui/components/chart"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip"
import {
  Activity,
  ArrowRight,
  Check,
  CircleAlert,
  Clock3,
  Gauge,
  History,
  Info,
  Radio,
  TriangleAlert,
} from "lucide-react"
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  Pie,
  PieChart,
  Scatter,
  XAxis,
  YAxis,
} from "recharts"
import type { ReactNode } from "react"
import { useEffect, useRef, useState } from "react"

import type {
  RunContract,
  RunHistoryMetricsContract,
  RunMetricPointContract,
} from "@/lib/api-client/contracts"
import { formatDateTime as formatDate } from "@/lib/format-date"

export type MetricsWindow = "24h" | "7d" | "30d" | "90d"

const latencyConfig = {
  apiResponseTimeMs: { label: "API response", color: "var(--primary)" },
  p50: { label: "p50", color: "var(--muted-foreground)" },
  p95: { label: "p95", color: "var(--warning, #d97706)" },
  p99: { label: "p99", color: "var(--destructive)" },
  spikeValue: { label: "Detected spike", color: "var(--destructive)" },
} satisfies ChartConfig

const compositionConfig = {
  api: { label: "API response", color: "var(--primary)" },
  preparation: { label: "Preparation", color: "#8b5cf6" },
  post: { label: "Post-processing", color: "#14b8a6" },
  retry: { label: "Retry backoff", color: "#f59e0b" },
  other: { label: "Other orchestration", color: "var(--muted-foreground)" },
} satisfies ChartConfig

const outcomeConfig = {
  success: { label: "Successful", color: "var(--success, #16a34a)" },
  failed: { label: "Failed", color: "var(--destructive)" },
  active: { label: "Active / other", color: "var(--muted-foreground)" },
} satisfies ChartConfig

export default function MonitorMetricsDashboard({
  monitorId,
  window,
  runs,
  metrics,
}: {
  monitorId: string
  window: MetricsWindow
  runs: RunContract[]
  metrics: RunHistoryMetricsContract
}) {
  const pointsByRun = new Map(
    metrics.points.map((point) => [point.runId, point])
  )
  const latencyData = metrics.points.filter(hasResponseTime).map((point) => ({
    ...point,
    label: chartTime(point.createdAt, window),
    p50: metrics.percentiles.p50Ms,
    p95: metrics.percentiles.p95Ms,
    p99: metrics.percentiles.p99Ms,
    spikeValue: point.spike ? point.apiResponseTimeMs : undefined,
  }))
  const compositionData = metrics.points
    .filter(hasResponseTime)
    .map((point) => ({
      label: chartTime(point.createdAt, window),
      api: point.apiResponseTimeMs,
      preparation: point.preparationMs,
      post: point.postProcessingMs,
      retry: point.retryBackoffMs,
      other: Math.max(
        0,
        point.executionDurationMs -
          point.apiResponseTimeMs -
          point.preparationMs -
          point.postProcessingMs -
          point.retryBackoffMs
      ),
    }))
  const percentiles = [
    ["Minimum", metrics.percentiles.minMs],
    ["p50", metrics.percentiles.p50Ms],
    ["p75", metrics.percentiles.p75Ms],
    ["p90", metrics.percentiles.p90Ms],
    ["p95", metrics.percentiles.p95Ms],
    ["p99", metrics.percentiles.p99Ms],
    ["Maximum", metrics.percentiles.maxMs],
  ].filter((entry): entry is [string, number] => typeof entry[1] === "number")
  const outcomeData = buildOutcomeData(metrics)

  return (
    <TooltipProvider>
      <div>
        {metrics.summary.measuredRunCount !== metrics.summary.runCount && (
          <div className="mt-5 flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/5 px-3 py-2.5 text-sm">
            <Info className="mt-0.5 size-4 shrink-0 text-warning" />
            <p>
              <span className="font-medium">
                {metrics.summary.measuredRunCount} of {metrics.summary.runCount}{" "}
                runs include API-only timing.
              </span>{" "}
              Older executions remain in reliability totals, but are excluded
              from latency percentiles.
            </p>
          </div>
        )}
        {metrics.summary.measuredRunCount > 0 &&
        metrics.summary.measuredRunCount < 20 ? (
          <div className="mt-3 flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/5 px-3 py-2.5 text-sm">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" />
            <p>
              <span className="font-medium">
                Percentiles are based on only {metrics.summary.measuredRunCount}{" "}
                measured runs.
              </span>{" "}
              p95 and especially p99 may change substantially as more executions
              are recorded.
            </p>
          </div>
        ) : null}

        <section
          aria-label="Key performance metrics"
          className="mt-6 grid overflow-hidden rounded-xl border sm:grid-cols-2 lg:grid-cols-4"
        >
          <MetricCard
            icon={Activity}
            label="Latest API response"
            value={formatDuration(metrics.summary.latestResponseMs)}
            detail={formatChange(metrics.summary.latestChangePercent)}
            help="The latest target response time, measured from the first request byte written until the response body is fully read. Preparation and assertions are excluded."
          />
          <MetricCard
            icon={Gauge}
            label="p50 · median"
            value={formatDuration(metrics.percentiles.p50Ms)}
            detail={`Average ${formatDuration(metrics.summary.averageResponseMs)}`}
            help="Half of measured API responses completed at or below this value. Median is less affected by unusual slow runs than the average."
          />
          <MetricCard
            icon={Gauge}
            label="p95 · tail latency"
            value={formatDuration(metrics.percentiles.p95Ms)}
            detail={`p90 ${formatDuration(metrics.percentiles.p90Ms)}`}
            help="95% of measured API responses completed at or below this value; the slowest 5% took longer. This exposes tail latency hidden by averages."
          />
          <MetricCard
            icon={TriangleAlert}
            label="p99 · worst tail"
            value={formatDuration(metrics.percentiles.p99Ms)}
            detail={`Max ${formatDuration(metrics.percentiles.maxMs)}`}
            help="99% of measured API responses completed at or below this value. It highlights rare, severe delays but needs a larger sample to be stable."
          />
          <MetricCard
            icon={Check}
            label="Availability"
            value={formatPercent(metrics.summary.successRate)}
            detail={`${metrics.summary.runCount} runs in ${window}`}
            help="Successful and successful-with-warning terminal runs divided by all completed runs. Active, cancelled, and skipped runs are excluded."
          />
          <MetricCard
            icon={CircleAlert}
            label="Error rate"
            value={formatPercent(metrics.summary.errorRate)}
            detail={`Timeouts ${formatPercent(metrics.summary.timeoutRate)}`}
            help="Failed, timed-out, and aborted runs divided by completed runs. Timeout rate is shown separately because it often indicates a latency or connectivity issue."
          />
          <MetricCard
            icon={Radio}
            label="Detected spikes"
            value={String(metrics.summary.spikeCount)}
            detail={
              metrics.summary.spikeCount
                ? "Review marked points"
                : "No meaningful spikes"
            }
            help="A run is marked as a spike when it exceeds the rolling p95 and is at least 25% and 100 ms slower than the rolling median. At least five earlier samples are required."
          />
          <MetricCard
            icon={Clock3}
            label="Run frequency"
            value={`${metrics.summary.runsPerHour.toLocaleString()} / hr`}
            detail={`Window ${window}`}
            help="Runs observed in the selected time range divided by the number of hours in that range. This indicates actual execution throughput, not configured schedule frequency."
          />
        </section>

        <section className="mt-8 rounded-xl border p-4 md:p-5">
          <ChartTitle
            title="API response-time trend"
            description="API-only latency over time with tail thresholds and detected spikes."
            help="This chart measures target-facing response time only. Preparation, scripts, extraction, assertions, and retry backoff are intentionally excluded from the percentile lines."
          />
          {latencyData.length ? (
            <ChartContainer
              className="mt-4 aspect-auto h-[330px] w-full"
              config={latencyConfig}
              initialDimension={{ width: 900, height: 330 }}
            >
              <ComposedChart
                data={latencyData}
                margin={{ left: 4, right: 12, top: 12, bottom: 4 }}
              >
                <defs>
                  <linearGradient id="latency-fill" x1="0" x2="0" y1="0" y2="1">
                    <stop
                      offset="5%"
                      stopColor="var(--color-apiResponseTimeMs)"
                      stopOpacity={0.28}
                    />
                    <stop
                      offset="95%"
                      stopColor="var(--color-apiResponseTimeMs)"
                      stopOpacity={0.02}
                    />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} />
                <XAxis
                  dataKey="label"
                  minTickGap={38}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  width={58}
                  tickFormatter={compactDuration}
                  tickLine={false}
                  axisLine={false}
                />
                <ChartTooltip
                  content={
                    <ChartTooltipContent
                      labelKey="label"
                      formatter={(value, name) => (
                        <>
                          <span className="text-muted-foreground">
                            {latencyMetricLabel(String(name))}
                          </span>
                          <span className="ml-auto font-mono font-medium">
                            {formatDuration(Number(value))}
                          </span>
                        </>
                      )}
                    />
                  }
                />
                <Area
                  dataKey="apiResponseTimeMs"
                  fill="url(#latency-fill)"
                  stroke="var(--color-apiResponseTimeMs)"
                  strokeWidth={2}
                  type="monotone"
                />
                <Line
                  dataKey="p50"
                  dot={false}
                  stroke="var(--color-p50)"
                  strokeDasharray="4 5"
                  strokeWidth={1}
                  type="monotone"
                />
                <Line
                  dataKey="p95"
                  dot={false}
                  stroke="var(--color-p95)"
                  strokeDasharray="6 4"
                  strokeWidth={1.5}
                  type="monotone"
                />
                <Line
                  dataKey="p99"
                  dot={false}
                  stroke="var(--color-p99)"
                  strokeDasharray="2 4"
                  strokeWidth={1.5}
                  type="monotone"
                />
                <Scatter
                  dataKey="spikeValue"
                  fill="var(--color-spikeValue)"
                  name="spikeValue"
                />
                <ChartLegend content={<ChartLegendContent />} />
              </ComposedChart>
            </ChartContainer>
          ) : (
            <ChartEmpty />
          )}
          {latencyData.length ? (
            <details className="mt-4 rounded-lg border">
              <summary className="cursor-pointer px-4 py-3 text-sm font-medium">
                View accessible response-time data
              </summary>
              <div className="max-h-80 overflow-auto border-t">
                <table className="w-full min-w-[620px] text-left text-sm">
                  <thead className="sticky top-0 bg-muted">
                    <tr>
                      <th className="px-4 py-2">Execution</th>
                      <th className="px-4 py-2">Started</th>
                      <th className="px-4 py-2">API response</th>
                      <th className="px-4 py-2">Signal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {latencyData.map((point) => (
                      <tr className="border-t" key={point.runId}>
                        <td className="px-4 py-2">
                          <Link
                            className="font-mono text-xs text-primary hover:underline"
                            params={{ monitorId, runId: point.runId }}
                            to="/monitors/$monitorId/runs/$runId"
                          >
                            {point.runId.slice(0, 8)}
                          </Link>
                        </td>
                        <td className="px-4 py-2">
                          {formatDate(point.createdAt)}
                        </td>
                        <td className="px-4 py-2 font-mono">
                          {formatDuration(point.apiResponseTimeMs)}
                        </td>
                        <td className="px-4 py-2">
                          {point.spike ? "Detected spike" : "Normal range"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          ) : null}
        </section>

        <DeferredAnalytics minHeight={360}>
          <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1.55fr)_minmax(330px,0.75fr)]">
            <section className="rounded-xl border p-4 md:p-5">
              <ChartTitle
                title="Execution composition"
                description="Where end-to-end run time was spent."
                help="API response is the target measurement. Preparation includes local template, script, secret, and request setup. Post-processing includes extraction and assertions. Other orchestration is any remaining executor overhead."
              />
              {compositionData.length ? (
                <ChartContainer
                  className="mt-4 aspect-auto h-[300px] w-full"
                  config={compositionConfig}
                  initialDimension={{ width: 760, height: 300 }}
                >
                  <AreaChart
                    data={compositionData}
                    margin={{ left: 4, right: 10, top: 10, bottom: 4 }}
                  >
                    <CartesianGrid vertical={false} />
                    <XAxis
                      dataKey="label"
                      minTickGap={36}
                      tickLine={false}
                      axisLine={false}
                    />
                    <YAxis
                      width={58}
                      tickFormatter={compactDuration}
                      tickLine={false}
                      axisLine={false}
                    />
                    <ChartTooltip
                      content={<ChartTooltipContent labelKey="label" />}
                    />
                    <Area
                      dataKey="api"
                      fill="var(--color-api)"
                      fillOpacity={0.72}
                      stackId="time"
                      stroke="var(--color-api)"
                      type="monotone"
                    />
                    <Area
                      dataKey="preparation"
                      fill="var(--color-preparation)"
                      fillOpacity={0.65}
                      stackId="time"
                      stroke="var(--color-preparation)"
                      type="monotone"
                    />
                    <Area
                      dataKey="post"
                      fill="var(--color-post)"
                      fillOpacity={0.65}
                      stackId="time"
                      stroke="var(--color-post)"
                      type="monotone"
                    />
                    <Area
                      dataKey="retry"
                      fill="var(--color-retry)"
                      fillOpacity={0.65}
                      stackId="time"
                      stroke="var(--color-retry)"
                      type="monotone"
                    />
                    <Area
                      dataKey="other"
                      fill="var(--color-other)"
                      fillOpacity={0.35}
                      stackId="time"
                      stroke="var(--color-other)"
                      type="monotone"
                    />
                    <ChartLegend
                      content={<ChartLegendContent className="flex-wrap" />}
                    />
                  </AreaChart>
                </ChartContainer>
              ) : (
                <ChartEmpty />
              )}
            </section>
            <section className="rounded-xl border p-4 md:p-5">
              <ChartTitle
                title="Run outcomes"
                description="Reliability mix for completed and active executions."
                help="Successful includes SUCCESS and SUCCESS_WITH_WARNINGS. Failed includes FAILED, TIMED_OUT, and ABORTED. Active / other includes queued, starting, running, cancelled, and skipped runs."
              />
              {outcomeData.some((entry) => entry.value > 0) ? (
                <ChartContainer
                  className="mx-auto mt-2 aspect-auto h-[230px] max-w-[360px]"
                  config={outcomeConfig}
                  initialDimension={{ width: 340, height: 230 }}
                >
                  <PieChart>
                    <ChartTooltip content={<ChartTooltipContent hideLabel />} />
                    <Pie
                      data={outcomeData}
                      dataKey="value"
                      innerRadius={58}
                      nameKey="key"
                      outerRadius={88}
                      paddingAngle={3}
                    >
                      {outcomeData.map((entry) => (
                        <Cell
                          key={entry.key}
                          fill={`var(--color-${entry.key})`}
                        />
                      ))}
                    </Pie>
                    <ChartLegend
                      content={
                        <ChartLegendContent
                          nameKey="key"
                          className="flex-wrap"
                        />
                      }
                    />
                  </PieChart>
                </ChartContainer>
              ) : (
                <ChartEmpty compact />
              )}
              <div className="mt-3 grid grid-cols-2 gap-x-5 gap-y-3 border-t pt-4 text-sm">
                <DetailMetric
                  label="Latency variation"
                  value={formatDuration(metrics.summary.standardDeviationMs)}
                  help="Standard deviation shows how widely API response times vary around the average. Lower values mean more consistent performance."
                />
                <DetailMetric
                  label="Average queue"
                  value={formatDuration(metrics.summary.averageQueueDelayMs)}
                  help="Average time from run creation until execution starts. This is Rhythm capacity delay and is not part of API response time."
                />
                <DetailMetric
                  label="Average preparation"
                  value={formatDuration(metrics.summary.averagePreparationMs)}
                  help="Average local setup time before target measurement: scripts, variables, secrets, request rendering, auth, proxy, and TLS setup."
                />
                <DetailMetric
                  label="Average execution"
                  value={formatDuration(metrics.summary.averageExecutionMs)}
                  help="Average full run duration. It includes preparation, target response time, retries, extraction, assertions, and orchestration."
                />
              </div>
            </section>
          </div>
        </DeferredAnalytics>

        <DeferredAnalytics minHeight={350}>
          <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(330px,0.8fr)]">
            <section className="rounded-xl border p-4 md:p-5">
              <ChartTitle
                title="Latency percentiles"
                description="Distribution thresholds for the selected period."
                help="A percentile is the response time at or below which that percentage of observations falls. p50 describes typical behavior; p95 and p99 expose increasingly rare tail latency."
              />
              {percentiles.length ? (
                <ChartContainer
                  className="mt-4 aspect-auto h-[290px] w-full"
                  config={{
                    value: { label: "Response time", color: "var(--primary)" },
                  }}
                  initialDimension={{ width: 700, height: 290 }}
                >
                  <BarChart
                    data={percentiles.map(([name, value]) => ({ name, value }))}
                    layout="vertical"
                    margin={{ left: 8, right: 22, top: 4, bottom: 4 }}
                  >
                    <CartesianGrid horizontal={false} />
                    <XAxis
                      type="number"
                      tickFormatter={compactDuration}
                      tickLine={false}
                      axisLine={false}
                    />
                    <YAxis
                      dataKey="name"
                      type="category"
                      width={68}
                      tickLine={false}
                      axisLine={false}
                    />
                    <ChartTooltip content={<ChartTooltipContent hideLabel />} />
                    <Bar
                      dataKey="value"
                      fill="var(--color-value)"
                      radius={[0, 5, 5, 0]}
                    />
                  </BarChart>
                </ChartContainer>
              ) : (
                <ChartEmpty compact />
              )}
            </section>
            <section className="rounded-xl border p-4 md:p-5">
              <ChartTitle
                title="Failure categories"
                description="Primary causes across failed executions."
                help="Failure categories identify the normalized primary cause of each failed run, such as timeout, network, TLS, assertion, extractor, script, or configuration failure."
              />
              <FailureCategories categories={metrics.failureCategories} />
            </section>
          </div>
        </DeferredAnalytics>

        <section className="mt-8 [contain-intrinsic-size:auto_760px] [content-visibility:auto]">
          <ChartTitle
            title="Latest executions"
            description="Newest first. Open any run for step, attempt, network, check, and failure evidence."
            help="API response excludes Rhythm preparation and post-processing. Execution is the complete run duration. A spike is evaluated against earlier rolling history, not future runs."
          />
          {!runs.length ? (
            <div className="mt-4 rounded-xl border border-dashed px-6 py-14 text-center">
              <History className="mx-auto size-7 text-muted-foreground" />
              <h3 className="mt-4 font-medium">No runs recorded</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Run a draft or published revision to create execution evidence.
              </p>
            </div>
          ) : (
            <div className="mt-4 overflow-hidden rounded-xl border">
              <div className="hidden grid-cols-[minmax(180px,1fr)_135px_130px_120px_120px_90px_36px] gap-4 border-b bg-muted/45 px-4 py-2.5 text-xs font-medium text-muted-foreground lg:grid">
                <span>Started</span>
                <span>Result</span>
                <span>API response</span>
                <span>Execution</span>
                <span>Preparation</span>
                <span>Signal</span>
                <span />
              </div>
              {runs.map((run) => (
                <RunRow
                  key={run.id}
                  metric={pointsByRun.get(run.id)}
                  run={run}
                />
              ))}
            </div>
          )}
        </section>
      </div>
    </TooltipProvider>
  )
}

function MetricCard({
  icon: Icon,
  label,
  value,
  detail,
  help,
}: {
  icon: typeof Activity
  label: string
  value: string
  detail: string
  help: string
}) {
  return (
    <div className="min-w-0 border-b p-4 last:border-b-0 sm:nth-[2n]:border-l sm:nth-[n+7]:border-b-0 lg:border-b lg:nth-[2n]:border-l-0 lg:nth-[n+2]:border-l lg:nth-[n+5]:border-b-0">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
          <Icon className="size-3.5" />
          {label}
        </span>
        <MetricHelp label={label} text={help} />
      </div>
      <p className="mt-3 font-heading text-2xl font-semibold tracking-tight tabular-nums">
        {value}
      </p>
      <p className="mt-1 truncate text-xs text-muted-foreground">{detail}</p>
    </div>
  )
}

function ChartTitle({
  title,
  description,
  help,
}: {
  title: string
  description: string
  help: string
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div>
        <h2 className="font-heading text-lg font-semibold">{title}</h2>
        <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
      </div>
      <MetricHelp label={title} text={help} />
    </div>
  )
}

function MetricHelp({ label, text }: { label: string; text: string }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            aria-label={`What ${label} means`}
          />
        }
      >
        <Info className="size-3.5" />
      </TooltipTrigger>
      <TooltipContent className="max-w-80 leading-relaxed" side="top">
        {text}
      </TooltipContent>
    </Tooltip>
  )
}

function DetailMetric({
  label,
  value,
  help,
}: {
  label: string
  value: string
  help: string
}) {
  return (
    <div>
      <div className="flex items-center gap-1">
        <p className="text-xs text-muted-foreground">{label}</p>
        <MetricHelp label={label} text={help} />
      </div>
      <p className="mt-0.5 font-mono font-medium tabular-nums">{value}</p>
    </div>
  )
}

function FailureCategories({
  categories,
}: {
  categories: Record<string, number>
}) {
  const sorted = Object.entries(categories).sort((a, b) => b[1] - a[1])
  const total = sorted.reduce((sum, [, count]) => sum + count, 0)
  if (!sorted.length)
    return (
      <div className="mt-6 rounded-lg border border-dashed px-4 py-10 text-center">
        <Check className="mx-auto size-6 text-success" />
        <p className="mt-3 text-sm font-medium">No categorized failures</p>
        <p className="mt-1 text-xs text-muted-foreground">
          No failed run in this period recorded a primary category.
        </p>
      </div>
    )
  return (
    <div className="mt-5 space-y-4">
      {sorted.map(([category, count]) => (
        <div key={category}>
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="truncate font-medium">
              {category.replaceAll("_", " ").toLowerCase()}
            </span>
            <span className="font-mono text-xs">{count}</span>
          </div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-destructive"
              style={{ width: `${Math.max(4, (count / total) * 100)}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  )
}

function RunRow({
  run,
  metric,
}: {
  run: RunContract
  metric?: RunMetricPointContract
}) {
  const success =
    run.status === "SUCCESS" || run.status === "SUCCESS_WITH_WARNINGS"
  const active = ["QUEUED", "STARTING", "RUNNING"].includes(run.status)
  return (
    <Link
      className="grid gap-3 border-b px-4 py-4 transition-colors last:border-b-0 hover:bg-muted/30 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset lg:grid-cols-[minmax(180px,1fr)_135px_130px_120px_120px_90px_36px] lg:items-center lg:gap-4"
      params={{ monitorId: run.monitorId, runId: run.id }}
      to="/monitors/$monitorId/runs/$runId"
    >
      <div>
        <p className="text-sm font-medium">
          {formatDate(run.startedAt ?? run.createdAt)}
        </p>
        <p className="mt-1 font-mono text-xs text-muted-foreground">
          {run.id.slice(0, 8)}
        </p>
      </div>
      <Badge
        className={
          success
            ? "w-fit bg-success-soft text-success-foreground"
            : active
              ? "w-fit"
              : "w-fit bg-destructive/10 text-destructive"
        }
        variant="secondary"
      >
        {success ? <Check /> : <CircleAlert />}
        {run.status.replaceAll("_", " ")}
      </Badge>
      <LabeledValue
        label="API response"
        value={
          active ? "In progress" : formatDuration(metric?.apiResponseTimeMs)
        }
      />
      <LabeledValue
        label="Execution"
        value={
          active
            ? "In progress"
            : formatDuration(metric?.executionDurationMs ?? run.durationMs)
        }
      />
      <LabeledValue
        label="Preparation"
        value={active ? "—" : formatDuration(metric?.preparationMs)}
      />
      <span
        className={
          metric?.spike
            ? "flex w-fit items-center gap-1 text-xs font-medium text-destructive"
            : "text-xs text-muted-foreground"
        }
      >
        {metric?.spike ? (
          <>
            <TriangleAlert className="size-3.5" /> Spike
          </>
        ) : metric?.apiResponseTimeMs === undefined && !active ? (
          "Legacy"
        ) : (
          "Normal"
        )}
      </span>
      <ArrowRight className="size-4 text-muted-foreground" />
    </Link>
  )
}

function LabeledValue({ label, value }: { label: string; value: string }) {
  return (
    <span className="text-sm">
      <span className="mr-2 text-xs text-muted-foreground lg:hidden">
        {label}
      </span>
      <span className="font-mono tabular-nums">{value}</span>
    </span>
  )
}

function ChartEmpty({ compact = false }: { compact?: boolean }) {
  return (
    <div
      className={`mt-4 grid place-items-center rounded-lg border border-dashed text-center ${compact ? "min-h-48" : "min-h-72"}`}
    >
      <div>
        <Activity className="mx-auto size-6 text-muted-foreground" />
        <p className="mt-3 text-sm font-medium">Not enough measured history</p>
        <p className="mt-1 text-xs text-muted-foreground">
          New runs will populate this chart with API-only timing.
        </p>
      </div>
    </div>
  )
}

function DeferredAnalytics({
  children,
  minHeight,
}: {
  children: ReactNode
  minHeight: number
}) {
  const target = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const element = target.current
    if (!element || typeof IntersectionObserver === "undefined") {
      setVisible(true)
      return
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return
        setVisible(true)
        observer.disconnect()
      },
      { rootMargin: "120px 0px" }
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  return (
    <div ref={target}>
      {visible ? (
        children
      ) : (
        <div
          aria-hidden="true"
          className="mt-6 animate-pulse rounded-xl border bg-muted/20"
          style={{ minHeight }}
        />
      )}
    </div>
  )
}

function hasResponseTime(
  point: RunMetricPointContract
): point is RunMetricPointContract & { apiResponseTimeMs: number } {
  return typeof point.apiResponseTimeMs === "number"
}

function buildOutcomeData(metrics: RunHistoryMetricsContract) {
  const status = metrics.statusDistribution
  return [
    {
      key: "success",
      value:
        statusCount(status, "SUCCESS") +
        statusCount(status, "SUCCESS_WITH_WARNINGS"),
    },
    {
      key: "failed",
      value:
        statusCount(status, "FAILED") +
        statusCount(status, "TIMED_OUT") +
        statusCount(status, "ABORTED"),
    },
    {
      key: "active",
      value:
        statusCount(status, "QUEUED") +
        statusCount(status, "STARTING") +
        statusCount(status, "RUNNING") +
        statusCount(status, "CANCELLED") +
        statusCount(status, "SKIPPED_CONDITION"),
    },
  ]
}

function statusCount(status: Record<string, number>, key: string) {
  return Number(status[key]) || 0
}
function latencyMetricLabel(key: string) {
  return key === "apiResponseTimeMs"
    ? "API response"
    : key === "spikeValue"
      ? "Detected spike"
      : key
}

function formatDuration(value?: number) {
  if (value === undefined || Number.isNaN(value)) return "—"
  if (value < 1) return "<1 ms"
  if (value >= 1000)
    return `${(value / 1000).toFixed(value >= 10000 ? 1 : 2)} s`
  return `${Math.round(value).toLocaleString()} ms`
}
function compactDuration(value: number) {
  return value >= 1000 ? `${Number((value / 1000).toFixed(1))}s` : `${value}ms`
}
function formatPercent(value: number) {
  return `${value.toFixed(value % 1 === 0 ? 0 : 1)}%`
}
function formatChange(value?: number) {
  if (value === undefined || value === 0) return "No previous change"
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}% vs previous run`
}
function chartTime(value: string, window: MetricsWindow) {
  const date = new Date(value)
  if (window === "24h")
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
  const day = date.toLocaleDateString([], { month: "short", day: "numeric" })
  return window === "90d"
    ? day
    : `${day} · ${date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
}
