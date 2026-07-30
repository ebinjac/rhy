import { createFileRoute, Link } from "@tanstack/react-router"
import { Button } from "@workspace/ui/components/button"
import {
  AlertCircle,
  ArrowLeft,
  History,
  LoaderCircle,
  RefreshCw,
} from "lucide-react"
import { lazy, Suspense, useEffect, useRef, useState } from "react"

import type {
  RunContract,
  RunHistoryMetricsContract,
} from "@/lib/api-client/contracts"
import { getMonitorMetrics, listMonitorRuns } from "@/lib/api-client/monitors"

import type { MetricsWindow } from "@/features/monitors/monitor-metrics-dashboard"
import { PageContainer } from "@/components/page-container"

const windows = ["24h", "7d", "30d", "90d"] as const
const MonitorMetricsDashboard = lazy(
  () => import("@/features/monitors/monitor-metrics-dashboard")
)

type MetricsData = {
  metrics: RunHistoryMetricsContract
  runs: RunContract[]
  window: MetricsWindow
}

export const Route = createFileRoute("/monitors/$monitorId/metrics")({
  validateSearch: (
    search: Record<string, unknown>
  ): { window?: MetricsWindow; run?: string } => {
    const validated: { window?: MetricsWindow; run?: string } = {}
    if (windows.includes(search.window as MetricsWindow))
      validated.window = search.window as MetricsWindow
    if (typeof search.run === "string") validated.run = search.run
    return validated
  },
  component: MonitorMetricsPage,
})

function MonitorMetricsPage() {
  const { monitorId } = Route.useParams()
  const { window: selectedWindow } = Route.useSearch()
  const window = selectedWindow ?? "30d"
  const navigate = Route.useNavigate()
  const cache = useRef(new Map<string, MetricsData>())
  const [data, setData] = useState<MetricsData | null>(null)
  const [error, setError] = useState("")
  const [refreshKey, setRefreshKey] = useState(0)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    const cacheKey = `${monitorId}:${window}`
    const cached = cache.current.get(cacheKey)
    if (cached) {
      setData(cached)
      setLoading(false)
      setError("")
      return () => {
        active = false
      }
    }

    setLoading(true)
    setError("")
    void Promise.all([
      listMonitorRuns({ data: { monitorId } }),
      getMonitorMetrics({ data: { monitorId, window } }),
    ])
      .then(([runs, metrics]) => {
        if (!active) return
        const next = { runs, metrics, window }
        cache.current.set(cacheKey, next)
        setData(next)
        setLoading(false)
      })
      .catch((reason: unknown) => {
        if (!active) return
        setError(
          reason instanceof Error
            ? reason.message
            : "Run analytics could not be loaded."
        )
        setLoading(false)
      })

    return () => {
      active = false
    }
  }, [monitorId, refreshKey, window])

  function retry() {
    cache.current.delete(`${monitorId}:${window}`)
    setRefreshKey((current) => current + 1)
  }

  return (
    <PageContainer>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          render={<Link to="/monitors" />}
          nativeButton={false}
          variant="ghost"
        >
          <ArrowLeft data-icon="inline-start" /> Monitors
        </Button>
        <Button
          render={
            <Link params={{ monitorId }} to="/monitors/$monitorId/runs" />
          }
          nativeButton={false}
          variant="outline"
        >
          <History data-icon="inline-start" /> Run history
        </Button>
      </div>
      <div className="mt-5 flex flex-col justify-between gap-5 lg:flex-row lg:items-end">
        <div>
          <h1 className="mt-1 font-heading text-2xl font-semibold tracking-tight">
            Run analytics
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Target response time, tail latency, reliability, spikes, and Rhythm
            execution overhead across this monitor&apos;s history.
          </p>
        </div>
        <div className="flex flex-col items-start gap-2 sm:items-end">
          <div className="flex h-5 items-center gap-2">
            {loading && data ? (
              <>
                <LoaderCircle
                  aria-hidden="true"
                  className="size-3.5 animate-spin text-primary"
                />
                <span className="text-xs text-muted-foreground">
                  {data.window === window
                    ? "Updating analytics"
                    : `Loading ${window} · showing ${data.window}`}
                </span>
              </>
            ) : (
              <span className="font-mono text-xs text-muted-foreground">
                Monitor {monitorId.slice(0, 8)}
              </span>
            )}
          </div>
          <div
            aria-label="Metrics time range"
            className="inline-flex rounded-lg border bg-muted/30 p-1"
          >
            {windows.map((item) => (
              <Button
                key={item}
                aria-pressed={window === item}
                className="h-7 px-3 text-xs"
                onClick={() => void navigate({ search: { window: item } })}
                size="sm"
                variant={window === item ? "secondary" : "ghost"}
              >
                {item}
              </Button>
            ))}
          </div>
        </div>
      </div>

      <div aria-live="polite" className="sr-only" role="status">
        {loading
          ? "Loading run analytics."
          : error
            ? "Run analytics failed to load."
            : "Run analytics loaded."}
      </div>

      {error && !data ? (
        <MetricsError message={error} onRetry={retry} />
      ) : data ? (
        <>
          {error ? (
            <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-warning/30 bg-warning/5 px-4 py-3 text-sm">
              <span>
                {data.window === window
                  ? "Refresh failed. Showing the last loaded analytics."
                  : `${window} analytics could not be loaded. Showing ${data.window}.`}
              </span>
              <Button onClick={retry} size="sm" variant="outline">
                <RefreshCw /> Retry
              </Button>
            </div>
          ) : null}
          <div
            aria-busy={loading}
            className={loading ? "opacity-70 transition-opacity" : undefined}
          >
            <Suspense fallback={<MetricsSkeleton chartsOnly />}>
              <MonitorMetricsDashboard
                metrics={data.metrics}
                monitorId={monitorId}
                runs={data.runs}
                window={data.window}
              />
            </Suspense>
          </div>
        </>
      ) : (
        <MetricsSkeleton />
      )}
    </PageContainer>
  )
}

function MetricsError({
  message,
  onRetry,
}: {
  message: string
  onRetry: () => void
}) {
  return (
    <div
      className="mt-6 flex flex-col items-start gap-4 rounded-xl border border-destructive/30 bg-destructive/5 p-5"
      role="alert"
    >
      <div className="flex items-start gap-3">
        <AlertCircle className="mt-0.5 size-5 shrink-0 text-destructive" />
        <div>
          <h2 className="font-medium">Run analytics could not be loaded</h2>
          <p className="mt-1 text-sm text-muted-foreground">{message}</p>
        </div>
      </div>
      <Button onClick={onRetry} variant="outline">
        <RefreshCw /> Try again
      </Button>
    </div>
  )
}

function MetricsSkeleton({ chartsOnly = false }: { chartsOnly?: boolean }) {
  return (
    <div aria-hidden="true" className="mt-6 animate-pulse">
      {!chartsOnly ? (
        <div className="grid overflow-hidden rounded-xl border sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, index) => (
            <div className="h-[108px] border-b p-4 lg:border-r" key={index}>
              <div className="h-3 w-24 rounded bg-muted" />
              <div className="mt-5 h-7 w-28 rounded bg-muted" />
              <div className="mt-2 h-3 w-20 rounded bg-muted" />
            </div>
          ))}
        </div>
      ) : null}
      <div className={chartsOnly ? "" : "mt-8"}>
        <div className="h-[390px] rounded-xl border p-5">
          <div className="h-4 w-44 rounded bg-muted" />
          <div className="mt-2 h-3 w-72 max-w-full rounded bg-muted" />
          <div className="mt-6 h-[300px] rounded-lg bg-muted/70" />
        </div>
        <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1.55fr)_minmax(330px,0.75fr)]">
          <div className="h-[360px] rounded-xl border bg-muted/25" />
          <div className="h-[360px] rounded-xl border bg-muted/25" />
        </div>
      </div>
    </div>
  )
}
