import { Link } from "@tanstack/react-router"
import {
  ChartContainer,
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
  BarChart3,
  CircleAlert,
  Gauge,
  Info,
  Network,
  TriangleAlert,
} from "lucide-react"
import { CartesianGrid, Legend, Line, LineChart, XAxis, YAxis } from "recharts"

import type {
  BrowserMetrics,
  BrowserStatistics,
} from "@/lib/api-client/browser-monitoring"
import { formatDuration } from "@/features/ui-monitoring/browser-monitor-status"
import { formatDateTime } from "@/lib/format-date"

const performanceConfig = {
  journeyMs: { label: "Journey", color: "var(--primary)" },
  lcpMs: { label: "LCP", color: "var(--warning)" },
  ttfbMs: { label: "TTFB", color: "#8b5cf6" },
  tbtMs: { label: "TBT", color: "#14b8a6" },
} satisfies ChartConfig

const graphConfig = {
  value: { label: "Observed value", color: "var(--primary)" },
} satisfies ChartConfig

export default function BrowserMetricsDashboard({
  monitorId,
  metrics,
}: {
  monitorId: string
  metrics: BrowserMetrics
}) {
  const points = metrics.series.map((point) => ({
    ...point,
    label: chartLabel(readString(point.createdAt)),
  }))
  const graphPoints = metrics.graphSeries.map((point) => ({
    ...point,
    label: chartLabel(readString(point.createdAt)),
  }))
  const allDistributions: Array<
    [string, BrowserStatistics | null | undefined]
  > = [
    ["Journey", metrics.journey],
    ["TTFB", metrics.metricDistributions.ttfbMs],
    ["FCP", metrics.metricDistributions.fcpMs],
    ["LCP", metrics.metricDistributions.lcpMs],
    ["TBT", metrics.metricDistributions.tbtMs],
    ["Interaction", metrics.metricDistributions.interactionMs],
  ]
  const distributions = allDistributions.filter(
    (entry): entry is [string, BrowserStatistics] =>
      Boolean(entry[1] && entry[1].sampleCount > 0)
  )

  return (
    <TooltipProvider>
      <div>
        {metrics.runCount > 0 && metrics.runCount < 20 ? (
          <div className="mt-5 flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/5 px-3 py-2.5 text-sm">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" />
            <p>
              Percentiles are based on {metrics.runCount} compatible run
              {metrics.runCount === 1 ? "" : "s"}. Tail values will stabilize as
              the same browser, viewport, and execution profile build history.
            </p>
          </div>
        ) : null}

        <section
          aria-label="UI performance summary"
          className="mt-6 grid overflow-hidden rounded-xl border sm:grid-cols-2 xl:grid-cols-4"
        >
          <MetricCard
            help="Percentage of terminal browser runs that completed successfully or with warnings."
            icon={Activity}
            label="Journey success"
            value={
              metrics.runCount
                ? `${metrics.successRate.toFixed(1)}%`
                : "Not recorded"
            }
          />
          <MetricCard
            detail={`Average ${formatDuration(metrics.journey.averageMs)}`}
            help="Half of complete browser journeys finished at or below this duration."
            icon={Gauge}
            label="Journey p50"
            value={formatDuration(metrics.journey.p50Ms)}
          />
          <MetricCard
            detail={`${metrics.journey.sampleCount} measured runs`}
            help="95% of complete browser journeys finished at or below this value. Use p95 to understand the slow tail."
            icon={Gauge}
            label="Journey p95"
            value={formatDuration(metrics.journey.p95Ms)}
          />
          <MetricCard
            detail="JavaScript, network, browser, and checkpoint outcomes"
            help="Terminal executions that did not complete successfully."
            icon={CircleAlert}
            label="Failure rate"
            value={
              metrics.runCount
                ? `${metrics.failureRate.toFixed(1)}%`
                : "Not recorded"
            }
          />
        </section>

        {points.length ? (
          <section
            className="mt-6 rounded-xl border p-4 md:p-5"
            aria-labelledby="performance-trend-title"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="font-semibold" id="performance-trend-title">
                  Browser performance over time
                </h2>
                <p className="mt-1 text-xs/5 text-muted-foreground">
                  Controlled synthetic journey and page milestones. Chart points
                  link to the exact execution.
                </p>
              </div>
              <InfoTooltip text="Lab measurements can differ from real-user field data. TBT is a lab responsiveness proxy and is not field INP." />
            </div>
            <ChartContainer
              className="mt-5 h-[310px] w-full"
              config={performanceConfig}
            >
              <LineChart accessibilityLayer data={points}>
                <CartesianGrid vertical={false} />
                <XAxis
                  axisLine={false}
                  dataKey="label"
                  minTickGap={24}
                  tickLine={false}
                />
                <YAxis
                  axisLine={false}
                  tickFormatter={(value) => `${value} ms`}
                  tickLine={false}
                  width={68}
                />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Legend />
                <Line
                  dataKey="journeyMs"
                  dot={false}
                  stroke="var(--color-journeyMs)"
                  strokeWidth={2}
                  type="monotone"
                />
                <Line
                  dataKey="lcpMs"
                  dot={false}
                  stroke="var(--color-lcpMs)"
                  strokeWidth={1.5}
                  type="monotone"
                />
                <Line
                  dataKey="ttfbMs"
                  dot={false}
                  stroke="var(--color-ttfbMs)"
                  strokeWidth={1.5}
                  type="monotone"
                />
                <Line
                  dataKey="tbtMs"
                  dot={false}
                  stroke="var(--color-tbtMs)"
                  strokeWidth={1.5}
                  type="monotone"
                />
              </LineChart>
            </ChartContainer>
            <AccessiblePerformanceTable monitorId={monitorId} points={points} />
          </section>
        ) : (
          <EmptyMetrics />
        )}

        {distributions.length ? (
          <section className="mt-6" aria-labelledby="distribution-title">
            <div>
              <h2 className="text-lg font-semibold" id="distribution-title">
                Performance distributions
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Compare the typical experience with tail latency for each
                browser milestone.
              </p>
            </div>
            <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {distributions.map(([name, stats]) => (
                <DistributionCard key={name} name={name} stats={stats} />
              ))}
            </div>
          </section>
        ) : null}

        {graphPoints.length ? (
          <section
            className="mt-6 rounded-xl border p-4 md:p-5"
            aria-labelledby="graph-trend-title"
          >
            <div className="flex items-start gap-3">
              <BarChart3 className="mt-0.5 size-5 text-primary" />
              <div>
                <h2 className="font-semibold" id="graph-trend-title">
                  Graph and KPI trends
                </h2>
                <p className="mt-1 text-xs/5 text-muted-foreground">
                  Normalized numeric evidence only; unrestricted upstream
                  responses are not retained.
                </p>
              </div>
            </div>
            <ChartContainer
              className="mt-5 h-[260px] w-full"
              config={graphConfig}
            >
              <LineChart accessibilityLayer data={graphPoints}>
                <CartesianGrid vertical={false} />
                <XAxis
                  axisLine={false}
                  dataKey="label"
                  minTickGap={24}
                  tickLine={false}
                />
                <YAxis axisLine={false} tickLine={false} width={60} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Line
                  dataKey="value"
                  dot
                  stroke="var(--color-value)"
                  strokeWidth={2}
                  type="monotone"
                />
              </LineChart>
            </ChartContainer>
          </section>
        ) : null}

        {Object.keys(metrics.failureCategories).length ? (
          <section className="mt-6" aria-labelledby="failures-title">
            <h2 className="text-lg font-semibold" id="failures-title">
              Failure categories
            </h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {Object.entries(metrics.failureCategories)
                .sort((left, right) => right[1] - left[1])
                .map(([category, count]) => (
                  <div className="rounded-xl border p-4" key={category}>
                    <div className="flex items-center justify-between gap-3">
                      <Network className="size-4 text-destructive" />
                      <span className="text-xl font-semibold tabular-nums">
                        {count}
                      </span>
                    </div>
                    <p className="mt-3 text-sm font-medium">
                      {category.toLowerCase().replaceAll("_", " ")}
                    </p>
                  </div>
                ))}
            </div>
          </section>
        ) : null}
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
  detail?: string
  help: string
}) {
  return (
    <div className="border-b p-4 last:border-b-0 sm:nth-[odd]:border-r xl:border-r xl:border-b-0 xl:last:border-r-0">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Icon className="size-4 text-primary" />
          {label}
        </div>
        <InfoTooltip text={help} />
      </div>
      <p className="mt-3 text-2xl font-semibold tabular-nums">{value}</p>
      {detail ? (
        <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
      ) : null}
    </div>
  )
}

function DistributionCard({
  name,
  stats,
}: {
  name: string
  stats: BrowserStatistics
}) {
  return (
    <article className="rounded-xl border p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="font-medium">{name}</p>
        <span className="text-xs text-muted-foreground">
          n={stats.sampleCount}
        </span>
      </div>
      <dl className="mt-4 grid grid-cols-3 gap-3 text-sm">
        <Stat label="p50" value={formatDuration(stats.p50Ms)} />
        <Stat label="p95" value={formatDuration(stats.p95Ms)} />
        <Stat label="p99" value={formatDuration(stats.p99Ms)} />
        <Stat label="Average" value={formatDuration(stats.averageMs)} />
        <Stat label="Minimum" value={formatDuration(stats.minimumMs)} />
        <Stat label="Maximum" value={formatDuration(stats.maximumMs)} />
      </dl>
      <p className="mt-4 border-t pt-3 text-xs text-muted-foreground">
        Standard deviation {formatDuration(stats.standardDeviation)}
      </p>
    </article>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 font-medium tabular-nums">{value}</dd>
    </div>
  )
}

function AccessiblePerformanceTable({
  monitorId,
  points,
}: {
  monitorId: string
  points: Array<Record<string, unknown>>
}) {
  return (
    <details className="mt-4 rounded-lg border">
      <summary className="cursor-pointer px-3 py-2 text-sm font-medium">
        Accessible performance data
      </summary>
      <div className="overflow-x-auto border-t">
        <table className="w-full min-w-[42rem] text-sm">
          <thead className="bg-muted/30 text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Execution</th>
              <th className="px-3 py-2 font-medium">Time</th>
              <th className="px-3 py-2 font-medium">Journey</th>
              <th className="px-3 py-2 font-medium">TTFB</th>
              <th className="px-3 py-2 font-medium">LCP</th>
              <th className="px-3 py-2 font-medium">TBT</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {points.map((point) => (
              <tr key={readString(point.runId)}>
                <td className="px-3 py-2">
                  <Link
                    className="font-mono text-xs text-primary hover:underline"
                    params={{
                      monitorId,
                      runId: readString(point.runId),
                    }}
                    to="/ui-monitoring/$monitorId/runs/$runId"
                  >
                    {readString(point.runId).slice(0, 8)}
                  </Link>
                </td>
                <td className="px-3 py-2">
                  {formatDateTime(readString(point.createdAt))}
                </td>
                <td className="px-3 py-2">
                  {formatDuration(readNumber(point.journeyMs))}
                </td>
                <td className="px-3 py-2">
                  {formatDuration(readNumber(point.ttfbMs))}
                </td>
                <td className="px-3 py-2">
                  {formatDuration(readNumber(point.lcpMs))}
                </td>
                <td className="px-3 py-2">
                  {formatDuration(readNumber(point.tbtMs))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  )
}

function InfoTooltip({ text }: { text: string }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            aria-label="Explain this metric"
            className="flex size-7 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            type="button"
          />
        }
      >
        <Info className="size-3.5" />
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">{text}</TooltipContent>
    </Tooltip>
  )
}

function EmptyMetrics() {
  return (
    <section className="mt-6 flex min-h-64 flex-col items-center justify-center rounded-xl border border-dashed px-6 text-center">
      <Activity className="size-6 text-primary" />
      <h2 className="mt-3 font-semibold">No compatible measurements yet</h2>
      <p className="mt-1 max-w-md text-sm text-muted-foreground">
        Complete a browser run to establish controlled synthetic page and
        journey timing. Missing measurements remain “Not recorded”; they are
        never shown as zero.
      </p>
    </section>
  )
}

function chartLabel(value: string) {
  if (!value) return ""
  const date = new Date(value)
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

function readString(value: unknown) {
  return typeof value === "string" ? value : ""
}

function readNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}
