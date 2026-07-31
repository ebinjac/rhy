import { lazy, Suspense, useEffect, useRef, useState } from "react"
import { createFileRoute } from "@tanstack/react-router"
import { Button } from "@workspace/ui/components/button"
import { AlertCircle, LoaderCircle, RefreshCw } from "lucide-react"

import { MetricsSkeleton } from "@/components/metrics-skeleton"
import { PageContainer } from "@/components/page-container"
import type { BrowserMetrics } from "@/lib/api-client/browser-monitoring"
import { getBrowserMetrics } from "@/lib/api-client/browser-monitoring"

const BrowserMetricsDashboard = lazy(
  () => import("@/features/ui-monitoring/browser-metrics-dashboard")
)
const windows = ["24h", "7d", "30d", "90d"] as const
type MetricsWindow = (typeof windows)[number]

export const Route = createFileRoute("/ui-monitoring/$monitorId/metrics")({
  validateSearch: (search: Record<string, unknown>) => ({
    ...(windows.includes(search.window as MetricsWindow)
      ? { window: search.window as MetricsWindow }
      : {}),
  }),
  loader: async ({ params, location }) => {
    const search = location.search as { window?: MetricsWindow }
    const window = search.window ?? "30d"
    const metrics = await getBrowserMetrics({
      data: { monitorId: params.monitorId, range: window },
    })
    return { metrics, window }
  },
  component: BrowserMetricsPage,
})

function BrowserMetricsPage() {
  const initial = Route.useLoaderData()
  const { monitorId } = Route.useParams()
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const window = search.window ?? "30d"
  const cache = useRef(new Map<string, BrowserMetrics>())
  const [metrics, setMetrics] = useState(initial.metrics)
  const [displayedWindow, setDisplayedWindow] = useState(initial.window)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [retryKey, setRetryKey] = useState(0)

  useEffect(() => {
    cache.current.set(`${monitorId}:${initial.window}`, initial.metrics)
    setMetrics(initial.metrics)
    setDisplayedWindow(initial.window)
    setError("")
    setLoading(false)
  }, [initial, monitorId])

  useEffect(() => {
    let active = true
    const key = `${monitorId}:${window}`
    const cached = cache.current.get(key)
    if (cached && retryKey === 0) {
      setMetrics(cached)
      setDisplayedWindow(window)
      setLoading(false)
      setError("")
      return () => {
        active = false
      }
    }

    setLoading(true)
    setError("")
    void getBrowserMetrics({ data: { monitorId, range: window } })
      .then((result) => {
        if (!active) return
        cache.current.set(key, result)
        setMetrics(result)
        setDisplayedWindow(window)
        setLoading(false)
      })
      .catch((reason: unknown) => {
        if (!active) return
        setError(
          reason instanceof Error
            ? reason.message
            : "Browser metrics could not be loaded."
        )
        setLoading(false)
      })
    return () => {
      active = false
    }
  }, [monitorId, retryKey, window])

  function retry() {
    cache.current.delete(`${monitorId}:${window}`)
    setRetryKey((value) => value + 1)
  }

  return (
    <PageContainer as="main">
      <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-end">
        <div>
          <h1 className="text-2xl font-semibold">UI performance analytics</h1>
          <p className="mt-1 max-w-2xl text-sm/6 text-muted-foreground">
            Journey percentiles, page milestones, browser errors, graph trends,
            and exact-run spike investigation for a controlled synthetic
            profile.
          </p>
        </div>
        <div className="flex flex-col items-start gap-2 sm:items-end">
          <div className="h-5 text-xs text-muted-foreground">
            {loading ? (
              <span className="inline-flex items-center gap-1.5">
                <LoaderCircle className="size-3.5 animate-spin text-primary motion-reduce:animate-none" />
                Loading {window} · showing {displayedWindow}
              </span>
            ) : (
              "Browser and viewport-specific history"
            )}
          </div>
          <div
            aria-label="Metrics time range"
            className="inline-flex rounded-lg border bg-muted/30 p-1"
          >
            {windows.map((item) => (
              <Button
                aria-pressed={window === item}
                className="h-8 px-3 text-xs"
                key={item}
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
          ? "Loading UI performance analytics."
          : error
            ? "UI performance analytics failed to load."
            : "UI performance analytics loaded."}
      </div>

      {error && !metrics ? (
        <div className="mt-6 flex min-h-64 flex-col items-center justify-center rounded-xl border border-destructive/30 px-6 text-center">
          <AlertCircle className="size-6 text-destructive" />
          <h2 className="mt-3 font-semibold">Metrics could not be loaded</h2>
          <p className="mt-1 max-w-md text-sm text-muted-foreground">{error}</p>
          <Button className="mt-4" onClick={retry} variant="outline">
            <RefreshCw />
            Retry
          </Button>
        </div>
      ) : (
        <>
          {error ? (
            <div className="mt-5 flex items-center justify-between gap-3 rounded-lg border border-warning/30 bg-warning/5 px-4 py-3 text-sm">
              <span>
                Refresh failed. Showing the last loaded {displayedWindow}{" "}
                evidence.
              </span>
              <Button onClick={retry} size="sm" variant="outline">
                <RefreshCw />
                Retry
              </Button>
            </div>
          ) : null}
          <div
            aria-busy={loading}
            className={loading ? "opacity-70 transition-opacity" : undefined}
          >
            <Suspense fallback={<MetricsSkeleton chartsOnly />}>
              <BrowserMetricsDashboard
                metrics={metrics}
                monitorId={monitorId}
              />
            </Suspense>
          </div>
        </>
      )}
    </PageContainer>
  )
}
