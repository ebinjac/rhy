import { useMemo, useState } from "react"
import { createFileRoute, Link } from "@tanstack/react-router"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { Checkbox } from "@workspace/ui/components/checkbox"
import { Input } from "@workspace/ui/components/input"
import { Activity, ArrowLeft, ArrowRight, ChartNoAxesCombined, Check, CircleAlert, History } from "lucide-react"

import type { RunContract } from "@/lib/api-client/contracts"
import { listMonitorRuns } from "@/lib/api-client/monitors"
import { formatDateTime as formatDate } from "@/lib/format-date"
import { PageContainer } from "@/components/page-container"

export const Route = createFileRoute("/monitors/$monitorId/runs/")({
  loader: ({ params }) => listMonitorRuns({ data: { monitorId: params.monitorId } }),
  component: MonitorRunsPage,
})

function MonitorRunsPage() {
  const runs = Route.useLoaderData()
  const { monitorId } = Route.useParams()
  const [query, setQuery] = useState("")
  const [statusFilter, setStatusFilter] = useState("")
  const [trigger, setTrigger] = useState("")
  const [page, setPage] = useState(1)
  const [compare, setCompare] = useState<Set<string>>(new Set())
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
  const pageSize = 25
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))
  const visible = filtered.slice((page - 1) * pageSize, page * pageSize)
  const completed = runs.filter((run) => !["QUEUED", "STARTING", "RUNNING"].includes(run.status))
  const successful = completed.filter((run) => run.status === "SUCCESS" || run.status === "SUCCESS_WITH_WARNINGS").length
  const averageDuration = completed.length ? Math.round(completed.reduce((sum, run) => sum + run.durationMs, 0) / completed.length) : 0

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
      <Summary icon={History} label="Recorded runs" value={String(runs.length)} />
      <Summary icon={Check} label="Success rate" value={completed.length ? `${Math.round(successful / completed.length * 100)}%` : "—"} />
      <Summary icon={Activity} label="Average execution" value={completed.length ? formatDuration(averageDuration) : "—"} />
    </section>
    <section className="mt-8"><div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-end"><div><h2 className="font-heading text-lg font-semibold">Latest executions</h2><p className="mt-0.5 text-sm text-muted-foreground">Newest first. API response excludes Rhythm orchestration and checks.</p></div><Link className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline" params={{ monitorId }} to="/monitors/$monitorId/metrics">View performance metrics <ArrowRight className="size-3.5" /></Link></div>
      <div className="mt-4 flex flex-wrap gap-2 border-y py-3">
        <Input aria-label="Search run ID" className="max-w-xs" placeholder="Search run ID" value={query} onChange={(event) => { setQuery(event.target.value); setPage(1) }} />
        <select aria-label="Filter run status" className="h-9 rounded-lg border bg-background px-3 text-sm" value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value); setPage(1) }}><option value="">All statuses</option>{Array.from(new Set(runs.map((run) => run.status))).map((value) => <option key={value}>{value}</option>)}</select>
        <select aria-label="Filter run trigger" className="h-9 rounded-lg border bg-background px-3 text-sm" value={trigger} onChange={(event) => { setTrigger(event.target.value); setPage(1) }}><option value="">All triggers</option>{Array.from(new Set(runs.map((run) => run.triggerType))).map((value) => <option key={value}>{value}</option>)}</select>
      </div>
      {compare.size === 2 ? <div className="mt-3 bg-primary/8 px-4 py-3 text-sm">Two executions selected. Full execution differs by {Math.abs([...compare].map((id) => runs.find((run) => run.id === id)?.durationMs ?? 0).reduce((left, right) => left - right)).toLocaleString()} ms. Open each execution for phase-level comparison.</div> : null}
      {!filtered.length ? <div className="mt-4 rounded-xl border border-dashed px-6 py-14 text-center"><History className="mx-auto size-7 text-muted-foreground" /><h3 className="mt-4 font-medium">No runs found</h3><p className="mt-1 text-sm text-muted-foreground">{runs.length ? "Clear a filter to see more executions." : "Run a draft or published revision to create execution evidence."}</p></div> : <div className="mt-4 overflow-hidden rounded-xl border"><div className="hidden grid-cols-[32px_minmax(180px,1fr)_145px_130px_120px_120px_36px] gap-4 border-b bg-muted/45 px-4 py-2.5 text-xs font-medium text-muted-foreground md:grid"><span>Compare</span><span>Started</span><span>Result</span><span>Trigger</span><span>API response</span><span>Full execution</span><span /></div>{visible.map((run) => <RunRow compare={compare.has(run.id)} key={run.id} onCompare={(checked) => setCompare((current) => { const next = new Set(current); if (checked) { if (next.size >= 2) next.delete(next.values().next().value!); next.add(run.id) } else next.delete(run.id); return next })} run={run} />)}</div>}
      {filtered.length ? <div className="mt-3 flex items-center justify-between gap-4 text-xs text-muted-foreground"><span>Showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, filtered.length)} of {filtered.length}</span><div className="flex items-center gap-2"><Button disabled={page === 1} onClick={() => setPage((value) => value - 1)} size="sm" variant="outline">Previous</Button><span>Page {page} of {pageCount}</span><Button disabled={page === pageCount} onClick={() => setPage((value) => value + 1)} size="sm" variant="outline">Next</Button></div></div> : null}
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

function Summary({ icon: Icon, label, value }: { icon: typeof History; label: string; value: string }) {
  return <div className="flex min-w-56 flex-1 items-center gap-3 px-5 py-4"><span className="grid size-8 place-items-center rounded-lg bg-muted"><Icon className="size-4" /></span><div><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 font-heading text-lg font-semibold">{value}</p></div></div>
}

function formatDuration(value: number) { return value >= 1000 ? `${(value / 1000).toFixed(value >= 10000 ? 1 : 2)} s` : `${value.toLocaleString()} ms` }
