import { useEffect, useMemo, useState } from "react"
import { createFileRoute, Link } from "@tanstack/react-router"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { Checkbox } from "@workspace/ui/components/checkbox"
import { Input } from "@workspace/ui/components/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
import { Activity, ArrowLeft, ArrowRight, ChartNoAxesCombined, Check, CircleAlert, History, LoaderCircle } from "lucide-react"

import { HintedLabel, InfoHint } from "@/components/info-hint"
import type { RunContract } from "@/lib/api-client/contracts"
import { listMonitorRuns, type MonitorRunPage } from "@/lib/api-client/monitors"
import { formatDateTime as formatDate } from "@/lib/format-date"
import { PageContainer } from "@/components/page-container"

const PAGE_SIZE = 50

export const Route = createFileRoute("/monitors/$monitorId/runs/")({
  loader: ({ params }) =>
    listMonitorRuns({ data: { monitorId: params.monitorId, limit: PAGE_SIZE } }),
  component: MonitorRunsPage,
})

function MonitorRunsPage() {
  const initial = Route.useLoaderData()
  const { monitorId } = Route.useParams()
  const [query, setQuery] = useState("")
  const [statusFilter, setStatusFilter] = useState("")
  const [trigger, setTrigger] = useState("")
  const [page, setPage] = useState<MonitorRunPage>(initial)
  const [loadingMore, setLoadingMore] = useState(false)
  const [loadError, setLoadError] = useState("")

  useEffect(() => {
    setPage(initial)
    setLoadError("")
  }, [initial, monitorId])

  const runs = page.runs
  const statusOptions = useMemo(
    () => Array.from(new Set(runs.map((run) => run.status))),
    [runs]
  )
  const triggerOptions = useMemo(
    () => Array.from(new Set(runs.map((run) => run.triggerType))),
    [runs]
  )
  const filtered = useMemo(
    () =>
      runs.filter(
        (run) =>
          (!query || run.id.toLowerCase().includes(query.toLowerCase())) &&
          (!statusFilter || run.status === statusFilter) &&
          (!trigger || run.triggerType === trigger)
      ),
    [runs, query, statusFilter, trigger]
  )
  const completed = runs.filter((run) => !["QUEUED", "STARTING", "RUNNING"].includes(run.status))
  const successful = completed.filter((run) => run.status === "SUCCESS" || run.status === "SUCCESS_WITH_WARNINGS").length
  const averageDuration = completed.length ? Math.round(completed.reduce((sum, run) => sum + run.durationMs, 0) / completed.length) : 0
  const [compare, setCompare] = useState<Set<string>>(new Set())

  async function loadOlder() {
    if (!page.nextCursor || loadingMore) return
    setLoadingMore(true)
    setLoadError("")
    try {
      const next = await listMonitorRuns({
        data: { monitorId, limit: PAGE_SIZE, cursor: page.nextCursor },
      })
      setPage((current) => ({
        runs: [...current.runs, ...next.runs],
        total: next.total,
        nextCursor: next.nextCursor,
      }))
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Older runs could not be loaded.")
    } finally {
      setLoadingMore(false)
    }
  }

  return <PageContainer>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <Button render={<Link to="/monitors" />} nativeButton={false} variant="ghost"><ArrowLeft data-icon="inline-start" /> Monitors</Button>
      <Button render={<Link params={{ monitorId }} to="/monitors/$monitorId/metrics" />} nativeButton={false} variant="outline"><ChartNoAxesCombined data-icon="inline-start" /> Metrics</Button>
    </div>
    <div className="mt-5 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
      <div><p className="text-sm font-medium text-muted-foreground">Execution evidence</p><h1 className="mt-1 font-heading text-2xl font-semibold tracking-tight">Run history</h1><p className="mt-1 max-w-2xl text-sm text-muted-foreground">Open an execution to inspect timing, attempts, request boundaries, extractors, assertions, and failure evidence.</p></div>
      <p className="font-mono text-xs text-muted-foreground">Monitor {monitorId.slice(0, 8)}</p>
    </div>
    <section aria-label="Run summary" className="mt-7 flex flex-wrap divide-x rounded-xl border">
      <Summary icon={History} label="Recorded runs" value={String(page.total)} />
      <Summary help="Successful and successful-with-warning terminal runs divided by completed runs in this loaded set." icon={Check} label="Success rate" value={completed.length ? `${Math.round(successful / completed.length * 100)}%` : "—"} />
      <Summary help="Mean full execution time of completed runs, including Rhythm orchestration and checks." icon={Activity} label="Average execution" value={completed.length ? formatDuration(averageDuration) : "—"} />
    </section>
    <section className="mt-8"><div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-end"><div><h2 className="font-heading text-lg font-semibold">Latest executions</h2><p className="mt-0.5 text-sm text-muted-foreground">Newest first. API response excludes Rhythm orchestration and checks.</p></div><Link className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline" params={{ monitorId }} to="/monitors/$monitorId/metrics">View performance metrics <ArrowRight className="size-3.5" /></Link></div>
      <div className="mt-4 flex flex-wrap gap-2 border-y py-3">
        <Input aria-label="Search run ID" className="max-w-xs" placeholder="Search run ID" value={query} onChange={(event) => setQuery(event.target.value)} />
        <div className="w-full sm:w-52">
          <Select
            value={statusFilter || null}
            onValueChange={(value) => setStatusFilter(value ?? "")}
            items={[
              { value: null, label: "All statuses" },
              ...statusOptions.map((value) => ({ value, label: value })),
            ]}
          >
            <SelectTrigger aria-label="Filter run status" className="h-9 w-full">
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={null}>All statuses</SelectItem>
              {statusOptions.map((value) => (
                <SelectItem key={value} value={value}>
                  {value}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="w-full sm:w-52">
          <Select
            value={trigger || null}
            onValueChange={(value) => setTrigger(value ?? "")}
            items={[
              { value: null, label: "All triggers" },
              ...triggerOptions.map((value) => ({ value, label: value })),
            ]}
          >
            <SelectTrigger aria-label="Filter run trigger" className="h-9 w-full">
              <SelectValue placeholder="All triggers" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={null}>All triggers</SelectItem>
              {triggerOptions.map((value) => (
                <SelectItem key={value} value={value}>
                  {value}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      {compare.size === 2 ? <div className="mt-3 bg-primary/8 px-4 py-3 text-sm">Two executions selected. Full execution differs by {Math.abs([...compare].map((id) => runs.find((run) => run.id === id)?.durationMs ?? 0).reduce((left, right) => left - right)).toLocaleString()} ms. Open each execution for phase-level comparison.</div> : null}
      {!filtered.length ? <div className="mt-4 rounded-xl border border-dashed px-6 py-14 text-center"><History className="mx-auto size-7 text-muted-foreground" /><h3 className="mt-4 font-medium">No runs found</h3><p className="mt-1 text-sm text-muted-foreground">{page.total ? "Clear a filter or load older runs to see more executions." : "Run a draft or published revision to create execution evidence."}</p></div> : <div className="mt-4 overflow-hidden rounded-xl border"><div className="hidden grid-cols-[32px_minmax(180px,1fr)_145px_130px_120px_120px_36px] gap-4 border-b bg-muted/45 px-4 py-2.5 text-xs font-medium text-muted-foreground md:grid"><span>Compare</span><span>Started</span><span>Result</span><span>Trigger</span><HintedLabel body="Target-facing time: DNS, proxy, TCP, TLS, request write, server wait, and download. Preparation, scripts, extractors, and assertions are excluded." title="API response time">API response</HintedLabel><HintedLabel body="Wall-clock duration of the run, including Rhythm orchestration, scripts, retries, checks, and post-processing." title="Full execution time">Full execution</HintedLabel><span /></div>{filtered.map((run) => <RunRow compare={compare.has(run.id)} key={run.id} onCompare={(checked) => setCompare((current) => { const next = new Set(current); if (checked) { if (next.size >= 2) next.delete(next.values().next().value!); next.add(run.id) } else next.delete(run.id); return next })} run={run} />)}</div>}
      {page.total ? <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <span className="text-xs text-muted-foreground">{filtered.length === runs.length ? `Showing ${runs.length} of ${page.total} recorded runs` : `Showing ${filtered.length} matching of ${runs.length} loaded (${page.total} recorded)`}</span>
        {page.nextCursor ? <div className="flex flex-wrap items-center gap-2">
          {loadError ? <span className="text-xs text-destructive">{loadError}</span> : null}
          <Button disabled={loadingMore} onClick={() => void loadOlder()} size="sm" variant="outline">
            {loadingMore ? <LoaderCircle className="size-3.5 animate-spin" /> : null}
            Load older runs
          </Button>
        </div> : <span className="text-xs text-muted-foreground">All recorded runs are loaded.</span>}
      </div> : null}
    </section>
  </PageContainer>
}

function RunRow({ run, compare, onCompare }: { run: RunContract; compare: boolean; onCompare: (checked: boolean) => void }) {
  const success = run.status === "SUCCESS" || run.status === "SUCCESS_WITH_WARNINGS"
  const active = ["QUEUED", "STARTING", "RUNNING"].includes(run.status)
  const apiResponse = apiResponseDurationMs(run)
  return <div className="grid gap-3 border-b px-4 py-4 last:border-b-0 hover:bg-muted/30 md:grid-cols-[32px_minmax(180px,1fr)_145px_130px_120px_120px_36px] md:items-center md:gap-4">
    <Checkbox aria-label={`Compare run ${run.id}`} checked={compare} onCheckedChange={(checked) => onCompare(checked === true)} />
    <div><p className="text-sm font-medium">{formatDate(run.startedAt ?? run.createdAt)}</p><p className="mt-1 font-mono text-xs text-muted-foreground">{run.id.slice(0, 8)}</p></div>
    <Badge className={success ? "w-fit bg-success-soft text-success-foreground" : active ? "w-fit" : "w-fit bg-destructive/10 text-destructive"} variant="secondary">{success ? <Check /> : <CircleAlert />}{run.status.replaceAll("_", " ")}</Badge>
    <span className="text-sm text-muted-foreground">{run.triggerType.toLowerCase().replaceAll("_", " ")}</span><span className="font-mono text-sm" title={apiResponse === undefined && !active ? "No HTTP response timing was recorded for this run." : undefined}>{active ? "In progress" : apiResponse !== undefined ? formatDuration(apiResponse) : "Not recorded"}</span><span className="font-mono text-sm">{active ? "In progress" : formatDuration(run.durationMs)}</span><Link aria-label={`View diagnostics for run ${run.id}`} className="rounded focus-visible:ring-2 focus-visible:ring-ring" params={{ monitorId: run.monitorId, runId: run.id }} to="/monitors/$monitorId/runs/$runId"><ArrowRight className="size-4 text-muted-foreground" /></Link>
  </div>
}

function apiResponseDurationMs(run: RunContract): number | undefined {
  if (typeof run.apiResponseTimeMs === "number") return run.apiResponseTimeMs
  if (!run.steps?.length) return undefined
  let sum = 0
  let recorded = false
  for (const step of run.steps) {
    const value = step.timing?.apiResponseTimeMs ?? step.timing?.networkTotalMs
    if (typeof value === "number") {
      sum += value
      recorded = true
    }
  }
  return recorded ? sum : undefined
}

function Summary({ icon: Icon, label, value, help }: { icon: typeof History; label: string; value: string; help?: string }) {
  return <div className="flex min-w-56 flex-1 items-center gap-3 px-5 py-4"><span className="grid size-8 place-items-center rounded-lg bg-muted"><Icon className="size-4" /></span><div><p className="flex items-center gap-1 text-xs text-muted-foreground">{label}{help ? <InfoHint className="size-5" title={label}>{help}</InfoHint> : null}</p><p className="mt-1 font-heading text-lg font-semibold">{value}</p></div></div>
}

function formatDuration(value: number) { return value >= 1000 ? `${(value / 1000).toFixed(value >= 10000 ? 1 : 2)} s` : `${value.toLocaleString()} ms` }
