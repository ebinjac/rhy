import { useMemo } from "react"
import { createFileRoute, Link } from "@tanstack/react-router"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@workspace/ui/components/table"
import { ArrowRight, History, Search } from "lucide-react"

import { PageContainer } from "@/components/page-container"
import {
  BrowserRunBadge,
  formatDuration,
} from "@/features/ui-monitoring/browser-monitor-status"
import { listBrowserRuns } from "@/lib/api-client/browser-monitoring"
import { formatDateTime } from "@/lib/format-date"

export const Route = createFileRoute("/ui-monitoring/$monitorId/runs/")({
  validateSearch: (search: Record<string, unknown>) => ({
    ...(typeof search.q === "string" && search.q ? { q: search.q } : {}),
    ...(typeof search.status === "string" && search.status
      ? { status: search.status }
      : {}),
  }),
  loader: ({ params }) =>
    listBrowserRuns({ data: { monitorId: params.monitorId, limit: 100 } }),
  component: BrowserRunHistory,
})

function BrowserRunHistory() {
  const runs = Route.useLoaderData()
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const { monitorId } = Route.useParams()
  const query = (search.q ?? "").trim().toLowerCase()
  const status = search.status ?? "ALL"
  const filtered = useMemo(
    () =>
      runs.filter((run) => {
        if (status !== "ALL" && run.status !== status) return false
        if (!query) return true
        return [
          run.id,
          run.triggerType,
          run.browserName,
          run.failureCategory ?? "",
          run.failureReason ?? "",
        ].some((value) => value.toLowerCase().includes(query))
      }),
    [query, runs, status]
  )

  return (
    <PageContainer as="main">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div>
          <h1 className="text-2xl font-semibold">Browser run history</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Journey outcomes with complete execution time, browser profile,
            trigger, and direct incident diagnostics.
          </p>
        </div>
        <Button
          nativeButton={false}
          render={
            <Link
              params={{ monitorId }}
              to="/ui-monitoring/$monitorId/metrics"
            />
          }
          variant="outline"
        >
          View metrics
          <ArrowRight />
        </Button>
      </div>

      <div className="mt-6 flex flex-col gap-3 sm:flex-row">
        <div className="relative min-w-0 flex-1 sm:max-w-sm">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label="Search browser runs"
            className="h-11 pl-9 sm:h-9"
            onChange={(event) =>
              void navigate({
                search: (previous) => ({
                  ...previous,
                  q: event.target.value || undefined,
                }),
                replace: true,
              })
            }
            placeholder="Search run ID, trigger, or failure"
            value={search.q ?? ""}
          />
        </div>
        <Select
          onValueChange={(value) =>
            void navigate({
              search: (previous) => ({
                ...previous,
                status: value === "ALL" ? undefined : (value ?? undefined),
              }),
              replace: true,
            })
          }
          value={status}
        >
          <SelectTrigger
            aria-label="Filter run status"
            className="h-11 w-full sm:h-9 sm:w-52"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All outcomes</SelectItem>
            <SelectItem value="SUCCESS">Success</SelectItem>
            <SelectItem value="SUCCESS_WITH_WARNINGS">
              Success with warnings
            </SelectItem>
            <SelectItem value="FAILED">Failed</SelectItem>
            <SelectItem value="TIMED_OUT">Timed out</SelectItem>
            <SelectItem value="CANCELLED">Cancelled</SelectItem>
          </SelectContent>
        </Select>
        <p className="self-center text-xs text-muted-foreground sm:ml-auto">
          {filtered.length} executions
        </p>
      </div>

      {!runs.length ? (
        <div className="mt-6 flex min-h-72 flex-col items-center justify-center rounded-xl border border-dashed px-6 text-center">
          <History className="size-6 text-primary" />
          <h2 className="mt-3 font-semibold">No browser runs yet</h2>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">
            Run the published journey from Overview. Scheduled executions will
            appear here as they complete.
          </p>
        </div>
      ) : (
        <>
          <div className="mt-4 hidden overflow-hidden rounded-xl border md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Outcome</TableHead>
                  <TableHead>Started</TableHead>
                  <TableHead>Journey</TableHead>
                  <TableHead>Profile</TableHead>
                  <TableHead>Trigger</TableHead>
                  <TableHead>Failure</TableHead>
                  <TableHead className="w-24" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((run) => (
                  <TableRow key={run.id}>
                    <TableCell>
                      <BrowserRunBadge status={run.status} />
                    </TableCell>
                    <TableCell className="text-sm">
                      {formatDateTime(run.startedAt ?? run.createdAt)}
                      <span className="block font-mono text-[11px] text-muted-foreground">
                        {run.id.slice(0, 8)}
                      </span>
                    </TableCell>
                    <TableCell className="text-sm tabular-nums">
                      {formatDuration(run.durationMs)}
                    </TableCell>
                    <TableCell className="text-sm capitalize">
                      {run.browserName}
                      <span className="block text-xs text-muted-foreground">
                        {readViewport(run.viewport)}
                      </span>
                    </TableCell>
                    <TableCell className="text-sm capitalize">
                      {run.triggerType.toLowerCase()}
                    </TableCell>
                    <TableCell className="max-w-xs truncate text-sm">
                      {run.failureCategory
                        ? run.failureCategory.toLowerCase().replaceAll("_", " ")
                        : "—"}
                    </TableCell>
                    <TableCell>
                      <Button
                        nativeButton={false}
                        render={
                          <Link
                            params={{ monitorId, runId: run.id }}
                            to="/ui-monitoring/$monitorId/runs/$runId"
                          />
                        }
                        size="sm"
                        variant="ghost"
                      >
                        Details
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="mt-4 grid gap-3 md:hidden">
            {filtered.map((run) => (
              <article className="rounded-xl border p-4" key={run.id}>
                <div className="flex items-center justify-between gap-3">
                  <BrowserRunBadge status={run.status} />
                  <span className="font-mono text-xs text-muted-foreground">
                    {run.id.slice(0, 8)}
                  </span>
                </div>
                <dl className="mt-4 grid grid-cols-2 gap-3 border-t pt-3 text-sm">
                  <div>
                    <dt className="text-xs text-muted-foreground">Started</dt>
                    <dd className="mt-0.5">
                      {formatDateTime(run.startedAt ?? run.createdAt)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Journey</dt>
                    <dd className="mt-0.5">{formatDuration(run.durationMs)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Browser</dt>
                    <dd className="mt-0.5 capitalize">{run.browserName}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Trigger</dt>
                    <dd className="mt-0.5 capitalize">
                      {run.triggerType.toLowerCase()}
                    </dd>
                  </div>
                </dl>
                <Button
                  className="mt-4 h-11 w-full"
                  nativeButton={false}
                  render={
                    <Link
                      params={{ monitorId, runId: run.id }}
                      to="/ui-monitoring/$monitorId/runs/$runId"
                    />
                  }
                  variant="outline"
                >
                  Open diagnostics
                  <ArrowRight />
                </Button>
              </article>
            ))}
          </div>
        </>
      )}
    </PageContainer>
  )
}

function readViewport(viewport: Record<string, unknown>) {
  const width = typeof viewport.width === "number" ? viewport.width : undefined
  const height =
    typeof viewport.height === "number" ? viewport.height : undefined
  return width && height ? `${width} × ${height}` : "Viewport not recorded"
}
