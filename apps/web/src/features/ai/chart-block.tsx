import { useEffect, useMemo, useState } from "react"
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@workspace/ui/components/chart"
import type { ChartConfig } from "@workspace/ui/components/chart"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@workspace/ui/components/table"
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  XAxis,
  YAxis,
} from "recharts"

import { formatDateTime } from "@/lib/format-date"
import { cn } from "@workspace/ui/lib/utils"

import type { ChartSpec } from "./message-blocks"

const PALETTE = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
]

export function AssistantChart({ spec }: { spec: ChartSpec }) {
  const [open, setOpen] = useState(false)
  const reduceMotion = usePrefersReducedMotion()
  const colors = useMemo(
    () =>
      spec.series.map((series, index) => ({
        ...series,
        color: PALETTE[index % PALETTE.length],
      })),
    [spec.series]
  )
  const config = useMemo(() => {
    if (spec.type === "pie") {
      return Object.fromEntries(
        spec.data.map((row, index) => {
          const name = String(row[spec.xKey] ?? `slice-${index}`)
          return [name, { label: name, color: PALETTE[index % PALETTE.length] }]
        })
      ) satisfies ChartConfig
    }
    return Object.fromEntries(
      colors.map((series) => [
        series.key,
        { label: series.label, color: series.color },
      ])
    ) satisfies ChartConfig
  }, [colors, spec])
  const pieData = useMemo(() => {
    if (spec.type !== "pie") return []
    const key = spec.series[0]?.key
    if (!key) return []
    return spec.data.map((row, index) => ({
      name: String(row[spec.xKey] ?? ""),
      value: Number(row[key] ?? 0),
      fill: PALETTE[index % PALETTE.length],
    }))
  }, [spec])

  return (
    <figure className="not-typeset my-4 overflow-hidden rounded-xl border bg-background motion-safe:transition-opacity motion-safe:duration-500 motion-safe:starting:opacity-0">
      <figcaption className="border-b px-4 py-3">
        <p className="font-heading text-sm font-semibold tracking-tight">
          {spec.title}
        </p>
        {spec.description ? (
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            {spec.description}
          </p>
        ) : null}
      </figcaption>
      <ChartContainer
        className="aspect-auto h-[280px] w-full px-2 pt-3 pb-1"
        config={config}
        initialDimension={{ width: 720, height: 280 }}
      >
        {spec.type === "bar" ? (
          <BarChart data={spec.data} margin={{ left: 8, right: 8, top: 8 }}>
            <CartesianGrid vertical={false} />
            <XAxis
              axisLine={false}
              dataKey={spec.xKey}
              minTickGap={24}
              tickFormatter={formatTick}
              tickLine={false}
            />
            <YAxis
              axisLine={false}
              tickFormatter={(value) => formatNumber(value, spec.unit, true)}
              tickLine={false}
              width={52}
            />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  formatter={(value, name) => (
                    <TooltipValues
                      label={seriesLabel(spec, String(name))}
                      unit={spec.unit}
                      value={value}
                    />
                  )}
                />
              }
            />
            <ChartLegend content={<ChartLegendContent />} />
            {colors.map((series) => (
              <Bar
                dataKey={series.key}
                fill={`var(--color-${series.key})`}
                isAnimationActive={!reduceMotion}
                key={series.key}
                maxBarSize={42}
                radius={[6, 6, 0, 0]}
              />
            ))}
          </BarChart>
        ) : spec.type === "pie" ? (
          <PieChart>
            <ChartTooltip
              content={
                <ChartTooltipContent
                  formatter={(value, name) => (
                    <TooltipValues
                      label={String(name)}
                      unit={spec.unit}
                      value={value}
                    />
                  )}
                  hideLabel
                />
              }
            />
            <ChartLegend content={<ChartLegendContent nameKey="name" />} />
            <Pie
              cx="50%"
              cy="50%"
              data={pieData}
              dataKey="value"
              innerRadius={52}
              isAnimationActive={!reduceMotion}
              nameKey="name"
              outerRadius={88}
              paddingAngle={2}
              stroke="var(--background)"
              strokeWidth={2}
            >
              {pieData.map((entry) => (
                <Cell fill={entry.fill} key={entry.name} />
              ))}
            </Pie>
          </PieChart>
        ) : spec.type === "area" ? (
          <AreaChart data={spec.data} margin={{ left: 8, right: 8, top: 8 }}>
            <CartesianGrid vertical={false} />
            <XAxis
              axisLine={false}
              dataKey={spec.xKey}
              minTickGap={28}
              tickFormatter={formatTick}
              tickLine={false}
            />
            <YAxis
              axisLine={false}
              tickFormatter={(value) => formatNumber(value, spec.unit, true)}
              tickLine={false}
              width={52}
            />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  formatter={(value, name) => (
                    <TooltipValues
                      label={seriesLabel(spec, String(name))}
                      unit={spec.unit}
                      value={value}
                    />
                  )}
                />
              }
            />
            <ChartLegend content={<ChartLegendContent />} />
            {colors.map((series) => (
              <Area
                dataKey={series.key}
                fill={`var(--color-${series.key})`}
                fillOpacity={0.18}
                isAnimationActive={!reduceMotion}
                key={series.key}
                stroke={`var(--color-${series.key})`}
                strokeWidth={2}
                type="monotone"
              />
            ))}
          </AreaChart>
        ) : (
          <LineChart data={spec.data} margin={{ left: 8, right: 8, top: 8 }}>
            <CartesianGrid vertical={false} />
            <XAxis
              axisLine={false}
              dataKey={spec.xKey}
              minTickGap={28}
              tickFormatter={formatTick}
              tickLine={false}
            />
            <YAxis
              axisLine={false}
              tickFormatter={(value) => formatNumber(value, spec.unit, true)}
              tickLine={false}
              width={52}
            />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  formatter={(value, name) => (
                    <TooltipValues
                      label={seriesLabel(spec, String(name))}
                      unit={spec.unit}
                      value={value}
                    />
                  )}
                />
              }
            />
            <ChartLegend content={<ChartLegendContent />} />
            {colors.map((series) => (
              <Line
                dataKey={series.key}
                dot={false}
                isAnimationActive={!reduceMotion}
                key={series.key}
                stroke={`var(--color-${series.key})`}
                strokeWidth={2}
                type="monotone"
              />
            ))}
          </LineChart>
        )}
      </ChartContainer>
      <details
        className="border-t"
        onToggle={(event) =>
          setOpen((event.currentTarget as HTMLDetailsElement).open)
        }
        open={open}
      >
        <summary className="cursor-pointer px-4 py-2.5 text-xs font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
          {open ? "Hide" : "View"} accessible chart data
        </summary>
        <div className="max-h-64 overflow-auto border-t">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{spec.xKey}</TableHead>
                {spec.series.map((series) => (
                  <TableHead key={series.key}>{series.label}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {spec.data.map((row, index) => (
                <TableRow key={`${row[spec.xKey]}-${index}`}>
                  <TableCell>{formatTick(row[spec.xKey])}</TableCell>
                  {spec.series.map((series) => (
                    <TableCell className="tabular-nums" key={series.key}>
                      {formatNumber(row[series.key], spec.unit)}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </details>
    </figure>
  )
}

function TooltipValues({
  label,
  unit,
  value,
}: {
  label: string
  unit?: string
  value: unknown
}) {
  return (
    <>
      <span className="text-muted-foreground">{label}</span>
      <span className="ml-auto font-mono font-medium tabular-nums">
        {formatNumber(value, unit)}
      </span>
    </>
  )
}

function seriesLabel(spec: ChartSpec, key: string) {
  return spec.series.find((series) => series.key === key)?.label ?? key
}

function formatTick(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value.toLocaleString()
  }
  const text = String(value ?? "")
  const timestamp = Date.parse(text)
  if (!Number.isNaN(timestamp) && /\d{4}-\d{2}-\d{2}|T\d{2}:/.test(text)) {
    return formatDateTime(new Date(timestamp))
  }
  return text
}

function formatNumber(value: unknown, unit?: string, compact = false) {
  const numeric = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(numeric)) return "—"
  const normalized = unit?.toLowerCase()
  if (normalized === "ms" || normalized === "milliseconds") {
    if (numeric >= 1000) {
      const seconds = numeric / 1000
      return `${seconds.toFixed(compact ? 1 : seconds >= 10 ? 1 : 2)} s`
    }
    return compact ? `${Math.round(numeric)}ms` : `${Math.round(numeric).toLocaleString()} ms`
  }
  if (normalized === "%" || normalized === "percent") {
    return `${numeric.toFixed(numeric % 1 === 0 ? 0 : 1)}%`
  }
  if (compact && Math.abs(numeric) >= 1000) {
    return Intl.NumberFormat(undefined, {
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(numeric)
  }
  return numeric.toLocaleString()
}

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)")
    const sync = () => setReduced(media.matches)
    sync()
    media.addEventListener("change", sync)
    return () => media.removeEventListener("change", sync)
  }, [])
  return reduced
}

export function AssistantStats({
  items,
}: {
  items: { label: string; value: string; hint?: string; tone?: string }[]
}) {
  return (
    <div
      className={cn(
        "not-typeset my-4 grid gap-px overflow-hidden rounded-xl border bg-border",
        items.length > 1 ? "sm:grid-cols-2" : "grid-cols-1",
        items.length > 2 ? "lg:grid-cols-3" : ""
      )}
    >
      {items.map((item) => (
        <div className="bg-background px-4 py-3" key={item.label}>
          <p className="text-xs text-muted-foreground">{item.label}</p>
          <p
            className={cn(
              "mt-1 font-heading text-lg font-semibold tracking-tight tabular-nums",
              item.tone === "success" && "text-success-foreground",
              item.tone === "warning" && "text-warning-foreground",
              item.tone === "destructive" && "text-destructive"
            )}
          >
            {item.value}
          </p>
          {item.hint ? (
            <p className="mt-1 text-xs text-muted-foreground">{item.hint}</p>
          ) : null}
        </div>
      ))}
    </div>
  )
}
