import { createFileRoute, Link } from "@tanstack/react-router"
import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { Button } from "@workspace/ui/components/button"
import { ArrowLeft, History, LoaderCircle, RefreshCw } from "lucide-react"
import { lazy, Suspense } from "react"

import type {
  RunContract,
  RunHistoryMetricsContract,
} from "@/lib/api-client/contracts"
import {
  getMonitorMetricSeries,
  getMonitorMetricsSummary,
  listMonitorRuns,
} from "@/lib/api-client/monitors"

import type { MetricsWindow } from "@/features/monitors/monitor-metrics-dashboard"
import { MetricsSkeleton } from "@/components/metrics-skeleton"
import { PageContainer } from "@/components/page-container"
import { ProductQueryProvider } from "@/components/product-query-provider"

const windows = ["24h", "7d", "30d", "90d"] as const
const MonitorMetricsDashboard = lazy(
  () => import("@/features/monitors/monitor-metrics-dashboard")
)

type MetricsData = {
  metrics: RunHistoryMetricsContract
  runs: RunContract[]
  window: MetricsWindow
  complete: boolean
}

async function loadMetricsSummary(
  monitorId: string,
  window: MetricsWindow
): Promise<MetricsData> {
  const metrics = await getMonitorMetricsSummary({
    data: { monitorId, window },
  })
  return { runs: [], metrics, window, complete: false }
}

async function loadMetricsDetails(
  monitorId: string,
  window: MetricsWindow,
  summary?: RunHistoryMetricsContract
): Promise<MetricsData> {
  const [runs, points] = await Promise.all([
    listMonitorRuns({ data: { monitorId } }),
    getMonitorMetricSeries({ data: { monitorId, window, maxPoints: 400 } }),
  ])
  const metrics =
    summary ??
    (await getMonitorMetricsSummary({ data: { monitorId, window } }))
  return { runs, metrics: { ...metrics, points }, window, complete: true }
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
  loader: async ({ params, location }) => {
    const search = location.search as { window?: MetricsWindow }
    const window = search.window ?? "30d"
    return loadMetricsSummary(params.monitorId, window)
  },
  component: MonitorMetricsPage,
})

function MonitorMetricsPage() {
  return (
    <ProductQueryProvider>
      <MonitorMetricsContent />
    </ProductQueryProvider>
  )
}

function MonitorMetricsContent() {
  const initial = Route.useLoaderData()
  const { monitorId } = Route.useParams()
  const { window: selectedWindow } = Route.useSearch()
  const window = selectedWindow ?? "30d"
  const navigate = Route.useNavigate()
  const query = useQuery({
    queryKey: ["monitor-metrics", monitorId, window],
    queryFn: () =>
      loadMetricsDetails(
        monitorId,
        window,
        initial.window === window ? initial.metrics : undefined
      ),
    initialData: initial.window === window ? initial : undefined,
    // The route loader intentionally returns summary-only data so the page can
    // paint before run history and chart series arrive. Mark that partial
    // snapshot stale immediately; otherwise React Query's stale window would
    // suppress the detail request and render a misleading empty run history.
    initialDataUpdatedAt: initial.window === window ? 0 : undefined,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  })
  const data = query.data ?? initial
  const loading = query.isFetching
  const error =
    query.error instanceof Error
      ? query.error.message
      : query.error
        ? "Run analytics could not be loaded."
        : ""

  function retry() {
    void query.refetch()
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
            {loading ? (
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

      {error && data.window !== window && !loading ? (
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-warning/30 bg-warning/5 px-4 py-3 text-sm">
          <span>
            {`${window} analytics could not be loaded. Showing ${data.window}.`}
          </span>
          <Button onClick={retry} size="sm" variant="outline">
            <RefreshCw /> Retry
          </Button>
        </div>
      ) : null}
      {error && data.window === window ? (
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-warning/30 bg-warning/5 px-4 py-3 text-sm">
          <span>Refresh failed. Showing the last loaded analytics.</span>
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
    </PageContainer>
  )
}
