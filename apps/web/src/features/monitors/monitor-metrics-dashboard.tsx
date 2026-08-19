import { Link } from "@tanstack/react-router"
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
  Activity,
  ArrowRight,
  Check,
  CircleAlert,
  Clock3,
  Gauge,
  History,
  Info,
  LoaderCircle,
  Radio,
  TriangleAlert,
} from "lucide-react"
import {
  Area,
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
import { InfoHint } from "@/components/info-hint"

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
  execution: { label: "Full execution", color: "var(--foreground)" },
} satisfies ChartConfig

const outcomeConfig = {
  success: { label: "Successful", color: "var(--success, #16a34a)" },
  failed: { label: "Failed", color: "var(--destructive)" },
  active: { label: "Active / other", color: "var(--muted-foreground)" },
} satisfies ChartConfig

const httpClassConfig = {
  apiResponseTimeMs: { label: "API response", color: "var(--primary)" },
  class1xx: { label: "1xx", color: "var(--chart-3)" },
  class2xx: { label: "2xx", color: "var(--success, #16a34a)" },
  class3xx: { label: "3xx", color: "var(--chart-2)" },
  class4xx: { label: "4xx", color: "var(--warning, #d97706)" },
  class5xx: { label: "5xx", color: "var(--destructive)" },
  httpTimeout: { label: "Timeout", color: "#7c3aed" },
  noResponse: { label: "No response", color: "var(--muted-foreground)" },
} satisfies ChartConfig

const availabilityConfig = {
  success: { label: "Successful", color: "var(--success, #16a34a)" },
  failed: { label: "Failed", color: "var(--destructive)" },
  timeout: { label: "Timed out", color: "#7c3aed" },
} satisfies ChartConfig

export default function MonitorMetricsDashboard({
  monitorId,
  window,
  runs,
  runsTotal = 0,
  runsHasMore = false,
  runsLoadingMore = false,
  onLoadMoreRuns,
  metrics,
}: {
  monitorId: string
  window: MetricsWindow
  runs: RunContract[]
  runsTotal?: number
  runsHasMore?: boolean
  runsLoadingMore?: boolean
  onLoadMoreRuns?: () => void
  metrics: RunHistoryMetricsContract
}) {
  const points = metrics.points ?? []
  const percentiles = metrics.percentiles ?? {}
  const pointsByRun = new Map(
    points.filter((point) => point.runId).map((point) => [point.runId, point])
  )
  const latencyData = points.filter(hasResponseTime).map((point) => ({
    ...point,
    label: chartTime(point.createdAt, window),
    p50: percentiles.p50Ms,
    p95: percentiles.p95Ms,
    p99: percentiles.p99Ms,
    spikeValue: point.spike ? point.apiResponseTimeMs : undefined,
  }))
  const compositionData = points.map((point) => {
    const api = point.apiResponseTimeMs ?? 0
    const preparation = point.preparationMs ?? 0
    const post = point.postProcessingMs ?? 0
    const retry = point.retryBackoffMs ?? 0
    return {
      label: chartTime(point.createdAt, window),
      api: point.apiResponseTimeMs ?? null,
      preparation,
      post,
      retry,
      other: Math.max(
        0,
        (point.executionDurationMs ?? 0) - api - preparation - post - retry
      ),
      execution: point.executionDurationMs,
    }
  })
  const percentileRows = [
    ["Minimum", percentiles.minMs],
    ["p50", percentiles.p50Ms],
    ["p75", percentiles.p75Ms],
    ["p90", percentiles.p90Ms],
    ["p95", percentiles.p95Ms],
    ["p99", percentiles.p99Ms],
    ["Maximum", percentiles.maxMs],
  ].filter((entry): entry is [string, number] => typeof entry[1] === "number")
  const outcomeData = buildOutcomeData(metrics)
  const statusTimeData = buildStatusTimeData(points, window)
  const statusCodeData = buildStatusCodeData(metrics)
  const availabilityData = statusTimeData
  const hasHttpClassSeries = statusTimeData.some(
    (point) =>
      point.class1xx +
        point.class2xx +
        point.class3xx +
        point.class4xx +
        point.class5xx +
        point.httpTimeout +
        point.noResponse >
      0
  )
  const hasAvailabilitySeries = availabilityData.some(
    (point) => point.success + point.failed + point.timeout > 0
  )
  const hasLatencySeries = statusTimeData.some(
    (point) => typeof point.apiResponseTimeMs === "number"
  )

  return (
    <div>
      {metrics.summary?.measuredRunCount !== metrics.summary?.runCount && (
        <div className="mt-5 flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/5 px-3 py-2.5 text-sm">
          <Info className="mt-0.5 size-4 shrink-0 text-warning" />
          <p>
            <span className="font-medium">
              {metrics.summary.measuredRunCount} of {metrics.summary.runCount}{" "}
              runs include API-only timing.
            </span>{" "}
            Older executions remain in reliability totals, but are excluded from
            latency percentiles until target-facing HTTP timing is available.
          </p>
        </div>
      )}
      {metrics.summary?.measuredRunCount > 0 &&
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
          value={formatDuration(percentiles.p50Ms)}
          detail={`Average ${formatDuration(metrics.summary.averageResponseMs)}`}
          help="Half of measured API responses completed at or below this value. Median is less affected by unusual slow runs than the average."
        />
        <MetricCard
          icon={Gauge}
          label="p95 · tail latency"
          value={formatDuration(percentiles.p95Ms)}
          detail={`p90 ${formatDuration(percentiles.p90Ms)}`}
          help="95% of measured API responses completed at or below this value; the slowest 5% took longer. This exposes tail latency hidden by averages."
        />
        <MetricCard
          icon={TriangleAlert}
          label="p99 · worst tail"
          value={formatDuration(percentiles.p99Ms)}
          detail={`Max ${formatDuration(percentiles.maxMs)}`}
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
          value={`${Number(metrics.summary.runsPerHour || 0).toLocaleString()} / hr`}
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
                    <th className="px-4 py-2">Preparation</th>
                    <th className="px-4 py-2">Execution</th>
                    <th className="px-4 py-2">Signal</th>
                  </tr>
                </thead>
                <tbody>
                  {latencyData.map((point, index) => (
                    <tr
                      className="border-t"
                      key={point.runId || `${point.createdAt}-${index}`}
                    >
                      <td className="px-4 py-2 font-mono text-xs">
                        {point.runId ? (
                          <Link
                            className="text-primary hover:underline"
                            params={{ monitorId, runId: point.runId }}
                            to="/monitors/$monitorId/runs/$runId"
                          >
                            {point.runId.slice(0, 8)}
                          </Link>
                        ) : (
                          "Bucket"
                        )}
                      </td>
                      <td className="px-4 py-2">
                        {point.createdAt ? formatDate(point.createdAt) : "—"}
                      </td>
                      <td className="px-4 py-2 font-mono">
                        {formatDuration(point.apiResponseTimeMs)}
                      </td>
                      <td className="px-4 py-2 font-mono">
                        {formatDuration(point.preparationMs)}
                      </td>
                      <td className="px-4 py-2 font-mono">
                        {formatDuration(point.executionDurationMs)}
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

      <section className="mt-8 rounded-xl border p-4 md:p-5">
        <ChartTitle
          title="Response time and HTTP status"
          description="API latency on the same time axis as recorded status-class counts for every run in this window."
          help="The line is target-facing API response time for the slowest run in each bucket. Dots are colored by that run's last-attempt HTTP status. The columns count every completed run in the bucket: 2xx–5xx from recorded codes, Timeout when the run timed out with no HTTP status, and No response when the script or setup failed before a response."
        />
        {statusTimeData.length > 0 && (hasLatencySeries || hasHttpClassSeries) ? (
          <div className="mt-4 space-y-5">
            {hasLatencySeries ? (
              <ChartContainer
                className="aspect-auto h-[220px] w-full"
                config={httpClassConfig}
                initialDimension={{ width: 900, height: 220 }}
              >
                <ComposedChart
                  data={statusTimeData}
                  margin={{ left: 4, right: 12, top: 10, bottom: 0 }}
                >
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
                              {httpClassLabel(String(name))}
                            </span>
                            <span className="ml-auto font-mono font-medium">
                              {name === "apiResponseTimeMs"
                                ? formatDuration(Number(value))
                                : Number(value).toLocaleString()}
                            </span>
                          </>
                        )}
                      />
                    }
                  />
                  <Line
                    dataKey="apiResponseTimeMs"
                    dot={(props) => <StatusClassDot {...props} />}
                    stroke="var(--color-apiResponseTimeMs)"
                    strokeWidth={2}
                    type="monotone"
                  />
                </ComposedChart>
              </ChartContainer>
            ) : null}
            {hasHttpClassSeries ? (
              <ChartContainer
                className="aspect-auto h-[200px] w-full"
                config={httpClassConfig}
                initialDimension={{ width: 900, height: 200 }}
              >
                <BarChart
                  data={statusTimeData}
                  margin={{ left: 4, right: 12, top: 8, bottom: 4 }}
                >
                  <CartesianGrid vertical={false} />
                  <XAxis
                    dataKey="label"
                    minTickGap={38}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    allowDecimals={false}
                    width={58}
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
                              {httpClassLabel(String(name))}
                            </span>
                            <span className="ml-auto font-mono font-medium">
                              {Number(value).toLocaleString()}
                            </span>
                          </>
                        )}
                      />
                    }
                  />
                  {httpClassBars(statusTimeData).map((key, index, items) => (
                    <Bar
                      dataKey={key}
                      fill={`var(--color-${key})`}
                      key={key}
                      maxBarSize={28}
                      radius={index === items.length - 1 ? [3, 3, 0, 0] : 0}
                      stackId="http"
                    />
                  ))}
                  <ChartLegend
                    content={<ChartLegendContent className="flex-wrap" />}
                  />
                </BarChart>
              </ChartContainer>
            ) : (
              <ChartEmpty
                compact
                detail="Last-attempt HTTP status classes will stack here once responses are recorded."
              />
            )}
          </div>
        ) : (
          <ChartEmpty detail="Completed runs in this window will plot API response time beside HTTP status-class counts." />
        )}
      </section>

      <DeferredAnalytics minHeight={340}>
        <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1.45fr)_minmax(330px,0.85fr)]">
          <section className="rounded-xl border p-4 md:p-5">
            <ChartTitle
              title="Success vs failure over time"
              description="Availability mix for completed runs in each bucket."
              help="Successful includes SUCCESS and SUCCESS_WITH_WARNINGS. Failed includes FAILED and ABORTED. Timed out is shown separately because it often tracks latency or connectivity rather than an HTTP error."
            />
            {hasAvailabilitySeries ? (
              <ChartContainer
                className="mt-4 aspect-auto h-[280px] w-full"
                config={availabilityConfig}
                initialDimension={{ width: 760, height: 280 }}
              >
                <BarChart
                  data={availabilityData}
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
                    allowDecimals={false}
                    width={46}
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
                              {availabilityLabel(String(name))}
                            </span>
                            <span className="ml-auto font-mono font-medium">
                              {Number(value).toLocaleString()}
                            </span>
                          </>
                        )}
                      />
                    }
                  />
                  <Bar
                    dataKey="success"
                    fill="var(--color-success)"
                    stackId="outcome"
                    maxBarSize={28}
                  />
                  <Bar
                    dataKey="failed"
                    fill="var(--color-failed)"
                    stackId="outcome"
                    maxBarSize={28}
                  />
                  <Bar
                    dataKey="timeout"
                    fill="var(--color-timeout)"
                    radius={[3, 3, 0, 0]}
                    stackId="outcome"
                    maxBarSize={28}
                  />
                  <ChartLegend content={<ChartLegendContent />} />
                </BarChart>
              </ChartContainer>
            ) : (
              <ChartEmpty
                compact
                detail="Completed runs will show success, failure, and timeout counts over time."
              />
            )}
          </section>
          <section className="rounded-xl border p-4 md:p-5">
            <ChartTitle
              title="Status code distribution"
              description="Last-attempt HTTP codes recorded in this window."
              help="Each bar is an exact response code from the last attempt of each completed run. Runs that failed before a response, including script failures, are counted as No response. Codes are not inferred from run outcome."
            />
            {statusCodeData.length ? (
              <ChartContainer
                className="mt-4 aspect-auto h-[280px] w-full"
                config={{
                  value: { label: "Runs", color: "var(--primary)" },
                }}
                initialDimension={{ width: 360, height: 280 }}
              >
                <BarChart
                  data={statusCodeData}
                  layout="vertical"
                  margin={{ left: 8, right: 18, top: 4, bottom: 4 }}
                >
                  <CartesianGrid horizontal={false} />
                  <XAxis
                    allowDecimals={false}
                    type="number"
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    dataKey="label"
                    type="category"
                    width={88}
                    tickLine={false}
                    axisLine={false}
                  />
                  <ChartTooltip content={<ChartTooltipContent hideLabel />} />
                  <Bar dataKey="value" radius={[0, 5, 5, 0]}>
                    {statusCodeData.map((entry) => (
                      <Cell
                        key={entry.code}
                        fill={httpClassColor(entry.classKey)}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ChartContainer>
            ) : (
              <ChartEmpty
                compact
                detail="Recorded last-attempt HTTP codes will appear here for the selected window."
              />
            )}
          </section>
        </div>
      </DeferredAnalytics>

      <DeferredAnalytics minHeight={360}>
        <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1.55fr)_minmax(330px,0.75fr)]">
          <section className="rounded-xl border p-4 md:p-5">
            <ChartTitle
              title="Execution composition"
              description="Where end-to-end run time was spent."
              help="API response is the target measurement. Preparation includes local template, script, secret, and request setup. Post-processing includes extraction and assertions. Other orchestration is any remaining executor overhead. Full execution is the complete run duration. Runs without API-only timing still show execution and any recorded preparation."
            />
            {compositionData.length ? (
              <ChartContainer
                className="mt-4 aspect-auto h-[300px] w-full"
                config={compositionConfig}
                initialDimension={{ width: 760, height: 300 }}
              >
                <ComposedChart
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
                    content={
                      <ChartTooltipContent
                        labelKey="label"
                        formatter={(value, name) => (
                          <>
                            <span className="text-muted-foreground">
                              {compositionMetricLabel(String(name))}
                            </span>
                            <span className="ml-auto font-mono font-medium">
                              {value == null
                                ? "Not recorded"
                                : formatDuration(Number(value))}
                            </span>
                          </>
                        )}
                      />
                    }
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
                  <Line
                    dataKey="execution"
                    dot={false}
                    stroke="var(--color-execution)"
                    strokeWidth={1.5}
                    type="monotone"
                  />
                  <ChartLegend
                    content={<ChartLegendContent className="flex-wrap" />}
                  />
                </ComposedChart>
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
                      <ChartLegendContent nameKey="key" className="flex-wrap" />
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
            {percentileRows.length ? (
              <ChartContainer
                className="mt-4 aspect-auto h-[290px] w-full"
                config={{
                  value: { label: "Response time", color: "var(--primary)" },
                }}
                initialDimension={{ width: 700, height: 290 }}
              >
                <BarChart
                  data={percentileRows.map(([name, value]) => ({ name, value }))}
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
            <FailureCategories categories={metrics.failureCategories ?? {}} />
          </section>
        </div>
      </DeferredAnalytics>

      <section className="mt-8 [contain-intrinsic-size:auto_760px] [content-visibility:auto]">
        <ChartTitle
          title="Latest executions"
          description="Newest first within the selected window. Open any run for step, attempt, network, check, and failure evidence."
          help="API response excludes Rhythm preparation and post-processing. Execution is the complete run duration. A spike is evaluated against earlier rolling history, not future runs. Charts and availability use the full time window, not only the rows loaded below."
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
          <>
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
            <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-muted-foreground">
                Showing {runs.length} of {runsTotal || runs.length} executions
                in {window}. Charts and summaries use every run in this window.
              </p>
              {runsHasMore ? (
                <Button
                  disabled={runsLoadingMore}
                  onClick={onLoadMoreRuns}
                  size="sm"
                  variant="outline"
                >
                  {runsLoadingMore ? (
                    <LoaderCircle className="size-3.5 animate-spin" />
                  ) : null}
                  Load older runs
                </Button>
              ) : null}
            </div>
          </>
        )}
      </section>
    </div>
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
        <InfoHint title={label}>{help}</InfoHint>
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
      <InfoHint title={title}>{help}</InfoHint>
    </div>
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
        <InfoHint className="size-5" title={label}>
          {help}
        </InfoHint>
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
  const apiResponse = metric?.apiResponseTimeMs ?? run.apiResponseTimeMs
  const preparation = metric?.preparationMs ?? run.preparationMs
  const execution = metric?.executionDurationMs ?? run.durationMs
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
          active
            ? "In progress"
            : apiResponse === undefined
              ? "Not recorded"
              : formatDuration(apiResponse)
        }
      />
      <LabeledValue
        label="Execution"
        value={active ? "In progress" : formatDuration(execution)}
      />
      <LabeledValue
        label="Preparation"
        value={
          active
            ? "—"
            : preparation === undefined
              ? "Not recorded"
              : formatDuration(preparation)
        }
      />
      <span
        className={
          metric?.spike
            ? "flex w-fit items-center gap-1 text-xs font-medium text-destructive"
            : "text-xs text-muted-foreground"
        }
        title={
          apiResponse === undefined && !active
            ? "No target-facing HTTP timing was recorded for this run."
            : undefined
        }
      >
        {metric?.spike ? (
          <>
            <TriangleAlert className="size-3.5" /> Spike
          </>
        ) : apiResponse === undefined && !active ? (
          "Not recorded"
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

function ChartEmpty({
  compact = false,
  detail = "New runs will populate this chart with API-only timing.",
}: {
  compact?: boolean
  detail?: string
}) {
  return (
    <div
      className={`mt-4 grid place-items-center rounded-lg border border-dashed text-center ${compact ? "min-h-48" : "min-h-72"}`}
    >
      <div>
        <Activity className="mx-auto size-6 text-muted-foreground" />
        <p className="mt-3 text-sm font-medium">Not enough measured history</p>
        <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
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
  const status = metrics.statusDistribution ?? {}
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

function buildStatusTimeData(
  points: RunMetricPointContract[],
  window: MetricsWindow
) {
  return points.map((point) => {
    const counts = point.bucketCounts
    const success =
      counts?.success ??
      (point.status === "SUCCESS" || point.status === "SUCCESS_WITH_WARNINGS"
        ? 1
        : 0)
    const failed =
      counts?.failed ??
      (point.status === "FAILED" || point.status === "ABORTED" ? 1 : 0)
    const timeout = counts?.timeout ?? (point.status === "TIMED_OUT" ? 1 : 0)
    return {
      label: chartTime(point.createdAt, window),
      apiResponseTimeMs: point.apiResponseTimeMs,
      statusClass: httpStatusClass(point),
      success,
      failed,
      timeout,
      class1xx: counts?.class1xx ?? 0,
      class2xx: counts?.class2xx ?? 0,
      class3xx: counts?.class3xx ?? 0,
      class4xx: counts?.class4xx ?? 0,
      class5xx: counts?.class5xx ?? 0,
      httpTimeout: counts?.httpTimeout ?? 0,
      noResponse: counts?.noResponse ?? 0,
    }
  })
}

function buildStatusCodeData(metrics: RunHistoryMetricsContract) {
  return Object.entries(metrics.responseStatusDistribution ?? {})
    .map(([code, value]) => ({
      code,
      label: code === "NO_RESPONSE" ? "No response" : code,
      value,
      classKey: statusCodeClassKey(code),
    }))
    .filter((entry) => entry.value > 0)
    .sort((a, b) => b.value - a.value)
}

function httpStatusClass(point: RunMetricPointContract) {
  if (typeof point.responseStatus === "number" && point.responseStatus > 0) {
    return `${Math.floor(point.responseStatus / 100)}xx`
  }
  if (point.status === "TIMED_OUT") return "timeout"
  return "no_response"
}

function statusCodeClassKey(code: string) {
  if (code === "NO_RESPONSE") return "no_response"
  const parsed = Number(code)
  if (!Number.isFinite(parsed) || parsed < 100) return "no_response"
  return `${Math.floor(parsed / 100)}xx`
}

function httpClassColor(classKey: string) {
  switch (classKey) {
    case "1xx":
      return "var(--chart-3)"
    case "2xx":
      return "var(--success, #16a34a)"
    case "3xx":
      return "var(--chart-2)"
    case "4xx":
      return "var(--warning, #d97706)"
    case "5xx":
      return "var(--destructive)"
    case "timeout":
      return "#7c3aed"
    default:
      return "var(--muted-foreground)"
  }
}

function StatusClassDot({
  cx,
  cy,
  payload,
}: {
  cx?: number
  cy?: number
  payload?: { statusClass?: string; apiResponseTimeMs?: number }
}) {
  if (cx == null || cy == null || payload?.apiResponseTimeMs == null)
    return null
  return (
    <circle
      cx={cx}
      cy={cy}
      fill={httpClassColor(payload.statusClass ?? "no_response")}
      r={3.5}
      stroke="var(--background)"
      strokeWidth={1}
    />
  )
}

function httpClassBars(
  points: Array<{
    class1xx: number
    class2xx: number
    class3xx: number
    class4xx: number
    class5xx: number
    httpTimeout: number
    noResponse: number
  }>
) {
  return (
    [
      "class1xx",
      "class2xx",
      "class3xx",
      "class4xx",
      "class5xx",
      "httpTimeout",
      "noResponse",
    ] as const
  ).filter((key) => points.some((point) => point[key] > 0))
}

function httpClassLabel(key: string) {
  return key in httpClassConfig
    ? String(httpClassConfig[key as keyof typeof httpClassConfig].label)
    : key
}

function availabilityLabel(key: string) {
  return key in availabilityConfig
    ? String(availabilityConfig[key as keyof typeof availabilityConfig].label)
    : key
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

function compositionMetricLabel(key: string) {
  return key in compositionConfig
    ? String(compositionConfig[key as keyof typeof compositionConfig].label)
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
function formatPercent(value?: number) {
  if (value === undefined || Number.isNaN(value)) return "—"
  return `${value.toFixed(value % 1 === 0 ? 0 : 1)}%`
}
function formatChange(value?: number) {
  if (value === undefined || value === 0) return "No previous change"
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}% vs previous run`
}
function chartTime(value: string | undefined, window: MetricsWindow) {
  const date = value ? new Date(value) : new Date(NaN)
  if (Number.isNaN(date.getTime())) return "—"
  if (window === "24h")
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
  const day = date.toLocaleDateString([], { month: "short", day: "numeric" })
  return window === "90d"
    ? day
    : `${day} · ${date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
}
