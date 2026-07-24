import { createFileRoute, Link } from "@tanstack/react-router"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { Activity, ArrowLeft, ArrowRight, ChartNoAxesCombined, Check, CircleAlert, History } from "lucide-react"

import type { RunContract } from "@/lib/api-client/contracts"
import { listMonitorRuns } from "@/lib/api-client/monitors"
import { formatDateTime as formatDate } from "@/lib/format-date"

export const Route = createFileRoute("/monitors/$monitorId/runs/")({
  loader: ({ params }) => listMonitorRuns({ data: { monitorId: params.monitorId } }),
  component: MonitorRunsPage,
})

function MonitorRunsPage() {
  const runs = Route.useLoaderData()
  const { monitorId } = Route.useParams()
  const completed = runs.filter((run) => !["QUEUED", "STARTING", "RUNNING"].includes(run.status))
  const successful = completed.filter((run) => run.status === "SUCCESS" || run.status === "SUCCESS_WITH_WARNINGS").length
  const averageDuration = completed.length ? Math.round(completed.reduce((sum, run) => sum + run.durationMs, 0) / completed.length) : 0

  return <div className="mx-auto max-w-[1280px] px-4 py-6 md:px-6 md:py-8">
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
    <section className="mt-8"><div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-end"><div><h2 className="font-heading text-lg font-semibold">Latest executions</h2><p className="mt-0.5 text-sm text-muted-foreground">Newest first. Evidence is masked before storage.</p></div><Link className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline" params={{ monitorId }} to="/monitors/$monitorId/metrics">View performance metrics <ArrowRight className="size-3.5" /></Link></div>
      {!runs.length ? <div className="mt-4 rounded-xl border border-dashed px-6 py-14 text-center"><History className="mx-auto size-7 text-muted-foreground" /><h3 className="mt-4 font-medium">No runs recorded</h3><p className="mt-1 text-sm text-muted-foreground">Run a draft or published revision to create execution evidence.</p></div> : <div className="mt-4 overflow-hidden rounded-xl border"><div className="hidden grid-cols-[minmax(180px,1fr)_150px_150px_120px_36px] gap-4 border-b bg-muted/45 px-4 py-2.5 text-xs font-medium text-muted-foreground md:grid"><span>Started</span><span>Result</span><span>Trigger</span><span>Execution</span><span /></div>{runs.map((run) => <RunRow key={run.id} run={run} />)}</div>}
    </section>
  </div>
}

function RunRow({ run }: { run: RunContract }) {
  const success = run.status === "SUCCESS" || run.status === "SUCCESS_WITH_WARNINGS"
  const active = ["QUEUED", "STARTING", "RUNNING"].includes(run.status)
  return <Link className="grid gap-3 border-b px-4 py-4 transition-colors last:border-b-0 hover:bg-muted/30 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset md:grid-cols-[minmax(180px,1fr)_150px_150px_120px_36px] md:items-center md:gap-4" params={{ monitorId: run.monitorId, runId: run.id }} to="/monitors/$monitorId/runs/$runId">
    <div><p className="text-sm font-medium">{formatDate(run.startedAt ?? run.createdAt)}</p><p className="mt-1 font-mono text-xs text-muted-foreground">{run.id.slice(0, 8)}</p></div>
    <Badge className={success ? "w-fit bg-success-soft text-success-foreground" : active ? "w-fit" : "w-fit bg-destructive/10 text-destructive"} variant="secondary">{success ? <Check /> : <CircleAlert />}{run.status.replaceAll("_", " ")}</Badge>
    <span className="text-sm text-muted-foreground">{run.triggerType.toLowerCase().replaceAll("_", " ")}</span><span className="font-mono text-sm">{active ? "In progress" : formatDuration(run.durationMs)}</span><ArrowRight className="size-4 text-muted-foreground" />
  </Link>
}

function Summary({ icon: Icon, label, value }: { icon: typeof History; label: string; value: string }) {
  return <div className="flex min-w-56 flex-1 items-center gap-3 px-5 py-4"><span className="grid size-8 place-items-center rounded-lg bg-muted"><Icon className="size-4" /></span><div><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 font-heading text-lg font-semibold">{value}</p></div></div>
}

function formatDuration(value: number) { return value >= 1000 ? `${(value / 1000).toFixed(value >= 10000 ? 1 : 2)} s` : `${value.toLocaleString()} ms` }
