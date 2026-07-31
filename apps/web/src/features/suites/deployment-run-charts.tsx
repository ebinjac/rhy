import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@workspace/ui/components/chart"
import type { ChartConfig } from "@workspace/ui/components/chart"
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  XAxis,
  YAxis,
} from "recharts"

import type { DeploymentDistributionContract } from "@/lib/api-client/contracts"

const comparisonChartConfig = {
  before: {
    label: "Before",
    color: "color-mix(in oklch, var(--muted-foreground) 45%, transparent)",
  },
  after: { label: "After", color: "var(--primary)" },
} satisfies ChartConfig

export function ComparisonChart({
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

export function TimeSeriesChart({
  baseline,
  post,
}: {
  baseline: DeploymentDistributionContract
  post: DeploymentDistributionContract
}) {
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
                    | { timestamp?: string; period?: string }
                    | undefined
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
  if (!Number.isFinite(value)) return "—"
  if (value < 1000) return `${Math.round(value)} ms`
  return `${(value / 1000).toFixed(2)} s`
}

function compactLatency(value: number) {
  if (!Number.isFinite(value)) return ""
  if (value < 1000) return `${Math.round(value)}`
  return `${(value / 1000).toFixed(1)}s`
}

function formatMilliseconds(value: number | undefined) {
  if (value === undefined || !Number.isFinite(value)) return "—"
  return `${Math.round(value)} ms`
}
