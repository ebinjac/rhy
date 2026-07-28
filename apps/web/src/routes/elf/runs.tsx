import { useMemo } from "react"
import { createFileRoute, Link } from "@tanstack/react-router"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { Clock3, Database, Search } from "lucide-react"

import {
  deriveELFOperationalStatus,
  OperationalStatusBadge,
} from "@/components/operational-status"
import { listELFRuns } from "@/lib/api-client/elf"
import { formatDateTime } from "@/lib/format-date"

export const Route = createFileRoute("/elf/runs")({
  validateSearch: (search: Record<string, unknown>) => ({
    ...(typeof search.q === "string" && search.q ? { q: search.q } : {}),
    ...(positivePage(search.page) > 1
      ? { page: positivePage(search.page) }
      : {}),
  }),
  loader: () => listELFRuns(),
  component: RunsPage,
})
function RunsPage() {
  const runs = Route.useLoaderData()
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const query = search.q ?? ""
  const filtered = useMemo(() => {
    const value = query.trim().toLowerCase()
    if (!value) return runs
    return runs.filter((run) =>
      `${run.applicationName ?? ""} ${run.serviceName ?? ""} ${run.resolvedIndex} ${run.status} ${run.decision}`
        .toLowerCase()
        .includes(value)
    )
  }, [query, runs])
  const pageSize = 25
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))
  const currentPage = Math.min(search.page ?? 1, pageCount)
  const visibleRuns = filtered.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize
  )
  return (
    <main className="mx-auto max-w-[1380px] px-4 py-6 md:px-6 md:py-8">
      <header>
        <h1 className="font-heading text-2xl font-semibold">ELF runs</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Sanitized probe and gate evidence. Sample documents expire after seven
          days.
        </p>
      </header>
      {runs.length ? (
        <div className="relative mt-7 max-w-lg">
          <Search className="absolute top-2.5 left-3 size-4 text-muted-foreground" />
          <Input
            aria-label="Search ELF runs"
            className="pl-9"
            value={query}
            onChange={(event) => {
              void navigate({
                search: { q: event.target.value, page: 1 },
                replace: true,
              })
            }}
            placeholder="Search application, service, index, or outcome"
          />
        </div>
      ) : null}
      <div className="mt-4 border-y">
        <table className="hidden w-full text-left text-sm md:table">
          <thead className="bg-muted/35 text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2.5 font-medium">Outcome</th>
              <th className="px-3 py-2.5 font-medium">Application / service</th>
              <th className="px-3 py-2.5 font-medium">Index</th>
              <th className="px-3 py-2.5 font-medium">Window</th>
              <th className="px-3 py-2.5 text-right font-medium">Hits</th>
              <th className="px-3 py-2.5 text-right font-medium">OpenSearch</th>
              <th className="px-3 py-2.5 text-right font-medium">Round trip</th>
              <th className="px-3 py-2.5 font-medium">Evidence</th>
              <th className="px-3 py-2.5 text-right font-medium">Details</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {visibleRuns.map((run) => (
              <tr key={run.id} className="hover:bg-muted/20">
                <td className="px-3 py-3">
                  <div className="flex items-center gap-2">
                    <div>
                      <OperationalStatusBadge
                        status={deriveELFOperationalStatus(run)}
                      />
                      <p className="text-xs text-muted-foreground">
                        {run.gateMode}
                      </p>
                    </div>
                  </div>
                </td>
                <td className="px-3 py-3">
                  <p>{run.applicationName || "Deleted application"}</p>
                  <p className="text-xs text-muted-foreground">
                    {run.serviceName || "All services"}
                  </p>
                </td>
                <td className="max-w-[220px] truncate px-3 py-3 font-mono text-xs">
                  {run.resolvedIndex}
                </td>
                <td className="px-3 py-3">
                  <p className="text-xs">{formatDateTime(run.createdAt)}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {Math.round(
                      (new Date(run.timeTo).getTime() -
                        new Date(run.timeFrom).getTime()) /
                        60000
                    )}{" "}
                    min
                  </p>
                </td>
                <td className="px-3 py-3 text-right tabular-nums">
                  {run.hitCount.toLocaleString()}
                </td>
                <td className="px-3 py-3 text-right tabular-nums">
                  {run.openSearchTookMs} ms
                </td>
                <td className="px-3 py-3 text-right tabular-nums">
                  {run.roundTripMs} ms
                </td>
                <td className="px-3 py-3">
                  <Badge variant="outline">{run.sampleState}</Badge>
                </td>
                <td className="px-3 py-3 text-right">
                  <Link
                    className="inline-flex min-h-11 items-center text-sm font-medium text-primary hover:underline"
                    params={{ runId: run.id }}
                    to="/elf/run/$runId"
                  >
                    View evidence
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="divide-y md:hidden">
          {visibleRuns.map((run) => (
            <article className="py-4" key={run.id}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <OperationalStatusBadge
                    status={deriveELFOperationalStatus(run)}
                  />
                  <h2 className="mt-2 font-medium">
                    {run.applicationName || "Deleted application"}
                  </h2>
                  <p className="text-xs text-muted-foreground">
                    {run.serviceName || "All services"} ·{" "}
                    {formatDateTime(run.createdAt)}
                  </p>
                </div>
                <span className="font-mono text-sm font-semibold">
                  {run.hitCount.toLocaleString()} hits
                </span>
              </div>
              <dl className="mt-4 grid grid-cols-2 gap-3 text-xs">
                <div>
                  <dt className="text-muted-foreground">Index</dt>
                  <dd className="mt-1 truncate font-mono">
                    {run.resolvedIndex}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Timing</dt>
                  <dd className="mt-1">
                    {run.openSearchTookMs} ms OpenSearch · {run.roundTripMs} ms
                    total
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Gate</dt>
                  <dd className="mt-1">{run.gateMode}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Evidence</dt>
                  <dd className="mt-1">{run.sampleState}</dd>
                </div>
              </dl>
              <Link
                className="mt-3 inline-flex min-h-11 items-center text-sm font-medium text-primary hover:underline"
                params={{ runId: run.id }}
                to="/elf/run/$runId"
              >
                View evidence
              </Link>
            </article>
          ))}
        </div>
        {!runs.length ? (
          <div className="py-16 text-center">
            <Database className="mx-auto size-7 text-muted-foreground" />
            <h2 className="mt-3 font-medium">No ELF executions</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Probe a saved query to create normalized evidence.
            </p>
            <Link
              className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline"
              to="/elf"
            >
              <Clock3 className="size-4" />
              Open query library
            </Link>
          </div>
        ) : null}
      </div>
      {filtered.length > pageSize ? (
        <div className="mt-4 flex items-center justify-between gap-3">
          <Button
            disabled={currentPage === 1}
            size="sm"
            variant="outline"
            onClick={() =>
              void navigate({
                search: { q: query, page: Math.max(1, currentPage - 1) },
                replace: true,
              })
            }
          >
            Previous
          </Button>
          <span className="text-xs text-muted-foreground">
            Page {currentPage} of {pageCount} · {filtered.length} runs
          </span>
          <Button
            disabled={currentPage === pageCount}
            size="sm"
            variant="outline"
            onClick={() =>
              void navigate({
                search: {
                  q: query,
                  page: Math.min(pageCount, currentPage + 1),
                },
                replace: true,
              })
            }
          >
            Next
          </Button>
        </div>
      ) : runs.length ? (
        <p className="mt-3 text-xs text-muted-foreground">
          Showing {visibleRuns.length} of {runs.length} runs
        </p>
      ) : null}
    </main>
  )
}

function positivePage(value: unknown) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1
}
